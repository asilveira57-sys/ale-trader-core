import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3FichaDia } from "@/lib/b3-ficha-dia.functions";
import { BRL } from "@/lib/b3-format";
import { copiarTexto, tabular } from "@/lib/b3-copiar";
import { vLabel } from "@/lib/b3-listas-format";
import { robotLabel } from "@/lib/b3-cockpit-labels";
import { useModeApelidos } from "@/hooks/use-mode-apelidos";
import { geoLinhas } from "@/lib/b3-ficha-geometria";

export const Route = createFileRoute("/_authenticated/b3-ficha-dia")({
  head: () => ({
    meta: [
      { title: "Ficha do Dia — AleTrader AI" },
      { name: "description", content: "Cada ordem do pregão com a geometria que o classificador usou na decisão." },
      { property: "og:title", content: "Ficha do Dia — AleTrader AI" },
      { property: "og:description", content: "Uma linha por ordem, com geometria, confirmação e resumo do recorte." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FichaDiaPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
});

const ATIVOS = ["WIN", "WDO", "BIT", "ETR", "SOL", "PETR4", "VALE3", "ITUB4", "BBDC4", "BBAS3"];
const MODALIDADES = ["indicador", "price_action", "price_action_sc", "mean_reversion", "range", "rompimento", "pullback", "vwap"];
const SR = "sem registro";
const btn = "min-h-11 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted";
const num = (v: any, d = 0) => (v == null ? SR : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: d }));
const lado = (s: any) => (s === "buy" ? "compra" : s === "sell" ? "venda" : s ?? SR);
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
function mover(d: string, passo: number) {
  const x = new Date(`${d}T12:00:00Z`);
  do x.setUTCDate(x.getUTCDate() + passo); while (x.getUTCDay() === 0 || x.getUTCDay() === 6);
  return x.toISOString().slice(0, 10);
}
const robo = (o: any) => robotLabel(o.mode, o.variant, o.apelido);
const HEAD = ["Hora", "Ativo · modalidade", "Robô", "Lado", "Contratos", "Entrada", "Stop", "Alvo", "Score", "Confiança", "Votos", "Resultado", "Saiu", "MFE (pts)", "MAE (pts)", "Barrada na sombra"];
const linhaTxt = (o: any) => [o.hora_brt ?? SR, `${o.raiz} · ${vLabel(o.variant)}`, robo(o), lado(o.lado), num(o.contratos), num(o.entrada, 2), num(o.stop, 2), num(o.alvo, 2), num(o.score, 1), num(o.confianca, 1), num(o.votos), o.resultado_brl == null ? SR : BRL(Number(o.resultado_brl)), o.saiu ?? SR, num(o.mfe_pts), num(o.mae_pts), o.barrada_na_sombra ? "sim" : "não"];
const confTxt = (o: any) => (o.confirmacao_exigida_pts == null ? null : `a confirmação exigia ${num(o.confirmacao_exigida_pts)} pontos; entrou a ${num(o.preco_confirmacao, 2)}`);

function fichaTxt(o: any) {
  const L = [`Ficha da ordem — ${o.raiz} · ${vLabel(o.variant)} · ${robo(o)}`];
  HEAD.forEach((h, i) => L.push(`${h}: ${linhaTxt(o)[i]}`));
  L.push(`Setup: ${o.setup ?? SR}`);
  const c = confTxt(o); if (c) L.push(`Confirmação: ${c}`);
  L.push("", "GEOMETRIA");
  const g = geoLinhas(o.geometria);
  if (!g) L.push("sem geometria registrada"); else g.forEach((x) => L.push(`${x.rotulo}: ${x.valor}`));
  return L.join("\n");
}

function Multi({ label, opts, sel, set, fmt }: { label: string; opts: string[]; sel: string[]; set: (v: string[]) => void; fmt?: (s: string) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-sm text-muted-foreground">{label}:</span>
      {opts.map((o) => {
        const on = sel.includes(o);
        return <button key={o} className={`${btn} ${on ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`} aria-pressed={on}
          onClick={() => set(on ? sel.filter((x) => x !== o) : [...sel, o])}>{fmt ? fmt(o) : o}</button>;
      })}
    </div>
  );
}

function FichaDiaPage() {
  useModeApelidos();
  const fn = useServerFn(getB3FichaDia);
  const [date, setDate] = useState(hojeBR());
  const [ativos, setAtivos] = useState<string[]>([]);
  const [mods, setMods] = useState<string[]>([]);
  const [aberta, setAberta] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["b3-ficha-dia", date, ativos, mods],
    queryFn: () => fn({ data: { date, symbols: ativos.length ? ativos : null, variants: mods.length ? mods : null } }),
    staleTime: Infinity,
  });
  const linhas = q.data?.linhas ?? [];
  const r = q.data?.resumo;
  const recorte = `${date}${ativos.length ? ` · ativos ${ativos.join(", ")}` : ""}${mods.length ? ` · modalidades ${mods.map(vLabel).join(", ")}` : ""}`;
  const resumoTxt = r ? [
    `${r.ordens} ordens (${r.fechadas} fechadas, ${r.abertas} abertas)`,
    `${r.ganhos} ganharam, ${r.perdas} perderam, ${r.zeradas} zeradas · acerto ${num(r.acerto_pct, 1)}%`,
    `resultado ${r.resultado_brl_formatado ?? SR}`,
    `${r.barradas_na_sombra} barradas na sombra`,
    `${r.no_limite_do_quorum} no limite exato do quórum; ${r.sem_quorum_declarado} sem quórum declarado (de ${r.ordens} ordens)`,
    `saiu no alvo ${r.saiu_no_alvo} · no stop ${r.saiu_no_stop} · no meio ${r.saiu_no_meio}`,
  ] : [];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Ficha do dia</h1>
        <p className="text-sm text-muted-foreground">Uma linha por ordem, com a geometria que o classificador usou. Só leitura; nada é recalculado.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} aria-label="Pregão anterior" onClick={() => setDate(mover(date, -1))}>◀</button>
        <input type="date" className="min-h-11 rounded-md border bg-background px-2 text-sm" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className={btn} aria-label="Pregão seguinte" onClick={() => setDate(mover(date, 1))}>▶</button>
        <button className={btn} onClick={() => q.refetch()}>{q.isFetching ? "Atualizando…" : "Atualizar"}</button>
      </div>
      <Multi label="Ativo" opts={ATIVOS} sel={ativos} set={setAtivos} />
      <Multi label="Modalidade" opts={MODALIDADES} sel={mods} set={setMods} fmt={vLabel} />

      <section className="rounded-lg border p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Resumo do recorte — {recorte}</h2>
          <button className={btn} disabled={!r} onClick={() => copiarTexto(`Ficha do dia — resumo ${recorte}\n${resumoTxt.join("\n")}`)}>Copiar resumo</button>
        </div>
        {q.isLoading ? <p className="text-sm text-muted-foreground">carregando…</p> : !r || !r.ordens ? <p className="text-sm text-muted-foreground">sem ordens neste pregão</p> :
          <ul className="space-y-0.5 text-sm">{resumoTxt.map((t) => <li key={t}>{t}</li>)}</ul>}
      </section>

      <section className="rounded-lg border">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <h2 className="mr-auto font-semibold">Ordens</h2>
          <button className={btn} disabled={!linhas.length} onClick={() => copiarTexto(`Ficha do dia — ${recorte}\n` + tabular(HEAD, linhas.map(linhaTxt)))}>Copiar a tabela</button>
          <button className={btn} disabled={aberta == null || !linhas[aberta]} onClick={() => aberta != null && copiarTexto(fichaTxt(linhas[aberta]))}>Copiar uma ficha</button>
        </div>
        <p className="px-3 py-1 text-xs text-muted-foreground">MFE = maior avanço a favor · MAE = maior avanço contra (em pontos). Toque na linha para abrir a geometria.</p>
        {!q.isLoading && !linhas.length ? <p className="px-3 py-4 text-sm text-muted-foreground">sem ordens neste pregão</p> :
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground"><tr>{HEAD.slice(0, 15).map((h) => <th key={h} className="whitespace-nowrap px-2 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {linhas.map((o: any, i: number) => {
                  const t = linhaTxt(o);
                  return (
                    <Fragment key={i}>
                      <tr className={`cursor-pointer border-t hover:bg-muted/40 ${aberta === i ? "bg-muted/40" : ""}`} onClick={() => setAberta(aberta === i ? null : i)}>
                        {t.slice(0, 15).map((c, j) => (
                          <td key={j} className={`whitespace-nowrap px-2 py-3 ${j === 11 && o.resultado_brl != null ? (Number(o.resultado_brl) < 0 ? "text-destructive" : Number(o.resultado_brl) > 0 ? "text-success" : "") : ""}`}>
                            {c}{j === 2 && o.barrada_na_sombra ? <span className="ml-2 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">o freio barraria esta entrada (no simulado ela entrou)</span> : null}
                          </td>
                        ))}
                      </tr>
                      {aberta === i && <tr className="bg-muted/20"><td colSpan={15} className="px-3 py-3"><Gaveta o={o} /></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>}
      </section>
    </div>
  );
}

function Gaveta({ o }: { o: any }) {
  const g = geoLinhas(o.geometria);
  const c = confTxt(o);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm">Setup: {o.setup ?? SR}</span>
        <button className={btn} onClick={() => copiarTexto(fichaTxt(o))}>Copiar esta ficha</button>
      </div>
      {c && <p className="text-sm">{c}</p>}
      {!g ? <p className="text-sm italic text-muted-foreground">sem geometria registrada</p> :
        <dl className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
          {g.map((x) => (
            <div key={x.chave} className={`flex justify-between gap-3 border-b border-border/50 py-1 ${x.destaque ? "font-semibold text-primary" : ""}`}>
              <dt className="text-muted-foreground">{x.rotulo}</dt><dd className="text-right">{x.valor}</dd>
            </div>
          ))}
        </dl>}
    </div>
  );
}
