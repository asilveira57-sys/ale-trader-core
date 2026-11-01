export type ThreeReading = {
  nivel: string; symbol: string | null; variant: string | null; mode: string | null;
  sem_freio: number; com_freio: number; com_freio_disjuntor: number;
  ordens: number; ganhos: number; perdas: number; acerto_pct: number | null;
  barradas: number; frase: string; saiu_no_alvo: number; saiu_no_stop: number; saiu_no_meio: number;
  pico_lucro?: number | null; pico_data?: string; pico_hora?: string;
  disparos?: { dia: string; motivo: string; hora: string | null; ordens_antes: number; ordens_no_dia: number }[];
};
export function readingFor(rows: ThreeReading[], symbol: string, variant?: string, mode?: string) {
  return rows.find(r => r.symbol === symbol && r.nivel === (mode ? "robo" : variant ? "modalidade" : "ativo") && (!variant || r.variant === variant) && (!mode || r.mode === mode));
}
export const readingText = (r?: ThreeReading) => r
  ? Object.entries(r).map(([key, value]) => `${key}: ${value == null ? "sem registro" : typeof value === "object" ? JSON.stringify(value) : value}`).join("\n")
  : "sem registro";
/** Shape only: every value is passed through from SQL, with no arithmetic. */
export function threePeriodData(data: { rows: ThreeReading[]; daily: any[]; period: any; colors: any[] } | undefined) {
  if (!data) return undefined;
  const total = data.rows.find(r => r.nivel === "total");
  const robots = data.rows.filter(r => r.nivel === "robo").map(r => ({ ...r, key: `${r.symbol}|${r.variant}|${r.mode}`, resultado_brl: r.sem_freio, ops: r.ordens, sombra_ops: r.barradas }));
  const side = (key: "com_freio" | "sem_freio") => ({ total_brl: total?.[key] ?? 0, ops: total?.ordens ?? 0, ganhos: total?.ganhos ?? 0, perdas: total?.perdas ?? 0,
    robots: robots.map(r => ({ ...r, resultado_brl: r[key] })),
    by_day: data.daily.filter(r => r.gid === 3).map(r => ({ date: r.dia, realized_brl: r[key], trades: r.ordens, wins: r.ganhos, losses: r.perdas })),
  });
  return { three: data, period: data.period, no_movement: total?.ordens === 0, rows_truncated: false,
    catalog: robots.map(r => ({ run_id: `${r.symbol}|${r.variant}`, symbol: r.symbol, variant: r.variant, mode: r.mode, cor: data.colors.find(c => c.symbol === r.symbol && c.variant === r.variant && c.mode === r.mode)?.cor })),
    sem_freio: side("sem_freio"), com_freio: side("com_freio") };
}
export function threeHeaders(rows: ThreeReading[]) {
  const shape = (r: ThreeReading) => ({ ...r, resultado_brl: r.sem_freio, ops: r.ordens, taxa_acerto: null });
  return rows.filter(r => r.nivel === "ativo").map(r => ({ ...shape(r), por_modalidade: rows.filter(v => v.nivel === "modalidade" && v.symbol === r.symbol).map(shape) }));
}