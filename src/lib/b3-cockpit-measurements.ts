// Pure measurement shared with geometriaPA; callers choose their own window.
export const directionalEfficiency = (displacement: number, amplitude: number) => displacement / amplitude;

export interface DailyPeak {
  trade_date: string; symbol: string; variant: string; mode: string; pico_margem_brl: number | null;
}

export function aggregateDailyPeaks(rows: DailyPeak[]) {
  const assets: Record<string, Record<string, number>> = {};
  const variants: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (row.pico_margem_brl == null || !Number.isFinite(Number(row.pico_margem_brl))) continue;
    const value = Number(row.pico_margem_brl);
    const asset = assets[row.symbol] ??= {};
    const variant = variants[`${row.symbol}|${row.variant}`] ??= {};
    // Only sum robots WITHIN one date, never maxima across dates.
    asset[row.trade_date] = (asset[row.trade_date] ?? 0) + value;
    variant[row.trade_date] = (variant[row.trade_date] ?? 0) + value;
  }
  return { assets, variants };
}

export function peakSummary(dates: string[], peaks?: Record<string, number>) {
  let mean = 0, count = 0, max = -Infinity;
  for (const date of dates) {
    const value = peaks?.[date];
    if (value == null || !Number.isFinite(value)) continue;
    count += 1;
    mean += (value - mean) / count;
    max = Math.max(max, value);
  }
  // Do not disguise an absent day as zero or average a different window.
  return { max: count ? max : null, mean: count === 5 && dates.length === 5 ? mean : null, count };
}

export interface HistoryCandle {
  minute_ts: string; candle_open: number; candle_high: number; candle_low: number; candle_close: number;
}

export function candlePath(rows: HistoryCandle[], step: number) {
  const points: { time: number; price: number; segment: number }[] = [];
  let previous = 0, segment = 0, bucket = -1;
  let high = -Infinity, low = Infinity;
  for (const row of rows) {
    const time = new Date(row.minute_ts).getTime();
    if (!Number.isFinite(time)) continue;
    high = Math.max(high, Number(row.candle_high));
    low = Math.min(low, Number(row.candle_low));
    // A missing minute interrupts the path: never interpolate a hole.
    if (previous && time - previous > 60_000) { segment += 1; bucket = -1; }
    const nextBucket = Math.floor(time / (step * 60_000));
    if (nextBucket !== bucket) {
      if (bucket === -1) points.push({ time, price: Number(row.candle_open), segment });
      points.push({ time: time + 60_000, price: Number(row.candle_close), segment });
      bucket = nextBucket;
    } else {
      points[points.length - 1] = { time: time + 60_000, price: Number(row.candle_close), segment };
    }
    previous = time;
  }
  const first = rows[0], last = rows[rows.length - 1];
  const amplitude = rows.length ? high - low : null;
  const efficiency = first && last && amplitude != null && amplitude > 0
    ? directionalEfficiency(Number(last.candle_close) - Number(first.candle_open), amplitude) : null;
  return { points, amplitude, efficiency, opening: first ? Number(first.candle_open) : null };
}