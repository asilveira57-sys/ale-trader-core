// ───────────── Conversão simulado → real por TAMANHO (30/08/2026) ─────────────
// O simulado roda maior (max_contracts) para gerar estatística; o real roda
// menor (b3_prd_authorizations.max_qty). Isso é DESENHO. O defeito corrigido
// aqui era outro: o espelhamento levava os valores em REAIS do simulado para o
// real sem converter para o tamanho real, e a regra "3 stops por dia" virava
// "até 15 stops por dia" no dinheiro real.
//
// Regra única:      valor_real = valor_simulado ÷ contratos_simulados × max_qty
// Pontos NÃO se convertem: stop_pts, gain_pts, trailing_*, breakeven_* são
// iguais em qualquer tamanho e não são tocados em nenhum lugar deste arquivo.
//
// Nada aqui é digitado à mão: quantidade e limites saem de
// b3_prd_authorizations (tela "Automações Reais") e dos parâmetros do robô.

/** Regra de casa: um robô aguenta 3 stops cheios por dia. */
export const STOPS_POR_DIA = 3;

export function realScale(simContracts: number, maxQty: number): number {
  const sim = Math.max(1, Number(simContracts) || 1);
  const real = Math.max(0, Number(maxQty) || 0);
  return real / sim;
}

/** Converte um valor denominado em R$ do tamanho simulado para o tamanho real. */
export function toRealBrl(valueBrl: number | null | undefined, simContracts: number, maxQty: number): number | null {
  if (valueBrl == null || !Number.isFinite(Number(valueBrl))) return null;
  return Number(valueBrl) * realScale(simContracts, maxQty);
}

/** 3 stops cheios no tamanho REAL, em R$. */
export function threeStopsRealBrl(stopPts: number, pointValueBrl: number, maxQty: number): number {
  const stop = Math.abs(Number(stopPts) || 0);
  const pv = Math.abs(Number(pointValueBrl) || 0);
  const qty = Math.max(0, Number(maxQty) || 0);
  return STOPS_POR_DIA * stop * pv * qty;
}

/**
 * MUDANÇA 4 — quem trava primeiro: vale o MENOR entre o limite manual digitado
 * na tela e o valor de 3 stops no tamanho real. Manual frouxo não afrouxa a
 * regra; manual apertado continua valendo. Zero/nulo no manual = só a regra.
 */
export function effectiveRealDailyLossBrl(
  manualBrl: number | null | undefined,
  stopPts: number,
  pointValueBrl: number,
  maxQty: number,
): { limit_brl: number; three_stops_brl: number; manual_brl: number | null; origem: "manual" | "tres_stops" } {
  const threeStops = threeStopsRealBrl(stopPts, pointValueBrl, maxQty);
  const manual = manualBrl == null || !Number.isFinite(Number(manualBrl)) || Number(manualBrl) <= 0
    ? null
    : Math.abs(Number(manualBrl));
  if (manual == null) return { limit_brl: threeStops, three_stops_brl: threeStops, manual_brl: null, origem: "tres_stops" };
  const limit = Math.min(manual, threeStops);
  return {
    limit_brl: limit,
    three_stops_brl: threeStops,
    manual_brl: manual,
    origem: limit === manual && manual < threeStops ? "manual" : "tres_stops",
  };
}

export interface SimBrlParams {
  daily_loss_limit_brl?: number | null;
  daily_gain_target_brl?: number | null;
  peak_lock_min_profit_brl?: number | null;
}

/** Todos os parâmetros em R$ do robô, convertidos para o tamanho real. */
export function convertSimBrlParamsToReal(cfg: SimBrlParams, simContracts: number, maxQty: number) {
  return {
    daily_loss_limit_brl: toRealBrl(cfg.daily_loss_limit_brl, simContracts, maxQty),
    daily_gain_target_brl: toRealBrl(cfg.daily_gain_target_brl, simContracts, maxQty),
    peak_lock_min_profit_brl: toRealBrl(cfg.peak_lock_min_profit_brl, simContracts, maxQty),
    escala: realScale(simContracts, maxQty),
  };
}

export interface GlobalStopRobot {
  symbol: string; variant: string; mode: string;
  enabled: boolean;
  max_qty: number;
  stop_pts: number;
  point_value_brl: number;
}

/**
 * MUDANÇA 2 — stop global DERIVADO, nunca digitado:
 *   stop_global = Σ (3 × stop_pts × valor_do_ponto × max_qty) dos robôs ligados.
 * Ligar/desligar robô ou mudar max_qty na tela ajusta o global sozinho.
 */
export function computeGlobalRealStop(robots: GlobalStopRobot[]) {
  const parts = robots
    .filter((r) => r.enabled === true && Number(r.max_qty) > 0 && Number(r.stop_pts) > 0)
    .map((r) => ({
      symbol: r.symbol, variant: r.variant, mode: r.mode,
      max_qty: Number(r.max_qty),
      stop_pts: Number(r.stop_pts),
      point_value_brl: Number(r.point_value_brl),
      three_stops_brl: threeStopsRealBrl(r.stop_pts, r.point_value_brl, r.max_qty),
    }));
  const total = parts.reduce((s, p) => s + p.three_stops_brl, 0);
  return { total_brl: Math.round(total * 100) / 100, robots: parts };
}
