import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listSeasonal, recomputeSeasonal } from "@/lib/intelligence.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/seasons")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["seasonal"], queryFn: () => listSeasonal() });
  const recompute = useMutation({
    mutationFn: () => recomputeSeasonal(),
    onSuccess: () => { toast.success("Temporadas atualizadas"); qc.invalidateQueries({ queryKey: ["seasonal"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });
  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Temporadas</h1>
        <Button onClick={() => recompute.mutate()} disabled={recompute.isPending}>Recalcular</Button>
      </header>
      <div className="grid md:grid-cols-2 gap-3">
        {(q.data ?? []).map((s: any) => (
          <Card key={s.id} className="p-3">
            <div className="flex justify-between items-baseline mb-2">
              <h2 className="font-medium uppercase">{s.period}</h2>
              <span className="text-xs text-muted-foreground">{new Date(s.computed_at).toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-2 text-sm gap-1">
              <span>Trades: {s.trades_count}</span>
              <span>PnL: {Number(s.net_pnl ?? 0).toFixed(2)}</span>
              <span>WinRate: {(Number(s.win_rate ?? 0) * 100).toFixed(1)}%</span>
              <span>PF: {Number(s.profit_factor ?? 0).toFixed(2)}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
