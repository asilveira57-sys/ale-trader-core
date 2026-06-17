import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { advanceCriteria, getAgentPerformance } from "@/lib/backtest.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle2, XCircle, Trophy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/backtest/criteria")({
  head: () => ({ meta: [{ title: "Critérios para avançar — AleTrader AI" }] }),
  component: CriteriaPage,
});

function CriteriaPage() {
  const critFn = useServerFn(advanceCriteria);
  const perfFn = useServerFn(getAgentPerformance);
  const { data: c } = useQuery({ queryKey: ["criteria"], queryFn: () => critFn({}) });
  const { data: perf } = useQuery({ queryKey: ["agent-perf"], queryFn: () => perfFn({}) });

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <header className="flex items-center gap-3">
        <Link to="/backtest"><Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button></Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Critérios para avançar de fase</h1>
          <p className="text-sm text-muted-foreground">Validação quantitativa antes de qualquer operação real.</p>
        </div>
      </header>

      {c && (
        <section className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Status geral</h2>
            <Badge variant={c.canAdvance ? "default" : "destructive"} className="text-sm">
              {c.canAdvance ? "APTO para próxima fase" : "AINDA NÃO APTO"}
            </Badge>
          </div>
          <ul className="divide-y divide-border">
            {c.checks.map((chk: any, i: number) => (
              <li key={i} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {chk.ok ? <CheckCircle2 className="size-5 text-success" /> : <XCircle className="size-5 text-destructive" />}
                  <span className="text-sm">{chk.label}</span>
                </div>
                <span className="text-sm font-mono text-muted-foreground">{chk.value}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-4">
            Total runs: {c.totals.runs} · Positivos: {c.totals.positiveRuns} · Trades acumulados: {c.totals.totalTrades}
          </p>
        </section>
      )}

      <section className="panel p-5">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Ranking agregado de agentes (backtests)</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr><th className="text-left py-2">#</th><th className="text-left">Agente</th><th className="text-right">Runs</th><th className="text-right">Hit %</th><th className="text-right">Acertos</th><th className="text-right">Erros</th></tr>
          </thead>
          <tbody>
            {(perf ?? []).map((p: any, i: number) => (
              <tr key={p.name} className="border-b border-border/40">
                <td className="py-2 font-mono text-muted-foreground">{i + 1}</td>
                <td className="font-medium">{p.name}</td>
                <td className="text-right font-mono">{p.runs}</td>
                <td className="text-right font-mono">{p.hit_rate.toFixed(1)}%</td>
                <td className="text-right font-mono text-success">{p.good}</td>
                <td className="text-right font-mono text-destructive">{p.bad}</td>
              </tr>
            ))}
            {(!perf || perf.length === 0) && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Execute backtests para gerar ranking.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
