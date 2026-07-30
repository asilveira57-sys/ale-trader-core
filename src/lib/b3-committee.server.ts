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
  // Volume fraco só rejeita quando o preço TAMBÉM está do lado errado do VWAP.
  // Antes, volume fraco rejeitava mesmo com VWAP a favor — o mesmo sinal
  // (fluxo) derrubava consenso e, em seguida, a penalização por rejeição.
  const vote: B3Vote = strong && dirOk ? "approve" : (weak && !dirOk) ? "reject" : "neutral";
  return {
    agent_name: "Volume / VWAP",
    vote,
    confidence: clamp(40 + Math.abs(c.volume_ratio - 1) * 40, 30, 90),
    reason: `Volume ${c.volume_ratio.toFixed(2)}x média. Preço ${c.price > c.vwap ? "acima" : "abaixo"} do VWAP${
      weak && dirOk ? " — fluxo fraco, mas direção a favor (neutro)." : "."
    }`,
    has_veto: false,
    data: { volume_ratio: c.volume_ratio, vwap: c.vwap, price: c.price, dir_ok: dirOk, weak, strong },
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

function aVolatilidade(c: B3Context, t?: B3AgentTuning): B3AgentVote {
  // Usa o MESMO limite do modo (cfg.max_volatility_pct). Antes eram 3,5% fixos,
  // contraditórios com o gate do motor: um modo com limite 6% passava no gate
  // e mesmo assim recebia "reject" do agente pelo mesmo valor de volatilidade.
  const maxPct = Number(t?.max_volatility_pct ?? 3.5);
  const minPct = Number(t?.min_volatility_pct ?? 0.6);
  const tooHigh = c.volatility_pct > maxPct;
  const tooLow = c.volatility_pct < minPct;
  return {
    agent_name: "Volatilidade",
    vote: tooHigh ? "reject" : tooLow ? "neutral" : "approve",
    confidence: 70,
    reason: tooHigh ? `Volatilidade ${c.volatility_pct.toFixed(2)}% acima do limite do modo (${maxPct.toFixed(2)}%).` :
            tooLow ? `Volatilidade ${c.volatility_pct.toFixed(2)}% abaixo de ${minPct.toFixed(2)}% — fluxo fraco (neutro).` :
            `Volatilidade ${c.volatility_pct.toFixed(2)}% dentro do limite do modo (${maxPct.toFixed(2)}%).`,
    has_veto: false,
    data: { volatility_pct: c.volatility_pct, spread_pts: c.spread_pts, max_volatility_pct: maxPct, min_volatility_pct: minPct },
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
  // Somente RSI extremo caracteriza euforia/pânico. As checagens antigas
  // `price > high*0.999` / `price < low*1.001` usavam c.high/c.low do próprio
  // buffer, que sempre inclui o preço atual como max/min quando ele faz um
  // novo extremo local — isso disparava veto em quase todo tick com
  // tendência real, cravando o score final em 25. Mantida como proteção,
  // porém sem o falso-positivo do "extremo de janela".
  const overbought = c.rsi > 78 && side === "buy";
  const oversold = c.rsi < 22 && side === "sell";
  const block = overbought || oversold;
  const reason = overbought
    ? `RSI ${c.rsi.toFixed(0)} sobrecomprado — evitar FOMO em compra.`
    : oversold
    ? `RSI ${c.rsi.toFixed(0)} sobrevendido — evitar pânico em venda.`
    : `RSI ${c.rsi.toFixed(0)} em zona neutra — sem sinais de euforia.`;
  return {
    agent_name: "Anti-Euforia",
    vote: block ? "reject" : "neutral",
    confidence: block ? 85 : 50,
    reason,
    has_veto: block,
    veto_reason: block ? "RSI em extremo (>78 compra / <22 venda)." : undefined,
    data: { rsi: c.rsi, high: c.high, low: c.low, rule: "rsi_only" },
  };
}

function aRisco(c: B3Context, side: B3Side, r: B3RiskState, t?: B3AgentTuning): B3AgentVote {
  const lossHit = r.realized_today_brl <= -r.daily_loss_limit;
  const gainHit = r.realized_today_brl >= r.daily_gain_target;
  const overContracts = r.open_contracts + r.requested_qty > r.max_contracts;
  // Stop/gain reais do modo (antes eram 150/300 fixos para os 5 modos).
  const stopPts = Number(t?.stop_pts ?? 150);
  const gainPts = Number(t?.gain_pts ?? 300);
  const rr = stopPts > 0 ? gainPts / stopPts : 0;
  const block = lossHit || gainHit || overContracts;
  const reasons: string[] = [];
  if (lossHit) reasons.push(`Perda diária atingida (${r.realized_today_brl.toFixed(2)}).`);
  if (gainHit) reasons.push(`Meta diária atingida (${r.realized_today_brl.toFixed(2)}).`);
  if (overContracts) reasons.push(`Contratos excederiam o limite (${r.max_contracts}).`);
  return {
    agent_name: "Risco",
    vote: block ? "reject" : "approve",
    confidence: 90,
    reason: block ? reasons.join(" ") : `R/R ${rr.toFixed(2)} (stop ${stopPts} / gain ${gainPts}) aceitável.`,
    has_veto: block,
    veto_reason: block ? reasons.join(" ") : undefined,
    data: { realized: r.realized_today_brl, loss_limit: r.daily_loss_limit, gain_target: r.daily_gain_target,
            open_contracts: r.open_contracts, requested: r.requested_qty, max: r.max_contracts,
            stop_pts: stopPts, gain_pts: gainPts, rr },
  };
}

/** Parâmetros por modo repassados aos agentes, para que os 5 modos não avaliem
 *  o mesmo tick com constantes idênticas. */
export interface B3AgentTuning {
  max_volatility_pct?: number;
  min_volatility_pct?: number;
  stop_pts?: number;
  gain_pts?: number;
}

export function runB3Agents(c: B3Context, side: B3Side, risk: B3RiskState, tuning?: B3AgentTuning): B3AgentVote[] {
  return [
    aTendencia(c, side),
    aVolume(c, side),
    aTecnico(c, side),
    aMomentum(c, side),
    aVolatilidade(c, tuning),
    aHorario(c, risk),
    aAntiTendencia(c, side),
    aRisco(c, side, risk, tuning),
  ];
}


export interface B3ScoreComposition {
  agents_consulted: number;
  consensus_pct: number;         // (approve/total)*100
  reject_pct: number;            // (reject/total)*100
  avg_confidence: number;        // média das confianças
  consensus_component: number;   // 0.45 * consensus_pct
  confidence_component: number;  // 0.35 * avg
  reject_penalty_component: number; // 0.20 * (100 - reject_pct)
  raw_score: number;             // soma antes do cap por veto
  veto_cap_applied: boolean;
  veto_cap_value: number;        // 25 quando aplicado, senão 100
  final_score: number;           // após veto e clamp
}

export interface B3AgentBreakdown {
  agent_name: string;
  vote: B3Vote;
  confidence: number;
  reason: string;
  has_veto: boolean;
  veto_reason?: string;
}

export interface B3Decision {
  final: "approved" | "rejected" | "blocked" | "hold";
  side: B3Side;
  score: number;             // 0..100
  approve_votes: number;
  reject_votes: number;
  neutral_votes: number;
  total_votes: number;
  avg_confidence: number;
  vetoes: string[];
  classification: string;
  justification: string;
  composition: B3ScoreComposition;
  agent_votes: B3AgentBreakdown[];
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
  const consensusComponent = 0.45 * consensusPct;
  const confidenceComponent = 0.35 * avg;
  const rejectPenaltyComponent = 0.20 * (100 - rejectPct);
  const rawScore = consensusComponent + confidenceComponent + rejectPenaltyComponent;
  const vetoCapApplied = vetoes.length > 0;
  const vetoCapValue = vetoCapApplied ? 25 : 100;
  let score = rawScore;
  if (vetoCapApplied) score = Math.min(score, vetoCapValue);
  score = clamp(score);

  let final: B3Decision["final"];
  if (vetoCapApplied) final = "blocked";
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

  const composition: B3ScoreComposition = {
    agents_consulted: votes.length,
    consensus_pct: Number(consensusPct.toFixed(2)),
    reject_pct: Number(rejectPct.toFixed(2)),
    avg_confidence: Number(avg.toFixed(2)),
    consensus_component: Number(consensusComponent.toFixed(2)),
    confidence_component: Number(confidenceComponent.toFixed(2)),
    reject_penalty_component: Number(rejectPenaltyComponent.toFixed(2)),
    raw_score: Number(rawScore.toFixed(2)),
    veto_cap_applied: vetoCapApplied,
    veto_cap_value: vetoCapValue,
    final_score: Number(score.toFixed(2)),
  };
  const agent_votes: B3AgentBreakdown[] = votes.map((v) => ({
    agent_name: v.agent_name,
    vote: v.vote,
    confidence: v.confidence,
    reason: v.reason,
    has_veto: v.has_veto,
    veto_reason: v.veto_reason,
  }));

  return {
    final, side, score,
    approve_votes: approve, reject_votes: reject, neutral_votes: neutral,
    total_votes: votes.length,
    avg_confidence: avg, vetoes, classification, justification,
    composition, agent_votes,
  };
}
