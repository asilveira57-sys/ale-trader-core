import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { resolvePeriod } from "./b3-period";
import type { ThreeReading } from "./b3-three-readings";
import { sessionWindow } from "./b3-session-window";
export const readThreeReadings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ preset: z.string().nullish(), start: z.string().nullish(), end: z.string().nullish(), sessions: z.union([z.literal(5), z.literal(10)]).optional(), symbols: z.array(z.string()).nullish(), variants: z.array(z.string()).nullish(), modes: z.array(z.string()).nullish() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    let period = resolvePeriod(data);
    let sessionDates: string[] = [];
    if (data.sessions) {
      const { data: dates, error: datesError } = await context.supabase.rpc("b3_ultimos_pregoes", {
        p_user_id: context.userId, p_n: data.sessions, p_fim: period.end,
        p_symbols: data.symbols ?? undefined, p_variants: data.variants ?? undefined, p_modes: data.modes ?? undefined,
      });
      if (datesError) throw new Error("Não foi possível ler as datas dos pregões.");
      sessionDates = (dates ?? []).map(r => r.dia);
      const window = sessionWindow(sessionDates);
      if (window) period = resolvePeriod({ preset: "entre", ...window });
    }
    const clock = performance.now();
    const { data: result, error } = await context.supabase.rpc("b3_cockpit_tres_leituras", {
      p_user_id: context.userId, p_inicio: period.start, p_fim: period.end,
      p_symbols: data.symbols ?? undefined, p_variants: data.variants ?? undefined, p_modes: data.modes ?? undefined,
    });
    if (error) throw new Error("Não foi possível ler as três leituras do cockpit.");
    const out = result as unknown as { rows: ThreeReading[]; daily: any[] };
    const { data: colors, error: colorError } = await (context.supabase as any).rpc("b3_cores_dos_robos");
    if (colorError) throw new Error("Não foi possível ler as cores dos robôs.");
    return { ...out, colors: (colors ?? []) as any[], period, sessionDates, ms: Math.round(performance.now() - clock) };
  });

/** Presentation metadata only; exact authorization counts are provided by the database. */
export const readCockpitRealLabels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase.from("b3_prd_authorizations")
      .select("symbol,variant,mode,magic_number,max_qty").eq("user_id", context.userId).eq("enabled", true);
    if (error) throw new Error("Não foi possível ler os selos reais.");
    const groups = new Map((rows ?? []).map(r => [`${r.symbol}|${r.variant}`, r]));
    const counts = await Promise.all([...groups.values()].map(async r => {
      const { count, error: countError } = await context.supabase.from("b3_prd_authorizations")
        .select("id", { count: "exact", head: true }).eq("user_id", context.userId)
        .eq("enabled", true).eq("symbol", r.symbol).eq("variant", r.variant);
      if (countError) throw new Error("Não foi possível ler a contagem de autorizações.");
      return { symbol: r.symbol, variant: r.variant, count };
    }));
    return { rows: rows ?? [], counts };
  });