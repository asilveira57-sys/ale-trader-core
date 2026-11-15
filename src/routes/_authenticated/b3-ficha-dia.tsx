import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3ExtratoDia } from "@/lib/b3-ficha-dia.functions";
import { BRL, FREIO_LABEL } from "@/lib/b3-format";
import { copiarTexto, tabular } from "@/lib/b3-copiar";
import { vLabel } from "@/lib/b3-listas-format";
import { robotLabel } from "@/lib/b3-cockpit-labels";
import { useModeApelidos } from "@/hooks/use-mode-apelidos";
import { geoLinhas } from "@/lib/b3-ficha-geometria";

// EXTRATO DO DIA (pedido do dono 08/11 e 15/11): o que ACONTECEU no pregão, uma
// linha por ordem, com quanto chegou a ganhar e quanto devolveu. Substitui o
// Diagnóstico diário e a Ficha do dia. As barradas na sombra ficam fora por padrão
// (não aconteceriam na conta real). Só leitura: tudo vem pronto do banco
// (b3_extrato_dia_ordens / b3_extrato_dia_resumo, mesmo recorte nas duas).
export const Route = createFileRoute("/_authenticated/b3-ficha-dia")({
  head: () => ({
    meta: [
      { title: "Extrato do dia — AleTrader AI" },
      { name: "description", content: "Cada ordem do pregão: entrada, quanto chegou a ganhar, saída e quanto devolveu." },
      { property: "og:title", content: "Extrato do dia — AleTrader AI" },
      { property: "og:description", content: "Uma linha por ordem, com filtros de ativo, modalidade e robô." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExtratoDiaPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
});

const ATIVOS = ["WIN", "WDO", "BIT"];
const MODALIDADES = ["indicador", "price_action", "price_action_sc", "mean_reversion", "range", "rompimento", "vwap"];
const MODOS = ["conservador", "cauteloso", "moderado", "equilibrado", "semi_agressivo", "arrojado", "agressivo", "enoir"];
const SR = "sem registro";
const btn = "min-h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted";
const num = (v: any, d = 0) => (v == null ? SR : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: d }));
const brl = (v: any) => (v == null ? SR : BRL(Number(v)));
const lado = (s: any) => (s === "buy" ? "compra" : s === "sell" ? "venda" : s ?? SR);
const hora = (h: any) => (h ? String(h).slice(0, 5) : "—");
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
function mover(d: string, passo: number) {
  const x = new Date(`${d}T12:00:00Z`);
  do x.setUTCDate(x.getUTCDate() + passo); while (x.getUTCDay() === 0 || x.getUTCDay() === 6);
  return x.toISOString().slice(0, 10);
}
const robo = (o: any) => robotLabel(o.mode, o.variant, o.apelido);
const cor = (v: any) => (v == null ? "" : Number(v) < 0 ? "text-destructive" : Number(v) > 0 ? "text-success" : "");
const HEAD = ["Entrou", "Ativo · modalidade", "Robô", "Lado", "Entrada", "Chegou a ganhar", "Chegou a perder", "Saiu", "Saída", "Como saiu", "Resultado", "Devolveu"];
const linhaTxt = (o: any) => [hora(o.hora_brt), `${o.raiz} · ${vLabel(o.variant)}`, robo(o), lado(o.lado), num(o.entrada, 2),
  brl(o.chegou_a_ganhar_brl), o.chegou_a_perder_brl == null ? SR : brl(-Number(o.chegou_a_perder_brl)), hora(o.hora_saida_brt), num(o.saida, 2),
  o.saiu ?? SR, brl(o.resultado_brl), brl(o.devolveu_brl)];
const sombraTxt = (o: any) => (Array.isArray(o.freios_na_sombra) ? o.freios_na_sombra : []).map((f: string) => FREIO_LABEL[f] ?? f).join(" + ");

function fichaTxt(o: any) {
  const L = [`Ordem — ${o.raiz} · ${vLabel(o.variant)} · ${robo(o)}`];
  HEAD.forEach((h, i) => L.push(`${h}: ${linhaTxt(o)[i]}`));
  L.push(`Stop: ${num(o.stop, 2)} · Alvo: ${num(o.alvo, 2)} · Motivo da saída: ${o.close_reason ?? SR}`);
  L.push(`Por que entrou: setup ${o.setup ?? SR} · score ${num(o.score, 1)} · confiança ${num(o.confianca, 1)} · votos ${num(o.votos)}`);
  if (o.barrada_na_sombra) L.push(`Barrada na sombra: ${sombraTxt(o) || "sim"}`);
  const g = geoLinhas(o.geometria);
  if (g) { L.push("", "GEOMETRIA"); g.forEach((x) => L.push(`${x.rotulo}: ${x.valor}`)); }
  return L.join("\n");
}

function Multi({ label, opts, sel, set, fmt }: { label: string; opts: string[]; sel: string[]; set: (v: string[]) => void; fmt?: (s: string) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-24 text-sm text-muted-foreground">{label}:</span>
      {opts.map((o) => {
        const on = sel.includes(o);
        return <button key={o} className={`${btn} ${on ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`} aria-pressed={on}
          onClick={() => set(on ? sel.filter((x) => x !== o) : [...sel, o])}>{fmt ? fmt(o) : o}</button>;
      })}
    </div>
  );
}

function ExtratoDiaPage() {
  useModeApelidos();
  const fn = useServerFn(getB3ExtratoDia);
  const [date, setDate] = useState(hojeBR());
  const [ativos, setAtivos] = useState<string[]>([]);
  const [mods, setMods] = useState<string[]>([]);
  const [modos, setModos] = useState<string[]>([]);
  const [sombra, setSombra] = useState(false);
  const [paginas, setPaginas] = useState(1);
  const [aberta, setAberta] = useState<number | null>(null);
  const filtroKey = JSON.stringify([date, ativos, mods, modos, sombra]);
  useEffect(() => { setPaginas(1); setAberta(null); }, [filtroKey]);
  const args = { date, symbols: ativos.length ? ativos : null, variants: mods.length ? mods : null, modes: modos.length ? modos : null, sombra };
  const q = useQuery({
    queryKey: ["b3-extrato-dia", filtroKey, paginas],
    queryFn: async () => {
      const partes = await Promise.all(Array.from({ length: paginas }, (_, i) => fn({ data: { ...args, offset: i * 300 } })));
      return { linhas: partes.flatMap((p) => p.linhas), resumo: partes[0]?.resumo };
    },
    staleTime: Infinity,
  });
  const linhas = q.data?.linhas ?? [];
  const r = q.data?.resumo;
  const total = Number(linhas[0]?.total_no_recorte ?? 0);
  const recorte = `${date}${ativos.length ? ` · ${ativos.join(", ")}` : ""}${mods.length ? ` · ${mods.map(vLabel).join(", ")}` : ""}${modos.length ? ` · ${modos.join(", ")}` : ""}${sombra ? " · com barradas na sombra" : ""}`;
  const resumoTxt = r ? `${r.ordens} ordens · ${r.ganhos} ganharam, ${r.perdas} perderam (acerto ${num(r.acerto_pct, 1)}%) · resultado ${brl(r.resultado_brl)} · chegaram a ganhar ${brl(r.chegou_a_ganhar_brl)} · devolveram ${brl(r.devolveu_brl)} · saiu no alvo ${r.saiu_no_alvo}, no stop ${r.saiu_no_stop}, no meio ${r.saiu_no_meio}` : "";

  return (
    <div className="space-y-3 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Extrato do dia</h1>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} aria-label="Pregão anterior" onClick={() => setDate(mover(date, -1))}>◀</button>
        <input type="date" className="min-h-9 rounded-md border bg-background px-2 text-sm" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className={btn} aria-label="Pregão seguinte" onClick={() => setDate(mover(date, 1))}>▶</button>
        <button className={btn} onClick={() => q.refetch()}>{q.isFetching ? "Atualizando…" : "Atualizar"}</button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sombra} onChange={(e) => setSombra(e.target.checked)} />incluir barradas na sombra</label>
      </div>
      <Multi label="Ativo" opts={ATIVOS} sel={ativos} set={setAtivos} />
      <Multi label="Modalidade" opts={MODALIDADES} sel={mods} set={setMods} fmt={vLabel} />
      <Multi label="Robô" opts={MODOS} sel={modos} set={setModos} fmt={(m) => robotLabel(m)} />

      <section className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm" data-extrato-resumo>
        <span className="mr-auto">{q.isLoading ? "carregando…" : !r || !r.ordens ? "sem ordens neste recorte" : resumoTxt}</span>
        <button className={btn} disabled={!linhas.length} onClick={() => copiarTexto(`Extrato do dia — ${recorte}\n${resumoTxt}\n` + tabular(HEAD, linhas.map(linhaTxt)))}>Copiar extrato</button>
      </section>

      {linhas.length > 0 && <section className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground"><tr>{HEAD.map((h) => <th key={h} className="whitespace-nowrap px-2 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {linhas.map((o: any, i: number) => {
              const t = linhaTxt(o);
              return (
                <Fragment key={i}>
                  <tr className={`cursor-pointer border-t hover:bg-muted/40 ${aberta === i ? "bg-muted/40" : ""}`} onClick={() => setAberta(aberta === i ? null : i)}>
                    {t.map((c, j) => <td key={j} className={`whitespace-nowrap px-2 py-2 ${j === 5 ? "text-success" : j === 6 ? "text-destructive" : j === 10 ? cor(o.resultado_brl) : j === 11 && Number(o.devolveu_brl) > 0 ? "font-semibold text-amber-400" : ""}`}>{c}{j === 2 && o.barrada_na_sombra ? <span className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">sombra</span> : null}</td>)}
                  </tr>
                  {aberta === i && <tr className="bg-muted/20"><td colSpan={HEAD.length} className="px-3 py-3"><Detalhe o={o} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {total > linhas.length && <div className="border-t p-2 text-center"><button className={btn} disabled={q.isFetching} onClick={() => setPaginas(paginas + 1)}>Mostrar mais ({linhas.length} de {total})</button></div>}
      </section>}
    </div>
  );
}

function Detalhe({ o }: { o: any }) {
  const g = geoLinhas(o.geometria);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span>Por que entrou: setup <b>{o.setup ?? SR}</b> · score {num(o.score, 1)} · confiança {num(o.confianca, 1)} · votos {num(o.votos)}</span>
        <span>Stop {num(o.stop, 2)} · Alvo {num(o.alvo, 2)} · Motivo da saída: <b>{o.close_reason ?? SR}</b></span>
        {o.barrada_na_sombra && <span className="text-muted-foreground">Barrada na sombra: {sombraTxt(o) || "sim"}</span>}
        <button className={`${btn} ml-auto`} onClick={() => copiarTexto(fichaTxt(o))}>Copiar esta ordem</button>
      </div>
      {g && <dl className="grid gap-x-6 gap-y-1 md:grid-cols-3">
        {g.map((x) => <div key={x.chave} className={`flex justify-between gap-3 border-b border-border/50 py-0.5 ${x.destaque ? "font-semibold text-primary" : ""}`}><dt className="text-muted-foreground">{x.rotulo}</dt><dd className="text-right">{x.valor}</dd></div>)}
      </dl>}
    </div>
  );
}
