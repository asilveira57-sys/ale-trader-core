import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { resolvePeriod, brtDate, daysBetween } from "./b3-period";
export const getPeriodPeakEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ preset: z.string().nullish(), start: z.string().nullish(), end: z.string().nullish(), symbols: z.array(z.string()).nullish(), variants: z.array(z.string()).nullish() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const period = resolvePeriod(data);
    const args = { p_user_id: context.userId, p_dias: Math.max(1, Math.ceil(daysBetween(period.start, brtDate(new Date())) / 4) + 1), p_symbols: data.symbols ?? null, p_variants: data.variants ?? null };
    const timings: { chamada: string; ms: number; linhas: number }[] = [];
    const read = async (name: string, extra = {}) => {
      const start = performance.now();
      const result = await (context.supabase as any).rpc(name, { ...args, ...extra });
      timings.push({ chamada: name, ms: Math.round(performance.now() - start), linhas: result.data?.length ?? 0 });
      if (result.error) throw new Error("Não foi possível ler os picos do período");
      return (result.data ?? []).filter((r: any) => String(r.trade_date).slice(0, 10) >= period.start && String(r.trade_date).slice(0, 10) <= period.end);
    };
    const [realized, exposure] = await Promise.all([read("b3_pico_realizado_dia"), read("b3_pico_exposicao_dia", { p_folga: 1.30 })]);
    return { realized, exposure, timings, possible_truncation: timings.some((t) => t.linhas >= 1000) };
  });