import type { ThreeReading } from "@/lib/b3-three-readings";
import { Button } from "@/components/ui/button";
import { Copy, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { copiarTexto } from "@/lib/b3-copiar";
import { readingText } from "@/lib/b3-three-readings";
import { MilestoneMark } from "./ConfigurationMilestones";
import { newestSessions } from "@/lib/b3-session-window";
import { circuitLabel, DisjuntorEvidence } from "./DisjuntorEvidence";
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const color = (n: number) => Number(n) > 0 ? "text-success" : Number(n) < 0 ? "text-destructive" : "text-foreground";
// Placar de três leituras. O nível do disjuntor e a evidência ficam num balão (ícone "i"),
// não em texto aberto: pedido do dono 15/11 para parar de rolar a página.
export function ThreeReadings({ row }: { row?: ThreeReading }) {
  return <div className="flex items-start gap-1"><div className="grid w-full grid-cols-3 gap-2 border-t border-border py-2 text-left text-[10px]" data-three-readings>
    {([['Sem freio', 'sem_freio'], ['Com freio', 'com_freio'], ['Com freio + disjuntor', 'com_freio_disjuntor']] as const).map(([label, key]) => <div className="min-w-0" key={key}>
      <span className="block min-h-8 text-muted-foreground">{label}</span>
      <strong className={`block break-words font-mono ${row ? color(row[key]) : "text-muted-foreground"}`}>{row ? brl(row[key]) : "sem registro"}</strong>
    </div>)}
  </div><Popover><PopoverTrigger asChild><button type="button" className="mt-2 flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground" aria-label="Como o disjuntor foi calculado"><Info className="size-4" /></button></PopoverTrigger><PopoverContent className="max-h-[70vh] w-96 overflow-y-auto text-xs"><p className="mb-2 font-semibold">{circuitLabel(row)}</p>{row?.disparos?.length ? <DisjuntorEvidence row={row} /> : <p className="text-muted-foreground">Disjuntor não disparou.</p>}</PopoverContent></Popover></div>;
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
// Quadradinhos por pregão (pedido do dono 15/11): um quadrado por dia, lado a lado, com as três
// leituras; o último quadrado é o total do período e o pico médio. Tocar num quadrado abre o balão
// com o motivo do disjuntor. Só apresentação: valores prontos de b3_cockpit_disjuntor_niveis e
// b3_pico_realizado_dia; a média do pico é a média simples dos picos exibidos.
type PeakLike = { trade_date: string; pico_realizado_brl: number | null; hora_do_pico_brt?: string | null };
const short = (n: number) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const dayLabel = (d: string) => { const [, m, dd] = String(d).slice(0, 10).split("-"); return `${dd}/${m}`; };
const KEYS = [['S', 'sem_freio', 'Sem freio'], ['F', 'com_freio', 'Com freio'], ['D', 'com_freio_disjuntor', 'Com freio + disjuntor']] as const;
function TileLines({ r }: { r: any }) {
  return <>{KEYS.map(([k, key, label]) => <span key={key} className="flex items-baseline justify-between gap-1" title={label}><span className="text-muted-foreground">{k}</span><span className={`font-mono font-semibold ${color(r[key])}`}>{short(r[key])}</span></span>)}</>;
}
export function ThreePeriodRows({ rows, total, symbol, variant, sessions, onToggleSessions, busy, title = "Resultados por pregão", peaks }: { rows: any[]; total?: ThreeReading; symbol?: string; variant?: string; sessions?: 5 | 10; onToggleSessions?: () => void; busy?: boolean; title?: string; compact?: boolean; peaks?: PeakLike[] }) {
  const daily = newestSessions(rows.filter(r => symbol ? r.symbol === symbol && (variant ? r.variant === variant && r.gid === 0 : r.gid === 1) : r.gid === 3));
  const tiles = [...daily].sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
  const peakOf = (d: string) => peaks?.find(p => String(p.trade_date).slice(0, 10) === String(d).slice(0, 10));
  const shownPeaks = tiles.map(t => peakOf(t.dia)?.pico_realizado_brl).filter((v): v is number => v != null && Number.isFinite(Number(v))).map(Number);
  const avgPeak = shownPeaks.length ? shownPeaks.reduce((a, b) => a + b, 0) / shownPeaks.length : null;
  const level = total ? circuitLabel(total) : circuitLabel({ nivel: symbol ? variant ? "modalidade" : "ativo" : "total", symbol: symbol ?? null, variant: variant ?? null });
  const copy = () => copiarTexto(`${title}\n` + tiles.map(r => `${r.dia} · sem freio ${brl(r.sem_freio)} · com freio ${brl(r.com_freio)} · com freio + disjuntor ${brl(r.com_freio_disjuntor)} · ${(r.disparos?.[0]?.disparou ?? "sem registro")}${peakOf(r.dia)?.pico_realizado_brl != null ? ` · pico ${brl(Number(peakOf(r.dia)!.pico_realizado_brl))}` : ""}`).join("\n") + `\nTotal · ${tiles.length} pregões · sem freio ${total ? brl(total.sem_freio) : "sem registro"} · com freio ${total ? brl(total.com_freio) : "sem registro"} · com freio + disjuntor ${total ? brl(total.com_freio_disjuntor) : "sem registro"}${avgPeak != null ? ` · pico médio ${brl(avgPeak)}` : ""}\n${level}`);
  return <section className="border-y border-border px-3 py-2 text-foreground" data-three-period>
    <div className="mb-1 flex items-center gap-2"><h2 className="text-xs font-bold">{title}</h2><span className="text-[10px] text-muted-foreground">S sem freio · F com freio · D com freio + disjuntor · por 1 contrato</span>
      <div className="ml-auto flex gap-1">{onToggleSessions && <Button variant="outline" size="sm" className="h-8 text-[11px]" disabled={busy} onClick={onToggleSessions}>{sessions === 10 ? "5 pregões" : "10 pregões"}</Button>}<Button variant="outline" size="sm" className="h-8 text-[11px]" aria-label={`Copiar ${title}`} onClick={copy}><Copy className="size-3" /></Button></div></div>
    <div className="flex gap-1.5 overflow-x-auto pb-1" data-period-tiles>
      {tiles.map(r => { const d = r.disparos?.[0]; const fired = d?.disparou && d.disparou !== "não disparou"; const pk = peakOf(r.dia); return <Popover key={r.dia}><PopoverTrigger asChild>
        <button type="button" className={`w-[7.5rem] shrink-0 rounded-md border bg-background/40 p-1.5 text-left text-[11px] leading-tight hover:bg-background/70 ${fired ? "border-amber-500/70" : "border-border"}`} aria-label={`Detalhes de ${r.dia}`} data-period-tile>
          <span className="mb-0.5 flex items-center justify-between font-bold"><span>{dayLabel(r.dia)}</span>{fired && <span className="rounded bg-amber-500/25 px-1 text-[9px] text-amber-200" title={d.disparou}>disj.</span>}</span>
          <TileLines r={r} />
          {pk?.pico_realizado_brl != null && <span className="mt-0.5 flex justify-between border-t border-border/60 pt-0.5 text-muted-foreground"><span>pico</span><span className="font-mono">{short(Number(pk.pico_realizado_brl))}</span></span>}
        </button></PopoverTrigger>
        <PopoverContent className="max-h-[70vh] w-96 overflow-y-auto text-xs"><p className="mb-1 font-bold">{r.dia}<MilestoneMark date={r.dia} symbol={symbol} variant={variant} /></p><DayCircuit r={r} />{pk?.pico_realizado_brl != null && <p className="mt-2">Pico do dia: {brl(Number(pk.pico_realizado_brl))}{pk.hora_do_pico_brt ? ` às ${String(pk.hora_do_pico_brt).slice(0, 5)}` : ""}</p>}</PopoverContent></Popover>; })}
      {total && <Popover><PopoverTrigger asChild><button type="button" className="w-[7.5rem] shrink-0 rounded-md border-2 border-current/50 bg-background/60 p-1.5 text-left text-[11px] leading-tight" aria-label="Total do período" data-period-total>
        <span className="mb-0.5 block font-bold">Total · {tiles.length}</span>
        <TileLines r={total} />
        {avgPeak != null && <span className="mt-0.5 flex justify-between border-t border-border/60 pt-0.5 text-muted-foreground"><span>pico méd.</span><span className="font-mono">{short(avgPeak)}</span></span>}
      </button></PopoverTrigger><PopoverContent className="w-80 text-xs"><p className="font-semibold">{level}</p><p className="mt-1 text-muted-foreground">Um disjuntor por ativo: o total soma os ativos e cada modalidade mostra a sua parte no disjuntor do ativo. O período soma os pregões{avgPeak != null ? `; pico médio = média dos picos diários exibidos (${shownPeaks.length})` : ""}.</p></PopoverContent></Popover>}
    </div>
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
    {d ? <DisjuntorEvidence row={{ ...r, nivel: r.disjuntor_nivel }} showValues={false} /> : <p className="text-muted-foreground">Disjuntor não disparou.</p>}
  </div>;
}
