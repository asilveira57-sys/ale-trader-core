// B3 Day Trade (WIN) — comitê de 8 agentes. Determinístico, sem dependências externas.
// Usado apenas pelo handler de createServerFn em src/lib/b3.functions.ts

export type B3Vote = "approve" | "reject" | "neutral";
export type B3Side = "buy" | "sell";

export interface B3Context {
  symbol: string;            // ex: WIN
  contract_code: string;     // ex: WINFUT
  price: number;             // pontos
  prev_close: number;
  open: number;
  high: number;
  low: number;
  vwap: number;
  ema9: number;
  ema21: number;
  rsi: number;               // 0..100
  macd: number;
  macd_signal: number;
  volume_ratio: number;      // vol atual / média
  volatility_pct: number;    // 0..100
  momentum: number;          // -100..100
  spread_pts: number;        // pontos
  now: Date;
  session_phase: "abertura" | "manha" | "almoco" | "tarde" | "fechamento" | "fora";
}

export interface B3AgentVote {
  agent_name: string;
  vote: B3Vote;
  confidence: number;        // 0..100
  reason: string;
  has_veto: boolean;
  veto_reason?: string;
  data: Record<string, unknown>;
}

export interface B3RiskState {
  daily_loss_limit: number;
  daily_gain_target: number;
  realized_today_brl: number;
  open_contracts: number;
  max_contracts: number;
  requested_qty: number;
  inside_hours: boolean;
  force_close_now: boolean;
  strategy_mode: "conservador" | "moderado" | "equilibrado" | "semi_agressivo" | "agressivo";
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

function saoPauloMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function buildMockB3Context(symbol = "WIN", contract = "WINFUT", basePrice = 130000): B3Context {
  const now = new Date();
  const seed = ((now.getTime() / 60000) | 0) + hash(symbol);
  const r = (k: number) => (Math.sin(seed * (k + 1)) + 1) / 2;
  const change = (r(1) - 0.5) * 0.02; // ±1%
  const price = Math.round((basePrice * (1 + change)) / 5) * 5;
  const phase = sessionPhase(now);
  return {
    symbol, contract_code: contract,
    price,
    prev_close: basePrice,
    open: basePrice * (1 + (r(2) - 0.5) * 0.005),
    high: price * (1 + Math.abs(change) + 0.002),
    low: price * (1 - Math.abs(change) - 0.002),
    vwap: price * (1 + (r(3) - 0.5) * 0.003),
    ema9: price * (1 + (r(4) - 0.5) * 0.004),
    ema21: price * (1 + (r(5) - 0.5) * 0.008),
    rsi: 25 + r(6) * 65,
    macd: (r(7) - 0.5) * 30,
    macd_signal: (r(8) - 0.5) * 30,
    volume_ratio: 0.5 + r(9) * 2,
    volatility_pct: 0.5 + r(10) * 4,
    momentum: (r(11) - 0.5) * 150,
    spread_pts: 5 + Math.round(r(12) * 10),
    now,
    session_phase: phase,
  };
}

function sessionPhase(d: Date): B3Context["session_phase"] {
  const m = saoPauloMinutes(d);
  if (m < 9 * 60 + 5 || m > 17 * 60 + 55) return "fora";
  if (m < 9 * 60 + 30) return "abertura";
  if (m < 12 * 60) return "manha";
  if (m < 14 * 60) return "almoco";
  if (m < 17 * 60) return "tarde";
  return "fechamento";
}

// ───── 8 agentes ─────
function aTendencia(c: B3Context, side: B3Side): B3AgentVote {
  const up = c.price > c.ema9 && c.ema9 > c.ema21;
  const down = c.price < c.ema9 && c.ema9 < c.ema21;
  const aligned = (side === "buy" && up) || (side === "sell" && down);
  const opposite = (side === "buy" && down) || (side === "sell" && up);
  return {
    agent_name: "Tendência Intraday",
    vote: aligned ? "approve" : opposite ? "reject" : "neutral",
    confidence: clamp(50 + Math.abs(c.ema9 - c.ema21) / c.price * 5000, 30, 95),
    reason: up ? "EMA9 > EMA21, preço acima — tendência alta." :
            down ? "EMA9 < EMA21, preço abaixo — tendência baixa." : "Médias cruzadas.",
    has_veto: false,
    data: { price: c.price, ema9: c.ema9, ema21: c.ema21 },
  };
}

function aVolume(c: B3Context, side: B3Side): B3AgentVote {
  const strong = c.volume_ratio > 1.3;
  const weak = c.volume_ratio < 0.7;
  const dirOk = (side === "buy" && c.price > c.vwap) || (side === "sell" && c.price < c.vwap);
  return {
    agent_name: "Volume / VWAP",
    vote: strong && dirOk ? "approve" : weak ? "reject" : "neutral",
    confidence: clamp(40 + Math.abs(c.volume_ratio - 1) * 40, 30, 90),
    reason: `Volume ${c.volume_ratio.toFixed(2)}x média. Preço ${c.price > c.vwap ? "acima" : "abaixo"} do VWAP.`,
    has_veto: false,
    data: { volume_ratio: c.volume_ratio, vwap: c.vwap, price: c.price },
  };
}

function aTecnico(c: B3Context, side: B3Side): B3AgentVote {
  const macdBull = c.macd > c.macd_signal;
  const rsiOk = c.rsi > 30 && c.rsi < 70;
  const buyOk = side === "buy" && macdBull && rsiOk && c.rsi < 65;
  const sellOk = side === "sell" && !macdBull && c.rsi > 35;
  return {
    agent_name: "Técnico (RSI/MACD)",
    vote: buyOk || sellOk ? "approve" : (!rsiOk ? "reject" : "neutral"),
    confidence: clamp(45 + Math.abs(c.macd - c.macd_signal) * 0.5, 35, 92),
    reason: `RSI ${c.rsi.toFixed(0)} · MACD ${macdBull ? "bull" : "bear"}.`,
    has_veto: false,
    data: { rsi: c.rsi, macd: c.macd, macd_signal: c.macd_signal },
  };
}

function aMomentum(c: B3Context, side: B3Side): B3AgentVote {
  const aligned = (side === "buy" && c.momentum > 20) || (side === "sell" && c.momentum < -20);
  const exhausted = Math.abs(c.momentum) > 120;
  return {
    agent_name: "Momentum",
    vote: exhausted ? "reject" : aligned ? "approve" : "neutral",
    confidence: clamp(40 + Math.abs(c.momentum) * 0.5, 30, 90),
    reason: exhausted ? "Momentum em exaustão — risco de reversão." :
            `Momentum ${c.momentum.toFixed(0)}.`,
    has_veto: false,
    data: { momentum: c.momentum },
  };
}

function aVolatilidade(c: B3Context): B3AgentVote {
  const tooHigh = c.volatility_pct > 3.5;
  const tooLow = c.volatility_pct < 0.6;
  return {
    agent_name: "Volatilidade",
    vote: tooHigh || tooLow ? "reject" : "approve",
    confidence: 70,
    reason: tooHigh ? `Volatilidade ${c.volatility_pct.toFixed(1)}% acima do tolerável.` :
            tooLow ? `Volatilidade ${c.volatility_pct.toFixed(1)}% muito baixa — sem fluxo.` :
            `Volatilidade ${c.volatility_pct.toFixed(1)}% adequada.`,
    has_veto: false,
    data: { volatility_pct: c.volatility_pct, spread_pts: c.spread_pts },
  };
}

function aHorario(c: B3Context, risk: B3RiskState): B3AgentVote {
  if (!risk.inside_hours || c.session_phase === "fora") {
    return { agent_name: "Horário de Pregão", vote: "reject", confidence: 100,
      reason: "Fora da janela operacional.", has_veto: true,
      veto_reason: "Fora do horário permitido.", data: { phase: c.session_phase } };
  }
  if (risk.force_close_now || c.session_phase === "fechamento") {
    return { agent_name: "Horário de Pregão", vote: "reject", confidence: 95,
      reason: "Janela de zeragem — apenas encerramento.", has_veto: true,
      veto_reason: "Janela de zeragem ativa.", data: { phase: c.session_phase } };
  }
  const cautious = c.session_phase === "almoco" || c.session_phase === "abertura";
  return {
    agent_name: "Horário de Pregão",
    vote: cautious ? "neutral" : "approve",
    confidence: cautious ? 55 : 80,
    reason: cautious ? `Fase ${c.session_phase} — cautela.` : `Fase ${c.session_phase} estável.`,
    has_veto: false,
    data: { phase: c.session_phase },
  };
}

function aAntiTendencia(c: B3Context, side: B3Side): B3AgentVote {
  const overbought = c.rsi > 78 && side === "buy";
  const oversold = c.rsi < 22 && side === "sell";
  const blow = c.price > c.high * 0.999 && side === "buy";
  const blowDn = c.price < c.low * 1.001 && side === "sell";
  const block = overbought || oversold || blow || blowDn;
  return {
    agent_name: "Anti-Euforia",
    vote: block ? "reject" : "neutral",
    confidence: block ? 85 : 50,
    reason: block ? `Entrada em extremo (RSI ${c.rsi.toFixed(0)}). Evitar FOMO.` :
            "Sem sinais de euforia.",
    has_veto: block,
    veto_reason: block ? "Entrada em extremo do dia." : undefined,
    data: { rsi: c.rsi, high: c.high, low: c.low },
  };
}

function aRisco(c: B3Context, side: B3Side, r: B3RiskState): B3AgentVote {
  const lossHit = r.realized_today_brl <= -r.daily_loss_limit;
  const gainHit = r.realized_today_brl >= r.daily_gain_target;
  const overContracts = r.open_contracts + r.requested_qty > r.max_contracts;
  const stopPts = 150, gainPts = 300;
  const rr = gainPts / stopPts;
  const block = lossHit || gainHit || overContracts;
  const reasons: string[] = [];
  if (lossHit) reasons.push(`Perda diária atingida (${r.realized_today_brl.toFixed(2)}).`);
  if (gainHit) reasons.push(`Meta diária atingida (${r.realized_today_brl.toFixed(2)}).`);
  if (overContracts) reasons.push(`Contratos excederiam o limite (${r.max_contracts}).`);
  return {
    agent_name: "Risco",
    vote: block ? "reject" : "approve",
    confidence: 90,
    reason: block ? reasons.join(" ") : `R/R ${rr.toFixed(1)} aceitável.`,
    has_veto: block,
    veto_reason: block ? reasons.join(" ") : undefined,
    data: { realized: r.realized_today_brl, loss_limit: r.daily_loss_limit, gain_target: r.daily_gain_target,
            open_contracts: r.open_contracts, requested: r.requested_qty, max: r.max_contracts, rr },
  };
}

export function runB3Agents(c: B3Context, side: B3Side, risk: B3RiskState): B3AgentVote[] {
  return [
    aTendencia(c, side),
    aVolume(c, side),
    aTecnico(c, side),
    aMomentum(c, side),
    aVolatilidade(c),
    aHorario(c, risk),
    aAntiTendencia(c, side),
    aRisco(c, side, risk),
  ];
}

export interface B3Decision {
  final: "approved" | "rejected" | "blocked" | "hold";
  side: B3Side;
  score: number;             // 0..100
  approve_votes: number;
  reject_votes: number;
  neutral_votes: number;
  avg_confidence: number;
  vetoes: string[];
  classification: string;
  justification: string;
}

export interface B3CommitteeSettings {
  min_approve_votes: number;
  min_confidence: number;
  min_score: number;
}

export function buildB3Decision(
  votes: B3AgentVote[],
  side: B3Side,
  settings: B3CommitteeSettings,
): B3Decision {
  let approve = 0, reject = 0, neutral = 0, conf = 0;
  const vetoes: string[] = [];
  for (const v of votes) {
    if (v.vote === "approve") approve++;
    else if (v.vote === "reject") reject++;
    else neutral++;
    conf += v.confidence;
    if (v.has_veto) vetoes.push(`${v.agent_name}: ${v.veto_reason ?? v.reason}`);
  }
  const total = votes.length || 1;
  const avg = conf / total;
  const consensusPct = (approve / total) * 100;
  const rejectPct = (reject / total) * 100;
  let score = 0.45 * consensusPct + 0.35 * avg + 0.20 * (100 - rejectPct);
  if (vetoes.length) score = Math.min(score, 25);
  score = clamp(score);

  let final: B3Decision["final"];
  if (vetoes.length) final = "blocked";
  else if (approve >= settings.min_approve_votes && avg >= settings.min_confidence && score >= settings.min_score)
    final = "approved";
  else if (reject > approve) final = "rejected";
  else final = "hold";

  const classification =
    score >= 85 ? "Sinal forte" :
    score >= 70 ? "Sinal moderado" :
    score >= 50 ? "Observar" : "Ignorar";

  const justification =
    final === "approved"
      ? `Entrada ${side === "buy" ? "comprada" : "vendida"} aprovada: ${approve}/${total} a favor, conf. ${avg.toFixed(0)}, score ${score.toFixed(0)}.`
      : final === "blocked"
      ? `Bloqueado por veto: ${vetoes.join(" | ")}`
      : final === "rejected"
      ? `Rejeitado: ${reject}/${total} contrários.`
      : `Sem consenso (${approve}A/${reject}R/${neutral}N).`;

  return {
    final, side, score, approve_votes: approve, reject_votes: reject, neutral_votes: neutral,
    avg_confidence: avg, vetoes, classification, justification,
  };
}
