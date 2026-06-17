import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listSupervisorReviews } from "@/lib/auto-trading.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye } from "lucide-react";

export const Route = createFileRoute("/_authenticated/supervisor")({
  head: () => ({ meta: [{ title: "Supervisor | AleTrader AI" }] }),
  component: SupervisorPage,
});

function SupervisorPage() {
  const fetchFn = useServerFn(listSupervisorReviews);
  const { data } = useQuery({ queryKey: ["supervisor"], queryFn: () => fetchFn(), refetchInterval: 30_000 });
  return (
    <div className="p-8 space-y-4 max-w-5xl">
      <header>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Eye className="size-7 text-purple-400" /> Supervisor</h1>
        <p className="text-muted-foreground">Histórico de pareceres do supervisor independente.</p>
      </header>
      <Card>
        <CardContent className="space-y-2 pt-6">
          {(data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Sem revisões.</p> :
            (data ?? []).map((r: any) => (
              <div key={r.id} className="border border-border rounded p-3 text-sm">
                <div className="flex justify-between items-center">
                  <Badge variant={r.verdict === "approved" ? "default" : r.verdict === "warning" ? "secondary" : "destructive"}>{r.verdict}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1">{r.justification}</p>
                <p className="text-xs text-muted-foreground mt-1">DQ: {r.data_quality_score ?? "—"}</p>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
