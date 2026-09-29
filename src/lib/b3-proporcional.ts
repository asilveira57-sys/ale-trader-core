// Limites proporcionais (29/09/2026).
// Dinheiro → % do capital. Movimento de preço → % do stop_pts da entrada.
// Com a chave desligada (ou percentual vazio) vale o valor fixo de sempre.

export interface CfgProporcional {
  limites_proporcionais?: boolean | null;
  peak_lock_min_profit_brl?: number | null;
  daily_gain_target_brl?: number | null;
  daily_loss_limit_brl?: number | null;
  max_contracts?: number | null;
  trailing_activation_pts?: number | null;
  trailing_giveback_pts?: number | null;
  breakeven_ativa_pts?: number | null;
  breakeven_folga_pts?: number | null;
  peak_lock_min_profit_pct?: number | null;
  daily_gain_target_pct?: number | null;
  daily_loss_limit_pct?: number | null;
  risco_contratos_pct?: number | null;
  trailing_activation_pct_stop?: number | null;
  trailing_giveback_pct_stop?: number | null;
  breakeven_ativa_pct_stop?: number | null;
  breakeven_folga_pct_stop?: number | null;
}

const pct = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) || n <= 0 ? null : n;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** contratos = piso(capital × risco% ÷ margem por contrato), mín. 1, teto opcional. */
export function contratosProporcionais(
  capital: number, riscoPct: number | null, margemContrato: number | null, teto?: number | null,
): number | null {
  const m = Number(margemContrato);
  if (riscoPct == null || !(m > 0) || !(capital > 0)) return null;
  let q = Math.max(1, Math.floor((capital * riscoPct / 100) / m));
  if (teto != null && Number(teto) > 0) q = Math.min(q, Number(teto));
  return q;
}

export interface LimitesResolvidos {
  proporcional: boolean;
  capital_brl: number | null;
  peak_lock_min_profit_brl: number | null;
  daily_gain_target_brl: number | null;
  daily_loss_limit_brl: number | null;
  max_contracts: number | null;
  trailing_activation_pts: number | null;
  trailing_giveback_pts: number | null;
  breakeven_ativa_pts: number | null;
  breakeven_folga_pts: number | null;
}

export function resolverLimites(
  cfg: CfgProporcional, capital: number | null, stopPts: number | null,
  opts: { margemContrato?: number | null; tetoContratos?: number | null } = {},
): LimitesResolvidos {
  const fixo = (k: keyof CfgProporcional) => (cfg[k] == null ? null : Number(cfg[k]));
  const on = cfg.limites_proporcionais === true;
  const cap = Number(capital);
  const capOk = on && cap > 0;
  const stop = Math.abs(Number(stopPts) || 0);
  const brl = (p: keyof CfgProporcional, f: keyof CfgProporcional) => {
    const v = pct(cfg[p]);
    return capOk && v != null ? r2(cap * v / 100) : fixo(f);
  };
  const pts = (p: keyof CfgProporcional, f: keyof CfgProporcional) => {
    const v = pct(cfg[p]);
    return on && stop > 0 && v != null ? Math.round(stop * v / 100) : fixo(f);
  };
  const q = capOk
    ? contratosProporcionais(cap, pct(cfg.risco_contratos_pct), opts.margemContrato ?? null, opts.tetoContratos)
    : null;
  return {
    proporcional: on,
    capital_brl: capOk ? cap : null,
    peak_lock_min_profit_brl: brl("peak_lock_min_profit_pct", "peak_lock_min_profit_brl"),
    daily_gain_target_brl: brl("daily_gain_target_pct", "daily_gain_target_brl"),
    daily_loss_limit_brl: brl("daily_loss_limit_pct", "daily_loss_limit_brl"),
    max_contracts: q ?? fixo("max_contracts"),
    trailing_activation_pts: pts("trailing_activation_pct_stop", "trailing_activation_pts"),
    trailing_giveback_pts: pts("trailing_giveback_pct_stop", "trailing_giveback_pts"),
    breakeven_ativa_pts: pts("breakeven_ativa_pct_stop", "breakeven_ativa_pts"),
    breakeven_folga_pts: pts("breakeven_folga_pct_stop", "breakeven_folga_pts"),
  };
}

/** Aplica os limites resolvidos por cima do cfg (só quando a chave está ligada). */
export function aplicarProporcional<T extends Record<string, any>>(
  cfg: T, capital: number | null, stopPts: number | null, margemContrato?: number | null,
): T {
  if (cfg?.limites_proporcionais !== true) return cfg;
  const r = resolverLimites(cfg, capital, stopPts, { margemContrato });
  const out: any = { ...cfg };
  for (const k of ["peak_lock_min_profit_brl", "daily_gain_target_brl", "daily_loss_limit_brl", "max_contracts",
    "trailing_activation_pts", "trailing_giveback_pts", "breakeven_ativa_pts", "breakeven_folga_pts"] as const) {
    if (r[k] != null) out[k] = r[k];
  }
  out.capital_calculo_brl = r.capital_brl;
  return out;
}

// ── Trava assimétrica do capital lido ───────────────────────────────────────
export const SALTO_ALTA = 0.30;
export const LEITURAS_ESTAVEIS = 3;

export interface EstadoCapital {
  aceito: number | null;
  pendente: number | null;
  leituras: number;
}

/**
 * Queda: aceita na hora (lado seguro). Alta > 30%: quarentena até três leituras
 * seguidas estáveis (±30% entre si) do novo patamar.
 */
export function aceitarCapital(prev: EstadoCapital, lido: number | null): EstadoCapital & { quarentena: boolean; saltou: boolean } {
  const v = Number(lido);
  if (lido == null || !Number.isFinite(v)) return { ...prev, quarentena: prev.pendente != null, saltou: false };
  const a = prev.aceito;
  if (a == null || !(a > 0) || v <= a * (1 + SALTO_ALTA)) {
    return { aceito: v, pendente: null, leituras: 0, quarentena: false, saltou: false };
  }
  const estavel = prev.pendente != null && Math.abs(v - prev.pendente) <= prev.pendente * SALTO_ALTA;
  const leituras = estavel ? prev.leituras + 1 : 1;
  if (leituras >= LEITURAS_ESTAVEIS) return { aceito: v, pendente: null, leituras: 0, quarentena: false, saltou: false };
  return { aceito: a, pendente: v, leituras, quarentena: true, saltou: leituras === 1 };
}
