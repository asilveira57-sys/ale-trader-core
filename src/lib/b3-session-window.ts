/** Dates only: no financial arithmetic or reconstruction of SQL totals. */
export function sessionWindow(dates: string[]) {
  const end = dates[0];
  const start = dates.at(-1);
  return start && end ? { start, end } : null;
}
export function newestSessions<T extends { dia: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.dia.localeCompare(a.dia));
}