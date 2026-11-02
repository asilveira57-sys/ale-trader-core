import { effectiveRealDailyLossBrl } from './b3-real-sizing';

export type AuthorizationInput = { symbol: string; variant: string; mode: string; stop_pts: number | null; point_value_brl: number | null; sim_max_contracts: number | null; simulado_ativo: boolean };
export function dailyLossPresentation(enabled: boolean, stored: number | null, stop: number | null, point: number | null, qty: number) {
  if (!(Number(stop) > 0) || !(Number(point) > 0)) return { available: false, forecast: !enabled, amount: null, origin: null };
  const value = effectiveRealDailyLossBrl(enabled ? stored : null, Number(stop), Number(point), qty);
  return { available: true, forecast: !enabled, amount: value.limit_brl, origin: value.origem };
}
export function authorizationState(enabled: boolean, reason?: string | null) {
  return !enabled ? 'desligado' : reason ? 'travado' : 'ligado';
}
export function canEnableAuthorization(input?: AuthorizationInput) {
  return !!input?.simulado_ativo && Number(input.stop_pts) > 0 && Number(input.point_value_brl) > 0;
}
export function visibleAuthorizations<T extends { symbol: string; variant: string; mode: string }>(rows: T[], inputs: AuthorizationInput[], showDisabled: boolean) {
  return rows.filter(row => showDisabled || inputs.some(i => i.symbol === row.symbol && i.variant === row.variant && i.mode === row.mode && i.simulado_ativo));
}