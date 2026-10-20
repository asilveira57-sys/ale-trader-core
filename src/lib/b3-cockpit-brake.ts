// Presentation-only brake evidence. Monetary pairs come unchanged from the RPC.
export interface BrakeDay {
  date: string; com_freio_brl: number; sem_freio_brl: number;
  ordens: number; barrados: number | null;
}
export const brakeNotActivated = (barrados: number | null | undefined) => barrados === 0;
export function totalBlocked(days: { barrados: number | null }[]) {
  return days.some((d) => d.barrados == null) ? null : days.reduce((s, d) => s + (d.barrados ?? 0), 0);
}
export function cockpitBrakeEffect(assets: { symbol: string; days: BrakeDay[]; by_variant: { variant: string; days: BrakeDay[] }[] }[], dates: string[]) {
  const days = dates.map((date) => {
    const rows = assets.flatMap((a) => a.days.filter((d) => d.date === date));
    const ordens = rows.reduce((s, d) => s + d.ordens, 0);
    const com = ordens ? rows.reduce((s, d) => s + d.com_freio_brl, 0) : null;
    const sem = ordens ? rows.reduce((s, d) => s + d.sem_freio_brl, 0) : null;
    return { date, ordens, com, sem, efeito: com == null || sem == null ? null : com - sem, barrados: rows.length ? totalBlocked(rows) : null };
  });
  const topDate = days.find((d) => d.ordens > 0)?.date ?? null;
  const top = assets.flatMap((a) => a.by_variant.flatMap((v) => v.days.filter((d) => d.date === topDate)
    .map((d) => ({ ...d, symbol: a.symbol, variant: v.variant, salvou: d.com_freio_brl - d.sem_freio_brl }))))
    .filter((d) => d.salvou > 0 && (d.barrados ?? 0) > 0).sort((a, b) => b.salvou - a.salvou).slice(0, 3);
  return { days, top, top_date: topDate, saldo: days.reduce((s, d) => s + (d.efeito ?? 0), 0), dias_com_dado: days.filter((d) => d.ordens > 0).length };
}