import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCarteiraReal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { lerCarteira, capacidadePorAtivo, FOLGA_MARGEM } = await import("./b3-carteira.server");
    const c = await lerCarteira(supabase, userId);
    const capacidade = await capacidadePorAtivo(supabase, userId, c.capital_operacional_brl);
    const { data: mt5 } = await (supabase as any).from("b3_mt5_account_state")
      .select("capital_liquido, margem_livre, saldo, reportado_em").eq("user_id", userId).maybeSingle();
    const patrimonio = mt5?.capital_liquido ?? mt5?.saldo ?? null;
    const { data: bloqueios } = await (supabase as any).from("system_logs")
      .select("created_at, message").eq("event_type", "carteira_insuficiente")
      .order("created_at", { ascending: false }).limit(5);
    return {
      ...c, folga: FOLGA_MARGEM, capacidade,
      mt5: { patrimonio_brl: patrimonio == null ? null : Number(patrimonio),
        margem_livre_brl: mt5?.margem_livre == null ? null : Number(mt5.margem_livre), reportado_em: mt5?.reportado_em ?? null },
      diferenca_brl: patrimonio == null ? null : Math.round((Number(patrimonio) - c.capital_operacional_brl) * 100) / 100,
      bloqueios: bloqueios ?? [],
    };
  });

export const lancarCarteiraReal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tipo: z.enum(["aporte", "retirada", "ajuste"]),
    valor_brl: z.number().finite().refine((v) => v !== 0, "valor não pode ser zero"),
    observacao: z.string().max(500).optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const v = data.tipo === "aporte" ? Math.abs(data.valor_brl) : data.tipo === "retirada" ? -Math.abs(data.valor_brl) : data.valor_brl;
    const { error } = await (context.supabase as any).from("b3_real_carteira").insert({
      user_id: context.userId, data: data.data, tipo: data.tipo, valor_brl: v, observacao: data.observacao ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
