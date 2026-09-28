// Trailing stop e zero a zero como MOVIMENTO DO STOP (28/09/2026).
// Antes o trailing só existia como gatilho de fechamento calculado em memória;
// o stop_price gravado ficava o original e o stop original era checado antes.
// Agora: nível novo = melhor preço − recuo (compra; espelhado na venda),
// arredondado a favor da proteção, e o stop só anda a favor, nunca volta.
// Zero em ativação/recuo/breakeven = desligado.

export type TrailCfg = {
  trailing_activation_pts: number;
  trailing_giveback_pts: number;
  trailing_mode: string;
  breakeven_ativa_pts: number;
  breakeven_folga_pts: number;
};

export function trailingLigado(cfg: TrailCfg) {
  return cfg.trailing_activation_pts > 0 && cfg.trailing_giveback_pts > 0 && cfg.trailing_mode !== "structural";
}
export function breakevenLigado(cfg: TrailCfg) {
  return cfg.breakeven_ativa_pts > 0;
}

function arred(level: number, tick: number, dir: 1 | -1) {
  const t = tick > 0 ? tick : 1;
  // compra: arredonda para baixo; venda: para cima (nunca promete mais proteção que a conta)
  return dir === 1 ? Math.floor(level / t + 1e-9) * t : Math.ceil(level / t - 1e-9) * t;
}

/** Nível de stop exigido pelo trailing/zero a zero dado o pico a favor (pts). */
export function nivelProtecao(p: {
  side: "buy" | "sell"; entry: number; peakPts: number; cfg: TrailCfg; tick: number;
}): { level: number; fonte: "trailing" | "breakeven" } | null {
  const dir: 1 | -1 = p.side === "buy" ? 1 : -1;
  let best: { level: number; fonte: "trailing" | "breakeven" } | null = null;
  if (trailingLigado(p.cfg) && p.peakPts >= p.cfg.trailing_activation_pts) {
    best = { level: arred(p.entry + dir * (p.peakPts - p.cfg.trailing_giveback_pts), p.tick, dir), fonte: "trailing" };
  }
  if (breakevenLigado(p.cfg) && p.peakPts >= p.cfg.breakeven_ativa_pts) {
    const be = arred(p.entry + dir * Math.max(0, p.cfg.breakeven_folga_pts || 0), p.tick, dir);
    if (!best || (dir === 1 ? be > best.level : be < best.level)) best = { level: be, fonte: "breakeven" };
  }
  return best;
}

/** true se `novo` protege mais que `atual` (compra: maior; venda: menor). */
export function protegeMais(side: "buy" | "sell", novo: number, atual: number | null) {
  if (atual === null || !Number.isFinite(atual) || atual <= 0) return true;
  return side === "buy" ? novo > atual : novo < atual;
}
