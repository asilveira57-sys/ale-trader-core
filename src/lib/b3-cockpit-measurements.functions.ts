// Read-only cockpit measurements. No motor, writes, external API or parameters.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { addDays } from "@/lib/b3-period";
import { rootSymbol } from "@/lib/b3-format";
import { aggregateDailyPeaks, candlePath, type DailyPeak, type HistoryCandle } from "./b3-cockpit-measurements";

export const getCockpitDailyPeaks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(6),
    symbols: z.array(z.string()).nullish(), variants: z.array(z.string()).nullish(), modes: z.array(z.string()).nullish(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const rows: DailyPeak[] = [];
    const limit = 10_000;
    let truncated = false;
    for (let from = 0; from < limit; from += 1000) {
      let query = context.supabase.from("b3_robot_daily_score")
        .select("trade_date,symbol,variant,mode,pico_margem_brl")
        .eq("user_id", context.userId).in("trade_date", data.dates)
        .order("trade_date").order("symbol").order("variant").order("mode");
      if (data.variants) query = query.in("variant", data.variants);
      if (data.modes) query = query.in("mode", data.modes);
      const { data: page, error } = await query.range(from, from + 999);
      if (error) throw new Error("Não foi possível ler os picos dos pregões");
      rows.push(...(page ?? []));
      if (rows.length >= limit) { truncated = true; break; }
      if (!page || page.length < 1000) break;
    }
    const selected = data.symbols ? new Set(data.symbols.map(rootSymbol)) : null;
    const filtered = rows.map((row) => ({ ...row, symbol: rootSymbol(row.symbol) }))
      .filter((row) => !selected || selected.has(row.symbol));
    // Example intent: WIN 05/10 reached a peak then returned most of it by close.
    // Daily robot peaks are aggregated per date BEFORE maximum/mean across dates.
    return { ...aggregateDailyPeaks(filtered), rows_truncated: truncated };
  });

export const getCockpitPricePath = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    symbol: z.string().regex(/^[A-Z0-9]{2,12}$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    step: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const root = rootSymbol(data.symbol);
    const rows: (HistoryCandle & { symbol: string })[] = [];
    let truncated = false;
    for (let from = 0; from < 5000; from += 1000) {
      const { data: page, error } = await context.supabase.from("b3_m1_candles_hist")
        .select("symbol,minute_ts,candle_open,candle_high,candle_low,candle_close")
        .eq("user_id", context.userId).like("symbol", `${root}%`)
        .gte("minute_ts", `${data.date}T03:00:00.000Z`)
        .lt("minute_ts", `${addDays(data.date, 1)}T03:00:00.000Z`)
        .order("minute_ts").order("symbol").range(from, from + 999);
      if (error) throw new Error("Não foi possível ler o preço do pregão");
      rows.push(...(page ?? []));
      if (rows.length >= 5000) { truncated = true; break; }
      if (!page || page.length < 1000) break;
    }
    // Use only stored M1 history, including its real gaps (10–13/10 absent).
    const candles = rows.filter((row) => rootSymbol(row.symbol) === root);
    return { ...candlePath(candles, data.step), rows_truncated: truncated };
  });