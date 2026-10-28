import { z } from "zod";

export const LOSS_OPTIONS = [15, 25, 40, 50, 75, 100] as const;
export const disjuntorInput = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  losses: z.array(z.number().refine((n) => LOSS_OPTIONS.some((p) => p === n))).min(1).max(6).default([25]),
  capital: z.number().positive().nullable().default(null),
  variants: z.array(z.string().min(1).max(40)).nullable().default(null),
});
export interface DisjuntorRow {
  variant?: string; conta_base?: string;
  dia: string; capital_base_brl: number; base_origem: string; perda_pct: number;
  limite_perda_brl: number; meta_ganho_brl: number; disparou: string;
  hora_disparo_brt: string | null; resultado_com_disjuntor_brl: number;
  resultado_sem_disjuntor_brl: number; diferenca_brl: number;
  ordens_antes: number; ordens_evitadas: number; ordens_no_dia: number;
  pior_momento_brl: number | null; melhor_momento_brl: number | null; frase: string;
}
export interface CapacityRobot { symbol: string; variant: string; mode: string; max_contracts: number; margin_per_contract_brl: number | null }
export function capacityBase(robots: CapacityRobot[], override: number | null = null) {
  if (override != null) return override;
  return robots.reduce((sum, r) => {
    if (r.margin_per_contract_brl == null || !(Number(r.margin_per_contract_brl) > 0)) throw new Error(`Margem sem registro: ${r.symbol}`);
    return sum + Number(r.max_contracts) * Number(r.margin_per_contract_brl);
  }, 0);
}
export function capacityFormula(robots: CapacityRobot[], override: number | null) {
  const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (override != null) return `informado: ${money(override)}`;
  const groups = new Map<string, { count: number; qty: number; margin: number }>();
  for (const r of robots) {
    const k = `${r.max_contracts}|${r.margin_per_contract_brl}`;
    const g = groups.get(k) ?? { count: 0, qty: Number(r.max_contracts), margin: Number(r.margin_per_contract_brl) };
    g.count++; groups.set(k, g);
  }
  return [...groups.values()].map(g => `${g.count} robôs × ${g.qty} ${g.qty === 1 ? "contrato" : "contratos"} × ${money(g.margin)}`).join(" + ") + ` = ${money(capacityBase(robots))}`;
}
export function sessionDates(start: string, end: string) {
  const first = new Date(`${start}T12:00:00Z`), last = new Date(`${end}T12:00:00Z`);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime()) || first > last || (last.getTime() - first.getTime()) / 86400000 > 366) throw new Error("Escolha um intervalo válido de até um ano.");
  const dates: string[] = [];
  for (const d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}
export function shiftSession(day: string, delta: number) {
  const d = new Date(`${day}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() + delta); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
export function disjuntorTotals(rows: DisjuntorRow[]) {
  const totals = new Map<number, { pct: number; com: number; sem: number; diferenca: number; antes: number; evitadas: number; ordens: number; pregoes: number }>();
  for (const r of rows) {
    if (!r.ordens_no_dia) continue;
    const t = totals.get(Number(r.perda_pct)) ?? { pct: Number(r.perda_pct), com: 0, sem: 0, diferenca: 0, antes: 0, evitadas: 0, ordens: 0, pregoes: 0 };
    t.com += Number(r.resultado_com_disjuntor_brl); t.sem += Number(r.resultado_sem_disjuntor_brl); t.diferenca += Number(r.diferenca_brl);
    t.antes += Number(r.ordens_antes); t.evitadas += Number(r.ordens_evitadas); t.ordens += Number(r.ordens_no_dia); t.pregoes++;
    totals.set(t.pct, t);
  }
  return [...totals.values()].sort((a, b) => a.pct - b.pct);
}
export function derivedPeakFloor(pct: number | null | undefined, globalStop: number) {
  const fraction = pct != null && Number.isFinite(pct) && pct >= 0 ? pct : 0.5;
  return { pct: fraction, peak_min_brl: Math.round(fraction * globalStop * 100) / 100 };
}
export function disjuntorBadgeText(row: DisjuntorRow | undefined) {
  if (!row) return "Disjuntor: sem registro";
  if (!row.ordens_no_dia) return "Disjuntor: sem ordens no dia";
  if (row.disparou === "não disparou") return "disjuntor não teria armado";
  const money = Number(row.resultado_com_disjuntor_brl).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `teria armado o disjuntor às ${row.hora_disparo_brt?.slice(0, 5) ?? "sem registro"} · ${row.disparou} · resultado travado ${money}`;
}