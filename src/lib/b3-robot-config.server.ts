// Configuração por robô (ativo × modalidade × modo).
// SOMENTE leitura/escrita de configuração — nada aqui participa das regras
// do motor de entrada, saída, trailing ou avaliação.

import {
  B3_ROBOT_EDITABLE_FIELDS, B3_ROBOT_FIELD_LABEL,
} from "./b3-robot-fields";

const NUMERIC_FIELDS = new Set<string>([
  "min_confidence", "min_score", "min_approve_votes", "max_volatility_pct",
  "lateral_strength_min", "lateral_vol_min", "stop_pts", "gain_pts", "max_contracts",
  "trailing_activation_pts", "trailing_giveback_pts", "daily_gain_target_brl",
  "minimum_trades_before_profit_lock", "profit_multiplier_before_lock",
  "post_target_allowed_retracement", "consecutive_loss_after_target",
  "post_target_size_reduction", "peak_giveback_pct", "peak_lock_min_profit_brl",
]);

export function sanitizeRobotPatch(raw: Record<string, any>): Record<string, any> {
  const patch: Record<string, any> = {};
  for (const key of B3_ROBOT_EDITABLE_FIELDS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (key === "enabled") { patch[key] = Boolean(v); continue; }
    if (NUMERIC_FIELDS.has(key)) {
      const n = Number(v);
      if (Number.isFinite(n)) patch[key] = n;
      continue;
    }
    if (v == null || v === "") continue;
    patch[key] = String(v);
  }
  return patch;
}

export function formatFieldValue(field: string, value: any): string {
  if (value == null || value === "") return "—";
  if (field === "enabled") return value ? "ligado" : "desligado";
  if (typeof value === "number") return String(value);
  return String(value);
}

/** `| DD/MM/AAAA: campo X de A para B` — padrão já usado no campo notes. */
export function buildNotesHistory(
  previous: string | null | undefined,
  changes: Array<{ field: string; from: any; to: any }>,
  now: Date = new Date(),
): string {
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(now);
  const entries = changes.map((c) => {
    const label = B3_ROBOT_FIELD_LABEL[c.field] ?? c.field;
    return `| ${date}: ${label} de ${formatFieldValue(c.field, c.from)} para ${formatFieldValue(c.field, c.to)}`;
  });
  const base = (previous ?? "").trim();
  const merged = [base, ...entries].filter(Boolean).join(" ");
  // notes é texto livre; corta pra não crescer indefinidamente.
  return merged.length > 6000 ? merged.slice(merged.length - 6000) : merged;
}

export function parseNotesHistory(notes: string | null | undefined) {
  const raw = String(notes ?? "");
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^(\d{2}\/\d{2}\/\d{4}):\s*(.*)$/);
      return m ? { date: m[1], text: m[2] } : { date: null as string | null, text: entry };
    })
    .reverse();
}

export function diffChanges(current: Record<string, any>, patch: Record<string, any>) {
  const changes: Array<{ field: string; from: any; to: any }> = [];
  for (const [field, to] of Object.entries(patch)) {
    const from = current?.[field];
    const same = field === "enabled"
      ? Boolean(from) === Boolean(to)
      : typeof to === "number"
        ? Number(from) === Number(to)
        : String(from ?? "") === String(to ?? "");
    if (!same) changes.push({ field, from, to });
  }
  return changes;
}

/**
 * Amplitude diária média (pontos) dos últimos N pregões, dentro da janela
 * operacional. Maior máxima menos menor mínima por dia BRT.
 */
export async function averageDailyRangePts(
  supabase: any, userId: string, symbol: string, sessions = 5,
): Promise<{ avg_range_pts: number | null; days: Array<{ date: string; range_pts: number }> }> {
  const since = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabase.from("b3_m1_candles_hist")
    .select("minute_ts, candle_high, candle_low")
    .eq("user_id", userId).eq("symbol", symbol)
    .gte("minute_ts", since)
    .order("minute_ts", { ascending: false })
    .limit(12000);

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const byDay: Record<string, { hi: number; lo: number }> = {};
  for (const row of data ?? []) {
    const parts = fmt.formatToParts(new Date(row.minute_ts));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const minutes = Number(get("hour")) % 24 * 60 + Number(get("minute"));
    if (minutes < 9 * 60 + 5 || minutes > 17 * 60) continue;
    const hi = Number(row.candle_high), lo = Number(row.candle_low);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;
    const cur = byDay[date];
    if (!cur) byDay[date] = { hi, lo };
    else { cur.hi = Math.max(cur.hi, hi); cur.lo = Math.min(cur.lo, lo); }
  }
  const days = Object.entries(byDay)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, sessions)
    .map(([date, v]) => ({ date, range_pts: Math.max(0, v.hi - v.lo) }))
    .reverse();
  const avg = days.length
    ? days.reduce((s, d) => s + d.range_pts, 0) / days.length
    : null;
  return { avg_range_pts: avg, days };
}
