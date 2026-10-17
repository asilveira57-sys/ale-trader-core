import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3FichaDia } from "@/lib/b3-ficha-dia.functions";
import { BRL } from "@/lib/b3-format";
import { copiarTexto, tabular } from "@/lib/b3-copiar";
import { modeFullLabel } from "@/lib/mode-nick-registry";
import { vLabel } from "@/lib/b3-listas-format";

export const Route = createFileRoute("/_authenticated/b3-ficha-dia")({
  head: () => ({
    meta: [
      { title: "Ficha do Dia — AleTrader AI" },
      { name: "description", content: "Por que cada ordem do pregão entrou e saiu: placar por ativo com payoff, geometria, comitê, captura e espelho real." },
      { property: "og:title", content: "Ficha do Dia — AleTrader AI" },
      { property: "og:description", content: "Placar por ativo e modalidade com payoff e ficha de cada ordem do pregão." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FichaDiaPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
});

const AJUDA = {
  mfe: "maior lucro que a operação chegou a ter antes de fechar, em pontos. Mostra o quanto o mercado andou a seu favor.",
  mae: "maior prejuízo que a operação chegou a ter antes de fechar, em pontos. Mostra o quanto ela ficou contra antes do fim.",
  captura: "quanto do movimento favorável a saída conseguiu pegar. Só faz sentido em operação que terminou no lucro.",
  freios: "freios que teriam barrado esta entrada no dinheiro real, mas não a barraram no simulado. Serve para comparar o que o real faria.",
  nivel: "em que degrau o freio de grupo estava quando a ordem abriu. Zero é freio desarmado.",
  bloq: "sim quer dizer que algum freio teria impedido esta ordem no real.",
  geo: "o que a geometria das últimas 20 velas diz: confirmado, lateral, contra a tendência ou esticado. Só existe em price action e só a partir de 14/10.",
  payoff: "ganho médio das vencedoras dividido pela perda média das perdedoras. Abaixo de 1, cada ganho é menor que cada perda.",
  esperanca: "positiva quando acerto × payoff supera 1 − acerto. É a condição matemática para a modalidade dar dinheiro no longo prazo.",
};

const SRT = "sem registro";
const SR = <span className="italic text-muted-foreground">{SRT}</span>;
const n = (v: any) => (v == null ? null : Number(v));
const num = (v: any, d = 0) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtT = (v: any, d = 0) => (v == null ? SRT : num(v, d));
const fmt = (v: any, d = 0) => (v == null ? SR : num(v, d));
const hora = (t: any) => (t ? new Date(t).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const brl = (v: any) => (v == null ? SR : <span className={Number(v) >= 0 ? "text-emerald-500" : "text-red-500"}>{BRL(Number(v))}</span>);
const semResultado = (o: any) => o.net_result_brl == null || o.status === "divergente_corretora";
const media = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const btn = "h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted";

type Linha = { ativo: string; variant: string; ordens: number; sem: number; resultado: number; acerto: number | null; payoff: number | null; mfe: number | null; mae: number | null; positiva: boolean | null };

function placarDe(all: any[], ativo: string, variant: string): Linha {
  const ok = all.filter((o) => !semResultado(o));
  const res = ok.map((o) => Number(o.net_result_brl));
  const win = res.filter((r) => r > 0), loss = res.filter((r) => r < 0);
  const acerto = ok.length ? win.length / ok.length : null;
  const gm = media(win), pm = media(loss);
  const payoff = gm != null && pm != null && pm !== 0 ? gm / Math.abs(pm) : null;
  return {
    ativo, variant, ordens: all.length, sem: all.length - ok.length,
    resultado: res.reduce((s, x) => s + x, 0), acerto, payoff,
    mfe: media(ok.filter((o) => o.mfe_pts != null).map((o) => Number(o.mfe_pts))),
    mae: media(ok.filter((o) => o.mae_pts != null).map((o) => Number(o.mae_pts))),
    positiva: acerto != null && payoff != null ? acerto * payoff > 1 - acerto : null,
  };
}
const porPayoff = (a: Linha, b: Linha) => (b.payoff ?? -1) - (a.payoff ?? -1);
const pctT = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const espT = (v: boolean | null) => (v == null ? "—" : v ? "positiva" : "negativa");
const placarHeader = ["Ativo", "Modalidade", "Ordens", "Sem resultado", "Resultado", "Acerto", "Payoff", "MFE médio", "MAE médio", "Esperança"];
const placarRow = (p: Linha) => [p.ativo, vLabel(p.variant), p.ordens, p.sem, BRL(p.resultado), pctT(p.acerto), p.payoff == null ? "—" : p.payoff.toFixed(2), p.mfe == null ? "—" : num(p.mfe), p.mae == null ? "—" : num(p.mae), espT(p.positiva)];

function FichaDiaPage() {
  const fn = useServerFn(getB3FichaDia);
  const [date, setDate] = useState(hojeBR());
  const [fAtivo, setFAtivo] = useState("");
  const [fVar, setFVar] = useState("");
  const [fRobo, setFRobo] = useState("");
  const [fRes, setFRes] = useState<"todas" | "ganho" | "perda">("todas");
  const [aberta, setAberta] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["b3-ficha-dia", date], queryFn: () => fn({ data: { date } }) });
  const orders = (q.data?.orders ?? []) as any[];

  // Topo: por ativo × modalidade, respeitando o filtro de ativo.
  const porAtivo = useMemo(() => {
    const g = new Map<string, Map<string, any[]>>();
    for (const o of orders) {
      if (fAtivo && o.root !== fAtivo) continue;
      if (!g.has(o.root)) g.set(o.root, new Map());
      const m = g.get(o.root)!; if (!m.has(o.variant)) m.set(o.variant, []); m.get(o.variant)!.push(o);
    }
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ativo, m]) => ({
      ativo, linhas: [...m.entries()].map(([v, all]) => placarDe(all, ativo, v)).sort(porPayoff),
    }));
  }, [orders, fAtivo]);

  // Fim: placar antigo, todos os ativos juntos por modalidade.
  const porModalidade = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const o of orders) { if (!g.has(o.variant)) g.set(o.variant, []); g.get(o.variant)!.push(o); }
    return [...g.entries()].map(([v, all]) => placarDe(all, "todos", v)).sort(porPayoff);
  }, [orders]);

  const opts = (k: string) => [...new Set(orders.map((o) => String(o[k])))].sort();
  const lista = orders.filter((o) =>
    (!fAtivo || o.root === fAtivo) && (!fVar || o.variant === fVar) && (!fRobo || o.mode === fRobo) &&
    (fRes === "todas" || (!semResultado(o) && (fRes === "ganho" ? Number(o.net_result_brl) > 0 : Number(o.net_result_brl) < 0))));
  const sel = "h-9 rounded-md border bg-background px-2 text-sm";

  const copiarTopo = () => copiarTexto(`Ficha do dia ${date} — placar por ativo${fAtivo ? ` (filtro: ${fAtivo})` : ""}\n` + tabular(placarHeader, porAtivo.flatMap((a) => a.linhas.map(placarRow))));
  const copiarFim = () => copiarTexto(`Ficha do dia ${date} — placar por modalidade (todos os ativos somados)\n` + tabular(placarHeader, porModalidade.map(placarRow)));

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold">Ficha do dia</h1>
        <p className="text-sm text-muted-foreground">Por que cada ordem entrou e saiu. Só leitura do que está gravado; nada é recalculado.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className={sel} value={date} onChange={(e) => setDate(e.target.value)} />
        <select className={sel} value={fAtivo} onChange={(e) => setFAtivo(e.target.value)}><option value="">Todos ativos</option>{opts("root").map((x) => <option key={x}>{x}</option>)}</select>
        {q.isFetching && <span className="text-sm text-muted-foreground">carregando…</span>}
        {q.data?.truncated && <span className="text-sm text-amber-500">Atenção: leitura atingiu o teto de segurança.</span>}
      </div>

      <section className="rounded-lg border">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <h2 className="mr-auto font-semibold">Placar do pregão por ativo{fAtivo ? ` — ${fAtivo}` : ""} (modalidades ordenadas por payoff)</h2>
          <button className={btn} onClick={copiarTopo}>Copiar placar</button>
        </div>
        <PlacarTabela grupos={porAtivo} />
        <Legenda />
      </section>

      <section className="rounded-lg border">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <h2 className="mr-auto font-semibold">Ordens ({lista.length})</h2>
          <select className={sel} value={fVar} onChange={(e) => setFVar(e.target.value)}><option value="">Todas modalidades</option>{opts("variant").map((x) => <option key={x} value={x}>{vLabel(x)}</option>)}</select>
          <select className={sel} value={fRobo} onChange={(e) => setFRobo(e.target.value)}><option value="">Todos robôs</option>{opts("mode").map((x) => <option key={x} value={x}>{modeFullLabel(x as any)}</option>)}</select>
          <select className={sel} value={fRes} onChange={(e) => setFRes(e.target.value as any)}><option value="todas">Todas</option><option value="ganho">Só ganhadoras</option><option value="perda">Só perdedoras</option></select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr>
              {["Entrada", "Ativo", "Modalidade", "Robô", "Lado", "Setup / veredito", "Resultado", "Real"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {lista.map((o) => (
                <Fragment key={o.id}>
                  <tr className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setAberta(aberta === o.id ? null : o.id)}>
                    <td className="px-3 py-2">{hora(o.entry_time)}</td>
                    <td className="px-3 py-2">{o.root}</td>
                    <td className="px-3 py-2">{vLabel(o.variant)}</td>
                    <td className="px-3 py-2">{modeFullLabel(o.mode)}</td>
                    <td className="px-3 py-2">{o.side === "buy" ? "Compra" : "Venda"}</td>
                    <td className="px-3 py-2">{o.entry_setup ?? SR} · {o.geo_veredito ?? SR}</td>
                    <td className="px-3 py-2">{semResultado(o) ? <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-500">SEM RESULTADO RECONCILIADO</span> : brl(o.net_result_brl)}</td>
                    <td className="px-3 py-2">{o.real ? <span className="rounded bg-primary/20 px-2 py-0.5 text-xs font-bold">REAL {o.real.net_result_brl == null ? "· sem resultado" : BRL(Number(o.real.net_result_brl))}</span> : <span className="text-xs text-muted-foreground">sem espelho</span>}</td>
                  </tr>
                  {aberta === o.id && <tr className="bg-muted/20"><td colSpan={8} className="px-3 py-3"><Detalhe o={o} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <h2 className="mr-auto font-semibold">Placar por modalidade — todos os ativos somados</h2>
          <button className={btn} onClick={copiarFim}>Copiar placar</button>
        </div>
        <PlacarTabela grupos={[{ ativo: "todos", linhas: porModalidade }]} />
        <p className="px-3 pb-2 text-xs text-amber-500">Atenção: esta linha soma ativos diferentes (WIN, WDO, BIT…) e não descreve um ativo só.</p>
      </section>
    </div>
  );
}

function Legenda() {
  return (
    <div className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
      <div><b>Payoff</b> — {AJUDA.payoff}</div>
      <div><b>Esperança</b> — {AJUDA.esperanca} A linha âmbar marca o corte.</div>
      <div><b>MFE</b> — {AJUDA.mfe} <b>MAE</b> — {AJUDA.mae}</div>
      <div>Ordens sem resultado reconciliado ficam fora de somas e médias.</div>
    </div>
  );
}

function PlacarTabela({ grupos }: { grupos: { ativo: string; linhas: Linha[] }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground"><tr>
          <th className="px-3 py-2">Ativo</th><th className="px-3 py-2">Modalidade</th><th className="px-3 py-2">Ordens</th><th className="px-3 py-2">Resultado</th><th className="px-3 py-2">Acerto</th>
          <th className="px-3 py-2" title={AJUDA.payoff}>Payoff</th><th className="px-3 py-2" title={AJUDA.mfe}>MFE médio</th><th className="px-3 py-2" title={AJUDA.mae}>MAE médio</th><th className="px-3 py-2" title={AJUDA.esperanca}>Esperança</th>
        </tr></thead>
        <tbody>
          {grupos.map((g) => g.linhas.map((p, i) => {
            const corte = i > 0 && g.linhas[i - 1]!.positiva === true && p.positiva !== true;
            return (
              <tr key={`${g.ativo}|${p.variant}`} className={`border-t ${i === 0 ? "border-t-2 border-t-border" : ""} ${corte ? "border-t-4 border-t-amber-500" : ""}`}>
                <td className="px-3 py-2 font-semibold">{i === 0 ? g.ativo : ""}</td>
                <td className="px-3 py-2 font-medium">{vLabel(p.variant)}</td>
                <td className="px-3 py-2">{p.ordens}{p.sem > 0 && <span className="ml-1 text-xs text-amber-500">({p.sem} sem resultado)</span>}</td>
                <td className="px-3 py-2">{brl(p.resultado)}</td>
                <td className="px-3 py-2">{pctT(p.acerto)}</td>
                <td className="px-3 py-2 text-base font-bold">{p.payoff == null ? "—" : p.payoff.toFixed(2)}</td>
                <td className="px-3 py-2">{p.mfe == null ? "—" : num(p.mfe)}</td>
                <td className="px-3 py-2">{p.mae == null ? "—" : num(p.mae)}</td>
                <td className="px-3 py-2">{p.positiva == null ? "—" : p.positiva ? <span className="text-emerald-500">positiva</span> : <span className="text-red-500">negativa</span>}</td>
              </tr>
            );
          }))}
          {!grupos.length && <tr><td colSpan={9} className="px-3 py-4 text-muted-foreground">Nenhuma ordem neste pregão.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const rejeita = (v: any) => /reject|rejeit|veto|contra/i.test(String(v?.voto ?? v?.vote ?? ""));
const aprova = (v: any) => /approv|aprov|favor/i.test(String(v?.voto ?? v?.vote ?? ""));
const nomeV = (v: any) => v?.agente ?? v?.nome ?? v?.agent_name ?? "agente";
const votoV = (v: any) => v?.voto ?? v?.vote ?? SRT;
const confV = (v: any) => v?.confianca ?? v?.confidence;
const razaoV = (v: any) => v?.razao ?? v?.reason ?? SRT;

function capturaDe(o: any): string {
  const mfe = n(o.mfe_pts), pts = n(o.gross_result_points);
  if (mfe == null) return SRT;
  if (mfe === 0) return "a operação nunca andou a favor";
  if (pts == null) return "—";
  if (pts > 0) return `${Math.min(100, (pts / mfe) * 100).toFixed(0)}%`;
  return `o melhor momento a favor foi de ${num(mfe)} pontos, contra um stop de ${o.stop_pts == null ? SRT : `${num(o.stop_pts)} pontos`}`;
}

function duracao(a: any, b: any): string | null {
  if (!a || !b) return null;
  const s = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
  if (!(s >= 0)) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p: string[] = [];
  if (h) p.push(`${h} ${h === 1 ? "hora" : "horas"}`);
  if (m) p.push(`${m} ${m === 1 ? "minuto" : "minutos"}`);
  if (ss || !p.length) p.push(`${ss} ${ss === 1 ? "segundo" : "segundos"}`);
  return p.length > 1 ? `${p.slice(0, -1).join(", ")} e ${p[p.length - 1]}` : p[0]!;
}

// Frase determinística: só costura campos gravados; campo nulo = oração omitida.
function narrativa(o: any, votos: any[] | null): string {
  const f: string[] = [];
  const lado = o.side === "buy" ? "Compra" : "Venda";
  let s = lado;
  if (o.quantity != null) s += ` de ${num(o.quantity)} ${Number(o.quantity) === 1 ? "contrato" : "contratos"}`;
  s += ` de ${o.root}`;
  if (o.entry_time) s += ` às ${hora(o.entry_time)}`;
  if (o.entry_price != null) s += ` a ${num(o.entry_price)}`;
  s += `, pelo robô ${modeFullLabel(o.mode)} do ${vLabel(o.variant)}.`;
  f.push(s);
  if (votos) {
    const a = votos.filter(aprova).length, r = votos.filter(rejeita).length, ne = votos.length - a - r;
    let c = `O comitê votou com ${a} ${a === 1 ? "voto" : "votos"} a favor, ${r ? `${r} contra` : "nenhum contra"} e ${ne} ${ne === 1 ? "neutro" : "neutros"}`;
    const x: string[] = [];
    if (o.entry_score != null) x.push(`score ${num(o.entry_score, 1)}`);
    if (o.entry_confidence != null) x.push(`confiança ${num(o.entry_confidence, 1)}`);
    f.push(c + (x.length ? `, com ${x.join(" e ")}.` : "."));
  } else {
    const x: string[] = [];
    if (o.entry_approve_votes != null) x.push(`${num(o.entry_approve_votes)} votos a favor`);
    if (o.entry_score != null) x.push(`score ${num(o.entry_score, 1)}`);
    if (o.entry_confidence != null) x.push(`confiança ${num(o.entry_confidence, 1)}`);
    if (x.length) f.push(`A entrada teve ${x.join(", ")}.`);
  }
  if (o.confirmacao_exigida_pts != null) {
    let c = `A regra de confirmação exigia ${num(o.confirmacao_exigida_pts)} pontos a favor`;
    if (o.confirmacao_janela_s != null) c += ` em até ${num(o.confirmacao_janela_s)} segundos`;
    if (o.confirmou === true) { const d = duracao(o.entry_time, o.confirmou_em); c += d ? ` e confirmou em ${d}` : " e confirmou"; }
    else if (o.confirmou === false) c += " e não confirmou";
    f.push(c + ".");
  }
  if (o.exit_time || o.exit_price != null || o.close_reason) {
    let c = "A ordem saiu";
    if (o.exit_time) c += ` às ${hora(o.exit_time)}`;
    if (o.close_reason) c += ` por ${String(o.close_reason).toUpperCase()}`;
    if (o.exit_price != null) c += `, a ${num(o.exit_price)}`;
    const d = duracao(o.entry_time, o.exit_time); if (d) c += `, ${d} depois`;
    const pts = n(o.gross_result_points);
    if (pts != null) c += `, com ${pts >= 0 ? "ganho" : "perda"} de ${num(Math.abs(pts))} pontos`;
    if (!semResultado(o)) c += `, ${BRL(Math.abs(Number(o.net_result_brl)))}`;
    f.push(c + ".");
  }
  const mfe = n(o.mfe_pts), mae = n(o.mae_pts);
  if (mfe != null && mae != null) f.push(mfe === 0 ? `Nunca andou a favor e no pior momento esteve ${num(mae)} pontos contra.` : `No melhor momento esteve ${num(mfe)} pontos a favor e no pior ${num(mae)} pontos contra.`);
  else if (mfe != null) f.push(mfe === 0 ? "Nunca andou a favor." : `No melhor momento esteve ${num(mfe)} pontos a favor.`);
  else if (mae != null) f.push(`No pior momento esteve ${num(mae)} pontos contra.`);
  if (o.nivel_freio_na_abertura != null) f.push(Number(o.nivel_freio_na_abertura) === 0 ? "Nenhum freio estava ativo na abertura." : `O freio de grupo estava no nível ${num(o.nivel_freio_na_abertura)} na abertura.`);
  if (o.semResultadoTxt) f.push(o.semResultadoTxt);
  return f.join(" ");
}

const simnao = (v: any) => (v == null ? SRT : v ? "sim" : "não");
const freiosT = (o: any) => (o.freios_na_sombra == null ? SRT : o.freios_na_sombra.length ? o.freios_na_sombra.join(", ") : "nenhum");

function textoCartao(o: any, votos: any[] | null, frase: string): string {
  const L: string[] = [];
  const kv = (k: string, v: any) => L.push(`${k}: ${v == null || v === "" ? SRT : v}`);
  L.push(`Ficha da ordem — ${o.root} · ${vLabel(o.variant)} · ${modeFullLabel(o.mode)}`, "", frase, "", "ENTRADA");
  kv("Hora", hora(o.entry_time)); kv("Lado", o.side === "buy" ? "compra" : "venda");
  kv("Preço", fmtT(o.entry_price, 2)); kv("Quantidade", fmtT(o.quantity));
  kv("Setup declarado", o.entry_setup ?? SRT); kv("Veredito geométrico", o.geo_veredito ?? SRT);
  kv("Eficiência direcional", fmtT(o.geo_eficiencia_direcional, 2)); kv("Posição na faixa", fmtT(o.geo_posicao_na_faixa, 2));
  kv("Amplitude (pts)", fmtT(o.geo_amplitude_pts)); kv("Velas", fmtT(o.geo_velas));
  kv("Score", fmtT(o.entry_score, 1)); kv("Confiança", fmtT(o.entry_confidence, 1)); kv("Votos a favor", fmtT(o.entry_approve_votes));
  L.push("", "CONFIRMAÇÃO");
  kv("Exigia", o.confirmacao_exigida_pts == null ? SRT : `${num(o.confirmacao_exigida_pts)} pts em ${fmtT(o.confirmacao_janela_s)} s`);
  kv("Confirmou", simnao(o.confirmou)); kv("Confirmou às", o.confirmou_em ? hora(o.confirmou_em) : SRT); kv("Preço confirmação", fmtT(o.preco_confirmacao, 2));
  L.push("", "ESPELHO REAL");
  kv("Magic", o.magic_number ?? "sem espelho");
  if (o.real) {
    kv("Entrada real", `${hora(o.real.entry_time)} · ${fmtT(o.real.entry_price, 2)}`);
    kv("Saída real", o.real.exit_time ? `${hora(o.real.exit_time)} · ${fmtT(o.real.exit_price, 2)}` : "—");
    kv("Resultado real", o.real.net_result_brl == null ? "sem resultado" : BRL(Number(o.real.net_result_brl)));
    kv("Status", o.real.status);
  } else kv("Ordem real", "sem espelho");
  L.push("", "COMITÊ");
  if (!votos) L.push(SRT);
  else votos.forEach((v, i) => L.push(`${i + 1}. ${nomeV(v)} — ${votoV(v)} · confiança ${fmtT(confV(v), 1)}${rejeita(v) ? " (REJEITOU)" : ""} — ${razaoV(v)}`));
  L.push("", "SAÍDA");
  kv("Hora", hora(o.exit_time)); kv("Preço", fmtT(o.exit_price, 2)); kv("Motivo", o.close_reason ?? SRT);
  kv("Resultado (pts)", fmtT(o.gross_result_points));
  kv("Resultado (R$)", semResultado(o) ? "SEM RESULTADO RECONCILIADO" : BRL(Number(o.net_result_brl)));
  kv("MFE (pts)", fmtT(o.mfe_pts)); kv("MAE (pts)", fmtT(o.mae_pts)); kv("Stop configurado (pts)", fmtT(o.stop_pts));
  kv("Captura", capturaDe(o));
  L.push("", "FREIOS");
  kv("Freios na sombra", freiosT(o)); kv("Nível do freio na abertura", fmtT(o.nivel_freio_na_abertura)); kv("Bloqueado na sombra", simnao(o.bloqueado_na_sombra));
  return L.join("\n");
}

function Campo({ k, v, ajuda }: { k: string; v: any; ajuda?: string }) {
  return (
    <div title={ajuda}>
      <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>
      {ajuda && <div className="text-[11px] leading-snug text-muted-foreground/80">{ajuda}</div>}
    </div>
  );
}

function Detalhe({ o }: { o: any }) {
  const votos: any[] | null = Array.isArray(o.agentes_votos) ? o.agentes_votos : null;
  const frase = narrativa(o, votos);
  const card = "space-y-1 rounded-md border bg-background p-3";
  const cap = capturaDe(o);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3 rounded-md border bg-background p-3">
        <p className="flex-1 text-sm leading-relaxed">{frase}</p>
        <button className={btn} onClick={() => copiarTexto(textoCartao(o, votos, frase))}>Copiar ficha</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className={card}>
          <h3 className="font-semibold">Entrada</h3>
          <Campo k="Hora" v={hora(o.entry_time)} /><Campo k="Lado" v={o.side === "buy" ? "compra" : "venda"} />
          <Campo k="Preço" v={fmt(o.entry_price, 2)} /><Campo k="Quantidade" v={fmt(o.quantity)} />
          <Campo k="Setup declarado" v={o.entry_setup ?? SR} /><Campo k="Veredito geométrico" v={o.geo_veredito ?? SR} ajuda={AJUDA.geo} />
          <Campo k="Eficiência direcional" v={fmt(o.geo_eficiencia_direcional, 2)} /><Campo k="Posição na faixa" v={fmt(o.geo_posicao_na_faixa, 2)} />
          <Campo k="Amplitude (pts)" v={fmt(o.geo_amplitude_pts)} /><Campo k="Velas" v={fmt(o.geo_velas)} />
          <Campo k="Score" v={fmt(o.entry_score, 1)} /><Campo k="Confiança" v={fmt(o.entry_confidence, 1)} /><Campo k="Votos a favor" v={fmt(o.entry_approve_votes)} />
        </div>
        <div className={card}>
          <h3 className="font-semibold">Confirmação</h3>
          <Campo k="Exigia" v={o.confirmacao_exigida_pts == null ? SR : <>{fmt(o.confirmacao_exigida_pts)} pts em {fmt(o.confirmacao_janela_s)} s</>} />
          <Campo k="Confirmou" v={o.confirmou == null ? SR : o.confirmou ? "sim" : "não"} />
          <Campo k="Confirmou às" v={o.confirmou_em ? hora(o.confirmou_em) : SR} /><Campo k="Preço confirmação" v={fmt(o.preco_confirmacao, 2)} />
          <h3 className="pt-2 font-semibold">Espelho real</h3>
          <Campo k="Magic" v={o.magic_number ?? "sem espelho"} />
          {o.real ? <>
            <Campo k="Entrada real" v={`${hora(o.real.entry_time)} · ${fmtT(o.real.entry_price, 2)}`} />
            <Campo k="Saída real" v={o.real.exit_time ? `${hora(o.real.exit_time)} · ${fmtT(o.real.exit_price, 2)}` : "—"} />
            <Campo k="Resultado real" v={o.real.net_result_brl == null ? <span className="text-amber-500">sem resultado</span> : brl(o.real.net_result_brl)} />
            <Campo k="Status" v={o.real.status} />
          </> : <Campo k="Ordem real" v="sem espelho" />}
        </div>
        <div className={card}>
          <h3 className="font-semibold">Comitê</h3>
          {!votos ? SR : votos.map((v, i) => (
            <div key={i} className={`rounded p-1.5 ${rejeita(v) ? "border border-red-500 bg-red-500/10" : ""}`}>
              <div className="flex justify-between font-medium"><span>{nomeV(v)}</span><span className={rejeita(v) ? "font-bold text-red-500" : ""}>{votoV(v)} · {fmt(confV(v), 1)}</span></div>
              <div className="text-xs text-muted-foreground">{razaoV(v)}</div>
            </div>
          ))}
        </div>
        <div className={card}>
          <h3 className="font-semibold">Saída</h3>
          <Campo k="Hora" v={hora(o.exit_time)} /><Campo k="Preço" v={fmt(o.exit_price, 2)} />
          <Campo k="Motivo" v={o.close_reason ?? SR} />
          <Campo k="Resultado (pts)" v={fmt(o.gross_result_points)} />
          <Campo k="Resultado (R$)" v={semResultado(o) ? <span className="text-amber-500">SEM RESULTADO RECONCILIADO</span> : brl(o.net_result_brl)} />
          <Campo k="MFE (pts)" v={fmt(o.mfe_pts)} ajuda={AJUDA.mfe} /><Campo k="MAE (pts)" v={fmt(o.mae_pts)} ajuda={AJUDA.mae} />
          <Campo k="Captura" v={<span className="font-bold">{cap === SRT ? SR : cap}</span>} ajuda={AJUDA.captura} />
          <h3 className="pt-2 font-semibold">Freios</h3>
          <Campo k="Freios na sombra" v={o.freios_na_sombra == null ? SR : freiosT(o)} ajuda={AJUDA.freios} />
          <Campo k="Nível do freio na abertura" v={fmt(o.nivel_freio_na_abertura)} ajuda={AJUDA.nivel} />
          <Campo k="Bloqueado na sombra" v={o.bloqueado_na_sombra == null ? SR : o.bloqueado_na_sombra ? "sim" : "não"} ajuda={AJUDA.bloq} />
        </div>
      </div>
    </div>
  );
}
