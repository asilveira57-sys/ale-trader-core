// Server-only committee logic. Pure deterministic functions — no env, no SDKs.
// Imported by src/lib/atrader.functions.ts (handler-only side).

export type Vote = "buy" | "sell" | "hold" | "wait";

export interface MarketContext {
  pair: string;
  timeframe: string;
  price: number;
  prev_price: number;
  change_24h_pct: number;
  high_24h: number;
  low_24h: number;
  volume_24h: number;
  avg_volume: number;
  rsi: number;
  macd: number;
  macd_signal: number;
  sma_short: number;
  sma_long: number;
  bb_upper: number;
  bb_lower: number;
  support: number;
  resistance: number;
  momentum: number;
  volatility_pct: number;
  data_quality: number; // 0..100
  sentiment?: number; // -100..100 if available
}

export interface AgentVote {
  agent: string;
  vote: Vote;
  confidence: number;
  justification: string;
  data_used: Record<string, unknown>;
  perceived_risk: number;
  has_veto: boolean;
  veto_reason?: string;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// ---- Mock context generator (deterministic per minute) -------------------
export function buildMockContext(pair: string, timeframe: string, price: number): MarketContext {
  const seed = ((Date.now() / 60000) | 0) + hash(pair);
  const r = (k: number) => ((Math.sin(seed * (k + 1)) + 1) / 2); // 0..1
  const change = (r(1) - 0.5) * 12; // -6..+6 %
  const vol = 1_000_000 * (0.5 + r(2) * 2);
  return {
    pair,
    timeframe,
    price,
    prev_price: price * (1 - change / 100),
    change_24h_pct: change,
    high_24h: price * (1 + Math.abs(change) / 100 + 0.005),
    low_24h: price * (1 - Math.abs(change) / 100 - 0.005),
    volume_24h: vol,
    avg_volume: vol * (0.6 + r(3) * 0.8),
    rsi: 20 + r(4) * 70,
    macd: (r(5) - 0.5) * 2,
    macd_signal: (r(6) - 0.5) * 2,
    sma_short: price * (1 + (r(7) - 0.5) * 0.02),
    sma_long: price * (1 + (r(8) - 0.5) * 0.04),
    bb_upper: price * 1.03,
    bb_lower: price * 0.97,
    support: price * 0.96,
    resistance: price * 1.04,
    momentum: (r(9) - 0.5) * 100,
    volatility_pct: 1 + r(10) * 5,
    data_quality: 90 + r(11) * 10,
  };
}
function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// ---- Individual agents ---------------------------------------------------

export const AGENT_NAMES = [
  "Agente de Tendência",
  "Agente de Volume",
  "Agente Técnico",
  "Agente de Momentum",
  "Agente de Sentimento",
  "Agente Conservador",
  "Agente Agressivo",
  "Agente Longo Prazo",
  "Agente Anti-Euforia",
  "Agente de Risco",
] as const;

function trendAgent(c: MarketContext): AgentVote {
  const above = c.price > c.sma_short && c.sma_short > c.sma_long;
  const below = c.price < c.sma_short && c.sma_short < c.sma_long;
  const vote: Vote = above ? "buy" : below ? "sell" : "hold";
  return {
    agent: "Agente de Tendência",
    vote,
    confidence: clamp(50 + Math.abs(c.sma_short - c.sma_long) / c.price * 2000, 30, 95),
    justification: above
      ? "Preço acima das médias curta/longa — tendência de alta."
      : below
      ? "Preço abaixo das médias — tendência de baixa."
      : "Médias cruzadas, sem tendência clara.",
    data_used: { sma_short: c.sma_short, sma_long: c.sma_long, price: c.price, support: c.support, resistance: c.resistance },
    perceived_risk: 40,
    has_veto: false,
  };
}

function volumeAgent(c: MarketContext): AgentVote {
  const ratio = c.volume_24h / c.avg_volume;
  const confirms = ratio > 1.3 && c.change_24h_pct > 0;
  const distribution = ratio > 1.3 && c.change_24h_pct < 0;
  const vote: Vote = confirms ? "buy" : distribution ? "sell" : ratio < 0.6 ? "wait" : "hold";
  return {
    agent: "Agente de Volume",
    vote,
    confidence: clamp(40 + Math.abs(ratio - 1) * 50, 30, 90),
    justification: `Volume ${ratio.toFixed(2)}x da média. ${
      confirms ? "Confirma alta." : distribution ? "Pressão vendedora." : "Sem confirmação clara."
    }`,
    data_used: { volume: c.volume_24h, avg_volume: c.avg_volume, ratio, change_24h: c.change_24h_pct },
    perceived_risk: ratio < 0.6 ? 60 : 35,
    has_veto: false,
  };
}

function technicalAgent(c: MarketContext): AgentVote {
  const macdBull = c.macd > c.macd_signal;
  const rsiOk = c.rsi > 35 && c.rsi < 70;
  const buy = macdBull && rsiOk && c.price < c.bb_upper;
  const sell = !macdBull && c.rsi > 70;
  const vote: Vote = buy ? "buy" : sell ? "sell" : "hold";
  return {
    agent: "Agente Técnico",
    vote,
    confidence: clamp(50 + Math.abs(c.macd - c.macd_signal) * 20, 35, 92),
    justification: `RSI ${c.rsi.toFixed(0)}, MACD ${macdBull ? "bull" : "bear"}. ${
      buy ? "Setup técnico favorável." : sell ? "Sobrecomprado e MACD virando." : "Sinais técnicos mistos."
    }`,
    data_used: { rsi: c.rsi, macd: c.macd, macd_signal: c.macd_signal, bb_upper: c.bb_upper, bb_lower: c.bb_lower },
    perceived_risk: 45,
    has_veto: false,
  };
}

function momentumAgent(c: MarketContext): AgentVote {
  const exhausted = Math.abs(c.momentum) > 70;
  const vote: Vote = exhausted ? (c.momentum > 0 ? "sell" : "buy") : c.momentum > 20 ? "buy" : c.momentum < -20 ? "sell" : "hold";
  return {
    agent: "Agente de Momentum",
    vote,
    confidence: clamp(40 + Math.abs(c.momentum) * 0.6, 30, 90),
    justification: exhausted
      ? "Momentum em exaustão — risco de reversão."
      : `Momentum ${c.momentum.toFixed(0)} — ${c.momentum > 0 ? "força compradora" : "força vendedora"}.`,
    data_used: { momentum: c.momentum, change_24h: c.change_24h_pct },
    perceived_risk: exhausted ? 65 : 40,
    has_veto: false,
  };
}

function sentimentAgent(c: MarketContext): AgentVote {
  const hasSource = typeof c.sentiment === "number";
  const s = c.sentiment ?? 0;
  const vote: Vote = !hasSource ? "wait" : s > 20 ? "buy" : s < -20 ? "sell" : "hold";
  return {
    agent: "Agente de Sentimento",
    vote,
    confidence: hasSource ? clamp(40 + Math.abs(s), 30, 85) : 35,
    justification: hasSource
      ? `Sentimento ${s.toFixed(0)} — mercado ${s > 0 ? "otimista" : "pessimista"}.`
      : "Sem fonte externa conectada. Voto baseado apenas em dados internos.",
    data_used: { sentiment: c.sentiment ?? null, has_source: hasSource },
    perceived_risk: 50,
    has_veto: false,
  };
}

function conservativeAgent(c: MarketContext): AgentVote {
  const safeBuy = c.rsi < 55 && c.price > c.sma_long && c.volatility_pct < 3.5 && c.volume_24h > c.avg_volume;
  const safeSell = c.rsi > 75 || (c.price < c.sma_long && c.change_24h_pct < -3);
  const vote: Vote = safeBuy ? "buy" : safeSell ? "sell" : "wait";
  return {
    agent: "Agente Conservador",
    vote,
    confidence: vote === "wait" ? 60 : 70,
    justification: safeBuy
      ? "Confirmações múltiplas com baixa volatilidade — entrada protegida."
      : safeSell
      ? "Sinais de fraqueza — preservar capital."
      : "Sem confirmações fortes — preferir esperar.",
    data_used: { rsi: c.rsi, volatility: c.volatility_pct, sma_long: c.sma_long },
    perceived_risk: 25,
    has_veto: false,
  };
}

function aggressiveAgent(c: MarketContext): AgentVote {
  const breakout = c.price > c.resistance * 0.995;
  const vote: Vote = breakout || c.momentum > 10 ? "buy" : c.change_24h_pct < -2 ? "sell" : "hold";
  return {
    agent: "Agente Agressivo",
    vote,
    confidence: clamp(55 + Math.abs(c.change_24h_pct) * 4, 40, 95),
    justification: breakout
      ? "Rompimento de resistência — entrada antecipada."
      : `Volatilidade ${c.volatility_pct.toFixed(1)}% — buscar oportunidade rápida.`,
    data_used: { resistance: c.resistance, momentum: c.momentum, change_24h: c.change_24h_pct },
    perceived_risk: 70,
    has_veto: false,
  };
}

function longTermAgent(c: MarketContext): AgentVote {
  const accumulating = c.price < c.sma_long * 1.02 && c.rsi < 55;
  const macroUp = c.sma_short > c.sma_long;
  const vote: Vote = accumulating && macroUp ? "buy" : c.price > c.sma_long * 1.15 ? "hold" : macroUp ? "hold" : "wait";
  return {
    agent: "Agente Longo Prazo",
    vote,
    confidence: 60,
    justification: accumulating
      ? "Preço próximo da média longa em ativo com tendência macro positiva — zona de acumulação."
      : "Aguardando ciclo favorável para acumulação.",
    data_used: { sma_long: c.sma_long, sma_short: c.sma_short, rsi: c.rsi },
    perceived_risk: 30,
    has_veto: false,
  };
}

function antiEuphoriaAgent(c: MarketContext): AgentVote {
  const euphoria = c.rsi > 80 || c.change_24h_pct > 8 || c.price > c.bb_upper * 1.01;
  const vote: Vote = euphoria ? "wait" : "hold";
  return {
    agent: "Agente Anti-Euforia",
    vote,
    confidence: euphoria ? 85 : 50,
    justification: euphoria
      ? `Sinais de euforia detectados (RSI ${c.rsi.toFixed(0)}, alta ${c.change_24h_pct.toFixed(1)}%).`
      : "Sem sinais de euforia.",
    data_used: { rsi: c.rsi, change_24h: c.change_24h_pct, bb_upper: c.bb_upper },
    perceived_risk: euphoria ? 90 : 30,
    has_veto: euphoria,
    veto_reason: euphoria ? "Euforia: bloqueio de compra para evitar FOMO." : undefined,
  };
}

function riskAgent(c: MarketContext, maxPositionValue: number, walletBalance: number): AgentVote {
  const exposurePct = (maxPositionValue / Math.max(walletBalance, 1)) * 100;
  const stopPct = 3;
  const targetPct = 6;
  const rr = targetPct / stopPct;
  const tooVolatile = c.volatility_pct > 6;
  const tooExposed = exposurePct > 25;
  const block = tooVolatile || tooExposed || c.data_quality < 50;
  return {
    agent: "Agente de Risco",
    vote: block ? "wait" : "hold",
    confidence: 80,
    justification: block
      ? `Risco elevado: volatilidade ${c.volatility_pct.toFixed(1)}%, exposição ${exposurePct.toFixed(1)}%, qualidade dados ${c.data_quality.toFixed(0)}.`
      : `Risco aceitável. R/R ${rr.toFixed(1)} (stop ${stopPct}% / alvo ${targetPct}%).`,
    data_used: { volatility: c.volatility_pct, exposure_pct: exposurePct, stop_pct: stopPct, target_pct: targetPct, rr },
    perceived_risk: block ? 95 : 35,
    has_veto: block,
    veto_reason: block ? "Risco/exposição acima do limite." : undefined,
  };
}

export interface AgentRuntimeMeta {
  weights: Record<string, number>;
  active: Record<string, boolean>;
  maxPositionValue: number;
  walletBalance: number;
}

export function runAllAgents(c: MarketContext, meta: AgentRuntimeMeta): AgentVote[] {
  const all: AgentVote[] = [
    trendAgent(c),
    volumeAgent(c),
    technicalAgent(c),
    momentumAgent(c),
    sentimentAgent(c),
    conservativeAgent(c),
    aggressiveAgent(c),
    longTermAgent(c),
    antiEuphoriaAgent(c),
    riskAgent(c, meta.maxPositionValue, meta.walletBalance),
  ];
  return all.filter((v) => meta.active[v.agent] !== false);
}

// ---- Committee consensus -------------------------------------------------

export interface CommitteeSettings {
  min_favor_votes: number;
  min_confidence: number;
  min_score: number;
  default_stop_pct: number;
  default_target_pct: number;
  max_position_value: number;
}

export interface CommitteeDecision {
  final_decision: "buy_approved" | "sell_approved" | "hold" | "wait" | "blocked";
  classification: string;
  score: number;
  avg_confidence: number;
  votes_buy: number;
  votes_sell: number;
  votes_hold: number;
  votes_wait: number;
  risk_approved: boolean;
  euphoria_vetoed: boolean;
  data_quality: number;
  consolidated_justification: string;
}

export function buildDecision(
  votes: AgentVote[],
  weights: Record<string, number>,
  settings: CommitteeSettings,
  dataQuality: number,
): CommitteeDecision {
  const counts = { buy: 0, sell: 0, hold: 0, wait: 0 };
  let confSum = 0;
  let weightSum = 0;
  let riskSum = 0;
  let riskApproved = true;
  let euphoriaVetoed = false;
  for (const v of votes) {
    counts[v.vote]++;
    const w = weights[v.agent] ?? 1;
    confSum += v.confidence * w;
    weightSum += w;
    riskSum += v.perceived_risk;
    if (v.agent === "Agente de Risco" && v.has_veto) riskApproved = false;
    if (v.agent === "Agente Anti-Euforia" && v.has_veto) euphoriaVetoed = true;
  }
  const avgConfidence = weightSum ? confSum / weightSum : 0;
  const avgRisk = votes.length ? riskSum / votes.length : 50;
  const total = votes.length || 1;
  const buySide = counts.buy;
  const sellSide = counts.sell;

  let score =
    0.35 * ((Math.max(buySide, sellSide) / total) * 100) +
    0.30 * avgConfidence +
    0.15 * dataQuality +
    0.20 * (100 - avgRisk);
  if (!riskApproved) score = Math.min(score, 30);
  if (euphoriaVetoed && buySide >= sellSide) score = Math.min(score, 50);
  score = clamp(score);

  let final: CommitteeDecision["final_decision"] = "wait";
  const buyOk =
    buySide >= settings.min_favor_votes &&
    riskApproved &&
    !euphoriaVetoed &&
    avgConfidence >= settings.min_confidence &&
    score >= settings.min_score;
  const sellOk =
    sellSide >= settings.min_favor_votes &&
    riskApproved &&
    avgConfidence >= settings.min_confidence &&
    score >= settings.min_score;
  if (!riskApproved) final = "blocked";
  else if (buyOk) final = "buy_approved";
  else if (sellOk) final = "sell_approved";
  else if (counts.hold > counts.wait) final = "hold";
  else final = "wait";

  const classification =
    score >= 91 ? "Oportunidade simulada crítica" :
    score >= 76 ? "Forte oportunidade simulada" :
    score >= 61 ? "Alerta moderado" :
    score >= 41 ? "Observar" : "Ignorar";

  const justification =
    final === "buy_approved"
      ? `Compra simulada aprovada: ${buySide}/${total} votos pró-compra, confiança média ${avgConfidence.toFixed(0)}, score ${score.toFixed(0)}.`
      : final === "sell_approved"
      ? `Venda simulada aprovada: ${sellSide}/${total} votos pró-venda, score ${score.toFixed(0)}.`
      : final === "blocked"
      ? "Operação bloqueada pelo Agente de Risco."
      : euphoriaVetoed
      ? "Compra bloqueada pelo Agente Anti-Euforia. Aguardar resfriamento."
      : `Sem consenso suficiente (${buySide} buy / ${sellSide} sell / ${counts.hold} hold / ${counts.wait} wait).`;

  return {
    final_decision: final,
    classification,
    score,
    avg_confidence: avgConfidence,
    votes_buy: counts.buy,
    votes_sell: counts.sell,
    votes_hold: counts.hold,
    votes_wait: counts.wait,
    risk_approved: riskApproved,
    euphoria_vetoed: euphoriaVetoed,
    data_quality: dataQuality,
    consolidated_justification: justification,
  };
}
