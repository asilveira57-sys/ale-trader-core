import type { ThreeReading } from "@/lib/b3-three-readings";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { copiarTexto } from "@/lib/b3-copiar";
import { readingText } from "@/lib/b3-three-readings";
import { MilestoneMark } from "./ConfigurationMilestones";
import { newestSessions } from "@/lib/b3-session-window";
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const color = (n: number) => Number(n) > 0 ? "text-success" : Number(n) < 0 ? "text-destructive" : "text-foreground";
export function ThreeReadings({ row }: { row?: ThreeReading }) {
  return <div className="grid w-full grid-cols-3 gap-2 border-t border-border py-2 text-left text-[10px]" data-three-readings>
    {([['Sem freio', 'sem_freio'], ['Com freio', 'com_freio'], ['Com freio + disjuntor', 'com_freio_disjuntor']] as const).map(([label, key]) => <div className="min-w-0" key={key}>
      <span className="block min-h-8 text-muted-foreground">{label}</span>
      <strong className={`block break-words font-mono ${row ? color(row[key]) : "text-muted-foreground"}`}>{row ? brl(row[key]) : "sem registro"}</strong>
    </div>)}
  </div>;
}
export function ReadingDetails({ row }: { row?: ThreeReading }) {
  if (!row) return <p className="text-xs text-muted-foreground">sem registro</p>;
  return <div className="space-y-1 text-xs text-foreground" data-reading-details>
    <p>Ordens: {row.ordens} · barradas: {row.barradas}</p>
    <p>{row.barradas === 0 ? "não acionado" : row.frase}</p>
    <p>{row.ganhos} ganhos / {row.perdas} perdas · acerto: {row.acerto_pct == null ? "sem registro" : `${row.acerto_pct}%`}</p>
    <p>Pico de lucro no dia: {row.pico_lucro == null ? "sem registro" : `${brl(row.pico_lucro)} · ${row.pico_hora?.slice(0, 5) ?? "sem registro"} · ${row.pico_data ?? "sem registro"}`}</p>
    <p>Saiu no alvo: {row.saiu_no_alvo ?? "sem registro"} / no stop: {row.saiu_no_stop ?? "sem registro"} / no meio: {row.saiu_no_meio ?? "sem registro"}</p>
    {row.disparos?.length ? row.disparos.map(d => <p key={d.dia}>Disjuntor da modalidade · {d.dia}: {d.motivo} · {d.hora?.slice(0, 5) ?? "sem registro"} · {d.ordens_antes} de {d.ordens_no_dia} ordens antes do disparo</p>) : row.nivel === "robo" ? <p>Disjuntor: sem ordens no período</p> : null}
  </div>;
}
export function ThreePeriodRows({ rows, total, symbol, variant, sessions, onToggleSessions, busy }: { rows: any[]; total?: ThreeReading; symbol?: string; variant?: string; sessions?: 5 | 10; onToggleSessions?: () => void; busy?: boolean }) {
  const daily = newestSessions(rows.filter(r => symbol ? r.symbol === symbol && (variant ? r.variant === variant && r.gid === 0 : r.gid === 1) : r.gid === 3));
  const totalLabel = `Total · ${daily.length} pregões`;
  return <section className="border-y border-border p-3 text-foreground" data-three-period>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">Resultados por pregão</h2>{onToggleSessions && <Button variant="outline" className="min-h-11" disabled={busy} onClick={onToggleSessions}>{sessions === 10 ? "mostrar 5 pregões" : "mostrar 10 pregões"}</Button>}<Button variant="outline" className="min-h-11" onClick={() => copiarTexto(daily.map(r => `${r.dia}\n${readingText(r)}`).join("\n\n") + `\n${totalLabel}\n${readingText(total)}`)}><Copy />Copiar pregões</Button></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-xs"><thead><tr className="border-b border-border"><th className="text-left">Pregão</th><th>Sem freio</th><th>Com freio</th><th>Com freio + disjuntor</th></tr></thead><tbody>
      {daily.map(r => <tr key={r.dia} className="border-b border-border"><td>{r.dia}<MilestoneMark date={r.dia} symbol={symbol} variant={variant} /></td>{(['sem_freio', 'com_freio', 'com_freio_disjuntor'] as const).map(key => <td key={key} className={`py-2 text-right font-mono ${color(r[key])}`}>{brl(r[key])}</td>)}</tr>)}
      {total && <tr className="font-bold" data-period-total><td>{totalLabel}</td>{(['sem_freio', 'com_freio', 'com_freio_disjuntor'] as const).map(key => <td key={key} className={`py-2 text-right font-mono ${color(total[key])}`}>{brl(total[key])}</td>)}</tr>}
    </tbody></table></div>
  </section>;
}