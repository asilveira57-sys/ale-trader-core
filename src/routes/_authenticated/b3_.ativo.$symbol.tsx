import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RobotConfigDialog } from "@/components/b3/RobotConfigDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RefreshCw, ArrowLeft, ChevronLeft, ChevronRight, CalendarDays, Copy, FileSpreadsheet, FileText } from "lucide-react";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import { getB3AssetDashboard } from "@/lib/b3-simulation.functions";
import { BRL, SIGNED_BRL, shortBRL, assetLabel } from "@/lib/b3-format";
import { buildAssetCopyText, buildModeCopyText, exportAssetXlsx, exportAssetPdf } from "@/lib/b3-asset-export";

export const Route = createFileRoute("/_authenticated/b3_/ativo/$symbol")({
  head: ({ params }) => {
    const s = String(params.symbol ?? "").toUpperCase();
    return {
      meta: [
        { title: `Painel do ativo ${s} — AleTrader AI` },
        { name: "description", content: `Painel de corrida do ativo ${s}: resultado do dia contra o limite de perda, ganhos, perdas, pico de exposição e taxa de acerto por modo.` },
        { property: "og:title", content: `Painel do ativo ${s} — AleTrader AI` },
        { property: "og:description", content: `Velocímetro do resultado do dia de ${s} com fundo de escala no limite de perda diário e desempenho por modo.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: AssetDashboardPage,
});



const VARIANT_LABEL: Record<string, string> = {
  indicador: "Indicador",
  price_action: "Price action",
  mean_reversion: "Reversão à média",
  range: "Faixa",
};
const variantLabel = (v: string) => VARIANT_LABEL[v] ?? v;
const modeLabel = (m: string) => m.replace("_", " ");
const pnlColor = (v: number) => (v >= 0 ? "text-emerald-400" : "text-rose-400");
const NUM = (v: number) => Number(v ?? 0).toLocaleString("pt-BR");

// ── Datas sempre em America/Sao_Paulo, no formato AAAA-MM-DD.
const brtToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
const addDays = (d: string, n: number) => {
  const dt = new Date(`${d}T12:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const startOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
const dmy = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—");
const toDate = (d: string) => new Date(`${d}T12:00:00.000Z`);
const fromDate = (dt: Date) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

const copyText = (text: string, msg: string) => {
  navigator.clipboard.writeText(text).then(
    () => toast.success(msg),
    () => toast.error("Não foi possível copiar"),
  );
};

function AssetDashboardPage() {
  const { symbol } = Route.useParams();
  const root = String(symbol ?? "").toUpperCase();
  const fetchDash = useServerFn(getB3AssetDashboard);
  const [variant, setVariant] = useState<string>("all");
  const [mode, setMode] = useState<string>("all");
  const today = brtToday();
  const [de, setDe] = useState<string>(today);
  const [ate, setAte] = useState<string>(today);

  const q = useQuery({
    queryKey: ["b3-asset-dashboard", root, variant, mode, de, ate],
    queryFn: () => fetchDash({ data: { symbol: root, variant, mode, de, ate } }),
    refetchInterval: useVisibleRefetchInterval(10000),
    refetchIntervalInBackground: false,
  });

  const d = q.data;
  const multiDay = de !== ate;
  const variantsPresent: string[] = d?.variants_present ?? [];
  // Chips só para ativos com run ativa; inclui o ativo aberto para não sumir.
  const assetsPresent: string[] = Array.from(
    new Set([...(d?.assets_present ?? []), root].filter(Boolean)),
  ).sort();

  // Pregões com ordens — as setas pulam fim de semana e dia sem pregão.
  const dias: string[] = d?.dias_disponiveis ?? [];
  const { prevDay, nextDay, lastSession } = useMemo(() => {
    const before = dias.filter((x) => x < de);
    const after = dias.filter((x) => x > ate);
    return {
      prevDay: before.length ? before[before.length - 1] : null,
      nextDay: after.length ? after[0] : null,
      lastSession: dias.length ? dias[dias.length - 1] : null,
    };
  }, [dias, de, ate]);

  const setDay = (day: string) => { setDe(day); setAte(day); };
  const setPeriod = (from: string, to: string) => { setDe(from); setAte(to); };

  const copyAsset = () => {
    if (!d) return;
    copyText(buildAssetCopyText(d), `Painel de ${root} copiado`);
  };

  return (
    <div className="container mx-auto py-6 space-y-5 tabular-nums">
      <header className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="h-7 w-7" disabled={!prevDay}
              title={prevDay ? `Pregão de ${dmy(prevDay)}` : "Sem pregão anterior"}
              onClick={() => prevDay && setDay(prevDay)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-2xl font-bold">Painel do ativo — {root}</h1>
            <Button size="icon" variant="outline" className="h-7 w-7" disabled={!nextDay}
              title={nextDay ? `Pregão de ${dmy(nextDay)}` : "Sem pregão posterior"}
              onClick={() => nextDay && setDay(nextDay)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            {d?.quote_symbol && <Badge variant="outline">{d.quote_symbol}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {multiDay ? `Período de ${dmy(de)} a ${dmy(ate)}` : `Pregão de ${dmy(de)}`}. Somente leitura — nenhum controle do motor aqui.
            {d?.contracts?.length ? ` Contratos: ${d.contracts.join(" · ")}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={copyAsset} disabled={!d}>
            <Copy className="w-4 h-4 mr-1" />Copiar ativo
          </Button>
          <Button size="sm" variant="outline" onClick={() => d && exportAssetXlsx(d)} disabled={!d}>
            <FileSpreadsheet className="w-4 h-4 mr-1" />XLSX
          </Button>
          <Button size="sm" variant="outline" onClick={() => d && exportAssetPdf(d)} disabled={!d}>
            <FileText className="w-4 h-4 mr-1" />PDF
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/b3-cockpit"><ArrowLeft className="w-4 h-4 mr-1" />Cockpit</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />Atualizar
          </Button>
        </div>
      </header>

      {/* ── Datas: atalhos, período e calendário ── */}
      <section className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Data:</span>
        <Button size="sm" variant={de === today && ate === today ? "default" : "outline"} className="h-7 text-[11px]"
          onClick={() => setDay(today)}>Hoje</Button>
        <Button size="sm" variant={de === addDays(today, -1) && ate === de ? "default" : "outline"} className="h-7 text-[11px]"
          onClick={() => setDay(addDays(today, -1))}>Ontem</Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={!lastSession}
          onClick={() => lastSession && setDay(lastSession)}>
          Último pregão{lastSession ? ` (${dmy(lastSession)})` : ""}
        </Button>
        <span className="text-[11px] text-muted-foreground ml-2">Período:</span>
        <Button size="sm" variant={de === addDays(today, -6) && ate === today ? "default" : "outline"} className="h-7 text-[11px]"
          onClick={() => setPeriod(addDays(today, -6), today)}>7 dias</Button>
        <Button size="sm" variant={de === addDays(today, -29) && ate === today ? "default" : "outline"} className="h-7 text-[11px]"
          onClick={() => setPeriod(addDays(today, -29), today)}>30 dias</Button>
        <Button size="sm" variant={de === startOfMonth(today) && ate === today ? "default" : "outline"} className="h-7 text-[11px]"
          onClick={() => setPeriod(startOfMonth(today), today)}>Mês atual</Button>
        <DayPicker label={`De ${dmy(de)}`} value={de} onChange={(v) => setDe(v > ate ? ate : v)} />
        <DayPicker label={`Até ${dmy(ate)}`} value={ate} onChange={(v) => setAte(v < de ? de : v)} />
      </section>

      {/* ── Chips de navegação ── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {assetsPresent.map((a) => (
            <Button key={a} asChild size="sm" variant={a === root ? "default" : "outline"} className="h-7 text-[11px]" title={assetLabel(a)}>
              <Link to="/b3/ativo/$symbol" params={{ symbol: a }}>{a}</Link>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Modalidade:</span>
          <Button size="sm" variant={variant === "all" ? "default" : "outline"} className="h-7 text-[11px]"
            onClick={() => { setVariant("all"); setMode("all"); }}>
            Todas
          </Button>
          {variantsPresent.map((v) => (
            <Button key={v} size="sm" variant={variant === v ? "default" : "outline"} className="h-7 text-[11px]"
              onClick={() => { setVariant(v); setMode("all"); }}>
              {variantLabel(v)}
            </Button>
          ))}
          {mode !== "all" && (
            <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={() => setMode("all")}>
              Modo: {modeLabel(mode)} ✕
            </Button>
          )}
        </div>
      </section>

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {!q.isLoading && !d?.groups?.length && (
        <p className="text-sm text-muted-foreground">Nenhuma operação de {root} no período selecionado.</p>
      )}

      {d && !!d.groups?.length && (
        <>
          {/* Bloco 1 — velocímetro no dia único, barras por pregão no período */}
          {multiDay ? (
            <DayBars dias={d.dias ?? []} />
          ) : (
            <Speedometer
              value={Number(d.resultado_dia_brl ?? 0)}
              scale={Number(d.scale_brl ?? 0)}
              piorPct={Number(d.pior_ponto_pct ?? 0)}
            />
          )}

          {/* Bloco 2 — quatro leituras */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Reading label="Ganhos" value={SIGNED_BRL(Number(d.ganhos_brl ?? 0))} color="text-emerald-400" />
            <Reading label="Perdas" value={BRL(Number(d.perdas_brl ?? 0))} color="text-rose-400" />
            <Reading
              label={multiDay ? "Maior pico de exposição" : "Pico de exposição"}
              value={BRL(Number(d.pico_exposicao_brl ?? 0))}
              sub={`${d.pico_exposicao_data && multiDay ? dmy(d.pico_exposicao_data) + " " : ""}${d.pico_exposicao_hora ?? "—"} · ${NUM(Number(d.pico_contratos ?? 0))} contratos`}
            />
            <Reading
              label="Operações"
              value={NUM(Number(d.ops_total ?? 0))}
              sub={`${NUM(Number(d.ops_lucro ?? 0))} no lucro`}
            />
          </section>

          {/* Bloco 3 — cards redondos por modo */}
          {d.groups.map((g: any) => (
            <section key={g.variant} className="space-y-2">
              {variant === "all" && (
                <div className="flex items-center gap-2 border-b border-border/50 pb-1">
                  <Badge variant="outline" className="text-[10px]">{variantLabel(g.variant)}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {NUM(g.ops)} ops · {NUM(g.wins)} no lucro ({g.hit_rate.toFixed(1)}%)
                  </span>
                  <span className={`text-[11px] font-mono ${pnlColor(g.resultado_brl)}`}>{SIGNED_BRL(g.resultado_brl)}</span>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {g.modes.map((m: any) => (
                  <ModeCard
                    key={`${g.variant}:${m.mode}`}
                    m={m}
                    active={mode === m.mode}
                    onClick={() => { setMode(mode === m.mode ? "all" : m.mode); if (variant === "all") setVariant(g.variant); }}
                    onCopy={() => copyText(buildModeCopyText(d, g.variant, m), `Modo ${modeLabel(m.mode)} copiado`)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function DayPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-[11px]">
          <CalendarDays className="w-3.5 h-3.5 mr-1" />{label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={toDate(value)}
          onSelect={(dt) => { if (dt) { onChange(fromDate(dt)); setOpen(false); } }}
        />
      </PopoverContent>
    </Popover>
  );
}

function Reading({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-mono font-semibold ${color ?? ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Barra por pregão: verde acima do zero, vermelha abaixo. Dia sujo
// (b3_pregao_saude.limpo = false) sai com opacidade menor e motivo no tooltip.
function DayBars({ dias }: { dias: any[] }) {
  const max = Math.max(1, ...dias.map((x) => Math.abs(Number(x.resultado_brl ?? 0))));
  const sujos = dias.filter((x) => x.limpo === false);
  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Resultado por pregão</p>
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1" style={{ height: 200 }}>
        {dias.map((x) => {
          const v = Number(x.resultado_brl ?? 0);
          const h = (Math.abs(v) / max) * 78;
          const sujo = x.limpo === false;
          return (
            <div key={x.trade_date} className={`flex-1 min-w-[26px] flex flex-col items-center ${sujo ? "opacity-40" : ""}`}
              title={`${x.trade_date} · ${SIGNED_BRL(v)} · ${x.ops} ops${sujo ? ` · pregão sujo: ${x.motivo_sujo ?? "sem motivo"}` : ""}`}>
              <div className="flex-1 w-full flex flex-col justify-end items-center">
                {v >= 0 && (
                  <>
                    <span className="text-[9px] font-mono text-emerald-400">{shortBRL(v)}</span>
                    <div className="w-full rounded-t bg-emerald-500" style={{ height: `${h}%` }} />
                  </>
                )}
              </div>
              <div className="w-full border-t border-border/70" />
              <div className="flex-1 w-full flex flex-col items-center">
                {v < 0 && (
                  <>
                    <div className="w-full rounded-b bg-rose-500" style={{ height: `${h}%` }} />
                    <span className="text-[9px] font-mono text-rose-400">{shortBRL(v)}</span>
                  </>
                )}
              </div>
              <span className="text-[9px] text-muted-foreground mt-1">{dmy(x.trade_date)}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        {dias.length} pregões
        {sujos.length ? ` · ${sujos.length} sujo(s), em opacidade menor: ${sujos.map((s) => dmy(s.trade_date)).join(", ")}` : ""}
      </p>
    </section>
  );
}

// ── Velocímetro: 240° de arco, fundo de escala = soma dos limites de perda
// dos modos habilitados do ativo. Só apresentação.
const CX = 180, CY = 190, R = 140, SPAN = 120; // ±120° = 240° de arco
const pt = (frac: number, r: number) => {
  const a = (frac * SPAN * Math.PI) / 180;
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
};
const arc = (from: number, to: number, r: number) => {
  const a = pt(from, r), b = pt(to, r);
  const large = Math.abs(to - from) * SPAN > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
};

function Speedometer({ value, scale, piorPct }: { value: number; scale: number; piorPct: number }) {
  const safeScale = scale > 0 ? scale : 1;
  const rawFrac = value / safeScale;
  const clamped = Math.max(-1, Math.min(1, rawFrac));
  const overflow = Math.abs(rawFrac) > 1;
  const needle = pt(clamped, R - 18);
  const baseL = pt(clamped - 0.06, 16);
  const baseR = pt(clamped + 0.06, 16);

  const ticks: { frac: number; major: boolean }[] = [];
  for (let i = -6; i <= 6; i += 1) ticks.push({ frac: i / 6, major: i % 3 === 0 });

  return (
    <section className={`rounded-lg border bg-card p-4 ${overflow ? "border-rose-500 ring-1 ring-rose-500/40" : "border-border/60"}`}>
      <div className="relative mx-auto w-full max-w-[420px]">
        <svg viewBox="0 0 360 280" className="w-full">
          {/* faixas do arco */}
          <path d={arc(-1, -0.66, R)} fill="none" strokeWidth={22} className="stroke-rose-600" strokeLinecap="butt" />
          <path d={arc(-0.66, 0, R)} fill="none" strokeWidth={22} className="stroke-orange-400/70" strokeLinecap="butt" />
          <path d={arc(0, 1, R)} fill="none" strokeWidth={22} className="stroke-emerald-500" strokeLinecap="butt" />

          {/* marcações a cada 1/12 da escala, rótulos a cada 1/4 */}
          {ticks.map((t, i) => {
            const a = pt(t.frac, R - 14), b = pt(t.frac, t.major ? R - 32 : R - 24);
            const lbl = pt(t.frac, R - 50);
            return (
              <g key={i}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={t.major ? 2.5 : 1.2} className="stroke-muted-foreground/70" />
                {t.major && (
                  <text x={lbl.x} y={lbl.y} textAnchor="middle" dominantBaseline="middle"
                    className="fill-muted-foreground text-[11px] font-mono">
                    {t.frac === 0 ? "0" : shortBRL(t.frac * scale)}
                  </text>
                )}
              </g>
            );
          })}

          {/* ponteiro triangular saindo do centro */}
          <polygon
            points={`${needle.x},${needle.y} ${baseL.x},${baseL.y} ${baseR.x},${baseR.y}`}
            className={value >= 0 ? "fill-emerald-400" : "fill-rose-500"}
          />
          <circle cx={CX} cy={CY} r={10} className="fill-background stroke-muted-foreground/60" strokeWidth={2} />

          {/* valor central */}
          <text x={CX} y={CY - 34} textAnchor="middle"
            className={`font-mono font-bold ${value >= 0 ? "fill-emerald-400" : "fill-rose-400"}`}
            style={{ fontSize: 40 }}>
            {SIGNED_BRL(value)}
          </text>
        </svg>
        <p className="text-center text-[11px] text-muted-foreground -mt-6">
          limite de perda {BRL(scale)} · {piorPct.toFixed(0)}% usado no pior momento
          {overflow && <span className="text-rose-400"> · fora de escala</span>}
        </p>
      </div>
    </section>
  );
}

// ── Card redondo por modo: anel = taxa de acerto, cor = sinal do resultado.
function ModeCard({ m, active, onClick, onCopy }: { m: any; active: boolean; onClick: () => void; onCopy: () => void }) {
  const r = 34, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Number(m.hit_rate ?? 0)));
  const positive = Number(m.resultado_brl ?? 0) >= 0;
  const ring = positive ? "stroke-emerald-400" : "stroke-rose-500";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={`relative rounded-lg border bg-card p-3 text-center transition-colors cursor-pointer ${active ? "border-primary ring-1 ring-primary/40" : "border-border/60 hover:border-primary/50"}`}
    >
      <span
        role="button"
        tabIndex={-1}
        title="Copiar modo"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCopy(); }}
        className="absolute top-1.5 right-1.5 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
      >
        <Copy className="w-3.5 h-3.5" />
      </span>
      <svg viewBox="0 0 88 88" className="w-20 h-20 mx-auto -rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" strokeWidth={8} className="stroke-muted/40" />
        <circle cx="44" cy="44" r={r} fill="none" strokeWidth={8} className={ring} strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`} />
        <text x="44" y="44" textAnchor="middle" dominantBaseline="central"
          className="fill-foreground font-mono text-[16px] rotate-90" style={{ transformOrigin: "44px 44px" }}>
          {pct.toFixed(0)}%
        </text>
      </svg>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mt-1">{modeLabel(m.mode)}</p>
      <p className={`text-lg font-mono font-semibold ${pnlColor(Number(m.resultado_brl ?? 0))}`}>
        {SIGNED_BRL(Number(m.resultado_brl ?? 0))}
      </p>
      <p className="text-[10px] text-muted-foreground">{NUM(m.ops)} ops · {NUM(m.wins)} no lucro</p>
      <p className="text-[10px] font-mono">
        <span className="text-emerald-400">{shortBRL(Number(m.ganhos_brl ?? 0))}</span>
        <span className="text-muted-foreground"> / </span>
        <span className="text-rose-400">{shortBRL(Math.abs(Number(m.perdas_brl ?? 0)))}</span>
      </p>
      {!m.enabled && <p className="text-[10px] text-muted-foreground italic">desligado</p>}
      {m.run_id && (
        <span
          className="mt-1 flex justify-center"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          <RobotConfigDialog
            runId={m.run_id}
            mode={m.mode}
            symbol={m.symbol ?? m.mode}
            variant={m.variant ?? "indicador"}
            compact
          />
        </span>
      )}
    </div>
  );
}
