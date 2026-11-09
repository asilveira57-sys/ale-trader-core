/** Presentation only: alert identity strings are not timestamps. */
export function validDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function realTime(value: string | null | undefined, seconds = false): string {
  const date = validDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    ...(seconds ? { second: '2-digit' as const } : {}),
  }).format(date);
}
export function realCalendarDate(value: string | null | undefined): string {
  const date = validDate(value ? `${value}T12:00:00` : null);
  return date ? date.toLocaleDateString('pt-BR') : '—';
}
export function realDuration(start: string | null | undefined, end: string | null | undefined, now = new Date()): string {
  const a = validDate(start), b = end == null ? validDate(now) : validDate(end);
  if (!a || !b) return '—';
  const sec = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}min${String(sec % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}