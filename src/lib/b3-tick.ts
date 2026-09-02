// Normalização de preço ao passo mínimo (tick) do instrumento.
//
// Por que existe: `Math.round(p / tick) * tick` deixa rastro de IEEE-754
// (41.230000000000004 para tick 0,01). Esse resíduo não existe
// economicamente, mas fazia a auditoria de execução do MT5 rejeitar
// operações reais — inclusive SAÍDAS por stop — com
// "Preco de execucao incompativel com Bid/Ask MT5".
//
// Regra: arredonda ao múltiplo do tick e fixa a precisão decimal no número
// de casas do próprio tick. Nunca altera o preço economicamente.

/** Casas decimais do passo mínimo (0,01 → 2; 0,1 → 1; 5 → 0). */
export function tickDecimals(tick: number): number {
  const t = Math.abs(Number(tick));
  if (!Number.isFinite(t) || t <= 0) return 2;
  if (Number.isInteger(t)) return 0;
  const s = t.toExponential();
  const [mantissa, expPart] = s.split("e");
  const exp = Number(expPart);
  const mantissaDecimals = (mantissa.split(".")[1] ?? "").length;
  return Math.max(0, Math.min(10, mantissaDecimals - exp));
}

/** Arredonda ao tick e normaliza as casas decimais (sem resíduo binário). */
export function roundToTick(price: number, tick: number): number {
  const p = Number(price);
  const t = Number(tick);
  if (!Number.isFinite(p)) return p;
  if (!Number.isFinite(t) || t <= 0) return p;
  const steps = Math.round(p / t);
  return Number((steps * t).toFixed(tickDecimals(t)));
}
