import { createFileRoute } from "@tanstack/react-router";
import { MilestoneContext, MilestoneMark, MilestoneWarning, useMilestones } from "@/components/b3/ConfigurationMilestones";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { getDisjuntorOptions, readDisjuntorScenarios } from "@/lib/b3-disjuntor-read.functions";
import { LOSS_OPTIONS, GAIN_OPTIONS, ASSET_OPTIONS, shiftSession, disjuntorTotals, type DisjuntorRow } from "@/lib/b3-disjuntor-view";
import { BRL } from "@/lib/b3-format";
import { copiarTexto, tabular } from "@/lib/b3-copiar";

export const Route = createFileRoute("/_authenticated/b3-sim-disjuntor")({
  head: () => ({ meta: [
    { title: "Simulação do disjuntor — AleTrader" },
    { name: "description", content: "Disjuntor por ativo e por modalidade, com teto de perda e meta de ganho, por pregão." },
    { property: "og:title", content: "Simulação do disjuntor — AleTrader" },
    { property: "og:description", content: "Compare cenários de perda e ganho por pregão sem alterar operações." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: Page,
});
// Decisão do dono 15/11: o disjuntor é por ATIVO e por MODALIDADE (filtráveis), nunca por robô.
// Cada cenário = teto de perda × meta de ganho, em % da capacidade dos robôs. Posição aberta na
// hora do disparo é zerada ao preço daquele instante (migration 0034). Total = soma dos ativos.
const variantsLabel: Record<string, string> = { indicador: "Indicador", price_action: "Price action", price_action_sc: "Price action SC", mean_reversion: "Reversão à média", range: "Faixa", rompimento: "Rompimento", pullback: "Repique", vwap: "VWAP" };
const value = (n: number | null | undefined) => n == null ? "sem registro" : BRL(Number(n));
const pctTxt = (n: number | null | undefined) => n == null ? "—" : `${Math.round(Number(n) * 100)}%`;
const nivelTxt = (r: DisjuntorRow) => r.nivel === "total" ? "Total (soma dos ativos)" : r.nivel === "ativo" ? `${r.symbol} · ativo` : `${r.symbol} · ${variantsLabel[r.variant ?? ""] ?? r.variant}`;
const headers = ["Nível", "Perda", "Ganho", "Base", "Teto de perda", "Meta de ganho", "Disparou", "Hora", "Com disjuntor", "Sem disjuntor", "Efeito", "Evitadas / no dia"];
const cells = (r: DisjuntorRow) => [nivelTxt(r), pctTxt(r.perda_pct), pctTxt(r.ganho_pct), value(r.capital_base_brl), value(Math.abs(Number(r.limite_perda_brl))), value(r.meta_ganho_brl), r.disparou, r.hora_disparo_brt?.slice(0, 5) ?? "—", value(r.resultado_com_disjuntor_brl), value(r.resultado_sem_disjuntor_brl), value(r.diferenca_brl), `${r.ordens_evitadas ?? 0} / ${r.ordens_no_dia ?? 0}`];
const ordem = (r: DisjuntorRow) => `${r.nivel === "total" ? 0 : 1}|${r.symbol ?? ""}|${r.nivel === "ativo" ? 0 : 1}|${r.variant ?? ""}|${r.perda_pct}|${r.ganho_pct}`;
function Chips<T extends string | number>({ label, opts, sel, set, fmt }: { label: string; opts: readonly T[]; sel: T[]; set: (v: T[]) => void; fmt?: (v: T) => string }) {
  return <fieldset className="flex flex-wrap items-center gap-x-4"><legend className="sr-only">{label}</legend><span className="w-28 text-sm font-medium">{label}</span>
    {opts.map(o => <label key={String(o)} className="flex min-h-9 items-center gap-2 text-sm"><Checkbox checked={sel.includes(o)} onCheckedChange={v => set(v ? [...sel, o] : sel.filter(x => x !== o))} />{fmt ? fmt(o) : String(o)}</label>)}</fieldset>;
}
function Page() {
  const milestones = useMilestones();
  const optionsFn = useServerFn(getDisjuntorOptions), read = useServerFn(readDisjuntorScenarios);
  const options = useQuery({ queryKey: ["disjuntor-opcoes"], queryFn: () => optionsFn(), staleTime: Infinity });
  const [range, setRange] = useState(false), [day, setDay] = useState(""), [end, setEnd] = useState("");
  const [assets, setAssets] = useState<string[]>(["WIN"]);
  const [losses, setLosses] = useState<number[]>([25]), [gains, setGains] = useState<number[]>([80]), [variants, setVariants] = useState<string[]>([]), [base, setBase] = useState("");
  const [selection, setSelection] = useState<any>(null);
  const modalidades = [...new Set(assets.flatMap(a => options.data?.byAsset?.[a] ?? []))].sort();
  useEffect(() => {
    if (!options.data || day) return;
    const d = options.data.lastDay;
    setVariants(options.data.variants);
    if (d) { setDay(d); setEnd(d); setSelection({ start: d, end: d, losses: [25], gains: [80], capital: null, variants: null, symbols: ["WIN"] }); }
  }, [options.data, day]);
  const query = useQuery({ queryKey: ["disjuntor-cenarios", selection], enabled: !!selection, queryFn: () => read({ data: selection }), staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const capital = base.trim() ? Number(base.replace(",", ".")) : null;
  const chosenVariants = variants.filter(v => modalidades.includes(v));
  const valid = !!day && (!range || !!end && end >= day) && losses.length > 0 && gains.length > 0 && assets.length > 0 && chosenVariants.length > 0 && (capital == null || Number.isFinite(capital) && capital > 0);
  const apply = (nextDay = day) => { if (!valid) return; setSelection({ start: nextDay, end: range ? end : nextDay, losses: [...losses].sort((a,b) => a-b), gains: [...gains].sort((a,b) => a-b), capital, symbols: assets, variants: chosenVariants.length === modalidades.length ? null : chosenVariants }); };
  const move = (delta: number) => { const d = shiftSession(day, delta); setDay(d); setEnd(d); if (!range) apply(d); };
  const rows: DisjuntorRow[] = query.data?.rows ?? [];
  const totals = disjuntorTotals(rows);
  const dates = [...new Set(rows.map(r => r.dia))].sort();
  const copy = () => copiarTexto(`Disjuntor simulado — ${selection?.start ?? ""} a ${selection?.end ?? ""} · ${selection?.symbols?.join(", ") ?? ""}\n` + dates.map(d => `Pregão ${d}\n` + tabular(headers, rows.filter(r => r.dia === d).sort((a,b) => ordem(a).localeCompare(ordem(b))).map(cells))).join("\n\n") + "\n\nTOTAL do período (soma dos ativos)\n" + tabular(["Perda", "Ganho", "Com disjuntor", "Sem disjuntor", "Efeito"], totals.map(t => [`${Math.round(t.pct*100)}%`, pctTxt(t.ganho), value(t.com), value(t.sem), value(t.diferenca)])));
  return <MilestoneContext.Provider value={milestones.data ?? []}><main className="space-y-4 p-4 md:p-6">
    <h1 className="text-xl font-semibold">Simulação do disjuntor</h1>
    <section className="space-y-3 border-y border-border py-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1"><Button className="min-h-9" variant={!range ? "default" : "outline"} onClick={() => setRange(false)}>Um dia</Button><Button className="min-h-9" variant={range ? "default" : "outline"} onClick={() => setRange(true)}>Intervalo</Button></div>
        <Button variant="outline" className="min-h-9 min-w-9" aria-label="Pregão anterior" disabled={!day || range} onClick={() => move(-1)}><ChevronLeft /></Button>
        <Input aria-label={range ? "Data inicial" : "Pregão"} className="h-9 w-40" type="date" value={day} onChange={e => setDay(e.target.value)} />
        <Button variant="outline" className="min-h-9 min-w-9" aria-label="Pregão seguinte" disabled={!day || range} onClick={() => move(1)}><ChevronRight /></Button>
        {range && <Input aria-label="Data final" className="h-9 w-40" type="date" value={end} onChange={e => setEnd(e.target.value)} />}
        <Input aria-label="Capital base (opcional)" placeholder="Capital base (vazio = capacidade dos robôs)" className="h-9 w-72" inputMode="decimal" value={base} onChange={e => setBase(e.target.value)} />
      </div>
      <Chips label="Ativos" opts={ASSET_OPTIONS} sel={assets as any} set={setAssets as any} />
      <Chips label="Modalidades" opts={modalidades} sel={chosenVariants} set={(v) => setVariants([...variants.filter(x => !modalidades.includes(x)), ...v])} fmt={(v) => variantsLabel[v] ?? v} />
      <Chips label="Teto de perda" opts={LOSS_OPTIONS} sel={losses} set={setLosses} fmt={(p) => `${p}%${p === 25 ? " (atual)" : ""}`} />
      <Chips label="Meta de ganho" opts={GAIN_OPTIONS} sel={gains} set={setGains} fmt={(p) => `${p}%${p === 80 ? " (atual)" : ""}`} />
      <div className="flex flex-wrap gap-2"><Button className="min-h-9" disabled={!valid || query.isFetching} onClick={() => apply()}>Consultar</Button><Button variant="outline" className="min-h-9" disabled={!selection || query.isFetching} onClick={() => query.refetch()}><RefreshCw className="size-4" />Atualizar</Button><Button variant="outline" className="min-h-9" disabled={!query.data} onClick={copy}><Copy className="size-4" />Copiar</Button></div>
      <p className="text-xs text-muted-foreground">Teto e meta em % da capacidade dos robôs do recorte. Posição aberta na hora do disparo é zerada ao preço daquele instante. Total = soma dos ativos. Piso da devolução de pico: {query.data ? `${query.data.floor.pct * 100}%` : "—"} do teto de perda.</p>
    </section>
    {selection && <MilestoneWarning start={selection.start} end={selection.end} />}
    {(options.isError || query.isError) && <p role="alert" className="text-destructive">{(query.error as any)?.message ?? (options.error as any)?.message}</p>}
    {(options.isPending || query.isFetching) && <p role="status">Consultando pregões…</p>}
    {query.data && !rows.some(r => r.ordens_no_dia > 0) && <p>sem ordens neste período</p>}
    {dates.length > 1 && totals.length > 0 && <section className="space-y-1"><h2 className="font-semibold">Total do período · soma dos ativos</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left">{["Perda","Ganho","Com disjuntor","Sem disjuntor","Efeito","Evitadas / no dia"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{totals.map(t => <tr key={`${t.pct}|${t.ganho}`} className="border-t border-border font-semibold"><td className="p-2">{Math.round(t.pct*100)}%</td><td className="p-2">{pctTxt(t.ganho)}</td><td className={`p-2 ${t.com < 0 ? "text-destructive" : "text-success"}`}>{value(t.com)}</td><td className="p-2">{value(t.sem)}</td><td className="p-2">{value(t.diferenca)}</td><td className="p-2">{t.evitadas} / {t.ordens}</td></tr>)}</tbody></table></div></section>}
    {dates.map(d => <details key={d} open={dates.length === 1} className="rounded-lg border border-border"><summary className="cursor-pointer p-2 font-semibold">Pregão {d}<MilestoneMark date={d} /></summary>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left">{headers.map(h => <th key={h} className="whitespace-nowrap p-2">{h}</th>)}</tr></thead><tbody>{rows.filter(r => r.dia === d).sort((a,b) => ordem(a).localeCompare(ordem(b))).map(r => <tr key={ordem(r)} title={r.frase} className={`border-b border-border ${r.nivel === "total" ? "font-bold" : r.nivel === "ativo" ? "font-semibold" : ""}`}>{cells(r).map((v,i) => <td key={i} className={`whitespace-nowrap p-2 ${i === 8 ? Number(r.resultado_com_disjuntor_brl) < 0 ? "text-destructive" : "text-success" : ""}`}>{v}</td>)}</tr>)}</tbody></table></div>
    </details>)}
  </main></MilestoneContext.Provider>;
}
