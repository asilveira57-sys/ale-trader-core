import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBacktest, generateBacktestReport } from "@/lib/backtest.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Printer, AlertTriangle } from "lucide-react";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/backtest/$runId")({
  head: () => ({ meta: [{ title: "Backtest — AleTrader AI" }] }),
  component: BacktestDetail,
});

function BacktestDetail() {
  const { runId } = useParams({ from: "/_authenticated/backtest/$runId" });
  const fetchFn = useServerFn(getBacktest);
  const reportFn = useServerFn(generateBacktestReport);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["backtest", runId],
    queryFn: () => fetchFn({ data: { run_id: runId } }),
    refetchInterval: (q) => (q.state.data as any)?.run?.status === "running" ? 3000 : false,
  });
  const mReport = useMutation({
    mutationFn: () => reportFn({ data: { run_id: runId } }),
    onSuccess: () => { toast.success("Relatório gerado"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando…</div>;
  const { run, settings, metrics, trades, report } = data;
  if (!run) return <div className="p-8">Run não encontrado</div>;

  if (run.status === "running") {
    const pct = run.total_candles ? Math.round((run.processed_candles / run.total_candles) * 100) : 0;
    return (
      <div className="p-8 max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">{run.name}</h1>
        <p className="text-muted-foreground">Executando… {pct}%</p>
        <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
      </div>
    );
  }

  if (run.status === "error") {
    return <div className="p-8 max-w-3xl space-y-3">
      <Link to="/backtest"><Button variant="ghost" size="sm"><ArrowLeft className="size-4 mr-1" />Voltar</Button></Link>
      <h1 className="text-2xl font-semibold">{run.name}</h1>
      <p className="text-destructive">{run.error_msg}</p>
    </div>;
  }

  const m = metrics ?? {} as any;
  const equity = (m.equity_curve ?? []) as any[];
  const dd = (m.drawdown_curve ?? []) as any[];
  const byAsset = Object.entries(m.breakdown_by_asset ?? {}).map(([k, v]) => ({ name: k, pnl: Number(v) }));
  const byAgent = Object.entries(m.breakdown_by_agent ?? {}).map(([k, v]: any) => ({ name: k, hit_rate: v.hit_rate, good: v.good, bad: v.bad }));
  const byTf = Object.entries(m.breakdown_by_timeframe ?? {}).map(([k, v]) => ({ name: k, pnl: Number(v) }));

  const bestTrades = [...trades].sort((a, b) => Number(b.pnl) - Number(a.pnl)).slice(0, 5);
  const worstTrades = [...trades].sort((a, b) => Number(a.pnl) - Number(b.pnl)).slice(0, 5);

  return (
    <div className="p-8 max-w-7xl space-y-6 print:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link to="/backtest"><Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{run.name}</h1>
            <p className="text-sm text-muted-foreground">{run.mode} · {settings?.period_start?.slice(0,10)} → {settings?.period_end?.slice(0,10)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => mReport.mutate()} disabled={mReport.isPending}>
            <FileText className="size-4 mr-2" />{report ? "Regerar relatório" : "Gerar relatório"}
          </Button>
          <Button onClick={() => window.print()}><Printer className="size-4 mr-2" />Exportar PDF</Button>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          ["PnL", `$${Number(m.total_pnl ?? 0).toFixed(2)}`],
          ["Retorno", `${Number(m.return_pct ?? 0).toFixed(2)}%`],
          ["Trades", m.n_trades ?? 0],
          ["Win rate", `${Number(m.win_rate ?? 0).toFixed(0)}%`],
          ["Profit factor", Number(m.profit_factor ?? 0).toFixed(2)],
          ["DD máx", `${Number(m.max_drawdown ?? 0).toFixed(1)}%`],
        ].map(([k, v]) => (
          <div key={k as string} className="panel p-4 text-center">
            <p className="text-xs uppercase text-muted-foreground">{k}</p>
            <p className="text-xl font-mono font-semibold mt-1">{v as any}</p>
          </div>
        ))}
      </section>

      {report && (
        <section className="panel p-5 space-y-3">
          <h2 className="text-sm font-semibold">Resumo executivo</h2>
          <p className="text-sm whitespace-pre-line">{report.summary}</p>
          {report.recommendation && (
            <>
              <h3 className="text-xs uppercase text-muted-foreground mt-3">Recomendação</h3>
              <p className="text-sm whitespace-pre-line">{report.recommendation}</p>
            </>
          )}
          {report.warnings?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {report.warnings.map((w: string, i: number) => (
                <Badge key={i} variant="destructive" className="gap-1"><AlertTriangle className="size-3" />{w}</Badge>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-2">Curva de patrimônio</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={equity}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} tickFormatter={(v) => v?.slice(5, 10)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Area type="monotone" dataKey="equity" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-2">Drawdown (%)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dd}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} tickFormatter={(v) => v?.slice(5, 10)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="dd" stroke="hsl(var(--destructive))" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-2">PnL por ativo</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byAsset}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="pnl" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-2">Taxa de acerto por agente</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byAgent}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-25} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="hit_rate" fill="hsl(var(--success, 142 70% 45%))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-2">Melhores operações</h3>
          <TradeTable rows={bestTrades} />
        </div>
        <div className="panel p-4">
          <h3 className="text-sm font-semibold mb-2">Piores operações</h3>
          <TradeTable rows={worstTrades} />
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="text-sm font-semibold mb-2">PnL por timeframe</h3>
        <div className="flex gap-3 flex-wrap">
          {byTf.map((x) => (
            <div key={x.name} className="border border-border rounded p-3 text-sm">
              <p className="text-xs text-muted-foreground">{x.name}</p>
              <p className={`font-mono ${x.pnl >= 0 ? "text-success" : "text-destructive"}`}>${x.pnl.toFixed(2)}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">⚠️ Resultados históricos não garantem performance futura.</p>
    </div>
  );
}

function TradeTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Sem dados.</p>;
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground border-b border-border">
        <tr>
          <th className="text-left py-1">Par</th><th>Side</th><th>Entrada</th><th>Saída</th>
          <th className="text-right">PnL</th><th className="text-right">%</th><th>Motivo</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className="border-b border-border/40">
            <td className="py-1">{t.pair}</td>
            <td>{t.side}</td>
            <td>${Number(t.entry_price).toFixed(2)}</td>
            <td>${Number(t.exit_price ?? 0).toFixed(2)}</td>
            <td className={`text-right font-mono ${Number(t.pnl) >= 0 ? "text-success" : "text-destructive"}`}>${Number(t.pnl).toFixed(2)}</td>
            <td className="text-right font-mono">{Number(t.pnl_pct).toFixed(2)}%</td>
            <td>{t.exit_reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
