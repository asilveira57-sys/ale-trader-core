import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ArrowLeft, ArrowUp, ArrowDown } from "lucide-react";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import { getB3BiDashboard } from "@/lib/b3-simulation.functions";
import { BRL, SIGNED_BRL, shortBRL } from "@/lib/b3-format";

export const Route = createFileRoute("/_authenticated/b3_/bi")({
  head: () => ({
    meta: [
      { title: "BI do B3 — decisão por retorno sobre capital | AleTrader AI" },
      { name: "description", content: "Dashboard analítico dos robôs B3: resultado por pregão, composição bidirecional por robô, ativo, modalidade e modo, capital exigido e retorno sobre o capital." },
      { property: "og:title", content: "BI do B3 — decisão por retorno sobre capital" },
      { property: "og:description", content: "Navegação por data e filtros combináveis sobre o placar diário dos robôs B3, com destaque para pregões sujos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BiPage,
});

// ─────────────────────────── datas (America/Sao_Paulo) ───────────────────────────
const brtToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const prevMonthAnchor = (iso: string) => addDays(monthStart(iso), -1);
const DM = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

type Preset = "hoje" | "ontem" | "7d" | "30d" | "mes" | "mes_ant" | "custom";

const rangeForPreset = (p: Preset, today: string): { de: string; ate: string } => {
  switch (p) {
    case "hoje": return { de: today, ate: today };
    case "ontem": return { de: addDays(today, -1), ate: addDays(today, -1) };
    case "7d": return { de: addDays(today, -6), ate: today };
    case "30d": return { de: addDays(today, -29), ate: today };
    case "mes": return { de: monthStart(today), ate: today };
    case "mes_ant": {
      const a = prevMonthAnchor(today);
      return { de: monthStart(a), ate: monthEnd(a) };
    }
    default: return { de: today, ate: today };
  }
};

const PRESETS: { key: Preset; label: string }[] = [
  { key: "hoje", label: "hoje" },
  { key: "ontem", label: "ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes", label: "mês atual" },
  { key: "mes_ant", label: "mês anterior" },
  { key: "custom", label: "personalizado" },
];

const ASSETS = ["WIN", "WDO", "PETR4", "VALE3"] as const;
const VARIANTS = [
  { key: "indicador", label: "indicador" },
  { key: "price_action", label: "price action" },
] as const;
const MODES = [
  { key: "conservador", label: "conservador" },
  { key: "moderado", label: "moderado" },
  { key: "equilibrado", label: "equilibrado" },
  { key: "semi_agressivo", label: "semi-agressivo" },
  { key: "agressivo", label: "agressivo" },
] as const;

const labelOfMode = (m: string) => MODES.find((x) => x.key === m)?.label ?? m;
const labelOfVariant = (v: string) => VARIANTS.find((x) => x.key === v)?.label ?? v;

// verde = positivo e retorno > 5%; laranja = positivo abaixo de 5%; vermelho = negativo
const perfColor = (resultado: number, retornoPct: number) =>
  resultado < 0 ? "hsl(0 72% 51%)" : retornoPct > 5 ? "hsl(152 60% 45%)" : "hsl(32 90% 55%)";

const PIE_COLORS = [
  "hsl(210 80% 55%)", "hsl(152 60% 45%)", "hsl(32 90% 55%)",
  "hsl(280 60% 60%)", "hsl(190 70% 45%)", "hsl(0 72% 51%)",
];

const PCT = (v: number) => `${v > 0 ? "+" : ""}${Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const NUM = (v: number) => Number(v ?? 0).toLocaleString("pt-BR");

type DimKey = "robo" | "ativo" | "modalidade" | "modo";
const DIMS: { key: DimKey; label: string }[] = [
  { key: "robo", label: "por robô" },
  { key: "ativo", label: "por ativo" },
  { key: "modalidade", label: "por modalidade" },
  { key: "modo", label: "por modo" },
];

type SortKey =
  | "symbol" | "variant" | "mode" | "dias" | "resultado_brl"
  | "capital_brl" | "retorno_pct" | "pior_dd_brl" | "trades" | "acerto_pct";

function BiPage() {
  const today = brtToday();
  const fetchBi = useServerFn(getB3BiDashboard);

  const [preset, setPreset] = useState<Preset>("30d");
  const [custom, setCustom] = useState(() => rangeForPreset("30d", today));
  const [symbol, setSymbol] = useState<string>("all");
  const [variant, setVariant] = useState<string>("all");
  const [mode, setMode] = useState<string>("all");
  const [excluirIntervencao, setExcluirIntervencao] = useState(true);
  const [dim, setDim] = useState<DimKey>("robo");
  const [sortKey, setSortKey] = useState<SortKey>("retorno_pct");
  const [sortDesc, setSortDesc] = useState(true);

  const range = preset === "custom" ? custom : rangeForPreset(preset, today);

  const q = useQuery({
    queryKey: ["b3-bi", range.de, range.ate, symbol, variant, mode, excluirIntervencao],
    queryFn: () => fetchBi({
      data: { de: range.de, ate: range.ate, symbol, variant, mode, excluir_intervencao: excluirIntervencao },
    }),
    refetchInterval: useVisibleRefetchInterval(30000),
    refetchIntervalInBackground: false,
  });

  const d = q.data;
  const c = d?.cartoes;

  const cenario = [
    symbol === "all" ? "todos os ativos" : symbol,
    variant === "all" ? "todas as modalidades" : labelOfVariant(variant),
    mode === "all" ? "todos os modos" : labelOfMode(mode),
    `${DM(range.de)} a ${DM(range.ate)}`,
  ].join(" · ");

  const barras = useMemo(
    () => (d?.dias ?? []).map((x: any) => ({ ...x, dia: DM(x.trade_date) })),
    [d],
  );

  const composicao = useMemo(() => {
    const list = (d?.composicao?.[dim] ?? []) as any[];
    return list.slice().sort((a, b) => b.resultado_brl - a.resultado_brl);
  }, [d, dim]);

  const robos = useMemo(() => {
    const list = ((d?.robos ?? []) as any[]).slice();
    return list.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === "string" ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
      return sortDesc ? -cmp : cmp;
    });
  }, [d, sortKey, sortDesc]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDesc((v) => !v);
    else { setSortKey(k); setSortDesc(true); }
  };

  return (
    <div className="container mx-auto py-6 space-y-5 tabular-nums">
      <header className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">BI — decisão por retorno sobre capital</h1>
          <p className="text-sm text-muted-foreground">
            Somente leitura, do placar diário dos robôs. {cenario}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/b3-cockpit"><ArrowLeft className="w-4 h-4 mr-1" />Cockpit</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />Atualizar
          </Button>
        </div>
      </header>

      {/* ── Bloco 1: período e filtros ── */}
      <section className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground w-20">Período:</span>
          {PRESETS.map((p) => (
            <Button key={p.key} size="sm" className="h-7 text-[11px]"
              variant={preset === p.key ? "default" : "outline"}
              onClick={() => { if (p.key === "custom") setCustom(range); setPreset(p.key); }}>
              {p.label}
            </Button>
          ))}
          {preset === "custom" && (
            <div className="flex items-center gap-2">
              <Input type="date" value={custom.de} className="h-7 w-[140px] text-[11px]"
                onChange={(e) => setCustom((v) => ({ ...v, de: e.target.value }))} />
              <span className="text-[11px] text-muted-foreground">a</span>
              <Input type="date" value={custom.ate} className="h-7 w-[140px] text-[11px]"
                onChange={(e) => setCustom((v) => ({ ...v, ate: e.target.value }))} />
            </div>
          )}
        </div>

        <FilterRow label="Ativo:" value={symbol} onChange={setSymbol}
          options={ASSETS.map((a) => ({ key: a, label: a }))} allLabel="todos" />
        <FilterRow label="Modalidade:" value={variant} onChange={setVariant}
          options={VARIANTS.map((v) => ({ key: v.key, label: v.label }))} allLabel="todas" />
        <FilterRow label="Modo:" value={mode} onChange={setMode}
          options={MODES.map((m) => ({ key: m.key, label: m.label }))} allLabel="todos" />

        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] text-muted-foreground w-20">Evidência:</span>
          <Button size="sm" className="h-7 text-[11px]"
            variant={excluirIntervencao ? "default" : "outline"}
            onClick={() => setExcluirIntervencao((v) => !v)}>
            {excluirIntervencao ? "excluindo dias com intervenção" : "incluindo dias com intervenção"}
          </Button>
        </div>
      </section>

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {/* ── Bloco 2: cartões ── */}
      {c && (
        <section className="space-y-2">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card label="Total positivo" value={SIGNED_BRL(c.total_positivo)} color="text-emerald-400" />
            <Card label="Total negativo" value={BRL(c.total_negativo)} color="text-rose-400" />
            <Card label="Resultado" value={SIGNED_BRL(c.resultado)}
              color={c.resultado >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <Card label="Pico de investimento" value={BRL(c.pico_investimento)}
              sub="capital exigido no pior momento" />
            <Card label="Retorno sobre o capital" value={PCT(c.retorno_pct)}
              color={c.retorno_pct >= 0 ? "text-emerald-400" : "text-rose-400"} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {NUM(c.pregoes)} pregões · {NUM(c.pregoes_positivos)} positivos · {NUM(c.pregoes_negativos)} negativos ·{" "}
            {NUM(c.pregoes_limpos)} limpos
          </p>
        </section>
      )}

      {/* ── Bloco 3: torre por dia ── */}
      {!!barras.length && (
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <h2 className="text-sm font-semibold mb-2">Resultado por pregão</h2>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barras}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                <XAxis dataKey="dia" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => shortBRL(v)} width={56} />
                <Tooltip content={<DayTooltip />} />
                <ReferenceLine y={0} className="stroke-muted-foreground" strokeWidth={1.5} />
                <Bar dataKey="resultado_brl" radius={[2, 2, 0, 0]}>
                  {barras.map((b: any, i: number) => (
                    <Cell key={i}
                      fill={b.resultado_brl >= 0 ? "hsl(152 60% 45%)" : "hsl(0 72% 51%)"}
                      fillOpacity={b.limpo ? 1 : 0.35} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Barras esmaecidas são pregões sujos (não são evidência confiável) — o motivo aparece no tooltip.
          </p>
        </section>
      )}

      {/* ── Bloco 4: composição bidirecional ── */}
      {!!composicao.length && (
        <section className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold">Composição do resultado</h2>
            <div className="flex flex-wrap gap-2">
              {DIMS.map((x) => (
                <Button key={x.key} size="sm" className="h-7 text-[11px]"
                  variant={dim === x.key ? "default" : "outline"} onClick={() => setDim(x.key)}>
                  {x.label}
                </Button>
              ))}
            </div>
          </div>
          <BiDirectional items={composicao} />
          <p className="text-[11px] text-muted-foreground">
            Verde: positivo com retorno acima de 5% do capital exigido · laranja: positivo abaixo de 5% · vermelho: negativo.
          </p>
        </section>
      )}

      {/* ── Bloco 5: pizza de capital por ativo ── */}
      {!!d?.capital_por_ativo?.length && (
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <h2 className="text-sm font-semibold mb-2">Capital exigido por ativo</h2>
          <div className="relative h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={d.capital_por_ativo} dataKey="capital_brl" nameKey="label"
                  innerRadius={70} outerRadius={110} paddingAngle={2}>
                  {d.capital_por_ativo.map((_: any, i: number) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: any, n: any) => [BRL(Number(v)), String(n)]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">total</p>
              <p className="text-xl font-mono font-semibold">{BRL(d.capital_total_brl)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 justify-center">
            {d.capital_por_ativo.map((a: any, i: number) => (
              <span key={a.label} className="flex items-center gap-1 text-[11px]">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                {a.label} · {BRL(a.capital_brl)}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── Bloco 6: tabela ── */}
      {!!robos.length && (
        <section className="rounded-lg border border-border/60 bg-card p-4 overflow-x-auto">
          <h2 className="text-sm font-semibold mb-2">Detalhe por robô</h2>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-muted-foreground border-b border-border/60">
                <Th k="symbol" {...{ sortKey, sortDesc, toggleSort }}>ativo</Th>
                <Th k="variant" {...{ sortKey, sortDesc, toggleSort }}>modalidade</Th>
                <Th k="mode" {...{ sortKey, sortDesc, toggleSort }}>modo</Th>
                <Th k="dias" align="right" {...{ sortKey, sortDesc, toggleSort }}>pregões</Th>
                <Th k="resultado_brl" align="right" {...{ sortKey, sortDesc, toggleSort }}>resultado</Th>
                <Th k="capital_brl" align="right" {...{ sortKey, sortDesc, toggleSort }}>capital exigido</Th>
                <Th k="retorno_pct" align="right" {...{ sortKey, sortDesc, toggleSort }}>retorno %</Th>
                <Th k="pior_dd_brl" align="right" {...{ sortKey, sortDesc, toggleSort }}>pior drawdown</Th>
                <Th k="trades" align="right" {...{ sortKey, sortDesc, toggleSort }}>operações</Th>
                <Th k="acerto_pct" align="right" {...{ sortKey, sortDesc, toggleSort }}>acerto %</Th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {robos.map((r) => (
                <tr key={`${r.symbol}-${r.variant}-${r.mode}`} className="border-b border-border/30">
                  <td className="py-1.5 font-sans">
                    <Link to="/b3/ativo/$symbol" params={{ symbol: r.symbol }} className="hover:underline">
                      {r.symbol}
                    </Link>
                  </td>
                  <td className="py-1.5 font-sans">
                    <Badge variant="outline" className="text-[10px]">{labelOfVariant(r.variant)}</Badge>
                  </td>
                  <td className="py-1.5 font-sans">{labelOfMode(r.mode)}</td>
                  <td className="py-1.5 text-right">{NUM(r.dias)}</td>
                  <td className={`py-1.5 text-right ${r.resultado_brl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {SIGNED_BRL(r.resultado_brl)}
                  </td>
                  <td className="py-1.5 text-right">{BRL(r.capital_brl)}</td>
                  <td className={`py-1.5 text-right font-semibold ${r.retorno_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {PCT(r.retorno_pct)}
                  </td>
                  <td className="py-1.5 text-right text-rose-400">{BRL(r.pior_dd_brl)}</td>
                  <td className="py-1.5 text-right">{NUM(r.trades)}</td>
                  <td className="py-1.5 text-right">{r.acerto_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!q.isLoading && !robos.length && (
        <p className="text-sm text-muted-foreground">Nenhum pregão com placar no cenário selecionado.</p>
      )}
    </div>
  );
}

function FilterRow({ label, value, onChange, options, allLabel }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { key: string; label: string }[]; allLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-20">{label}</span>
      <Button size="sm" className="h-7 text-[11px]" variant={value === "all" ? "default" : "outline"}
        onClick={() => onChange("all")}>{allLabel}</Button>
      {options.map((o) => (
        <Button key={o.key} size="sm" className="h-7 text-[11px]"
          variant={value === o.key ? "default" : "outline"} onClick={() => onChange(o.key)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function Card({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-mono font-semibold ${color ?? ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function DayTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card p-2 text-[11px] space-y-0.5">
      <p className="font-semibold">{p.dia}</p>
      <p className={p.resultado_brl >= 0 ? "text-emerald-400" : "text-rose-400"}>{SIGNED_BRL(p.resultado_brl)}</p>
      <p className="text-muted-foreground">{NUM(p.trades)} operações · capital {BRL(p.pico_margem_brl)}</p>
      {!p.limpo && <p className="text-orange-400">pregão sujo: {p.motivo_sujo ?? "sem motivo registrado"}</p>}
    </div>
  );
}

// Barra horizontal bidirecional: zero no meio, positivos à direita.
function BiDirectional({ items }: { items: any[] }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(Number(i.resultado_brl ?? 0))));
  return (
    <div className="space-y-1.5">
      {items.map((i) => {
        const v = Number(i.resultado_brl ?? 0);
        const w = (Math.abs(v) / max) * 50;
        const color = perfColor(v, Number(i.retorno_pct ?? 0));
        return (
          <div key={i.label} className="flex items-center gap-2">
            <span className="w-[220px] shrink-0 truncate text-[11px]" title={i.label}>{i.label}</span>
            <div className="relative flex-1 h-6">
              <div className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground/50" />
              <div className="absolute inset-y-1 rounded-sm"
                style={{
                  background: color,
                  width: `${w}%`,
                  left: v >= 0 ? "50%" : `${50 - w}%`,
                }} />
              <span className={`absolute top-0.5 text-[11px] font-mono ${v >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                style={v >= 0 ? { left: `calc(50% + ${w}% + 6px)` } : { right: `calc(50% + ${w}% + 6px)` }}>
                {SIGNED_BRL(v)} · {PCT(Number(i.retorno_pct ?? 0))}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Th({ k, children, align, sortKey, sortDesc, toggleSort }: {
  k: SortKey; children: React.ReactNode; align?: "right";
  sortKey: SortKey; sortDesc: boolean; toggleSort: (k: SortKey) => void;
}) {
  const activeCol = sortKey === k;
  return (
    <th className={`py-1.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
        {children}
        {activeCol && (sortDesc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
      </button>
    </th>
  );
}
