import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listRegimes } from "@/lib/intelligence.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/regimes")({ component: Page });

const COLORS: Record<string, string> = {
  bull: "bg-emerald-500/15 text-emerald-300",
  bear: "bg-red-500/15 text-red-300",
  sideways: "bg-muted text-muted-foreground",
  high_volatility: "bg-orange-500/15 text-orange-300",
  low_volatility: "bg-blue-500/15 text-blue-300",
};

function Page() {
  const q = useQuery({ queryKey: ["regimes"], queryFn: () => listRegimes() });
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Detector de Regime de Mercado</h1>
      <p className="text-sm text-muted-foreground">Classificação automática que influencia pesos do conselho.</p>
      <div className="grid gap-2">
        {(q.data ?? []).map((r: any) => (
          <Card key={r.id} className="p-3 flex items-center justify-between">
            <div>
              <Badge className={COLORS[r.regime] ?? ""}>{r.regime}</Badge>
              <span className="ml-2 text-sm">conf {(Number(r.confidence) * 100).toFixed(0)}%</span>
            </div>
            <div className="text-xs text-muted-foreground">
              vol {(Number(r.volatility ?? 0) * 100).toFixed(2)}% · trend {Number(r.trend_strength ?? 0).toFixed(2)} · {new Date(r.detected_at).toLocaleString()}
            </div>
          </Card>
        ))}
        {q.isSuccess && (q.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nenhuma detecção registrada ainda.</p>}
      </div>
    </div>
  );
}
