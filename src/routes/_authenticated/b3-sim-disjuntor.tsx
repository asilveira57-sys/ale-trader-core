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
import { LOSS_OPTIONS, shiftSession, disjuntorTotals, type DisjuntorRow } from "@/lib/b3-disjuntor-view";
import { circuitLevel } from "@/components/b3/DisjuntorEvidence";
import { BRL } from "@/lib/b3-format";
import { copiarTexto, tabular } from "@/lib/b3-copiar";

export const Route = createFileRoute("/_authenticated/b3-sim-disjuntor")({
  head: () => ({ meta: [
    { title: "Disjuntor simulado WIN por pregão — AleTrader" },
    { name: "description", content: "Cenários WIN por modalidade e pregão, com base na capacidade dos robôs habilitados." },
    { property: "og:title", content: "Disjuntor simulado WIN — AleTrader" },
    { property: "og:description", content: "Compare cenários por pregão e limiar sem alterar operações reais." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: Page,
});
const variantsLabel: Record<string, string> = { indicador: "Indicador", price_action: "Price action", price_action_sc: "Price action SC", mean_reversion: "Reversão à média", range: "Faixa", rompimento: "Rompimento", pullback: "Repique", vwap: "VWAP" };
const value = (n: number | null | undefined) => n == null ? "sem registro" : BRL(Number(n));
const headers = ["Pregão", "Nível calculado", "Perda", "Base", "Teto de perda", "Disparou", "Hora", "Com disjuntor", "Sem disjuntor", "Efeito", "Ordens evitadas / no dia", "Frase"];
const cells = (r: DisjuntorRow) => [r.dia, circuitLevel({ nivel: r.nivel ?? "total", symbol: r.symbol ?? null, variant: r.variant ?? null }), `${Math.round(Number(r.perda_pct) * 100)}%`, value(r.capital_base_brl), value(Math.abs(Number(r.limite_perda_brl))), r.disparou, r.hora_disparo_brt?.slice(0, 5) ?? "sem registro", value(r.resultado_com_disjuntor_brl), value(r.resultado_sem_disjuntor_brl), value(r.diferenca_brl), `${r.ordens_evitadas ?? "sem registro"} / ${r.ordens_no_dia ?? "sem registro"}`, r.disparou === "não disparou" ? "não armou — resultado idêntico ao com freio" : r.frase];
const LIMITATION = "A curva é do resultado realizado, pela hora de saída. O disjuntor real lê o saldo com o flutuante da posição aberta; por isso a simulação dispara um pouco mais tarde que o real. É o cenário conservador.";
function Page() {
  const milestones = useMilestones();
  const optionsFn = useServerFn(getDisjuntorOptions), read = useServerFn(readDisjuntorScenarios);
  const options = useQuery({ queryKey: ["win-disjuntor-opcoes"], queryFn: () => optionsFn(), staleTime: Infinity });
  const [range, setRange] = useState(false), [day, setDay] = useState(""), [end, setEnd] = useState("");
  const [losses, setLosses] = useState<number[]>([25]), [variants, setVariants] = useState<string[]>([]), [base, setBase] = useState("");
  const [selection, setSelection] = useState<{ start: string; end: string; losses: number[]; capital: number | null; variants: string[] | null } | null>(null);
  useEffect(() => {
    if (!options.data || day) return;
    const d = options.data.lastDay;
    setVariants(options.data.variants);
    if (d) { setDay(d); setEnd(d); setSelection({ start: d, end: d, losses: [25], capital: null, variants: null }); }
  }, [options.data, day]);
  const query = useQuery({ queryKey: ["win-disjuntor-cenarios", selection], enabled: !!selection, queryFn: () => { if (!selection) throw new Error("Escolha o pregão."); return read({ data: selection }); }, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const capital = base.trim() ? Number(base.replace(",", ".")) : null;
  const valid = !!day && (!range || !!end && end >= day) && losses.length > 0 && variants.length > 0 && (capital == null || Number.isFinite(capital) && capital > 0);
  const apply = (nextDay = day) => { if (!valid) return; setSelection({ start: nextDay, end: range ? end : nextDay, losses: [...losses].sort((a,b) => a-b), capital, variants: variants.length === options.data?.variants.length ? null : variants }); };
  const move = (delta: number) => { const d = shiftSession(day, delta); setDay(d); setEnd(d); if (!range) apply(d); };
  const rows = query.data?.rows ?? [], totals = disjuntorTotals(rows);
  const dates = [...new Set(rows.map(r => r.dia))];
  const copy = () => copiarTexto(`Disjuntor simulado — ${selection?.start ?? "sem registro"} a ${selection?.end ?? "sem registro"}\n${LIMITATION}\nPiso: ${value(query.data?.floor.piso_brl)}\nModalidades e ativos não somam o total. Só dias são somados.\n\n` + tabular(headers, rows.map(cells)) + "\n\nTOTAL do período · disjuntor calculado no nível: total\n" + tabular(["Perda", "Com disjuntor", "Sem disjuntor", "Efeito"], totals.map(t => [`${t.pct*100}%`, value(t.com),value(t.sem),value(t.diferenca)])) + "\n\n" + rows.map(r => Object.entries(r).map(([k,v]) => `${k}: ${v ?? "sem registro"}`).join("\n")).join("\n\n"));
  return <MilestoneContext.Provider value={milestones.data ?? []}><main className="p-4 md:p-6 space-y-5">
    <header className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold">Simulação do disjuntor · WIN</h1><span className="text-sm text-muted-foreground">Todos os robôs</span></header>
    <section className="space-y-4 border-y border-border py-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1"><Button className="min-h-11" variant={!range ? "default" : "outline"} onClick={() => setRange(false)}>Um dia</Button><Button className="min-h-11" variant={range ? "default" : "outline"} onClick={() => setRange(true)}>Intervalo</Button></div>
        <Button variant="outline" className="min-h-11 min-w-11" aria-label="Pregão anterior" disabled={!day || range} onClick={() => move(-1)}><ChevronLeft /></Button>
        <label className="space-y-1 text-sm"><span>{range ? "Data inicial" : "Pregão"}</span><Input aria-label={range ? "Data inicial" : "Pregão"} className="h-11 w-44" type="date" value={day} onChange={e => setDay(e.target.value)} /></label>
        <Button variant="outline" className="min-h-11 min-w-11" aria-label="Pregão seguinte" disabled={!day || range} onClick={() => move(1)}><ChevronRight /></Button>
        {range && <label className="space-y-1 text-sm"><span>Data final</span><Input aria-label="Data final" className="h-11 w-44" type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>}
        <label className="space-y-1 text-sm"><span>Capital base por cenário (opcional)</span><Input aria-label="Capital base (opcional)" className="h-11 w-48" inputMode="decimal" value={base} onChange={e => setBase(e.target.value)} /><span className="block text-xs text-muted-foreground">vazio = capacidade dos robôs habilitados</span></label>
      </div>
      <fieldset><legend className="text-sm font-medium">Modalidades</legend><div className="flex flex-wrap gap-x-4"><label className="flex min-h-11 items-center gap-2 text-sm"><Checkbox checked={!!options.data && variants.length === options.data.variants.length} onCheckedChange={v => setVariants(v ? options.data?.variants ?? [] : [])} />Todas</label>{options.data?.variants.map(v => <label key={v} className="flex min-h-11 items-center gap-2 text-sm"><Checkbox checked={variants.includes(v)} onCheckedChange={checked => setVariants(old => checked ? [...old, v] : old.filter(x => x !== v))} />{variantsLabel[v] ?? v}</label>)}</div></fieldset>
      <fieldset><legend className="text-sm font-medium">Limiares de perda</legend><div className="flex flex-wrap gap-4">{LOSS_OPTIONS.map(p => <label key={p} className="flex min-h-11 items-center gap-2 text-sm"><Checkbox checked={losses.includes(p)} onCheckedChange={v => setLosses(old => v ? [...old,p] : old.filter(x => x !== p))} />{p}%{p === 25 ? " · valor real" : ""}</label>)}</div></fieldset>
      <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={!valid || query.isFetching} onClick={() => apply()}>Consultar</Button><Button variant="outline" className="min-h-11" disabled={!selection || query.isFetching} onClick={() => query.refetch()}><RefreshCw className="size-4" />Atualizar</Button><Button variant="outline" className="min-h-11" disabled={!query.data} onClick={copy}><Copy className="size-4" />Copiar tabela inteira</Button></div>
    </section>
    <p className="text-sm text-muted-foreground">{LIMITATION}</p>
    {selection && <MilestoneWarning start={selection.start} end={selection.end} />}
    {(options.isError || query.isError) && <p role="alert" className="text-destructive">{query.error?.message ?? options.error?.message}</p>}
    {(options.isPending || query.isFetching) && <p role="status">Consultando pregões…</p>}
    {query.data && <><h2 className="font-semibold">WIN · {selection?.start} {range ? `a ${selection?.end}` : ""}</h2><p className="text-sm text-muted-foreground">Piso da devolução de pico de lucro: {value(query.data.floor.piso_brl)} · {query.data.floor.pct * 100}% do stop global ({value(query.data.floor.stop_global_brl)})</p>
    {!rows.some(r => r.ordens_no_dia > 0) && <p>sem ordens neste período</p>}
    {dates.map(d => <section key={d} className="space-y-2"><h3 className="font-semibold">Pregão {d}<MilestoneMark date={d} symbol="WIN" /></h3>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left">{headers.map(h => <th key={h} className="p-3 whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{rows.filter(r => r.dia === d).map(r => <tr key={`${r.dia}|${r.nivel}|${r.variant}|${r.perda_pct}`} className={`border-b border-border ${r.nivel === "total" ? "font-bold" : ""}`}>{cells(r).map((v,i) => <td key={i} className={`p-3 ${i === 11 ? "min-w-72" : "whitespace-nowrap"} ${i === 7 || i === 8 ? Number(i === 7 ? r.resultado_com_disjuntor_brl : r.resultado_sem_disjuntor_brl) < 0 ? "text-destructive" : "text-success" : ""}`}>{i === 1 ? `disjuntor calculado no nível: ${v}` : !r.ordens_no_dia && i === 11 ? "sem ordens neste pregão" : v}</td>)}</tr>)}</tbody></table></div></section>)}
    <p className="text-sm text-muted-foreground">Modalidades e ativos não somam o todo: cada curva dispara em seu próprio instante. O período soma apenas pregões.</p>
    {selection?.start !== selection?.end && <section className="space-y-2"><h3 className="font-semibold">TOTAL do período · disjuntor calculado no nível: total</h3><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Perda","Com disjuntor","Sem disjuntor","Efeito","Ordens evitadas / no dia"].map(h => <th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{totals.map(t => <tr key={t.pct} className="font-semibold border-t border-border"><td className="p-3">{t.pct*100}%</td><td className="p-3">{value(t.com)}</td><td className="p-3">{value(t.sem)}</td><td className="p-3">{value(t.diferenca)}</td><td className="p-3">{t.evitadas} / {t.ordens}</td></tr>)}</tbody></table></div></section>}</>}
  </main></MilestoneContext.Provider>;
}
