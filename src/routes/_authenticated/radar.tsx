import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listRadar, recomputeRadar } from "@/lib/intelligence.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/radar")({ component: Page });

const KIND_COLOR: Record<string, string> = {
  promising: "bg-emerald-500/15 text-emerald-300",
  dangerous: "bg-red-500/15 text-red-300",
  emerging_trend: "bg-blue-500/15 text-blue-300",
  behavior_shift: "bg-yellow-500/15 text-yellow-300",
  regime_change: "bg-purple-500/15 text-purple-300",
};

function Page() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["radar"], queryFn: () => listRadar() });
  const recompute = useMutation({
    mutationFn: () => recomputeRadar(),
    onSuccess: (r: any) => { toast.success(`${r?.length ?? 0} sinais atualizados`); qc.invalidateQueries({ queryKey: ["radar"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });
  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Radar de Oportunidades</h1>
        <Button onClick={() => recompute.mutate()} disabled={recompute.isPending}>Recalcular</Button>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {(q.data ?? []).map((r: any) => (
          <Card key={r.id} className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">{r.symbol ?? "—"}</span>
              <Badge className={KIND_COLOR[r.kind] ?? ""}>{r.kind}</Badge>
            </div>
            <p className="text-sm">{r.reason}</p>
            <p className="text-xs text-muted-foreground mt-1">score {Number(r.score).toFixed(0)} · {new Date(r.created_at).toLocaleString()}</p>
          </Card>
        ))}
        {q.isSuccess && (q.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nenhum sinal no radar.</p>}
      </div>
    </div>
  );
}
