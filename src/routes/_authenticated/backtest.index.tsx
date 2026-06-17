import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBacktests, deleteBacktest } from "@/lib/backtest.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, FlaskConical, Trash2, Database, CheckSquare } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/backtest/")({
  head: () => ({ meta: [{ title: "Laboratório de Backtesting — AleTrader AI" }] }),
  component: BacktestList,
});

function BacktestList() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(listBacktests);
  const delFn = useServerFn(deleteBacktest);
  const { data, isLoading } = useQuery({
    queryKey: ["backtests"],
    queryFn: () => fetchFn({}),
    refetchInterval: 4000,
  });
  const mDel = useMutation({
    mutationFn: (run_id: string) => delFn({ data: { run_id } }),
    onSuccess: () => { toast.success("Run removido"); qc.invalidateQueries({ queryKey: ["backtests"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FlaskConical className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Laboratório de Backtesting</h1>
            <p className="text-sm text-muted-foreground">Teste agentes, comitês e estratégias com dados históricos — sem dinheiro real.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/backtest/data"><Button variant="outline"><Database className="size-4 mr-2" />Dados históricos</Button></Link>
          <Link to="/backtest/criteria"><Button variant="outline"><CheckSquare className="size-4 mr-2" />Critérios</Button></Link>
          <Link to="/backtest/new"><Button><Plus className="size-4 mr-2" />Novo backtest</Button></Link>
        </div>
      </header>

      <section className="panel p-5">
        {isLoading ? <p className="text-muted-foreground text-sm">Carregando…</p> : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-2">Nome</th>
                <th className="text-left">Modo</th>
                <th className="text-left">Status</th>
                <th className="text-right">PnL</th>
                <th className="text-right">Retorno</th>
                <th className="text-right">Trades</th>
                <th className="text-right">Win %</th>
                <th className="text-right">PF</th>
                <th className="text-right">DD máx</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r: any) => {
                const s = r.summary ?? {};
                const pnl = Number(s.total_pnl ?? 0);
                return (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="py-2">
                      <Link to="/backtest/$runId" params={{ runId: r.id }} className="font-medium hover:underline">{r.name}</Link>
                    </td>
                    <td><Badge variant="outline">{r.mode}</Badge></td>
                    <td>
                      <Badge variant={r.status === "done" ? "default" : r.status === "error" ? "destructive" : "secondary"}>
                        {r.status}{r.status === "running" && r.total_candles ? ` (${Math.round((r.processed_candles / r.total_candles) * 100)}%)` : ""}
                      </Badge>
                    </td>
                    <td className={`text-right font-mono ${pnl >= 0 ? "text-success" : "text-destructive"}`}>${pnl.toFixed(2)}</td>
                    <td className="text-right font-mono">{Number(s.return_pct ?? 0).toFixed(2)}%</td>
                    <td className="text-right font-mono">{s.n_trades ?? 0}</td>
                    <td className="text-right font-mono">{Number(s.win_rate ?? 0).toFixed(0)}%</td>
                    <td className="text-right font-mono">{Number(s.profit_factor ?? 0).toFixed(2)}</td>
                    <td className="text-right font-mono">{Number(s.max_drawdown ?? 0).toFixed(1)}%</td>
                    <td className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => mDel.mutate(r.id)}><Trash2 className="size-4" /></Button>
                    </td>
                  </tr>
                );
              })}
              {(!data || data.length === 0) && (
                <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">Nenhum backtest ainda. Crie o primeiro.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-xs text-muted-foreground">⚠️ Resultados históricos não garantem performance futura. Sistema permanece em modo simulação — nenhuma ordem real é executada.</p>
    </div>
  );
}
