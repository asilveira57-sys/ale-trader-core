import type { ThreeReading } from "@/lib/b3-three-readings";
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
  return <div className="space-y-1 text-xs text-foreground">
    <p>Ordens: {row.ordens} · barradas: {row.barradas}</p>
    <p>{row.barradas === 0 ? "não acionado" : row.frase}</p>
    <p>{row.ganhos} ganhos / {row.perdas} perdas · acerto: {row.acerto_pct == null ? "sem registro" : `${row.acerto_pct}%`}</p>
    <p>Pico de lucro no dia: {row.pico_lucro == null ? "sem registro" : `${brl(row.pico_lucro)} · ${row.pico_hora?.slice(0, 5) ?? "sem registro"} · ${row.pico_data ?? "sem registro"}`}</p>
    <p>Saiu no alvo: {row.saiu_no_alvo} / no stop: {row.saiu_no_stop} / no meio: {row.saiu_no_meio}</p>
    {row.disparos?.length ? row.disparos.map(d => <p key={d.dia}>Disjuntor da modalidade · {d.dia}: {d.motivo} · {d.hora?.slice(0, 5) ?? "sem registro"} · {d.ordens_antes} de {d.ordens_no_dia} ordens antes do disparo</p>) : <p>Disjuntor: sem ordens no período</p>}
  </div>;
}