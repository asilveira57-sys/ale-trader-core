export function batchWarnings(margin: number, limits: number, capital: number, days: number | null) {
  return { margin: margin > capital, stale: days == null || days > 3, loss: limits > capital };
}
export function daysSinceLedger(date: string | null, today: string) {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000));
}