// Janela operacional rígida da B3 (America/Sao_Paulo).
// Usada ANTES de qualquer acesso ao banco, para que fora do pregão o sistema
// não processe modos, não crie snapshots, não registre bloqueios e não gere logs.
// Não altera nenhuma regra estratégica — apenas define quando o módulo B3 opera.
//
// WIN/WDO abrem às 09:00 (leilão 08:55–09:00) e negociam até 18:25/18:30.
// A janela começava 09:05, atrasando o aquecimento dos indicadores M1 antes
// das entradas das 09:15. Encerrava às 17:00, deixando apenas 5 minutos após
// a zeragem obrigatória das 16:55 — se o tick falhar, a posição fica aberta.
// Com 17:30 a margem de segurança passa a 35 minutos.

export const B3_WINDOW_TZ = "America/Sao_Paulo";
export const B3_WINDOW_START_MIN = 9 * 60;       // 09:00
export const B3_WINDOW_END_MIN = 17 * 60 + 30;     // 17:30

function minutesToHhMm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface B3WindowState {
  open: boolean;
  reason: "open" | "weekend" | "before_open" | "after_close";
  brt_time: string;      // HH:MM
  brt_date: string;      // YYYY-MM-DD
  weekday: number;       // 0=domingo … 6=sábado
  minutes: number;       // minutos desde 00:00 BRT
  window: { start: string; end: string; tz: string };
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Data (YYYY-MM-DD) no fuso da B3. */
export function b3BrtDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: B3_WINDOW_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function b3WindowState(d: Date = new Date()): B3WindowState {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: B3_WINDOW_TZ, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const minutes = hour * 60 + minute;

  const isWeekday = weekday >= 1 && weekday <= 5;
  const reason: B3WindowState["reason"] = !isWeekday
    ? "weekend"
    : minutes < B3_WINDOW_START_MIN
      ? "before_open"
      : minutes > B3_WINDOW_END_MIN
        ? "after_close"
        : "open";

  return {
    open: reason === "open",
    reason,
    brt_time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    brt_date: b3BrtDate(d),
    weekday,
    minutes,
    window: { start: "09:05", end: "17:00", tz: B3_WINDOW_TZ },
  };
}

export function isB3TradingWindow(d: Date = new Date()): boolean {
  return b3WindowState(d).open;
}
