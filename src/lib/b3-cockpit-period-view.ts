// Historical presentation adapter; never reconstructs live operational state.
export const CLOSED_PERIOD = "período encerrado";
export function maximumDaily<T extends { trade_date: string }>(rows: T[], value: (row: T) => number | null): T | null {
  return rows.reduce<T | null>((best, row) => {
    const n = value(row);
    if (n == null || !Number.isFinite(n)) return best;
    return best == null || n > Number(value(best)) ? row : best;
  }, null);
}
export function periodCards(catalog: any[], robots: any[]) {
  const byKey = new Map(robots.map((r) => [r.key, r]));
  const unique = new Map(catalog.map((c) => [`${c.symbol}|${c.variant}|${c.mode}`, c]));
  // Rolled contracts/reruns share one robot identity, while result aggregation
  // already combines their orders. Do not multiply that result per run.
  return [...unique.values()].map((c) => {
    const r = byKey.get(`${c.symbol}|${c.variant}|${c.mode}`);
    return { ...c, enabled: true, open: null, realized_today: r?.resultado_brl ?? 0, total_today: r?.resultado_brl ?? 0, ops: r?.ops ?? 0, ganhos: r?.ganhos ?? 0, perdas: r?.perdas ?? 0, sombra_ops: r?.sombra_ops ?? 0 };
  });
}
export function periodHeaders(cards: any[]) {
  const roots = [...new Set(cards.map((c) => c.symbol))];
  const group = (list: any[]) => {
    const ops = list.reduce((n, c) => n + c.ops, 0), ganhos = list.reduce((n, c) => n + c.ganhos, 0);
    const sorted = list.filter((c) => c.ops > 0).sort((a, b) => a.total_today - b.total_today);
    const best = (c: any) => c ? { ...c, brl: c.total_today } : null;
    return { resultado_brl: list.reduce((n, c) => n + c.total_today, 0), ops, ganhos, taxa_acerto: ops ? ganhos / ops : null, melhor_robo: best(sorted[sorted.length - 1]), pior_robo: best(sorted[0]) };
  };
  return roots.map((symbol) => {
    const list = cards.filter((c) => c.symbol === symbol);
    return { symbol, ...group(list), por_modalidade: [...new Set(list.map((c) => c.variant))].map((variant) => ({ variant, ...group(list.filter((c) => c.variant === variant)) })) };
  });
}