// Conferência do real contra o extrato da corretora. Lê e grava SOMENTE
// b3_real_extrato_corretora (lançamento manual do dono); nunca toca ordens reais.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const num = z.number().finite().nullable();
const extratoInput = z.object({
  pregao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ajuste_day_trade_brl: num, custos_brl: num, irrf_brl: num, deposito_brl: num, saldo_apos_brl: num,
  origem: z.enum(["extrato_pdf", "manual"]),
});

export const readConferencia = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const [div, ext] = await Promise.all([
    (context.supabase as any).rpc("b3_real_divergencia"),
    context.supabase.from("b3_real_extrato_corretora").select("*").eq("user_id", context.userId).order("pregao", { ascending: false }).range(0, 999),
  ]);
  if (div.error || ext.error) throw new Error("Não foi possível ler a conferência.");
  return { divergencia: (div.data ?? []) as any[], extrato: ext.data ?? [] };
});

export const saveExtrato = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((i: unknown) => extratoInput.parse(i)).handler(async ({ data, context }) => {
  const { error } = await context.supabase.from("b3_real_extrato_corretora")
    .upsert({ ...data, user_id: context.userId, lancado_em: new Date().toISOString() }, { onConflict: "user_id,pregao" });
  if (error) throw new Error("Não foi possível salvar o lançamento.");
  return { ok: true };
});
