import type { ThreeReading } from "@/lib/b3-three-readings";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { Fragment, useState } from "react";
import { copiarTexto } from "@/lib/b3-copiar";
import { readingText } from "@/lib/b3-three-readings";
import { MilestoneMark } from "./ConfigurationMilestones";
import { newestSessions } from "@/lib/b3-session-window";
import { circuitLabel, DisjuntorEvidence } from "./DisjuntorEvidence";
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const color = (n: number) => Number(n) > 0 ? "text-success" : Number(n) < 0 ? "text-destructive" : "text-foreground";
export function ThreeReadings({ row }: { row?: ThreeReading }) {
  return <div><div className="grid w-full grid-cols-3 gap-2 border-t border-border py-2 text-left text-[10px]" data-three-readings>
    {([['Sem freio', 'sem_freio'], ['Com freio', 'com_freio'], ['Com freio + disjuntor', 'com_freio_disjuntor']] as const).map(([label, key]) => <div className="min-w-0" key={key}>
      <span className="block min-h-8 text-muted-foreground">{label}</span>
      <strong className={`block break-words font-mono ${row ? color(row[key]) : "text-muted-foreground"}`}>{row ? brl(row[key]) : "sem registro"}</strong>
    </div>)}
  </div><p className="text-xs text-muted-foreground">{circuitLabel(row)}</p>{row?.disparos?.length ? <details className="text-xs"><summary className="flex min-h-11 cursor-pointer items-center">Disjuntor por pregão</summary><DisjuntorEvidence row={row} /></details> : null}</div>;
}
export function ReadingDetails({ row }: { row?: ThreeReading }) {
  if (!row) return <p className="text-xs text-muted-foreground">sem registro</p>;
  return <div className="space-y-1 text-xs text-foreground" data-reading-details>
    <p>Ordens: {row.ordens} · barradas: {row.barradas}</p>
    <p>{row.barradas === 0 ? "não acionado" : row.frase}</p>
    <p>{row.ganhos} ganhos / {row.perdas} perdas · acerto: {row.acerto_pct == null ? "sem registro" : `${row.acerto_pct}%`}</p>
    <p>Pico de lucro no dia: {row.pico_lucro == null ? "sem registro" : `${brl(row.pico_lucro)} · ${row.pico_hora?.slice(0, 5) ?? "sem registro"} · ${row.pico_data ?? "sem registro"}`}</p>
    <p>Saiu no alvo: {row.saiu_no_alvo ?? "sem registro"} / no stop: {row.saiu_no_stop ?? "sem registro"} / no meio: {row.saiu_no_meio ?? "sem registro"}</p>
  </div>;
}
// Tabela de pregões com as três leituras. A evidência do disjuntor de cada dia fica RECOLHIDA
// por padrão e abre ao tocar no dia (pedido do dono 12/11: a lista aberta obrigava a rolar a página).
// Só apresentação: os valores vêm prontos de b3_cockpit_disjuntor_niveis.
export function ThreePeriodRows({ rows, total, symbol, variant, sessions, onToggleSessions, busy, title = "Resultados por pregão", compact = false }: { rows: any[]; total?: ThreeReading; symbol?: string; variant?: string; sessions?: 5 | 10; onToggleSessions?: () => void; busy?: boolean; title?: string; compact?: boolean }) {
  const daily = newestSessions(rows.filter(r => symbol ? r.symbol === symbol && (variant ? r.variant === variant && r.gid === 0 : r.gid === 1) : r.gid === 3));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (dia: string) => setOpen(prev => { const next = new Set(prev); next.has(dia) ? next.delete(dia) : next.add(dia); return next; });
  const totalLabel = `Total · ${daily.length} pregões`;
  const level = total ? circuitLabel(total) : circuitLabel({ nivel: symbol ? variant ? "modalidade" : "ativo" : "total", symbol: symbol ?? null, variant: variant ?? null });
  const keys = ['sem_freio', 'com_freio', 'com_freio_disjuntor'] as const;
  return <section className={`border-y border-border text-foreground ${compact ? "px-3 py-2" : "p-3"}`} data-three-period>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">{title}</h2>{onToggleSessions && <Button variant="outline" className="min-h-11" disabled={busy} onClick={onToggleSessions}>{sessions === 10 ? "mostrar 5 pregões" : "mostrar 10 pregões"}</Button>}<Button variant="outline" className="min-h-11" onClick={() => copiarTexto(`${title}\n` + daily.map(r => `${r.dia} · sem freio ${brl(r.sem_freio)} · com freio ${brl(r.com_freio)} · com freio + disjuntor ${brl(r.com_freio_disjuntor)} · ${(r.disparos?.[0]?.disparou ?? "sem registro")}`).join("\n") + `\n${totalLabel} · sem freio ${total ? brl(total.sem_freio) : "sem registro"} · com freio ${total ? brl(total.com_freio) : "sem registro"} · com freio + disjuntor ${total ? brl(total.com_freio_disjuntor) : "sem registro"}\n${level}`)}><Copy />Copiar pregões</Button></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-xs"><thead><tr className="border-b border-border"><th className="text-left">Pregão</th><th>Sem freio</th><th>Com freio</th><th>Com freio + disjuntor</th></tr></thead><tbody>
      {daily.map(r => { const d = r.disparos?.[0]; const fired = d?.disparou && d.disparou !== "não disparou"; const isOpen = open.has(r.dia); return <Fragment key={r.dia}>
        <tr className="border-b border-border"><td className="py-1"><button type="button" className="flex min-h-11 items-center gap-1 text-left" aria-expanded={isOpen} aria-label={`${isOpen ? "Recolher" : "Expandir"} detalhes do disjuntor em ${r.dia}`} onClick={() => toggle(r.dia)}>{isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}<span>{r.dia}</span>{fired && <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-200">disparou</span>}</button><MilestoneMark date={r.dia} symbol={symbol} variant={variant} /></td>{keys.map(key => <td key={key} className={`py-2 text-right font-mono ${color(r[key])}`}>{brl(r[key])}</td>)}</tr>
        {isOpen && <tr className="border-b border-border" data-disjuntor-dia><td colSpan={4} className="py-2"><DayCircuit r={r} /></td></tr>}
      </Fragment>; })}
      {total && <tr className="font-bold" data-period-total><td>{totalLabel}</td>{keys.map(key => <td key={key} className={`py-2 text-right font-mono ${color(total[key])}`}>{brl(total[key])}</td>)}</tr>}
    </tbody></table></div>
    <p className="py-2 text-xs text-muted-foreground">{level}. Toque no dia para ver por que o disjuntor disparou ou não. Existe um disjuntor por ativo: o total é a soma dos ativos, e cada modalidade mostra a sua parte no disjuntor do ativo (as ordens com freio fechadas até o disparo), por isso as modalidades somam o ativo. O período soma os pregões.</p>
  </section>;
}

// Detalhe de um dia: as três leituras lado a lado e o motivo do disjuntor.
function DayCircuit({ r }: { r: any }) {
  const d = r.disparos?.[0];
  return <div className="space-y-2 text-xs">
    <div className="grid grid-cols-3 gap-2 font-mono">
      <span>Sem freio<br /><strong className={color(r.sem_freio)}>{brl(r.sem_freio)}</strong></span>
      <span>Com freio<br /><strong className={color(r.com_freio)}>{brl(r.com_freio)}</strong></span>
      <span>Com freio + disjuntor<br /><strong className={color(r.com_freio_disjuntor)}>{brl(r.com_freio_disjuntor)}</strong></span>
    </div>
    {d && <DisjuntorEvidence row={{ ...r, nivel: r.disjuntor_nivel }} showValues={false} />}
  </div>;
}