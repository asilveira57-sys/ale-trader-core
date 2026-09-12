// Navegação por DATA das telas de cockpit (real e simulado).
//
// Regra de tela, não de motor: nada aqui decide entrada, freio, espelhamento ou
// execução. Só resolve "que pedaço do tempo estou olhando".
//
// Duas invariantes que valem dinheiro:
//  1) o padrão é SEMPRE "hoje" — a escolha não é guardada. Olhar dado velho
//     achando que é o de agora é o pior defeito possível numa tela de real.
//  2) período que NÃO inclui hoje é um MODO histórico: quem consome esconde os
//     blocos vivos (executor, corretora, cotação, alertas) e as ações.

export type PeriodPreset = "hoje" | "ontem" | "3d" | "7d" | "15d" | "30d" | "entre";

export const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "ontem", label: "Ontem" },
  { key: "3d", label: "3 dias" },
  { key: "7d", label: "7 dias" },
  { key: "15d", label: "15 dias" },
  { key: "30d", label: "30 dias" },
  { key: "entre", label: "Entre datas" },
];

const PRESET_DAYS: Record<string, number> = { "3d": 3, "7d": 7, "15d": 15, "30d": 30 };

export interface PeriodInput {
  preset?: string | null;
  /** AAAA-MM-DD (BRT), inclusive — usado só quando preset = "entre" */
  start?: string | null;
  /** AAAA-MM-DD (BRT), inclusive */
  end?: string | null;
}

export interface ResolvedPeriod {
  preset: PeriodPreset;
  /** primeiro pregão do recorte, AAAA-MM-DD em BRT (inclusive) */
  start: string;
  /** último pregão do recorte, AAAA-MM-DD em BRT (inclusive) */
  end: string;
  /** dias de calendário cobertos (>= 1) */
  days: number;
  /** o recorte inclui o dia corrente? (define o MODO da tela) */
  includes_today: boolean;
  single_day: boolean;
  /** limites em UTC: BRT = UTC−3, sem horário de verão */
  start_utc: string;
  end_utc: string;
  label: string;
}

/** Data do pregão (AAAA-MM-DD) no fuso de São Paulo. */
export function brtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Soma dias em AAAA-MM-DD sem passar por fuso (usa UTC ao meio-dia). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12);
  };
  return Math.round((p(end) - p(start)) / 86_400_000) + 1;
}

export const formatBrDate = (date: string) => {
  if (!isDate(date)) return "—";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
};

export function resolvePeriod(input: PeriodInput | null | undefined, now: Date = new Date()): ResolvedPeriod {
  const today = brtDate(now);
  const raw = String(input?.preset ?? "hoje");
  const preset: PeriodPreset = (PERIOD_PRESETS.some((p) => p.key === raw) ? raw : "hoje") as PeriodPreset;

  let start = today;
  let end = today;

  if (preset === "ontem") {
    start = end = addDays(today, -1);
  } else if (PRESET_DAYS[preset]) {
    end = today;
    start = addDays(today, -(PRESET_DAYS[preset]! - 1));
  } else if (preset === "entre") {
    const a = isDate(input?.start) ? input!.start! : today;
    const b = isDate(input?.end) ? input!.end! : today;
    start = a <= b ? a : b;
    end = a <= b ? b : a;
    // Nunca deixa a tela pedir o futuro: não existe pregão adiante.
    if (end > today) end = today;
    if (start > end) start = end;
  }

  const days = Math.max(1, daysBetween(start, end));
  const includesToday = start <= today && today <= end;

  return {
    preset, start, end, days,
    includes_today: includesToday,
    single_day: start === end,
    start_utc: `${start}T03:00:00.000Z`,
    end_utc: `${addDays(end, 1)}T03:00:00.000Z`,
    label: start === end
      ? formatBrDate(start)
      : `${formatBrDate(start)} a ${formatBrDate(end)}`,
  };
}

/** Teto de linhas proporcional ao período — período longo não pode truncar em silêncio. */
export function periodRowLimit(days: number, perDay = 1500, base = 2000, max = 40_000): number {
  return Math.min(max, base + Math.max(0, days - 1) * perDay);
}
