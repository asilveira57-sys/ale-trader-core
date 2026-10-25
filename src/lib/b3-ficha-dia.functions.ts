// Ficha do dia — SOMENTE LEITURA. Duas RPCs por recorte: b3_ficha_dia_ordens
// (uma linha por ordem) e b3_ficha_dia_resumo (totais do mesmo recorte).
// Nada é calculado aqui.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getB3FichaDia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    symbols: z.array(z.string()).max(20).nullable(),
    variants: z.array(z.string()).max(20).nullable(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const args = {
      p_user_id: context.userId, p_dia: data.date,
      p_symbols: data.symbols?.length ? data.symbols : null,
      p_variants: data.variants?.length ? data.variants : null,
    };
    const [linhas, resumo] = await Promise.all([
      sb.rpc("b3_ficha_dia_ordens", args),
      sb.rpc("b3_ficha_dia_resumo", args),
    ]);
    if (linhas.error) throw new Error(linhas.error.message);
    if (resumo.error) throw new Error(resumo.error.message);
    const r = Array.isArray(resumo.data) ? resumo.data[0] ?? null : resumo.data ?? null;
    return { date: data.date, linhas: (linhas.data ?? []) as any[], resumo: r as any };
  });
