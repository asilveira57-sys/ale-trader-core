// Binance Exit Audit V2 — Cérebro Pós-Trade com indicadores reais.
// Calcula recovery via klines pós-saída + indicadores pré-saída (EMA, RSI, MACD, ATR, ADX, BB, VWAP, Volume),
// classifica saídas em ~25 categorias, mede confiança, deduplica trades cruzados,
// gera diagnóstico com motivos + recomendação por trade e relatório executivo agregado.
// Somente módulo Binance. Não toca tabelas b3_*.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LossSell = {
  source: "real_positions" | "automated_trades" | "simulated_orders";
  id: string;
  pair: string;
  side: "buy" | "sell";
  asset: string;
  opened_at: string;
  closed_at: string;
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  exit_reason: string | null;
  price_1h: number | null;
  price_4h: number | null;
  price_12h: number | null;
  price_24h: number | null;
  recovery_1h: number | null;
  recovery_4h: number | null;
  recovery_12h: number | null;
  recovery_24h: number | null;
  recovery_max: number | null;
  recovered_1h: boolean;
  recovered_4h: boolean;
  recovered_12h: boolean;
  recovered_24h: boolean;
  drop_pct: number;
  classification: string;
  diagnosis: string;
  premature: boolean;
  avoidable: boolean;
  score: number;
  candles_available: boolean;
  votes: Array<{ agent: string; vote: string; confidence: number }>;
  decision: {
    final_decision: string | null;
    score: number | null;
    consensus: number | null;
    justification: string | null;
  } | null;
  // V2
  confidence: number;                      // 0–100 (concordância dos indicadores)
  motivos: string[];                        // bullets do diagnóstico
  recommendation: string | null;            // ação sugerida
  recovery_lost_pct: number | null;         // mesmo que recovery_max para vendas prematuras
  recovery_lost_usdt: number | null;        // recovery convertido em USDT (posição estimada)
  indicators: Record<string, number | string | null> | null;
  pattern_key: string | null;               // assinatura do padrão p/ agregação
  duplicate: boolean;                       // marcado como duplicata
};

export type AuditReport = {
  generated_at: string;
  total_closed: number;
  total_losses: number;
  audited: number;
  pending: number;
  processed_this_run: number;
  has_more: boolean;
  duplicates_filtered: number;
  recovery_rate_1h: number;
  recovery_rate_4h: number;
  recovery_rate_12h: number;
  recovery_rate_24h: number;
  avg_recovery_1h: number;
  avg_recovery_4h: number;
  avg_recovery_12h: number;
  avg_recovery_24h: number;
  early_exit_score: number;
  premature_count: number;
  correct_count: number;
  avoidable_loss_usdt: number;
  unavoidable_loss_usdt: number;
  avoidable_stops: number;
  unavoidable_stops: number;
  perfect_pct: number;
  early_pct: number;
  quality_score: number;
  by_classification: Record<string, number>;
  quality: { label: "Excelente" | "Boa" | "Regular" | "Ruim" | "Crítica"; color: string; threshold_pct: number };
  alert: string | null;
  suggestions: string[];
  losses: LossSell[];
  // V2 executive report
  executive: {
    by_asset: Array<{ asset: string; count: number; premature: number; avg_recovery: number; lost_usdt: number }>;
    by_hour: Array<{ hour: number; count: number; premature: number }>;
    avg_recovery_by_asset: Record<string, number>;
    avg_recovery_by_period: { "1h": number; "4h": number; "12h": number; "24h": number };
    indicators_in_premature: Array<{ indicator: string; presence_pct: number; avg_value: number | null }>;
    top_patterns: Array<{ pattern: string; count: number; avg_recovery: number; lost_usdt: number }>;
    top_recommendations: Array<{ recommendation: string; count: number }>;
  };
};

const BINANCE_BASE = "https://api.binance.com";
const PREMATURE_THRESHOLD_PCT = 5;
const VERY_EARLY_THRESHOLD_PCT = 10;
const PERFECT_THRESHOLD_PCT = 0.5;

type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

async function fetchKlines(symbol: string, interval: string, startTime: number, endTime: number, limit = 300): Promise<Kline[]> {
  try {
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    return (await r.json()) as Kline[];
  } catch { return []; }
}

function extremeInWindow(klines: Kline[], exitMs: number, hours: number, side: "buy" | "sell"): number | null {
  const cutoff = exitMs + hours * 3600_000;
  let extreme: number | null = null;
  for (const k of klines) {
    const openTime = Number(k[0]);
    if (openTime < exitMs) continue;
    if (openTime > cutoff) break;
    const high = Number(k[2]);
    const low = Number(k[3]);
    if (side === "buy") { if (extreme === null || high > extreme) extreme = high; }
    else { if (extreme === null || low < extreme) extreme = low; }
  }
  return extreme;
}

function recoveryPct(side: "buy" | "sell", exit: number, favorable: number | null): number | null {
  if (favorable === null || !Number.isFinite(favorable) || exit <= 0) return null;
  const diff = side === "buy" ? favorable - exit : exit - favorable;
  return (diff / exit) * 100;
}

// ============= Indicadores =============
function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}
function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const s = values.slice(-period).reduce((a, v) => a + v, 0);
  return s / period;
}
function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}
function macd(values: number[]): { macd: number; signal: number; hist: number } | null {
  if (values.length < 35) return null;
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);
  // align — e26 starts later
  const offset = e12.length - e26.length;
  const macdLine = e26.map((v, i) => e12[i + offset] - v);
  const sig = ema(macdLine, 9);
  if (!sig.length) return null;
  const m = macdLine[macdLine.length - 1];
  const s = sig[sig.length - 1];
  return { macd: m, signal: s, hist: m - s };
}
function atr(klines: Kline[], period = 14): number | null {
  if (klines.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const h = Number(klines[i][2]), l = Number(klines[i][3]), pc = Number(klines[i - 1][4]);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Wilder smoothing
  let a = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}
function adx(klines: Kline[], period = 14): number | null {
  if (klines.length < period * 2 + 1) return null;
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const h = Number(klines[i][2]), l = Number(klines[i][3]);
    const ph = Number(klines[i - 1][2]), pl = Number(klines[i - 1][3]), pc = Number(klines[i - 1][4]);
    const up = h - ph, dn = pl - l;
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  function wilder(arr: number[]): number {
    let s = arr.slice(0, period).reduce((a, v) => a + v, 0);
    for (let i = period; i < arr.length; i++) s = s - s / period + arr[i];
    return s;
  }
  const trSum = wilder(tr);
  const plusSum = wilder(plusDM);
  const minusSum = wilder(minusDM);
  if (trSum === 0) return null;
  const plusDI = (plusSum / trSum) * 100;
  const minusDI = (minusSum / trSum) * 100;
  const dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1)) * 100;
  return dx;
}
function bollinger(values: number[], period = 20, mult = 2): { upper: number; lower: number; mid: number; width: number } | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mid = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mid + mult * sd, lower = mid - mult * sd;
  return { upper, lower, mid, width: ((upper - lower) / mid) * 100 };
}
function vwap(klines: Kline[]): number | null {
  if (!klines.length) return null;
  let pv = 0, vv = 0;
  for (const k of klines) {
    const tp = (Number(k[2]) + Number(k[3]) + Number(k[4])) / 3;
    const v = Number(k[5]);
    pv += tp * v; vv += v;
  }
  return vv > 0 ? pv / vv : null;
}
function avgVolume(klines: Kline[], lookback = 20): number | null {
  if (klines.length < lookback) return null;
  return klines.slice(-lookback).reduce((s, k) => s + Number(k[5]), 0) / lookback;
}

type IndicatorSnapshot = {
  ema9: number | null; ema21: number | null; sma50: number | null;
  rsi: number | null; macd: number | null; macdSignal: number | null; macdHist: number | null;
  atr: number | null; atrPct: number | null; adx: number | null;
  bbWidth: number | null; bbPos: number | null; // posição do close: -1..+1
  vwap: number | null; vwapDist: number | null; // %
  volRatio: number | null; // volume atual / média
  trend: "alta" | "baixa" | "lateral";
  momentum: "forte" | "fraco" | "neutro";
  volatility: "alta" | "media" | "baixa";
};

async function fetchIndicatorsAtExit(symbol: string, exitMs: number): Promise<IndicatorSnapshot | null> {
  // 1h klines, 100 candles antes da saída
  const startMs = exitMs - 100 * 3600_000;
  const kl = await fetchKlines(symbol, "1h", startMs, exitMs, 100);
  if (kl.length < 30) return null;
  const closes = kl.map((k) => Number(k[4]));
  const last = closes[closes.length - 1];
  const e9 = ema(closes, 9); const e21 = ema(closes, 21);
  const ema9 = e9.length ? e9[e9.length - 1] : null;
  const ema21 = e21.length ? e21[e21.length - 1] : null;
  const sma50 = sma(closes, 50);
  const rsiV = rsi(closes, 14);
  const m = macd(closes);
  const atrV = atr(kl, 14);
  const atrPct = atrV !== null && last > 0 ? (atrV / last) * 100 : null;
  const adxV = adx(kl, 14);
  const bb = bollinger(closes, 20, 2);
  const bbPos = bb ? Math.max(-1, Math.min(1, (last - bb.mid) / ((bb.upper - bb.lower) / 2 || 1))) : null;
  const vw = vwap(kl.slice(-24));
  const vwapDist = vw && last > 0 ? ((last - vw) / vw) * 100 : null;
  const volNow = Number(kl[kl.length - 1][5]);
  const volAvg = avgVolume(kl, 20);
  const volRatio = volAvg && volAvg > 0 ? volNow / volAvg : null;

  let trend: IndicatorSnapshot["trend"] = "lateral";
  if (ema9 !== null && ema21 !== null) {
    const diff = ((ema9 - ema21) / ema21) * 100;
    if (diff > 0.3) trend = "alta";
    else if (diff < -0.3) trend = "baixa";
  }
  const momentum: IndicatorSnapshot["momentum"] = adxV === null ? "neutro" : adxV >= 25 ? "forte" : adxV < 18 ? "fraco" : "neutro";
  const volatility: IndicatorSnapshot["volatility"] = atrPct === null ? "media" : atrPct >= 1.5 ? "alta" : atrPct < 0.5 ? "baixa" : "media";

  return {
    ema9, ema21, sma50,
    rsi: rsiV,
    macd: m?.macd ?? null, macdSignal: m?.signal ?? null, macdHist: m?.hist ?? null,
    atr: atrV, atrPct, adx: adxV,
    bbWidth: bb?.width ?? null, bbPos,
    vwap: vw, vwapDist,
    volRatio,
    trend, momentum, volatility,
  };
}

// ============= Classificação V2 (indicador-driven) =============
type ClassifyOut = {
  classification: string;
  diagnosis: string;
  motivos: string[];
  recommendation: string;
  avoidable: boolean;
  premature: boolean;
  score: number;
  confidence: number;
  patternKey: string;
};

function classifyV2(opts: {
  side: "buy" | "sell";
  pnl_pct: number;
  rec_1h: number | null;
  rec_4h: number | null;
  rec_24h: number | null;
  rec_max: number | null;
  candles: boolean;
  ind: IndicatorSnapshot | null;
}): ClassifyOut {
  if (!opts.candles || opts.rec_max === null) {
    return {
      classification: "Sem dados", diagnosis: "Sem candles pós-saída disponíveis ainda.",
      motivos: [], recommendation: "Aguardar janela mínima de 1h após a saída.",
      avoidable: false, premature: false, score: 50, confidence: 0, patternKey: "sem_dados",
    };
  }
  const rec = opts.rec_max;
  const lossAbs = Math.abs(opts.pnl_pct);
  const ind = opts.ind;
  const motivos: string[] = [];
  const agree: boolean[] = []; // cada indicador confirma o veredito ou não

  // Avaliações de indicador (do ponto de vista de "manter posição teria sido melhor")
  const wouldHaveProfited = rec > PREMATURE_THRESHOLD_PCT;

  if (ind) {
    if (ind.ema9 !== null && ind.ema21 !== null) {
      const trendUp = ind.ema9 > ind.ema21;
      if (opts.side === "buy" && trendUp) { motivos.push(`EMA9 (${ind.ema9.toFixed(4)}) acima da EMA21 — tendência ainda comprada`); agree.push(wouldHaveProfited); }
      else if (opts.side === "buy" && !trendUp) { motivos.push("EMA9 abaixo da EMA21 — perda de tendência confirmou saída"); agree.push(!wouldHaveProfited); }
      else if (opts.side === "sell" && !trendUp) { motivos.push("EMA9 abaixo da EMA21 — tendência ainda vendida"); agree.push(wouldHaveProfited); }
      else { motivos.push("EMA9 acima da EMA21 — reversão confirmou saída"); agree.push(!wouldHaveProfited); }
    }
    if (ind.rsi !== null) {
      if (ind.rsi >= 70) { motivos.push(`RSI ${ind.rsi.toFixed(0)} em sobrecompra — exaustão compradora`); agree.push(opts.side === "buy" ? !wouldHaveProfited : wouldHaveProfited); }
      else if (ind.rsi <= 30) { motivos.push(`RSI ${ind.rsi.toFixed(0)} em sobrevenda — exaustão vendedora`); agree.push(opts.side === "sell" ? !wouldHaveProfited : wouldHaveProfited); }
      else if (ind.rsi >= 60) { motivos.push(`RSI ${ind.rsi.toFixed(0)} acima de 60 — momentum comprador`); agree.push(opts.side === "buy" ? wouldHaveProfited : !wouldHaveProfited); }
      else if (ind.rsi <= 40) { motivos.push(`RSI ${ind.rsi.toFixed(0)} abaixo de 40 — momentum vendedor`); agree.push(opts.side === "sell" ? wouldHaveProfited : !wouldHaveProfited); }
    }
    if (ind.macdHist !== null) {
      if (ind.macdHist > 0) { motivos.push(`MACD histograma positivo (${ind.macdHist.toFixed(4)}) — pressão compradora`); agree.push(opts.side === "buy" ? wouldHaveProfited : !wouldHaveProfited); }
      else { motivos.push(`MACD histograma negativo (${ind.macdHist.toFixed(4)}) — pressão vendedora`); agree.push(opts.side === "sell" ? wouldHaveProfited : !wouldHaveProfited); }
    }
    if (ind.adx !== null) {
      if (ind.adx >= 25) { motivos.push(`ADX ${ind.adx.toFixed(0)} indica tendência forte`); }
      else { motivos.push(`ADX ${ind.adx.toFixed(0)} indica mercado lateral/fraco`); }
    }
    if (ind.atrPct !== null) {
      if (ind.atrPct >= 1.5) motivos.push(`ATR ${ind.atrPct.toFixed(2)}% — volatilidade elevada`);
      else if (ind.atrPct < 0.5) motivos.push(`ATR ${ind.atrPct.toFixed(2)}% — baixa volatilidade`);
    }
    if (ind.bbPos !== null) {
      if (ind.bbPos > 0.8) motivos.push("Preço próximo à banda superior — possível exaustão");
      else if (ind.bbPos < -0.8) motivos.push("Preço próximo à banda inferior — possível repique");
    }
    if (ind.volRatio !== null) {
      if (ind.volRatio >= 1.5) motivos.push(`Volume ${ind.volRatio.toFixed(1)}x acima da média — confirmação`);
      else if (ind.volRatio < 0.7) motivos.push(`Volume ${ind.volRatio.toFixed(1)}x abaixo da média — baixa liquidez`);
    }
    if (ind.vwapDist !== null) motivos.push(`Preço ${ind.vwapDist >= 0 ? "+" : ""}${ind.vwapDist.toFixed(2)}% vs VWAP`);
  }

  const confidence = agree.length ? Math.round((agree.filter(Boolean).length / agree.length) * 100) : 50;

  // ===== Decisão de classificação combinando recovery + indicadores =====
  // Mercado seguiu na direção da saída (recovery negativo): stop foi correto.
  if (rec <= 0) {
    if (ind && ind.adx !== null && ind.adx >= 30) {
      return { classification: "Continuação forte", diagnosis: `Tendência contrária mantida (ADX ${ind.adx.toFixed(0)}). Stop protegeu de perda maior.`,
        motivos, recommendation: "Manter critérios atuais — saída correta em tendência forte.",
        avoidable: false, premature: false, score: 80, confidence, patternKey: `continuacao_forte_${opts.side}` };
    }
    if (lossAbs >= 3) {
      return { classification: "Stop técnico", diagnosis: "Stop acionado dentro de critério técnico; mercado continuou contra a posição.",
        motivos, recommendation: "Sem mudança — stop tecnicamente válido.",
        avoidable: false, premature: false, score: 78, confidence, patternKey: `stop_tecnico_${opts.side}` };
    }
    return { classification: "Reversão confirmada", diagnosis: "Movimento contrário se confirmou após a saída.",
      motivos, recommendation: "Sem ajuste necessário.",
      avoidable: false, premature: false, score: 75, confidence, patternKey: `reversao_confirmada_${opts.side}` };
  }

  if (rec <= PERFECT_THRESHOLD_PCT) {
    return { classification: "Venda perfeita", diagnosis: "Saída praticamente no melhor preço disponível na janela de 24h.",
      motivos, recommendation: "Manter critérios — execução ótima.",
      avoidable: false, premature: false, score: 96, confidence, patternKey: `venda_perfeita_${opts.side}` };
  }
  if (rec < 2) {
    return { classification: "Realização ideal", diagnosis: "Pequeno movimento residual a favor; saída próxima do topo.",
      motivos, recommendation: "Sem ajuste — execução adequada.",
      avoidable: false, premature: false, score: 85, confidence, patternKey: `realizacao_ideal_${opts.side}` };
  }
  if (rec < PREMATURE_THRESHOLD_PCT) {
    // 2% – 5%
    if (ind && ind.atrPct !== null && ind.atrPct >= 1.5) {
      return { classification: "Alta volatilidade", diagnosis: `Movimento dentro do ATR (${ind.atrPct.toFixed(2)}%); repique esperado.`,
        motivos, recommendation: "Considerar trailing stop baseado em ATR.",
        avoidable: false, premature: false, score: 60, confidence, patternKey: `alta_volatilidade_${opts.side}` };
    }
    if (lossAbs < 1) {
      return { classification: "Realização precoce", diagnosis: "Encerramento com pouco fôlego; mercado andou mais a favor.",
        motivos, recommendation: "Exigir 1–2 candles adicionais antes de fechar.",
        avoidable: true, premature: false, score: 55, confidence, patternKey: `realizacao_precoce_${opts.side}` };
    }
    return { classification: "Pullback saudável", diagnosis: "Pequeno repique após saída; movimento dentro do esperado.",
      motivos, recommendation: "Sem mudança crítica.",
      avoidable: false, premature: false, score: 65, confidence, patternKey: `pullback_saudavel_${opts.side}` };
  }

  // ===== Prematuras (>= 5%) =====
  if (rec >= VERY_EARLY_THRESHOLD_PCT && opts.rec_1h !== null && opts.rec_1h >= PREMATURE_THRESHOLD_PCT) {
    return { classification: "Saída emocional", diagnosis: `Reversão violenta em menos de 1h (+${opts.rec_1h.toFixed(1)}%); saída provavelmente reativa.`,
      motivos, recommendation: "Cooldown de 5 min após sinal contrário antes de fechar.",
      avoidable: true, premature: true, score: 8, confidence, patternKey: `saida_emocional_${opts.side}` };
  }

  // Rompimento confirmado (LONG): EMA up + ADX forte + Volume alto
  if (ind && opts.side === "buy" && ind.ema9 !== null && ind.ema21 !== null && ind.ema9 > ind.ema21
      && ind.adx !== null && ind.adx >= 25 && ind.volRatio !== null && ind.volRatio >= 1.2) {
    return { classification: "Rompimento confirmado", diagnosis: `Tendência forte (ADX ${ind.adx.toFixed(0)}) com volume crescente — saída perdeu rompimento.`,
      motivos, recommendation: "Exigir 6+ votos vendedores quando ADX>25 e EMA9>EMA21.",
      avoidable: true, premature: true, score: 12, confidence, patternKey: `rompimento_confirmado_${opts.side}` };
  }
  // Continuação de tendência: EMA aligned + RSI > 55
  if (ind && opts.side === "buy" && ind.ema9 !== null && ind.ema21 !== null && ind.ema9 > ind.ema21
      && ind.rsi !== null && ind.rsi >= 55) {
    return { classification: "Continuação de tendência", diagnosis: `EMA9>EMA21 e RSI ${ind.rsi.toFixed(0)} — tendência seguiu após a saída.`,
      motivos, recommendation: "Aguardar fechamento abaixo da EMA9 antes de vender.",
      avoidable: true, premature: true, score: 18, confidence, patternKey: `continuacao_tendencia_${opts.side}` };
  }
  // Exaustão vendedora (SHORT prematuro): RSI<35
  if (ind && opts.side === "sell" && ind.rsi !== null && ind.rsi <= 35) {
    return { classification: "Exaustão vendedora", diagnosis: `RSI ${ind.rsi.toFixed(0)} indicava sobrevenda — repique era provável.`,
      motivos, recommendation: "Filtro: não abrir SHORT com RSI<35.",
      avoidable: true, premature: true, score: 15, confidence, patternKey: "exaustao_vendedora" };
  }
  // Movimento explosivo
  if (rec >= 15) {
    return { classification: "Movimento explosivo", diagnosis: `Recovery de +${rec.toFixed(1)}% em até 24h — movimento explosivo perdido.`,
      motivos, recommendation: "Implementar take profit dinâmico baseado em momentum.",
      avoidable: true, premature: true, score: 5, confidence, patternKey: `movimento_explosivo_${opts.side}` };
  }
  // Stop evitável: stop pequeno + recovery alto
  if (lossAbs < 3) {
    return { classification: "Stop evitável", diagnosis: `Stop de ${lossAbs.toFixed(1)}% e mercado andou +${rec.toFixed(1)}% a favor.`,
      motivos, recommendation: "Ampliar distância do stop em ativos voláteis (1.5x ATR).",
      avoidable: true, premature: true, score: 22, confidence, patternKey: `stop_evitavel_${opts.side}` };
  }
  // Default prematura
  return { classification: "Venda antecipada", diagnosis: `Mercado andou +${rec.toFixed(1)}% a favor após a saída.`,
    motivos, recommendation: "Exigir confirmação adicional (2 candles) antes de fechar.",
    avoidable: true, premature: true, score: 28, confidence, patternKey: `venda_antecipada_${opts.side}` };
}

function qualityFromScore(score: number) {
  if (score >= 80) return { label: "Excelente" as const, color: "text-emerald-400", threshold_pct: score };
  if (score >= 65) return { label: "Boa" as const, color: "text-green-400", threshold_pct: score };
  if (score >= 50) return { label: "Regular" as const, color: "text-yellow-400", threshold_pct: score };
  if (score >= 35) return { label: "Ruim" as const, color: "text-orange-400", threshold_pct: score };
  return { label: "Crítica" as const, color: "text-red-500", threshold_pct: score };
}

type CachedRow = {
  source: string; trade_id: string;
  high_1h: number | null; low_1h: number | null;
  high_4h: number | null; low_4h: number | null;
  high_12h: number | null; low_12h: number | null;
  high_24h: number | null; low_24h: number | null;
  recovery_1h: number | null; recovery_4h: number | null;
  recovery_12h: number | null; recovery_24h: number | null;
  recovery_max: number | null;
  classification: string | null; diagnosis: string | null;
  avoidable: boolean | null; premature: boolean | null;
  score: number | null; candles_available: boolean | null;
  confidence: number | null;
  motivos: string[] | null;
  indicators: Record<string, any> | null;
  recommendation: string | null;
  recovery_lost_pct: number | null;
  recovery_lost_usdt: number | null;
  pattern_key: string | null;
};

export const auditBinanceExits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batchSize?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const batchSize = Math.min(Math.max(data.batchSize ?? 600, 50), 1500);

    const PAGE = 1000;
    async function paginate<R>(builder: (from: number, to: number) => any): Promise<R[]> {
      const out: R[] = [];
      let from = 0;
      while (true) {
        const to = from + PAGE - 1;
        const { data: rows } = await builder(from, to);
        if (!rows || rows.length === 0) break;
        out.push(...(rows as R[]));
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return out;
    }

    const [realPosRows, autoTradesRows, simOrdersRows] = await Promise.all([
      paginate<any>((f, t) => supabase.from("real_positions")
        .select("id, pair, opened_at, closed_at, entry_price, exit_price, pnl, pnl_pct, exit_reason, request_id, side")
        .eq("status", "closed").lt("pnl", 0).order("closed_at", { ascending: false }).range(f, t)),
      paginate<any>((f, t) => supabase.from("automated_trades")
        .select("id, asset_id, opened_at, closed_at, entry_price, exit_price, pnl, pnl_pct, exit_reason, request_id, side")
        .eq("status", "closed").lt("pnl", 0).order("closed_at", { ascending: false }).range(f, t)),
      paginate<any>((f, t) => supabase.from("simulated_orders")
        .select("id, pair, side, created_at, closed_at, entry_price, closed_price, realized_pnl, net_pnl")
        .eq("status", "closed").or("net_pnl.lt.0,realized_pnl.lt.0").order("closed_at", { ascending: false }).range(f, t)),
    ]);

    const [realClosed, autoClosed, simClosed] = await Promise.all([
      supabase.from("real_positions").select("id", { count: "exact", head: true }).eq("status", "closed"),
      supabase.from("automated_trades").select("id", { count: "exact", head: true }).eq("status", "closed"),
      supabase.from("simulated_orders").select("id", { count: "exact", head: true }).eq("status", "closed"),
    ]);
    const totalClosed = (realClosed.count ?? 0) + (autoClosed.count ?? 0) + (simClosed.count ?? 0);

    const assetIds = (autoTradesRows ?? []).map((t) => t.asset_id).filter(Boolean) as string[];
    const assetMap = new Map<string, string>();
    if (assetIds.length) {
      const { data: assets } = await supabase.from("monitored_assets").select("id, pair").in("id", assetIds);
      for (const a of (assets ?? []) as Array<{ id: string; pair: string }>) assetMap.set(a.id, a.pair);
    }

    const losses: LossSell[] = [];
    const makeBase = () => ({
      price_1h: null as number | null, price_4h: null as number | null,
      price_12h: null as number | null, price_24h: null as number | null,
      recovery_1h: null as number | null, recovery_4h: null as number | null,
      recovery_12h: null as number | null, recovery_24h: null as number | null,
      recovery_max: null as number | null,
      recovered_1h: false, recovered_4h: false, recovered_12h: false, recovered_24h: false,
      classification: "Sem dados", diagnosis: "Aguardando análise.",
      premature: false, avoidable: false, score: 50, candles_available: false,
      votes: [] as Array<{ agent: string; vote: string; confidence: number }>,
      decision: null as LossSell["decision"],
      confidence: 0, motivos: [] as string[], recommendation: null as string | null,
      recovery_lost_pct: null as number | null, recovery_lost_usdt: null as number | null,
      indicators: null as Record<string, any> | null, pattern_key: null as string | null,
      duplicate: false,
    });

    for (const p of realPosRows ?? []) {
      const side: "buy" | "sell" = ((p.side as string) ?? "buy") === "sell" ? "sell" : "buy";
      losses.push({ ...baseEmpty, source: "real_positions", id: p.id, pair: p.pair, side,
        asset: (p.pair as string).replace("USDT", ""), opened_at: p.opened_at, closed_at: p.closed_at,
        entry_price: Number(p.entry_price), exit_price: Number(p.exit_price),
        pnl: Number(p.pnl), pnl_pct: Number(p.pnl_pct), exit_reason: (p.exit_reason as string | null) ?? null,
        drop_pct: ((Number(p.exit_price) - Number(p.entry_price)) / Number(p.entry_price)) * 100,
      });
    }
    for (const t of autoTradesRows ?? []) {
      const symbol = (t.asset_id && assetMap.get(t.asset_id)) || "";
      if (!symbol) continue;
      const side: "buy" | "sell" = ((t.side as string) ?? "buy") === "sell" ? "sell" : "buy";
      losses.push({ ...baseEmpty, source: "automated_trades", id: t.id, pair: symbol, side,
        asset: symbol.replace("USDT", ""), opened_at: t.opened_at, closed_at: t.closed_at,
        entry_price: Number(t.entry_price), exit_price: Number(t.exit_price),
        pnl: Number(t.pnl), pnl_pct: Number(t.pnl_pct), exit_reason: (t.exit_reason as string | null) ?? null,
        drop_pct: ((Number(t.exit_price) - Number(t.entry_price)) / Number(t.entry_price)) * 100,
      });
    }
    for (const s of simOrdersRows ?? []) {
      const entry = Number(s.entry_price); const exit = Number(s.closed_price);
      if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0) continue;
      const side: "buy" | "sell" = (s.side as string) === "sell" ? "sell" : "buy";
      const pnl = Number(s.net_pnl ?? s.realized_pnl ?? 0);
      const drop_pct = ((exit - entry) / entry) * 100;
      const pnl_pct = side === "buy" ? drop_pct : -drop_pct;
      losses.push({ ...baseEmpty, source: "simulated_orders", id: s.id, pair: s.pair, side,
        asset: (s.pair as string).replace("USDT", ""), opened_at: s.created_at, closed_at: s.closed_at,
        entry_price: entry, exit_price: exit, pnl, pnl_pct, exit_reason: null, drop_pct });
    }

    // ===== Deduplicação =====
    // Mesmo (pair|side|exit_time bucket 60s|exit_price rounded 6dp) — mantém o primeiro, marca os demais.
    const seen = new Map<string, LossSell>();
    let duplicates_filtered = 0;
    for (const l of losses) {
      const bucket = Math.floor(new Date(l.closed_at).getTime() / 60000);
      const key = `${l.pair}|${l.side}|${bucket}|${l.exit_price.toFixed(6)}`;
      if (seen.has(key)) { l.duplicate = true; duplicates_filtered++; }
      else seen.set(key, l);
    }
    const uniqueLosses = losses.filter((l) => !l.duplicate);

    // ===== Carrega cache =====
    const cacheMap = new Map<string, CachedRow>();
    if (uniqueLosses.length) {
      const tradeIds = uniqueLosses.map((l) => l.id);
      const CHUNK = 500;
      for (let i = 0; i < tradeIds.length; i += CHUNK) {
        const chunk = tradeIds.slice(i, i + CHUNK);
        const { data: rows } = await supabase
          .from("binance_audit_learning")
          .select("source,trade_id,high_1h,low_1h,high_4h,low_4h,high_12h,low_12h,high_24h,low_24h,recovery_1h,recovery_4h,recovery_12h,recovery_24h,recovery_max,classification,diagnosis,avoidable,premature,score,candles_available,confidence,motivos,indicators,recommendation,recovery_lost_pct,recovery_lost_usdt,pattern_key")
          .in("trade_id", chunk);
        for (const r of (rows ?? []) as CachedRow[]) cacheMap.set(`${r.source}:${r.trade_id}`, r);
      }
    }

    // Aplica cache
    for (const l of uniqueLosses) {
      const c = cacheMap.get(`${l.source}:${l.id}`);
      if (!c) continue;
      const fav = (h: number | null, lo: number | null) => l.side === "buy" ? h : lo;
      l.price_1h = fav(c.high_1h, c.low_1h);
      l.price_4h = fav(c.high_4h, c.low_4h);
      l.price_12h = fav(c.high_12h, c.low_12h);
      l.price_24h = fav(c.high_24h, c.low_24h);
      l.recovery_1h = c.recovery_1h; l.recovery_4h = c.recovery_4h;
      l.recovery_12h = c.recovery_12h; l.recovery_24h = c.recovery_24h;
      l.recovery_max = c.recovery_max;
      l.recovered_1h = (c.recovery_1h ?? 0) > 0; l.recovered_4h = (c.recovery_4h ?? 0) > 0;
      l.recovered_12h = (c.recovery_12h ?? 0) > 0; l.recovered_24h = (c.recovery_24h ?? 0) > 0;
      l.classification = c.classification ?? "Sem dados";
      l.diagnosis = c.diagnosis ?? "";
      l.avoidable = !!c.avoidable; l.premature = !!c.premature;
      l.score = Number(c.score ?? 50); l.candles_available = !!c.candles_available;
      l.confidence = Number(c.confidence ?? 0);
      l.motivos = Array.isArray(c.motivos) ? c.motivos : [];
      l.indicators = (c.indicators as any) ?? null;
      l.recommendation = c.recommendation ?? null;
      l.recovery_lost_pct = c.recovery_lost_pct;
      l.recovery_lost_usdt = c.recovery_lost_usdt;
      l.pattern_key = c.pattern_key ?? null;
    }

    // ===== Processa pendentes =====
    const nowMs = Date.now();
    const pendingAll = uniqueLosses.filter((l) => {
      if (cacheMap.has(`${l.source}:${l.id}`)) return false;
      const t = new Date(l.closed_at).getTime();
      return Number.isFinite(t) && t + 3600_000 <= nowMs;
    });
    const toProcess = pendingAll.slice(0, batchSize);

    let processedThisRun = 0;
    const CONCURRENCY = 12;
    const upserts: any[] = [];

    for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
      const batch = toProcess.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (l) => {
        const exitMs = new Date(l.closed_at).getTime();
        const [postKlines, ind] = await Promise.all([
          fetchKlines(l.pair, "5m", exitMs, exitMs + 24 * 3600_000, 300),
          fetchIndicatorsAtExit(l.pair, exitMs),
        ]);
        const candlesAvail = postKlines.length > 0;

        const high_1h = candlesAvail ? extremeInWindow(postKlines, exitMs, 1, "buy") : null;
        const low_1h  = candlesAvail ? extremeInWindow(postKlines, exitMs, 1, "sell") : null;
        const high_4h = candlesAvail ? extremeInWindow(postKlines, exitMs, 4, "buy") : null;
        const low_4h  = candlesAvail ? extremeInWindow(postKlines, exitMs, 4, "sell") : null;
        const high_12h = candlesAvail && (exitMs + 12 * 3600_000 <= nowMs) ? extremeInWindow(postKlines, exitMs, 12, "buy") : null;
        const low_12h  = candlesAvail && (exitMs + 12 * 3600_000 <= nowMs) ? extremeInWindow(postKlines, exitMs, 12, "sell") : null;
        const high_24h = candlesAvail && (exitMs + 24 * 3600_000 <= nowMs) ? extremeInWindow(postKlines, exitMs, 24, "buy") : null;
        const low_24h  = candlesAvail && (exitMs + 24 * 3600_000 <= nowMs) ? extremeInWindow(postKlines, exitMs, 24, "sell") : null;

        const fav = (h: number | null, lo: number | null) => l.side === "buy" ? h : lo;
        const rec_1h = recoveryPct(l.side, l.exit_price, fav(high_1h, low_1h));
        const rec_4h = recoveryPct(l.side, l.exit_price, fav(high_4h, low_4h));
        const rec_12h = recoveryPct(l.side, l.exit_price, fav(high_12h, low_12h));
        const rec_24h = recoveryPct(l.side, l.exit_price, fav(high_24h, low_24h));
        const rec_values = [rec_1h, rec_4h, rec_12h, rec_24h].filter((v): v is number => v !== null);
        const rec_max = rec_values.length ? Math.max(...rec_values) : null;

        const cls = classifyV2({ side: l.side, pnl_pct: l.pnl_pct, rec_1h, rec_4h, rec_24h, rec_max, candles: candlesAvail, ind });

        // posição estimada (USDT) a partir do pnl_pct: pos ≈ pnl / (pnl_pct/100)
        const position = l.pnl_pct !== 0 ? Math.abs(l.pnl / (l.pnl_pct / 100)) : 0;
        const recovery_lost_pct = cls.premature && rec_max !== null ? rec_max : null;
        const recovery_lost_usdt = recovery_lost_pct !== null && position > 0 ? (recovery_lost_pct / 100) * position : null;

        const indPayload: Record<string, any> | null = ind ? {
          ema9: ind.ema9, ema21: ind.ema21, sma50: ind.sma50, rsi: ind.rsi,
          macd: ind.macd, macdSignal: ind.macdSignal, macdHist: ind.macdHist,
          atr: ind.atr, atrPct: ind.atrPct, adx: ind.adx,
          bbWidth: ind.bbWidth, bbPos: ind.bbPos, vwap: ind.vwap, vwapDist: ind.vwapDist,
          volRatio: ind.volRatio, trend: ind.trend, momentum: ind.momentum, volatility: ind.volatility,
        } : null;

        // aplica em memória
        Object.assign(l, {
          price_1h: fav(high_1h, low_1h), price_4h: fav(high_4h, low_4h),
          price_12h: fav(high_12h, low_12h), price_24h: fav(high_24h, low_24h),
          recovery_1h: rec_1h, recovery_4h: rec_4h, recovery_12h: rec_12h, recovery_24h: rec_24h,
          recovery_max: rec_max,
          recovered_1h: (rec_1h ?? 0) > 0, recovered_4h: (rec_4h ?? 0) > 0,
          recovered_12h: (rec_12h ?? 0) > 0, recovered_24h: (rec_24h ?? 0) > 0,
          classification: cls.classification, diagnosis: cls.diagnosis,
          avoidable: cls.avoidable, premature: cls.premature, score: cls.score,
          candles_available: candlesAvail,
          confidence: cls.confidence, motivos: cls.motivos, recommendation: cls.recommendation,
          recovery_lost_pct, recovery_lost_usdt, indicators: indPayload, pattern_key: cls.patternKey,
        });
        processedThisRun++;

        upserts.push({
          source: l.source, trade_id: l.id, symbol: l.pair, side: l.side,
          exit_time: l.closed_at, exit_price: l.exit_price, entry_price: l.entry_price,
          pnl: l.pnl, pnl_pct: l.pnl_pct,
          high_1h, low_1h, high_4h, low_4h, high_12h, low_12h, high_24h, low_24h,
          recovery_1h: rec_1h, recovery_4h: rec_4h, recovery_12h: rec_12h, recovery_24h: rec_24h,
          recovery_max: rec_max,
          classification: cls.classification, diagnosis: cls.diagnosis,
          avoidable: cls.avoidable, premature: cls.premature, score: cls.score,
          candles_available: candlesAvail,
          confidence: cls.confidence, motivos: cls.motivos, recommendation: cls.recommendation,
          recovery_lost_pct, recovery_lost_usdt, indicators: indPayload,
          pattern_key: cls.patternKey, position_size: position,
        });
      }));
    }

    if (upserts.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const CHUNK = 200;
      for (let i = 0; i < upserts.length; i += CHUNK) {
        await supabaseAdmin.from("binance_audit_learning")
          .upsert(upserts.slice(i, i + CHUNK), { onConflict: "source,trade_id" });
      }
    }

    // ===== Métricas =====
    const reportLosses = uniqueLosses; // sem duplicatas
    const total = reportLosses.length;
    const audited = reportLosses.filter((l) => l.candles_available).length;
    const pending = pendingAll.length - processedThisRun;
    const hasMore = pending > 0;

    const recovered = (key: keyof Pick<LossSell, "recovered_1h" | "recovered_4h" | "recovered_12h" | "recovered_24h">) =>
      reportLosses.filter((l) => l[key]).length;
    const rate = (n: number) => (audited ? (n / audited) * 100 : 0);
    const recovery_rate_1h = rate(recovered("recovered_1h"));
    const recovery_rate_4h = rate(recovered("recovered_4h"));
    const recovery_rate_12h = rate(recovered("recovered_12h"));
    const recovery_rate_24h = rate(recovered("recovered_24h"));

    const avg = (key: keyof Pick<LossSell, "recovery_1h" | "recovery_4h" | "recovery_12h" | "recovery_24h">) => {
      const vals = reportLosses.map((l) => l[key]).filter((v): v is number => v !== null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    };
    const avg_recovery_1h = avg("recovery_1h");
    const avg_recovery_4h = avg("recovery_4h");
    const avg_recovery_12h = avg("recovery_12h");
    const avg_recovery_24h = avg("recovery_24h");

    const premature_count = reportLosses.filter((l) => l.premature).length;
    const correct_count = audited - premature_count;
    const early_exit_score = audited ? (premature_count / audited) * 100 : 0;
    const avoidable_loss_usdt = reportLosses.filter((l) => l.avoidable).reduce((s, l) => s + Math.abs(l.pnl), 0);
    const unavoidable_loss_usdt = reportLosses.filter((l) => l.candles_available && !l.avoidable).reduce((s, l) => s + Math.abs(l.pnl), 0);
    const avoidable_stops = reportLosses.filter((l) => l.classification === "Stop evitável").length;
    const unavoidable_stops = reportLosses.filter((l) => l.classification === "Stop técnico" || l.classification === "Continuação forte").length;
    const perfect_pct = audited ? (reportLosses.filter((l) => l.classification === "Venda perfeita").length / audited) * 100 : 0;
    const early_pct = audited ? (reportLosses.filter((l) => l.premature).length / audited) * 100 : 0;
    const quality_score = audited
      ? reportLosses.filter((l) => l.candles_available).reduce((s, l) => s + l.score, 0) / audited : 50;

    const by_classification: Record<string, number> = {};
    for (const l of reportLosses) by_classification[l.classification] = (by_classification[l.classification] ?? 0) + 1;

    const quality = qualityFromScore(quality_score);

    // ===== Relatório executivo agregado =====
    const auditedLosses = reportLosses.filter((l) => l.candles_available);
    const prematureLosses = auditedLosses.filter((l) => l.premature);

    const byAssetMap = new Map<string, { count: number; premature: number; rec: number[]; lost: number }>();
    for (const l of auditedLosses) {
      const cur = byAssetMap.get(l.asset) ?? { count: 0, premature: 0, rec: [], lost: 0 };
      cur.count++;
      if (l.premature) cur.premature++;
      if (l.recovery_max !== null) cur.rec.push(l.recovery_max);
      cur.lost += l.recovery_lost_usdt ?? 0;
      byAssetMap.set(l.asset, cur);
    }
    const by_asset = [...byAssetMap.entries()]
      .map(([asset, v]) => ({ asset, count: v.count, premature: v.premature,
        avg_recovery: v.rec.length ? v.rec.reduce((a, x) => a + x, 0) / v.rec.length : 0,
        lost_usdt: v.lost }))
      .sort((a, b) => b.premature - a.premature).slice(0, 15);

    const byHourMap = new Map<number, { count: number; premature: number }>();
    for (const l of auditedLosses) {
      const h = new Date(l.closed_at).getUTCHours();
      const cur = byHourMap.get(h) ?? { count: 0, premature: 0 };
      cur.count++; if (l.premature) cur.premature++;
      byHourMap.set(h, cur);
    }
    const by_hour = [...byHourMap.entries()].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour);

    const avg_recovery_by_asset: Record<string, number> = {};
    for (const a of by_asset) avg_recovery_by_asset[a.asset] = a.avg_recovery;

    // Indicadores presentes em prematuras
    const indStats = new Map<string, { presence: number; vals: number[] }>();
    const indConditions: Array<[string, (i: any) => boolean, (i: any) => number | null]> = [
      ["RSI > 60", (i) => i?.rsi != null && i.rsi > 60, (i) => i?.rsi ?? null],
      ["RSI < 40", (i) => i?.rsi != null && i.rsi < 40, (i) => i?.rsi ?? null],
      ["EMA9 > EMA21", (i) => i?.ema9 != null && i?.ema21 != null && i.ema9 > i.ema21, () => null],
      ["EMA9 < EMA21", (i) => i?.ema9 != null && i?.ema21 != null && i.ema9 < i.ema21, () => null],
      ["ADX > 25 (tendência forte)", (i) => i?.adx != null && i.adx > 25, (i) => i?.adx ?? null],
      ["ATR alto (>1.5%)", (i) => i?.atrPct != null && i.atrPct > 1.5, (i) => i?.atrPct ?? null],
      ["MACD histograma positivo", (i) => i?.macdHist != null && i.macdHist > 0, (i) => i?.macdHist ?? null],
      ["Volume > 1.5x média", (i) => i?.volRatio != null && i.volRatio > 1.5, (i) => i?.volRatio ?? null],
    ];
    for (const [name, cond, get] of indConditions) {
      let presence = 0; const vals: number[] = [];
      for (const l of prematureLosses) {
        const ind = l.indicators as any;
        if (cond(ind)) { presence++; const v = get(ind); if (v !== null) vals.push(v); }
      }
      indStats.set(name, { presence, vals });
    }
    const indicators_in_premature = [...indStats.entries()].map(([indicator, v]) => ({
      indicator,
      presence_pct: prematureLosses.length ? (v.presence / prematureLosses.length) * 100 : 0,
      avg_value: v.vals.length ? v.vals.reduce((a, x) => a + x, 0) / v.vals.length : null,
    })).sort((a, b) => b.presence_pct - a.presence_pct);

    const patternMap = new Map<string, { count: number; rec: number[]; lost: number }>();
    for (const l of auditedLosses) {
      const k = l.pattern_key ?? l.classification;
      const cur = patternMap.get(k) ?? { count: 0, rec: [], lost: 0 };
      cur.count++; if (l.recovery_max !== null) cur.rec.push(l.recovery_max);
      cur.lost += l.recovery_lost_usdt ?? 0;
      patternMap.set(k, cur);
    }
    const top_patterns = [...patternMap.entries()].map(([pattern, v]) => ({
      pattern, count: v.count,
      avg_recovery: v.rec.length ? v.rec.reduce((a, x) => a + x, 0) / v.rec.length : 0,
      lost_usdt: v.lost,
    })).sort((a, b) => b.count - a.count).slice(0, 10);

    const recCount = new Map<string, number>();
    for (const l of prematureLosses) {
      if (!l.recommendation) continue;
      recCount.set(l.recommendation, (recCount.get(l.recommendation) ?? 0) + 1);
    }
    const top_recommendations = [...recCount.entries()]
      .map(([recommendation, count]) => ({ recommendation, count }))
      .sort((a, b) => b.count - a.count).slice(0, 10);

    // ===== Alerta global =====
    const suggestions: string[] = [];
    let alert: string | null = null;
    if (early_exit_score > 30) {
      alert = "Comitê Binance está vendendo prematuramente em mais de 30% dos casos.";
      // Derivado dos padrões: traz top 4 recomendações
      for (const r of top_recommendations.slice(0, 4)) suggestions.push(r.recommendation);
      if (!suggestions.length) {
        suggestions.push(
          "Aumentar consenso mínimo para vendas (ex.: 6+ votos vendedores).",
          "Adicionar cooldown após queda brusca antes de nova venda.",
          "Filtro ATR para reduzir vendas em volatilidade momentânea.",
        );
      }
    } else if (avoidable_stops > unavoidable_stops && audited > 20) {
      alert = "Stops evitáveis superam inevitáveis — revisar largura do stop.";
      suggestions.push("Ampliar distância do stop loss em ativos voláteis (1.5x ATR).", "Aplicar trailing stop dinâmico baseado em ATR.");
    }

    const report: AuditReport = {
      generated_at: new Date().toISOString(),
      total_closed: totalClosed,
      total_losses: total,
      audited, pending, processed_this_run: processedThisRun, has_more: hasMore,
      duplicates_filtered,
      recovery_rate_1h, recovery_rate_4h, recovery_rate_12h, recovery_rate_24h,
      avg_recovery_1h, avg_recovery_4h, avg_recovery_12h, avg_recovery_24h,
      early_exit_score, premature_count, correct_count,
      avoidable_loss_usdt, unavoidable_loss_usdt,
      avoidable_stops, unavoidable_stops,
      perfect_pct, early_pct, quality_score,
      by_classification, quality, alert, suggestions,
      losses: reportLosses,
      executive: {
        by_asset, by_hour, avg_recovery_by_asset,
        avg_recovery_by_period: { "1h": avg_recovery_1h, "4h": avg_recovery_4h, "12h": avg_recovery_12h, "24h": avg_recovery_24h },
        indicators_in_premature,
        top_patterns,
        top_recommendations,
      },
    };
    return report;
  });
