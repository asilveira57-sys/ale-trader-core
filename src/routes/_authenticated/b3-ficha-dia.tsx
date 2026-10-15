import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3FichaDia } from "@/lib/b3-ficha-dia.functions";
import { BRL } from "@/lib/b3-format";

export const Route = createFileRoute("/_authenticated/b3-ficha-dia")({
  head: () => ({
    meta: [
      { title: "Ficha do Dia — AleTrader AI" },
      { name: "description", content: "Por que cada ordem do pregão entrou e saiu: placar com payoff, geometria, comitê, captura e espelho real." },
      { property: "og:title", content: "Ficha do Dia — AleTrader AI" },
      { property: "og:description", content: "Placar por modalidade com payoff e ficha de cada ordem do pregão." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FichaDiaPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
});

const SR = <span className="italic text-muted-foreground">sem registro</span>;
const n = (v: any) => (v == null ? null : Number(v));
const fmt = (v: any, d = 0) => (v == null ? SR : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const hora = (t: any) => (t ? new Date(t).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const brl = (v: any) => (v == null ? SR : <span className={Number(v) >= 0 ? "text-emerald-500" : "text-red-500"}>{BRL(Number(v))}</span>);
const semResultado = (o: any) => o.net_result_brl == null || o.status === "divergente_corretora";
const media = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

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

  const placar = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const o of orders) { if (!g.has(o.variant)) g.set(o.variant, []); g.get(o.variant)!.push(o); }
    return [...g.entries()].map(([variant, all]) => {
      const ok = all.filter((o) => !semResultado(o));
      const res = ok.map((o) => Number(o.net_result_brl));
      const win = res.filter((r) => r > 0), loss = res.filter((r) => r < 0);
      const acerto = ok.length ? win.length / ok.length : null;
      const gm = media(win), pm = media(loss);
      const payoff = gm != null && pm != null && pm !== 0 ? gm / Math.abs(pm) : null;
      return {
        variant, ordens: all.length, sem: all.length - ok.length,
        resultado: res.reduce((s, x) => s + x, 0), acerto, payoff,
        mfe: media(ok.filter((o) => o.mfe_pts != null).map((o) => Number(o.mfe_pts))),
        mae: media(ok.filter((o) => o.mae_pts != null).map((o) => Number(o.mae_pts))),
        positiva: acerto != null && payoff != null ? acerto * payoff > 1 - acerto : null,
      };
    }).sort((a, b) => (b.payoff ?? -1) - (a.payoff ?? -1));
  }, [orders]);

  const opts = (k: string) => [...new Set(orders.map((o) => String(o[k])))].sort();
  const lista = orders.filter((o) =>
    (!fAtivo || o.root === fAtivo) && (!fVar || o.variant === fVar) && (!fRobo || o.mode === fRobo) &&
    (fRes === "todas" || (!semResultado(o) && (fRes === "ganho" ? Number(o.net_result_brl) > 0 : Number(o.net_result_brl) < 0))));
  const sel = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold">Ficha do dia</h1>
        <p className="text-sm text-muted-foreground">Por que cada ordem entrou e saiu. Só leitura do que está gravado; nada é recalculado.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className={sel} value={date} onChange={(e) => setDate(e.target.value)} />
        {q.isFetching && <span className="text-sm text-muted-foreground">carregando…</span>}
        {q.data?.truncated && <span className="text-sm text-amber-500">Atenção: leitura atingiu o teto de segurança.</span>}
      </div>

      <section className="rounded-lg border">
        <h2 className="border-b px-3 py-2 font-semibold">Placar do pregão por modalidade (ordenado por payoff)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr>
              {["Modalidade", "Ordens", "Resultado", "Acerto", "Payoff", "MFE médio", "MAE médio", "Esperança"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {placar.map((p, i) => {
                const corte = i > 0 && placar[i - 1]!.positiva === true && p.positiva !== true;
                return (
                  <tr key={p.variant} className={`border-t ${corte ? "border-t-4 border-t-amber-500" : ""}`}>
                    <td className="px-3 py-2 font-medium">{p.variant || "—"}</td>
                    <td className="px-3 py-2">{p.ordens}{p.sem > 0 && <span className="ml-1 text-xs text-amber-500">({p.sem} sem resultado)</span>}</td>
                    <td className="px-3 py-2">{brl(p.resultado)}</td>
                    <td className="px-3 py-2">{p.acerto == null ? "—" : `${(p.acerto * 100).toFixed(1)}%`}</td>
                    <td className="px-3 py-2 text-base font-bold">{p.payoff == null ? "—" : p.payoff.toFixed(2)}</td>
                    <td className="px-3 py-2">{p.mfe == null ? "—" : fmt(p.mfe)}</td>
                    <td className="px-3 py-2">{p.mae == null ? "—" : fmt(p.mae)}</td>
                    <td className="px-3 py-2">{p.positiva == null ? "—" : p.positiva ? <span className="text-emerald-500">positiva</span> : <span className="text-red-500">negativa</span>}</td>
                  </tr>
                );
              })}
              {!placar.length && <tr><td colSpan={8} className="px-3 py-4 text-muted-foreground">Nenhuma ordem neste pregão.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-xs text-muted-foreground">Payoff = ganho médio das vencedoras ÷ |perda média das perdedoras|. Esperança positiva quando acerto × payoff &gt; 1 − acerto; a linha âmbar marca o corte. Ordens sem resultado reconciliado ficam fora de somas e médias.</p>
      </section>

      <section className="rounded-lg border">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <h2 className="mr-auto font-semibold">Ordens ({lista.length})</h2>
          <select className={sel} value={fAtivo} onChange={(e) => setFAtivo(e.target.value)}><option value="">Todos ativos</option>{opts("root").map((x) => <option key={x}>{x}</option>)}</select>
          <select className={sel} value={fVar} onChange={(e) => setFVar(e.target.value)}><option value="">Todas modalidades</option>{opts("variant").map((x) => <option key={x}>{x}</option>)}</select>
          <select className={sel} value={fRobo} onChange={(e) => setFRobo(e.target.value)}><option value="">Todos robôs</option>{opts("mode").map((x) => <option key={x}>{x}</option>)}</select>
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
                    <td className="px-3 py-2">{o.variant}</td>
                    <td className="px-3 py-2">{o.mode}</td>
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
    </div>
  );
}

function Campo({ k, v }: { k: string; v: any }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>;
}

function Detalhe({ o }: { o: any }) {
  const mfe = n(o.mfe_pts), pts = n(o.gross_result_points);
  const captura = mfe == null || mfe === 0 || pts == null ? "—" : `${((pts / mfe) * 100).toFixed(0)}%`;
  const votos: any[] | null = Array.isArray(o.agentes_votos) ? o.agentes_votos : null;
  const rejeita = (v: any) => /reject|rejeit|contra|no|veto/i.test(String(v?.voto ?? v?.vote ?? ""));
  const card = "space-y-1 rounded-md border bg-background p-3";
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div className={card}>
        <h3 className="font-semibold">Entrada</h3>
        <Campo k="Hora" v={hora(o.entry_time)} /><Campo k="Lado" v={o.side} />
        <Campo k="Preço" v={fmt(o.entry_price, 2)} /><Campo k="Quantidade" v={fmt(o.quantity)} />
        <Campo k="Setup declarado" v={o.entry_setup ?? SR} /><Campo k="Veredito geométrico" v={o.geo_veredito ?? SR} />
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
          <Campo k="Entrada real" v={`${hora(o.real.entry_time)} · ${fmt(o.real.entry_price, 2)}`} />
          <Campo k="Saída real" v={o.real.exit_time ? `${hora(o.real.exit_time)} · ${fmt(o.real.exit_price, 2)}` : "—"} />
          <Campo k="Resultado real" v={o.real.net_result_brl == null ? <span className="text-amber-500">sem resultado</span> : brl(o.real.net_result_brl)} />
          <Campo k="Status" v={o.real.status} />
        </> : <Campo k="Ordem real" v="sem espelho" />}
      </div>
      <div className={card}>
        <h3 className="font-semibold">Comitê</h3>
        {!votos ? SR : votos.map((v, i) => (
          <div key={i} className={`rounded p-1.5 ${rejeita(v) ? "border border-red-500 bg-red-500/10" : ""}`}>
            <div className="flex justify-between font-medium"><span>{v.agente ?? v.nome ?? v.agent_name}</span><span className={rejeita(v) ? "font-bold text-red-500" : ""}>{v.voto ?? v.vote} · {v.confianca ?? v.confidence ?? "—"}</span></div>
            <div className="text-xs text-muted-foreground">{v.razao ?? v.reason}</div>
          </div>
        ))}
      </div>
      <div className={card}>
        <h3 className="font-semibold">Saída</h3>
        <Campo k="Hora" v={hora(o.exit_time)} /><Campo k="Preço" v={fmt(o.exit_price, 2)} />
        <Campo k="Motivo" v={o.close_reason ?? "—"} />
        <Campo k="Resultado (pts)" v={fmt(o.gross_result_points)} />
        <Campo k="Resultado (R$)" v={semResultado(o) ? <span className="text-amber-500">SEM RESULTADO RECONCILIADO</span> : brl(o.net_result_brl)} />
        <Campo k="MFE (pts)" v={fmt(o.mfe_pts)} /><Campo k="MAE (pts)" v={fmt(o.mae_pts)} />
        <Campo k="Captura" v={<span className="font-bold">{captura}</span>} />
        <Campo k="Freios na sombra" v={o.freios_na_sombra == null ? SR : o.freios_na_sombra.length ? o.freios_na_sombra.join(", ") : "nenhum"} />
        <Campo k="Nível do freio na abertura" v={fmt(o.nivel_freio_na_abertura)} />
        <Campo k="Bloqueado na sombra" v={o.bloqueado_na_sombra == null ? SR : o.bloqueado_na_sombra ? "sim" : "não"} />
      </div>
    </div>
  );
}
