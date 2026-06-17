import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLiveMetrics, getReadinessCriteria } from "@/lib/live.functions";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/metrics")({
  head: () => ({ meta: [{ title: "Métricas — AleTrader AI" }] }),
  component: MetricsPage,
});

function MetricsPage() {
  const fn = useServerFn(getLiveMetrics);
  const cr = useServerFn(getReadinessCriteria);
  const { data: m } = useQuery({ queryKey: ["live-metrics"], queryFn: () => fn({}), refetchInterval: 15000 });
  const { data: r } = useQuery({ queryKey: ["live-readiness"], queryFn: () => cr({}), refetchInterval: 30000 });
  if (!m || !r) return <div className="p-8 text-muted-foreground">Carregando…</div>;

  const byAsset = Object.entries(m.by_asset).map(([name, pnl]) => ({ name, pnl: Number(pnl) }));
  const cards = [
    ["Trades", String(m.n_trades)],
    ["Win Rate", `${m.win_rate.toFixed(1)}%`],
    ["Profit Factor", m.profit_factor.toFixed(2)],
    ["PnL total", `$${m.total_pnl.toFixed(2)}`],
    ["DD máx", `${m.max_drawdown.toFixed(1)}%`],
  ] as const;

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <header><h1 className="text-2xl font-semibold tracking-tight">Métricas operacionais</h1></header>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map(([k, v]) => (
          <div key={k} className="panel p-3 text-center">
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">{k}</p>
            <p className="text-lg font-mono font-semibold mt-1">{v}</p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-2">Curva de patrimônio</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={m.equity_curve}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip />
              <Area type="monotone" dataKey="equity" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-2">PnL por ativo</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byAsset}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip />
              <Bar dataKey="pnl" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="font-medium mb-3">Ranking de agentes (peso atual)</h2>
        <div className="space-y-1.5">
          {m.agents.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between text-sm border-b border-border/40 py-1.5">
              <span>{a.name}</span>
              <span className="font-mono">{Number(a.weight).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="font-medium mb-3">Critérios para avançar à Fase 6</h2>
        <ul className="space-y-2">
          {r.criteria.map((c: any) => (
            <li key={c.key} className="flex items-center gap-3 text-sm">
              {c.ok ? <CheckCircle2 className="size-4 text-emerald-500" /> : <XCircle className="size-4 text-destructive" />}
              <span className="flex-1">{c.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{c.value}</span>
            </li>
          ))}
        </ul>
        {r.ready ? (
          <p className="mt-3 text-sm text-emerald-500">✅ Pronto para avançar — execução real continua bloqueada até autorização explícita.</p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Continue operando em paper trading até atingir todos os critérios.</p>
        )}
      </section>
    </div>
  );
}
