// Cérebro Binance — análise multitemporal + comitê de indicadores + score.
// Server-only. Sem efeitos colaterais; apenas lê Binance pública e calcula.

const BINANCE_PUBLIC = "https://api.binance.com";

export type TrendLabel = "Alta Forte" | "Alta Moderada" | "Lateral" | "Baixa Moderada" | "Baixa Forte";
export type Vote = "approve" | "reject" | "neutral";

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TimeframeAnalysis {
  tf: string;
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  trend: TrendLabel;
  changePct: number;
}

export interface IndicatorVote {
  indicator: string;
  vote: Vote;
  detail: string;
  value?: number;
}

export interface BrainAnalysis {
  symbol: string;
  side: "buy" | "sell" | "hold" | "skip";
  price: number;
  timeframes: TimeframeAnalysis[];
  dominantTrend: TrendLabel;
  timeframeConflict: boolean;
  indicators: IndicatorVote[];
  approve: number;
  reject: number;
  neutral: number;
  score: number;
  classification: string;
  volatilityClass: "Baixa" | "Normal" | "Alta" | "Extrema";
  volumeSignal: "crescente" | "decrescente" | "estavel" | "exaustao";
  fibLevels: Record<string, number>;
  feeBuy: number;
  feeSell: number;
  spreadPct: number;
  slippagePct: number;
  expectedGross: number;
  expectedNet: number;
  feeGatePassed: boolean;
  rationale: string;
  recommendation: "Excelente oportunidade" | "Boa operação" | "Aceitável" | "Muito arriscado" | "Reprovar";
}

// -------------- Binance public klines --------------
export async function fetchKlines(symbol: string, interval: string, limit = 200): Promise<Kline[]> {
  const url = `${BINANCE_PUBLIC}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { headers: { "User-Agent": "lovable-brain/1.0" } });
  if (!res.ok) throw new Error(`klines ${symbol} ${interval}: ${res.status}`);
  const raw = (await res.json()) as unknown[][];
  return raw.map((k) => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

// -------------- Indicadores --------------
function sma(arr: number[], n: number) {
  if (arr.length < n) return arr[arr.length - 1] ?? 0;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
}

function ema(arr: number[], n: number) {
  if (arr.length === 0) return 0;
  const k = 2 / (n + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

function rsi(closes: number[], n = 14) {
  if (closes.length < n + 1) return 50;
  let gain = 0, loss = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  const avgG = gain / n, avgL = loss / n;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function macd(closes: number[]) {
  const macdLine = ema(closes, 12) - ema(closes, 26);
  // signal via EMA9 of macd series (approx using last 35 points)
  const series: number[] = [];
  for (let i = 26; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    series.push(ema(slice, 12) - ema(slice, 26));
  }
  const signal = ema(series.length ? series : [macdLine], 9);
  return { macd: macdLine, signal, hist: macdLine - signal };
}

function bollinger(closes: number[], n = 20, k = 2) {
  const m = sma(closes, n);
  const slice = closes.slice(-n);
  const v = slice.reduce((a, c) => a + (c - m) ** 2, 0) / Math.max(slice.length, 1);
  const sd = Math.sqrt(v);
  return { mid: m, upper: m + k * sd, lower: m - k * sd, width: (2 * k * sd) / m };
}

function atr(highs: number[], lows: number[], closes: number[], n = 14) {
  if (closes.length < n + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }
  return sma(trs, n);
}

function adx(highs: number[], lows: number[], closes: number[], n = 14) {
  if (closes.length < n + 2) return 0;
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    plusDM += up > dn && up > 0 ? up : 0;
    minusDM += dn > up && dn > 0 ? dn : 0;
    tr += Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }
  if (tr === 0) return 0;
  const plusDI = (plusDM / tr) * 100;
  const minusDI = (minusDM / tr) * 100;
  const dx = (Math.abs(plusDI - minusDI) / Math.max(plusDI + minusDI, 0.0001)) * 100;
  return dx;
}

function fibLevels(high: number, low: number) {
  const d = high - low;
  return {
    "0.236": high - d * 0.236,
    "0.382": high - d * 0.382,
    "0.5": high - d * 0.5,
    "0.618": high - d * 0.618,
    "0.786": high - d * 0.786,
    "1.27": low - d * 0.27,
    "1.61": low - d * 0.61,
  };
}

// -------------- Tendência por timeframe --------------
function classifyTrend(closes: number[]): { trend: TrendLabel; changePct: number } {
  if (closes.length < 20) return { trend: "Lateral", changePct: 0 };
  const last = closes[closes.length - 1];
  const ref = closes[0];
  const pct = ((last - ref) / ref) * 100;
  const m20 = sma(closes, 20);
  const m50 = sma(closes, Math.min(50, closes.length));
  const above = last > m20 && m20 > m50;
  const below = last < m20 && m20 < m50;
  let trend: TrendLabel = "Lateral";
  if (above && pct > 3) trend = "Alta Forte";
  else if (above) trend = "Alta Moderada";
  else if (below && pct < -3) trend = "Baixa Forte";
  else if (below) trend = "Baixa Moderada";
  return { trend, changePct: pct };
}

// -------------- Comitê de indicadores --------------
function indicatorCommittee(tf1h: TimeframeAnalysis, tf4h: TimeframeAnalysis, tf1d: TimeframeAnalysis): IndicatorVote[] {
  const closes = tf1h.closes;
  const r = rsi(closes);
  const m = macd(closes);
  const bb = bollinger(closes);
  const a14 = atr(tf1h.highs, tf1h.lows, closes);
  const adxV = adx(tf1h.highs, tf1h.lows, closes);
  const last = closes[closes.length - 1];
  const m20 = sma(closes, 20);
  const m50 = sma(closes, 50);
  const volNow = tf1h.volumes[tf1h.volumes.length - 1] ?? 0;
  const volAvg = sma(tf1h.volumes, 20);

  const votes: IndicatorVote[] = [];

  votes.push({
    indicator: "Tendência",
    vote: tf1d.trend.startsWith("Alta") ? "approve" : tf1d.trend.startsWith("Baixa") ? "reject" : "neutral",
    detail: `1d: ${tf1d.trend} (${tf1d.changePct.toFixed(2)}%)`,
  });
  votes.push({
    indicator: "Momentum",
    vote: tf1h.changePct > 1 ? "approve" : tf1h.changePct < -1 ? "reject" : "neutral",
    detail: `1h Δ ${tf1h.changePct.toFixed(2)}%`,
    value: tf1h.changePct,
  });
  votes.push({
    indicator: "Volume",
    vote: volNow > volAvg * 1.3 ? "approve" : volNow < volAvg * 0.6 ? "reject" : "neutral",
    detail: `vol/avg ${(volNow / Math.max(volAvg, 1)).toFixed(2)}x`,
  });
  votes.push({
    indicator: "RSI",
    vote: r > 35 && r < 70 ? "approve" : r >= 70 ? "reject" : "neutral",
    detail: `RSI ${r.toFixed(1)}`,
    value: r,
  });
  votes.push({
    indicator: "MACD",
    vote: m.hist > 0 && m.macd > m.signal ? "approve" : m.hist < 0 ? "reject" : "neutral",
    detail: `hist ${m.hist.toFixed(4)}`,
    value: m.hist,
  });
  votes.push({
    indicator: "ADX",
    vote: adxV >= 25 ? "approve" : adxV < 15 ? "reject" : "neutral",
    detail: `ADX ${adxV.toFixed(1)}`,
    value: adxV,
  });
  votes.push({
    indicator: "Médias Móveis",
    vote: last > m20 && m20 > m50 ? "approve" : last < m20 && m20 < m50 ? "reject" : "neutral",
    detail: `last ${last.toFixed(2)} m20 ${m20.toFixed(2)} m50 ${m50.toFixed(2)}`,
  });
  votes.push({
    indicator: "Bandas de Bollinger",
    vote: last < bb.lower ? "approve" : last > bb.upper ? "reject" : "neutral",
    detail: `pos ${((last - bb.lower) / (bb.upper - bb.lower)).toFixed(2)}`,
  });
  votes.push({
    indicator: "ATR",
    vote: a14 / last < 0.02 ? "approve" : a14 / last > 0.05 ? "reject" : "neutral",
    detail: `ATR% ${((a14 / last) * 100).toFixed(2)}`,
  });
  votes.push({
    indicator: "Fibonacci",
    vote: (() => {
      const high = Math.max(...tf4h.highs);
      const low = Math.min(...tf4h.lows);
      const f = fibLevels(high, low);
      const near618 = Math.abs(last - f["0.618"]) / last < 0.005;
      const near500 = Math.abs(last - f["0.5"]) / last < 0.005;
      return near618 || near500 ? "approve" : "neutral";
    })(),
    detail: "fib 4h",
  });
  votes.push({
    indicator: "Price Action",
    vote: tf1h.changePct > 0 && tf4h.changePct > 0 ? "approve" : tf1h.changePct < 0 && tf4h.changePct < 0 ? "reject" : "neutral",
    detail: `1h+4h confluência`,
  });
  votes.push({
    indicator: "Suporte/Resistência",
    vote: (() => {
      const sup = Math.min(...closes.slice(-30));
      const res = Math.max(...closes.slice(-30));
      if ((last - sup) / sup < 0.01) return "approve";
      if ((res - last) / last < 0.01) return "reject";
      return "neutral";
    })(),
    detail: "30 períodos",
  });
  votes.push({
    indicator: "Fluxo comprador",
    vote: tf1h.changePct > 0 && volNow > volAvg ? "approve" : "neutral",
    detail: "preço↑ vol↑",
  });
  votes.push({
    indicator: "Fluxo vendedor",
    vote: tf1h.changePct < 0 && volNow > volAvg ? "reject" : "neutral",
    detail: "preço↓ vol↑",
  });
  votes.push({
    indicator: "Liquidez",
    vote: volAvg * last > 1_000_000 ? "approve" : "reject",
    detail: `notional avg ${(volAvg * last).toFixed(0)}`,
  });
  votes.push({
    indicator: "Volatilidade",
    vote: bb.width < 0.04 ? "approve" : bb.width > 0.12 ? "reject" : "neutral",
    detail: `BBwidth ${(bb.width * 100).toFixed(2)}%`,
  });
  votes.push({
    indicator: "Padrões gráficos",
    vote: (() => {
      const lastThree = closes.slice(-3);
      const rising = lastThree[2] > lastThree[1] && lastThree[1] > lastThree[0];
      const falling = lastThree[2] < lastThree[1] && lastThree[1] < lastThree[0];
      return rising ? "approve" : falling ? "reject" : "neutral";
    })(),
    detail: "3-bar",
  });

  return votes;
}

function classifyVolatility(bbWidth: number): BrainAnalysis["volatilityClass"] {
  if (bbWidth < 0.03) return "Baixa";
  if (bbWidth < 0.06) return "Normal";
  if (bbWidth < 0.12) return "Alta";
  return "Extrema";
}

function classifyScore(score: number): { classification: string; recommendation: BrainAnalysis["recommendation"] } {
  if (score <= 30) return { classification: "Reprovar", recommendation: "Reprovar" };
  if (score <= 50) return { classification: "Muito arriscado", recommendation: "Muito arriscado" };
  if (score <= 70) return { classification: "Operação aceitável", recommendation: "Aceitável" };
  if (score <= 85) return { classification: "Boa operação", recommendation: "Boa operação" };
  return { classification: "Excelente oportunidade", recommendation: "Excelente oportunidade" };
}

// -------------- Análise principal --------------
export async function loadIndicatorWeights(): Promise<Record<string, number>> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("binance_indicator_performance").select("indicator,weight");
    const map: Record<string, number> = {};
    for (const r of data ?? []) map[r.indicator] = Number(r.weight ?? 1.0);
    return map;
  } catch {
    return {};
  }
}

export async function analyzeBrain(symbol: string, opts?: { side?: "buy" | "sell"; notional?: number; sampleSize?: number; weights?: Record<string, number> }): Promise<BrainAnalysis> {
  const intervals: { tf: string; iv: string; limit: number }[] = [
    { tf: "1m", iv: "1m", limit: 60 },
    { tf: "5m", iv: "5m", limit: 60 },
    { tf: "15m", iv: "15m", limit: 60 },
    { tf: "1h", iv: "1h", limit: 100 },
    { tf: "4h", iv: "4h", limit: 100 },
    { tf: "1d", iv: "1d", limit: 60 },
    { tf: "7d", iv: "1d", limit: 7 },
    { tf: "15d", iv: "1d", limit: 15 },
    { tf: "30d", iv: "1d", limit: 30 },
  ];

  const results = await Promise.all(
    intervals.map(async ({ tf, iv, limit }) => {
      const k = await fetchKlines(symbol, iv, Math.max(limit, 60));
      const slice = k.slice(-limit);
      const closes = slice.map((x) => x.close);
      const highs = slice.map((x) => x.high);
      const lows = slice.map((x) => x.low);
      const volumes = slice.map((x) => x.volume);
      const { trend, changePct } = classifyTrend(closes);
      const tfa: TimeframeAnalysis = { tf, closes, highs, lows, volumes, trend, changePct };
      return tfa;
    }),
  );

  const byTf = Object.fromEntries(results.map((r) => [r.tf, r])) as Record<string, TimeframeAnalysis>;
  const price = byTf["1m"].closes[byTf["1m"].closes.length - 1];

  // Tendência dominante: peso maior nos tfs longos
  const weights: Record<string, number> = { "1m": 0.05, "5m": 0.05, "15m": 0.1, "1h": 0.15, "4h": 0.2, "1d": 0.2, "7d": 0.1, "15d": 0.075, "30d": 0.075 };
  let score = 0;
  let conflict = false;
  let upSides = 0, downSides = 0;
  for (const r of results) {
    const w = weights[r.tf] ?? 0;
    if (r.trend.startsWith("Alta")) { score += w; upSides++; }
    else if (r.trend.startsWith("Baixa")) { score -= w; downSides++; }
  }
  if (upSides > 0 && downSides > 0) conflict = true;
  const dominantTrend: TrendLabel = score > 0.3 ? "Alta Forte" : score > 0.1 ? "Alta Moderada" : score < -0.3 ? "Baixa Forte" : score < -0.1 ? "Baixa Moderada" : "Lateral";

  // Comitê
  const indicators = indicatorCommittee(byTf["1h"], byTf["4h"], byTf["1d"]);
  const approve = indicators.filter((i) => i.vote === "approve").length;
  const reject = indicators.filter((i) => i.vote === "reject").length;
  const neutral = indicators.filter((i) => i.vote === "neutral").length;

  // Score 0-100
  const total = indicators.length;
  const consensusPct = (approve / total) * 100;
  const trendAlignment = dominantTrend.startsWith("Alta") ? 100 : dominantTrend === "Lateral" ? 50 : 0;
  const bb = bollinger(byTf["1h"].closes);
  const vol = classifyVolatility(bb.width);
  const volPenalty = vol === "Extrema" ? 20 : vol === "Alta" ? 10 : 0;
  let finalScore =
    0.45 * consensusPct +
    0.30 * trendAlignment +
    0.15 * (100 - (reject / total) * 100) +
    0.10 * (conflict ? 40 : 90) - volPenalty;
  finalScore = Math.max(0, Math.min(100, finalScore));

  const { classification, recommendation } = classifyScore(finalScore);

  // Volume
  const volNow = byTf["1h"].volumes.at(-1) ?? 0;
  const volAvg = sma(byTf["1h"].volumes, 20);
  const volumeSignal: BrainAnalysis["volumeSignal"] =
    volNow > volAvg * 1.4 ? "crescente" : volNow < volAvg * 0.5 ? "exaustao" : volNow < volAvg * 0.9 ? "decrescente" : "estavel";

  // Fib
  const high4 = Math.max(...byTf["4h"].highs);
  const low4 = Math.min(...byTf["4h"].lows);
  const fib = fibLevels(high4, low4);

  // Taxas / lucro líquido esperado
  const notional = opts?.notional ?? 100;
  const feeRate = 0.001; // 0.1% spot taker padrão Binance
  const feeBuy = notional * feeRate;
  const feeSell = notional * feeRate;
  const spreadPct = (bb.width / 10);
  const slippagePct = vol === "Extrema" ? 0.003 : vol === "Alta" ? 0.0015 : 0.0007;
  const expectedGrossPct = Math.max(0, (finalScore - 50) / 50) * 0.02; // até 2%
  const expectedGross = notional * expectedGrossPct;
  const totalCost = feeBuy + feeSell + notional * (spreadPct + slippagePct);
  const expectedNet = expectedGross - totalCost;
  const feeGatePassed = expectedGross >= totalCost * 3;

  const side: BrainAnalysis["side"] = opts?.side
    ?? (dominantTrend.startsWith("Alta") && approve > reject ? "buy" : dominantTrend.startsWith("Baixa") && reject > approve ? "sell" : "hold");

  const rationale = [
    `Tendência dominante: ${dominantTrend}${conflict ? " (com conflito multitemporal)" : ""}.`,
    `Comitê: ${approve} aprovam, ${reject} reprovam, ${neutral} neutros.`,
    `Volatilidade ${vol}, volume ${volumeSignal}.`,
    `Lucro líquido esperado ${expectedNet.toFixed(4)} vs custo ${totalCost.toFixed(4)}.`,
    feeGatePassed ? "Filtro de taxas OK." : "Filtro de taxas BLOQUEIA (lucro < 3x custo).",
  ].join(" ");

  return {
    symbol, side, price,
    timeframes: results,
    dominantTrend, timeframeConflict: conflict,
    indicators, approve, reject, neutral,
    score: finalScore, classification,
    volatilityClass: vol, volumeSignal,
    fibLevels: fib,
    feeBuy, feeSell, spreadPct, slippagePct,
    expectedGross, expectedNet, feeGatePassed,
    rationale, recommendation,
  };
}
