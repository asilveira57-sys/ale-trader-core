// Liberação manual de freio para o REAL — leitura e comandos da tela.
// Liberar exige a senha mestra (a mesma de religar o real); travar de volta
// não exige nada: reduzir exposição nunca deve ter atrito.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FREIOS = ["grupo", "pico", "pos_meta", "stop_diario"] as const;

const alvoSchema = z.object({
  escopo: z.enum(["grupo", "robo"]),
  symbol: z.string().min(1).max(20),
  variant: z.string().min(1).max(40),
  mode: z.string().min(1).max(40).nullable().optional(),
  freio: z.enum(FREIOS),
});

export const listLiberacoesFreio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listLiberacoesAtivas } = await import("./b3-liberacao-freio.server");
    const ativas = await listLiberacoesAtivas(context.supabase, context.userId);
    return { liberacoes: ativas };
  });

export const liberarFreioReal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    alvoSchema.extend({ password: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertMasterPassword } = await import("./prd-master-password.server");
    await assertMasterPassword(data.password);

    const { registrarLiberacao, listLiberacoesAtivas, chaveLiberacao } =
      await import("./b3-liberacao-freio.server");

    const alvo = {
      escopo: data.escopo,
      symbol: data.symbol,
      variant: data.variant,
      mode: data.escopo === "grupo" ? null : (data.mode ?? null),
      freio: data.freio,
    };
    if (alvo.escopo === "robo" && !alvo.mode) throw new Error("Liberação por robô exige o modo.");

    const jaAtivas = await listLiberacoesAtivas(supabase, userId);
    if (jaAtivas.some((l) => chaveLiberacao(l) === chaveLiberacao(alvo))) {
      return { ok: true as const, ja_estava: true };
    }

    // Estado do freio no momento da liberação: para o freio de grupo, nível e
    // resultado do grupo — sem isso o registro não diz o que foi contornado.
    let estado: Record<string, unknown> = {};
    if (data.freio === "grupo") {
      const { data: g } = await (supabase as any).from("b3_grupo_estado_dia")
        .select("nivel_atual, resultado_brl, multiplicador, robos_travados, trade_date")
        .eq("user_id", userId).eq("symbol", data.symbol).eq("variant", data.variant)
        .order("trade_date", { ascending: false }).limit(1).maybeSingle();
      estado = {
        grupo_nivel: g?.nivel_atual ?? null,
        grupo_resultado_brl: g?.resultado_brl ?? null,
        grupo_multiplicador: g?.multiplicador ?? null,
        grupo_travados: g?.robos_travados ?? null,
      };
    }

    const lib = await registrarLiberacao(supabase, userId, alvo, estado);
    return { ok: true as const, ja_estava: false, liberacao: lib };
  });

export const travarFreioReal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => alvoSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { listLiberacoesAbertas, encerrarLiberacoes, chaveLiberacao } =
      await import("./b3-liberacao-freio.server");
    const alvo = {
      escopo: data.escopo,
      symbol: data.symbol,
      variant: data.variant,
      mode: data.escopo === "grupo" ? null : (data.mode ?? null),
      freio: data.freio,
    };
    const abertas = await listLiberacoesAbertas(supabase, userId);
    const alvos = abertas.filter((l) => chaveLiberacao(l) === chaveLiberacao(alvo));
    const n = await encerrarLiberacoes(supabase, userId, alvos, "travado_pelo_usuario");
    return { ok: true as const, encerradas: n };
  });
