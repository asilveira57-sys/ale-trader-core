import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAgentRankings, recomputeRankings } from "@/lib/intelligence.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/agent-rankings")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<"30d" | "90d" | "180d" | "365d">("30d");
  const q = useQuery({ queryKey: ["ranks", period], queryFn: () => listAgentRankings({ data: { period } }) });
  const recompute = useMutation({
    mutationFn: () => recomputeRankings({ data: { period } }),
    onSuccess: () => { toast.success("Ranking atualizado"); qc.invalidateQueries({ queryKey: ["ranks", period] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });
  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Conselho Evolutivo</h1>
        <div className="flex gap-2">
          {(["30d", "90d", "180d", "365d"] as const).map((p) => (
            <Button key={p} size="sm" variant={p === period ? "default" : "outline"} onClick={() => setPeriod(p)}>{p}</Button>
          ))}
          <Button size="sm" onClick={() => recompute.mutate()} disabled={recompute.isPending}>Recalcular</Button>
        </div>
      </header>
      <div className="space-y-2">
        {(q.data ?? []).map((r: any, i: number) => (
          <Card key={r.id} className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground mr-2">#{i + 1}</span>
                <span className="font-medium">{r.agents?.name ?? r.agent_id}</span>
              </div>
              <span className="text-lg font-semibold">{Number(r.score).toFixed(1)}</span>
            </div>
            <div className="grid grid-cols-3 text-xs text-muted-foreground mt-1 gap-1">
              <span>Acc: {fmt(r.accuracy)}</span>
              <span>Lucro: {fmt(r.profit_contribution)}</span>
              <span>DD: {fmt(r.drawdown_caused)}</span>
              <span>Consist: {fmt(r.consistency)}</span>
              <span>Veto: {fmt(r.veto_precision)}</span>
              <span>Trades: {r.trades_count}</span>
            </div>
          </Card>
        ))}
        {q.isSuccess && (q.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sem dados — recalcule o ranking.</p>}
      </div>
    </div>
  );
}

function fmt(n: any) { return n == null ? "n/d" : Number(n).toFixed(2); }
