import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSimDisjuntor, getSimDisjuntorOpcoes } from "@/lib/b3-sim-disjuntor.functions";
import { CENARIOS, simularDisjuntor } from "@/lib/b3-sim-disjuntor";
import { BRL } from "@/lib/b3-format";
import { modeFullLabel } from "@/lib/mode-nick-registry";

export const Route = createFileRoute("/_authenticated/b3-sim-disjuntor")({
  head: () => ({
    meta: [
      { title: "Simulação de disjuntor — AleTrader AI" },
      { name: "description", content: "Curva do resultado histórico sob disjuntores de perda, por ativo e modalidade, só em pregões limpos." },
      { property: "og:title", content: "Simulação de disjuntor — AleTrader AI" },
      { property: "og:description", content: "Resultado, dia mediano e disparos por percentual de corte de perda." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
});

const MIN_PREGOES = 10;
const cor = (v: number | null) => (v == null ? "—" : <span className={v >= 0 ? "text-success" : "text-destructive"}>{BRL(v)}</span>);
type Crit = "pausado" | "buraco" | "aberta" | "rolagem";
const CRIT: { k: Crit; label: string }[] = [
  { k: "pausado", label: "sistema pausado (sem tique / cobertura < 80%)" },
  { k: "buraco", label: "buraco de cotação (> 10 min ou cotação parada)" },
  { k: "aberta", label: "ordem aberta sem fechamento forçado (stop pendente / fantasma)" },
  { k: "rolagem", label: "vencimento/rolagem do contrato" },
];

function Page() {
  const opcFn = useServerFn(getSimDisjuntorOpcoes);
  const fn = useServerFn(getSimDisjuntor);
  const opc = useQuery({ queryKey: ["simdj-opc"], queryFn: () => opcFn() });
  const [ativo, setAtivo] = useState("");
  const [variant, setVariant] = useState("");
  const [mode, setMode] = useState("");
  const [dias, setDias] = useState(30);
  const [soLimpo, setSoLimpo] = useState(true);
  const [crit, setCrit] = useState<Record<Crit, boolean>>({ pausado: true, buraco: true, aberta: true, rolagem: true });
  const [baseTxt, setBaseTxt] = useState("");

  useEffect(() => {
    if (!ativo && opc.data?.length) { const w = opc.data.find((o) => o.ativo === "WIN") ?? opc.data[0]!; setAtivo(w.ativo); setVariant(w.variants[0] ?? ""); }
  }, [opc.data, ativo]);
  const variants = opc.data?.find((o) => o.ativo === ativo)?.variants ?? [];

  const q = useQuery({
    queryKey: ["simdj", ativo, variant, mode, dias],
    enabled: !!ativo && !!variant,
    queryFn: () => fn({ data: { ativo, variant, mode: mode || null, dias } }),
  });
  useEffect(() => { setBaseTxt(""); }, [ativo, variant, mode]);

  const calc = useMemo(() => {
    const d = q.data;
    if (!d) return null;
    const todos = [...new Set(d.ordens.map((o) => o.dia))].sort();
    const qual = new Map(d.qualidade.map((x) => [x.pregao, x]));
    const saude = new Map(d.saude.map((x: any) => [x.trade_date, x]));
    let prevContrato: string | null = null;
    const status = todos.map((dia) => {
      const cs = d.contratos_por_dia[dia] ?? [];
      const rol = cs.length > 1 || (prevContrato != null && cs[0] != null && cs[0] !== prevContrato);
      if (cs.length) prevContrato = cs[cs.length - 1]!;
      const ql = qual.get(dia);
      if (ql) return { dia, limpo: ql.classificacao === "LIMPO_APARENTE" && !(crit.rolagem && rol), motivo: ql.classificacao === "LIMPO_APARENTE" ? (rol && crit.rolagem ? "rolagem" : "") : `${ql.classificacao}: ${ql.motivo}`, fonte: "qualidade" };
      const s: any = saude.get(dia);
      if (!s) return { dia, limpo: false, motivo: "sem avaliação de saúde", fonte: "nenhuma" };
      const m: string[] = [];
      if (crit.pausado && (!s.primeiro_tick || Number(s.cobertura_pct ?? 0) < 80)) m.push("pausado");
      if (crit.buraco && (Number(s.maior_buraco_min ?? 0) > 10 || Number(s.cotacao_parada ?? 0) > 0)) m.push("buraco de cotação");
      if (crit.aberta && (Number(s.stops_pendentes ?? 0) > 0 || Number(s.ordens_fantasma ?? 0) > 0)) m.push("ordem aberta sem fechamento");
      if (crit.rolagem && rol) m.push("rolagem");
      return { dia, limpo: m.length === 0, motivo: m.join(", "), fonte: "saude" };
    });
    const usados = soLimpo ? status.filter((s) => s.limpo).map((s) => s.dia) : todos;
    const base = baseTxt ? Number(baseTxt.replace(",", ".")) : (d.base_sugerida_brl ?? 0);
    const cen = CENARIOS.map((p) => simularDisjuntor(d.ordens, usados, base, p));
    const validos = cen.filter((c) => c.pregoes >= MIN_PREGOES);
    const ord = [...validos].sort((a, b) => b.total - a.total);
    const pior = cen[0]?.pior ?? null;
    const indist = ord.length >= 2 && pior != null && Math.abs(ord[0]!.total - ord[1]!.total) < Math.abs(pior);
    return { status, usados, todos, base, cen, melhor: ord[0] ?? null, indist };
  }, [q.data, soLimpo, crit, baseTxt]);

  const pctTxt = (p: number | null) => (p == null ? "sem disjuntor" : `${Math.round(p * 100)}%`);

  return (
    <main className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold">Simulação de disjuntor de perda</h1>
        <p className="text-sm text-muted-foreground">Somente leitura. Simula sobre resultados já gravados; não altera nenhuma configuração. Um ativo e uma modalidade por vez — não há soma entre ativos.</p>
      </div>

      <div className="panel p-4 flex flex-wrap gap-4 items-end text-sm">
        <label className="space-y-1"><div>Ativo</div>
          <select className="h-9 rounded border border-border bg-background px-2" value={ativo} onChange={(e) => { setAtivo(e.target.value); setVariant(opc.data?.find((o) => o.ativo === e.target.value)?.variants[0] ?? ""); setMode(""); }}>
            {opc.data?.map((o) => <option key={o.ativo} value={o.ativo}>{o.ativo}</option>)}
          </select></label>
        <label className="space-y-1"><div>Modalidade</div>
          <select className="h-9 rounded border border-border bg-background px-2" value={variant} onChange={(e) => { setVariant(e.target.value); setMode(""); }}>
            {variants.map((v) => <option key={v} value={v}>{v}</option>)}
          </select></label>
        <label className="space-y-1"><div>Robô (opcional)</div>
          <select className="h-9 rounded border border-border bg-background px-2" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">todos os robôs da modalidade</option>
            {q.data?.modos.map((m) => <option key={m} value={m}>{modeFullLabel(m as any)}</option>)}
          </select></label>
        <label className="space-y-1"><div>Período (dias)</div>
          <input className="h-9 w-20 rounded border border-border bg-background px-2" type="number" min={5} max={180} value={dias} onChange={(e) => setDias(Math.min(180, Math.max(5, Number(e.target.value) || 30)))} /></label>
        <label className="space-y-1"><div>Base do % (R$)</div>
          <input className="h-9 w-28 rounded border border-border bg-background px-2" inputMode="decimal" placeholder={q.data?.base_sugerida_brl != null ? q.data.base_sugerida_brl.toFixed(0) : "—"} value={baseTxt} onChange={(e) => setBaseTxt(e.target.value.replace(/[^\d,.]/g, ""))} /></label>
        <label className="flex items-center gap-2 h-9"><input type="checkbox" checked={soLimpo} onChange={(e) => setSoLimpo(e.target.checked)} /> só pregão limpo</label>
      </div>

      {soLimpo && (
        <div className="panel p-3 text-sm space-y-1">
          <div className="text-muted-foreground">Critérios (valem onde não há classificação manual em b3_pregoes_qualidade; lá ela manda):</div>
          {CRIT.map((c) => (
            <label key={c.k} className="flex items-center gap-2"><input type="checkbox" checked={crit[c.k]} onChange={(e) => setCrit({ ...crit, [c.k]: e.target.checked })} /> {c.label}</label>
          ))}
          <div className="text-xs text-muted-foreground">Buraco de cotação vem da saúde do pregão (geral, não separada por ativo). Dia sem nenhuma avaliação conta como não limpo.</div>
        </div>
      )}

      {q.isLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}
      {calc && q.data && (
        <>
          <div className="rounded-md border-2 border-primary/60 bg-primary/10 p-3 text-base font-semibold">
            {calc.todos.length} pregões no período, {calc.status.filter((s) => s.limpo).length} limpos, usando {calc.usados.length}
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>Base do percentual: {BRL(calc.base)} {baseTxt ? "(digitada)" : `(mediana do pico de margem diário do grupo, ${q.data.dias_com_pico} dias com medição)`}.</div>
            {q.data.sem_resultado > 0 && <div className="text-warning font-medium">{q.data.sem_resultado} ordens sem resultado reconciliado, excluídas.</div>}
            {q.data.rows_truncated && <div className="text-destructive font-medium">Leitura atingiu o teto de segurança — resultado incompleto.</div>}
          </div>

          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-2">Cenário</th><th className="p-2">Resultado total</th><th className="p-2">Dia mediano</th><th className="p-2">Pior dia</th><th className="p-2">Melhor dia</th><th className="p-2">Pregões</th><th className="p-2">Disparos</th><th className="p-2">Ops impedidas</th><th className="p-2"></th>
              </tr></thead>
              <tbody>
                {calc.cen.map((c) => {
                  const insuf = c.pregoes < MIN_PREGOES;
                  const top = !insuf && calc.melhor === c;
                  return (
                    <tr key={String(c.pct)} className={`border-b border-border/50 ${top ? "bg-success/10" : ""}`}>
                      <td className="p-2 font-medium">{pctTxt(c.pct)}{c.pct != null && <span className="text-xs text-muted-foreground"> ({BRL(c.pct * calc.base)})</span>}</td>
                      <td className="p-2 font-mono">{cor(c.total)}</td>
                      <td className="p-2 font-mono font-semibold">{cor(c.mediana)}</td>
                      <td className="p-2 font-mono">{cor(c.pior)}</td>
                      <td className="p-2 font-mono">{cor(c.melhor)}</td>
                      <td className="p-2">{c.pregoes}</td>
                      <td className="p-2">{c.pct == null ? "—" : c.disparos}</td>
                      <td className="p-2">{c.pct == null ? "—" : c.impedidas}</td>
                      <td className="p-2 text-xs">{insuf ? <span className="text-warning font-medium">amostra insuficiente</span> : top ? <span className="text-success">sugestão sobre histórico</span> : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-sm">
            {!calc.melhor ? <span className="text-warning">Nenhum cenário com {MIN_PREGOES}+ pregões limpos: sem sugestão.</span>
              : calc.indist ? <span className="text-warning">A diferença entre o melhor e o segundo melhor cenário é menor que o pior dia do período: a escolha não é distinguível pelos dados.</span>
              : <span>Sugestão sobre histórico (não é recomendação): {pctTxt(calc.melhor.pct)}.</span>}
          </div>

          <details className="panel p-3 text-sm">
            <summary className="cursor-pointer">Pregões e motivo de exclusão</summary>
            <ul className="mt-2 space-y-0.5 font-mono text-xs">
              {calc.status.map((s) => <li key={s.dia} className={s.limpo ? "" : "text-muted-foreground"}>{s.dia} — {s.limpo ? "limpo" : `excluído: ${s.motivo}`} <span className="opacity-60">({s.fonte})</span></li>)}
            </ul>
          </details>
          <p className="text-xs text-muted-foreground">Fonte: {q.data.fonte_faltante} Disjuntor simulado por dia sobre o grupo escolhido: quando o acumulado pelas saídas chega a −% da base, toda operação que entra depois é impedida. Dia sem operação não existe na conta.</p>
        </>
      )}
    </main>
  );
}
