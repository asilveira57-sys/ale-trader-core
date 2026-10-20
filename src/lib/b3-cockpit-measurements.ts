// Pure measurement shared with geometriaPA; callers choose their own window.
export const directionalEfficiency = (displacement: number, amplitude: number) => displacement / amplitude;

// Realized peak per day from b3_pico_realizado_dia: max over time of the
// group's cumulative closed result. Never sum peaks on any axis.
export interface RealizedPeak {
  trade_date: string; raiz: string; variant: string;
  pico_realizado_brl: number | null; fechamento_brl: number | null; devolveu_brl: number | null;
  hora_do_pico_brt: string | null; ordens: number | null;
}

export function indexRealizedPeaks(rows: RealizedPeak[], dates: string[]) {
  const wanted = new Set(dates);
  const assets: Record<string, Record<string, RealizedPeak>> = {};
  const variants: Record<string, Record<string, RealizedPeak>> = {};
  for (const row of rows) {
    if (!wanted.has(row.trade_date) || row.pico_realizado_brl == null) continue;
    // The asset line is the '(ativo)' curve, never a sum of modalities.
    if (row.variant === "(ativo)") (assets[row.raiz] ??= {})[row.trade_date] = row;
    else (variants[`${row.raiz}|${row.variant}`] ??= {})[row.trade_date] = row;
  }
  return { assets, variants };
}

export function peakSummary(dates: string[], peaks?: Record<string, { pico_realizado_brl: number | null } | number>) {
  let mean = 0, count = 0, max = -Infinity;
  for (const date of dates) {
    const raw = peaks?.[date];
    const value = raw == null ? null : typeof raw === "number" ? raw : raw.pico_realizado_brl;
    if (value == null || !Number.isFinite(Number(value))) continue;
    count += 1;
    mean += (Number(value) - mean) / count;
    max = Math.max(max, Number(value));
  }
  // Missing days are excluded (never zero); count says over how many days.
  return { max: count ? max : null, mean: count ? mean : null, count };
}

export interface FreioRow {
  trade_date: string; symbol: string; variant: string; mode: string;
  net_brl: number | null; net_brl_livre: number | null; trades_bloqueado_sombra: number | null;
}

export function freioEfeito(rows: FreioRow[], dates: string[]) {
  const days = dates.map((date) => {
    const of = rows.filter((r) => r.trade_date === date && r.net_brl != null && r.net_brl_livre != null);
    const com = of.reduce((s, r) => s + Number(r.net_brl), 0);
    const sem = of.reduce((s, r) => s + Number(r.net_brl_livre), 0);
    return { date, robots: of.length, com: of.length ? com : null, sem: of.length ? sem : null,
      efeito: of.length ? com - sem : null, barrados: of.reduce((s, r) => s + Number(r.trades_bloqueado_sombra ?? 0), 0) };
  });
  const lastDate = days.find((d) => d.robots > 0)?.date ?? null;
  const top = rows.filter((r) => r.trade_date === lastDate && Number(r.trades_bloqueado_sombra ?? 0) > 0
      && r.net_brl != null && r.net_brl_livre != null)
    .map((r) => ({ ...r, salvou: Number(r.net_brl) - Number(r.net_brl_livre) }))
    .filter((r) => r.salvou > 0).sort((a, b) => b.salvou - a.salvou).slice(0, 3);
  const valid = days.filter((d) => d.efeito != null);
  return { days, top, top_date: lastDate, saldo: valid.reduce((s, d) => s + (d.efeito ?? 0), 0), dias_com_dado: valid.length };
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