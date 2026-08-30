// Lista 1 — resultado por combinação, em tabela, com filtro de período,
// filtros de ativo/modalidade/modo e agrupamento.
// Somente leitura. Filtro, soma, ordenação e placar vêm do servidor.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3ResultadoCombinacao, type CombGroup } from "@/lib/b3-listas.functions";
import { BRL, SIGNED_BRL, assetLabel, B3_ASSETS } from "@/lib/b3-format";
import {
  vLabel, downloadCsv, printPage, dm, todayBrt, daysAgoBrt,
  LISTA_VARIANT_LABEL, MODE_KEYS,
} from "@/lib/b3-listas-format";
import { useModeApelidos } from "@/hooks/use-mode-apelidos";
import { Button } from "@/components/ui/button";
import { Table2, Download, Printer, ArrowUp, ArrowDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/b3-listas")({
  head: () => ({
    meta: [
      { title: "Resultado por Combinação — AleTrader AI" },
      { name: "description", content: "Tabela ordenável do resultado dos robôs por ativo, modalidade e modo, com filtro de período, comparação com o período anterior e exportação." },
      { property: "og:title", content: "Resultado por Combinação — AleTrader AI" },
      { property: "og:description", content: "Resultado, operações, pregões e resultado por operação de cada combinação de robô, exportável em CSV e PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ListasPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String((error as any)?.message ?? error)}</div>,
  notFoundComponent: () => <div className="p-6">Não encontrado.</div>,
});

const GROUPS: { key: CombGroup; label: string; hint: string }[] = [
  { key: "ativo", label: "Por ativo", hint: "10 linhas" },
  { key: "par", label: "Por par (ativo + modalidade)", hint: "70 linhas" },
  { key: "trio", label: "Por trio (ativo + modalidade + modo)", hint: "350 linhas" },
  { key: "modalidade", label: "Por modalidade", hint: "corte transversal" },
  { key: "modo", label: "Por modo", hint: "corte transversal" },
];

const COLS = [
  { key: "chave", label: "Combinação", num: false },
  { key: "resultado_brl", label: "Resultado", num: true },
  { key: "media_op", label: "Por operação", num: true },
  { key: "resultado_anterior_brl", label: "Período anterior", num: true },
  { key: "ops", label: "Ops", num: true },
  { key: "ops_pos", label: "Ops +", num: true },
  { key: "hit_rate", label: "Acerto %", num: true },
  { key: "pregoes", label: "Pregões", num: true },
  { key: "pregoes_pos", label: "Pregões +", num: true },
  { key: "pct_pregoes_pos", label: "% pregões +", num: true },
  { key: "melhor_dia", label: "Melhor dia", num: true },
  { key: "pior_dia", label: "Pior dia", num: true },
  { key: "score_medio", label: "Score médio", num: true },
] as const;

const N = (v: any, d = 0) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));

const ASSETS = [...B3_ASSETS] as string[];
const VARIANTS = Object.keys(LISTA_VARIANT_LABEL);
const MODES = [...MODE_KEYS] as string[];

const STORE = "aletrader:b3-listas-filtro";

// Grupo de seleção múltipla no mesmo padrão do cockpit simulado:
// clique simples isola o item, Ctrl/Shift/Meta soma, caixinhas somam,
// e "Todos" é alternador de verdade (tudo marcado -> desmarca tudo).
function MultiPick({
  title, all, sel, onChange, labelOf,
}: {
  title: string;
  all: string[];
  sel: string[];
  onChange: (next: string[]) => void;
  labelOf: (v: string) => string;
}) {
  const isAll = sel.length === all.length;
  const toggleAll = () => onChange(isAll ? [] : [...all]);
  const click = (v: string, e: React.MouseEvent) => {
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (additive) onChange(sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]);
    else onChange(sel.length === 1 && sel[0] === v ? [] : [v]);
  };
  return (
    <div className="min-w-[14rem] flex-1">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <button
          type="button"
          onClick={toggleAll}
          className={`rounded border px-1.5 py-0.5 text-[11px] ${isAll ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}
        >
          Todos
        </button>
        <span className="text-[11px] text-muted-foreground">{sel.length}/{all.length}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {all.map((v) => {
          const on = sel.includes(v);
          return (
            <span key={v} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${on ? "border-primary/60 bg-primary/10" : "border-border text-muted-foreground"}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(on ? sel.filter((x) => x !== v) : [...sel, v])}
                className="size-3 accent-current"
                aria-label={labelOf(v)}
              />
              <button type="button" onClick={(e) => click(v, e)} className="hover:text-foreground">
                {labelOf(v)}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ListasPage() {
  const fn = useServerFn(getB3ResultadoCombinacao);
  const apelidos = useModeApelidos();
  // Apelido em destaque, técnico entre parênteses. Chave nunca muda.
  const mText = (m?: string | null) => {
    if (!m) return "—";
    const t = apelidos.tech(m);
    const n = apelidos.nick(m);
    return t && t !== n ? `${n} (${t})` : n;
  };
  const [de, setDe] = useState(daysAgoBrt(13));
  const [ate, setAte] = useState(todayBrt());
  const [group, setGroup] = useState<CombGroup>("trio");
  const [sort, setSort] = useState<string>("resultado_brl");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [symbols, setSymbols] = useState<string[]>(ASSETS);
  const [variants, setVariants] = useState<string[]>(VARIANTS);
  const [modes, setModes] = useState<string[]>(MODES);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (Array.isArray(s.symbols)) setSymbols(s.symbols.filter((v: string) => ASSETS.includes(v)));
      if (Array.isArray(s.variants)) setVariants(s.variants.filter((v: string) => VARIANTS.includes(v)));
      if (Array.isArray(s.modes)) setModes(s.modes.filter((v: string) => MODES.includes(v)));
    } catch { /* preferência é conveniência, não requisito */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ symbols, variants, modes })); } catch { /* ignora */ }
  }, [symbols, variants, modes]);

  // Seleção completa vira "sem recorte" pro servidor; vazia devolve tela vazia.
  const asArg = (sel: string[], all: string[]) => (sel.length === all.length ? null : sel);

  const q = useQuery({
    queryKey: ["b3-listas", de, ate, group, sort, dir, symbols, variants, modes],
    queryFn: () => fn({
      data: {
        de, ate, group, sort, dir,
        symbols: asArg(symbols, ASSETS),
        variants: asArg(variants, VARIANTS),
        modes: asArg(modes, MODES),
      },
    }),
  });

  const rows = q.data?.rows ?? [];
  const totais = q.data?.totais;
  const filtroAtivo = symbols.length !== ASSETS.length || variants.length !== VARIANTS.length || modes.length !== MODES.length;
  const nada = !symbols.length || !variants.length || !modes.length;

  const nome = (r: any) =>
    [r.symbol ? `${r.symbol} — ${assetLabel(r.symbol)}` : null, r.variant ? vLabel(r.variant) : null, r.mode ? mText(r.mode) : null]
      .filter(Boolean)
      .join(" · ") || r.chave;

  const onSort = (key: string) => {
    if (key === sort) setDir(dir === "desc" ? "asc" : "desc");
    else { setSort(key); setDir(key === "chave" ? "asc" : "desc"); }
  };

  const csv = () =>
    downloadCsv(
      `b3_resultado_${group}_${de}_a_${ate}${filtroAtivo ? "_filtrado" : ""}.csv`,
      ["Combinação", "Ativo", "Modalidade", "Modo", "Resultado (R$)", "Resultado por operação (R$)",
        "Período anterior (R$)", "Operações", "Operações positivas", "Taxa de acerto (%)", "Pregões",
        "Pregões positivos", "% pregões positivos", "Melhor dia (R$)", "Pior dia (R$)", "Score médio"],
      rows.map((r: any) => [
        nome(r), r.symbol ?? "", r.variant ?? "", r.mode ?? "",
        r.resultado_brl, r.media_op, r.resultado_anterior_brl, r.ops, r.ops_pos, r.hit_rate,
        r.pregoes, r.pregoes_pos, r.pct_pregoes_pos, r.melhor_dia, r.pior_dia, r.score_medio,
      ]),
    );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <style>{`@media print { .no-print { display: none !important } body { background: #fff } }`}</style>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Table2 className="size-5" /> Resultado por combinação
          </h1>
          <p className="text-sm text-muted-foreground">
            {dm(de)} a {dm(ate)} · comparado com {dm(q.data?.prev_de)} a {dm(q.data?.prev_ate)} · dias anulados por intervenção ficam fora
          </p>
          {filtroAtivo && (
            <p className="text-xs text-primary">
              Filtro ativo: {symbols.length}/{ASSETS.length} ativos · {variants.length}/{VARIANTS.length} modalidades · {modes.length}/{MODES.length} modos — placar, tabela e exportação seguem este recorte
            </p>
          )}
        </div>
        <div className="no-print flex gap-2">
          <Button variant="outline" size="sm" onClick={csv} disabled={!rows.length}>
            <Download className="mr-1 size-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={printPage} disabled={!rows.length}>
            <Printer className="mr-1 size-4" /> PDF
          </Button>
        </div>
      </header>

      <div className="no-print space-y-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">
            De
            <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)}
              className="mt-1 block rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
          </label>
          <label className="text-xs text-muted-foreground">
            Até
            <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)}
              className="mt-1 block rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
          </label>
          <label className="text-xs text-muted-foreground">
            Agrupar
            <select value={group} onChange={(e) => setGroup(e.target.value as CombGroup)}
              className="mt-1 block rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground">
              {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label} ({g.hint})</option>)}
            </select>
          </label>
          <Button variant="ghost" size="sm" className="mb-0.5"
            onClick={() => { setSymbols(ASSETS); setVariants(VARIANTS); setModes(MODES); }}>
            Limpar filtros
          </Button>
        </div>
        <div className="flex flex-wrap gap-4">
          <MultiPick title="Ativo" all={ASSETS} sel={symbols} onChange={setSymbols} labelOf={(v) => v} />
          <MultiPick title="Modalidade" all={VARIANTS} sel={variants} onChange={setVariants} labelOf={vLabel} />
          <MultiPick title="Modo" all={MODES} sel={modes} onChange={setModes} labelOf={mText} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Clique isola o item · Ctrl (ou Shift) no clique soma · caixinhas somam · "Todos" marca e desmarca tudo
        </p>
      </div>

      {totais && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            { l: "Resultado do período", v: SIGNED_BRL(totais.resultado_brl) },
            { l: "Por operação", v: totais.media_op == null ? "—" : SIGNED_BRL(totais.media_op) },
            { l: "Período anterior", v: `${SIGNED_BRL(totais.resultado_anterior_brl)}${totais.media_op_anterior == null ? "" : ` · ${SIGNED_BRL(totais.media_op_anterior)}/op`}` },
            { l: "Operações", v: N(totais.ops) },
            { l: "Operações positivas", v: `${N(totais.ops_pos)} (${totais.ops ? ((totais.ops_pos / totais.ops) * 100).toFixed(1) : "0,0"}%)` },
          ].map((c) => (
            <div key={c.l} className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">{c.l}</div>
              <div className="text-lg font-semibold tabular-nums">{c.v}</div>
            </div>
          ))}
        </div>
      )}

      {nada ? (
        <div className="p-6 text-sm text-muted-foreground">Nenhum item selecionado no filtro — marque ao menos um ativo, uma modalidade e um modo.</div>
      ) : q.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Somando no servidor…</div>
      ) : !rows.length ? (
        <div className="p-6 text-sm text-muted-foreground">Nenhuma operação encerrada no período dentro do recorte (ou todos os dias foram anulados por intervenção).</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.num ? "text-right" : "text-left"}`}>
                    <button type="button" onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                      {c.label}
                      {sort === c.key && (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.chave} className="border-t border-border/60">
                  <td className="whitespace-nowrap px-3 py-1.5">{nome(r)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${r.resultado_brl >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                    {SIGNED_BRL(r.resultado_brl)}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-medium tabular-nums ${r.media_op == null ? "text-muted-foreground" : r.media_op >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                    {r.media_op == null ? "—" : SIGNED_BRL(r.media_op)}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${r.resultado_anterior_brl == null ? "text-muted-foreground" : r.resultado_anterior_brl >= 0 ? "text-emerald-500/80" : "text-destructive/80"}`}>
                    {r.resultado_anterior_brl == null ? "—" : SIGNED_BRL(r.resultado_anterior_brl)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{N(r.ops)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{N(r.ops_pos)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{N(r.hit_rate, 1)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{N(r.pregoes)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{N(r.pregoes_pos)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{N(r.pct_pregoes_pos, 1)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.melhor_dia == null ? "—" : BRL(r.melhor_dia)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.pior_dia == null ? "—" : BRL(r.pior_dia)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{N(r.score_medio, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
