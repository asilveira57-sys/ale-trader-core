import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRanking } from "@/lib/experts.functions";
import { Badge } from "@/components/ui/badge";
import { Trophy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ranking")({
  head: () => ({ meta: [{ title: "Ranking — AleTrader AI" }] }),
  component: RankingPage,
});

function RankingPage() {
  const fetchFn = useServerFn(getRanking);
  const { data, isLoading } = useQuery({ queryKey: ["ranking"], queryFn: () => fetchFn({}), refetchInterval: 15000 });
  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando ranking…</div>;

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <header className="flex items-center gap-3">
        <Trophy className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ranking de Agentes</h1>
          <p className="text-sm text-muted-foreground">Ordenado pela reputação acumulada nas decisões simuladas.</p>
        </div>
      </header>

      <section className="panel p-5">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-2">#</th>
              <th className="text-left">Agente</th>
              <th className="text-left">Tipo</th>
              <th className="text-right">Score</th>
              <th className="text-right">Peso</th>
              <th className="text-right">Acertos</th>
              <th className="text-right">Erros</th>
              <th className="text-right">PnL sim.</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r: any, i: number) => (
              <tr key={r.id} className="border-b border-border/40">
                <td className="py-2 font-mono text-muted-foreground">{i + 1}</td>
                <td className="font-medium">{r.agents?.name ?? "—"}</td>
                <td><Badge variant="outline">{r.agents?.kind === "expert" ? "Especialista" : "Regra"}</Badge></td>
                <td className="text-right font-mono">{Number(r.score).toFixed(0)}</td>
                <td className="text-right font-mono">{Number(r.weight_current).toFixed(2)}</td>
                <td className="text-right font-mono text-success">{r.hits}</td>
                <td className="text-right font-mono text-destructive">{r.misses}</td>
                <td className={`text-right font-mono ${Number(r.profit_simulated) >= 0 ? "text-success" : "text-destructive"}`}>
                  ${Number(r.profit_simulated).toFixed(2)}
                </td>
              </tr>
            ))}
            {(!data || data.length === 0) && (
              <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Sem dados de reputação ainda. Feche algumas ordens simuladas para gerar histórico.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
