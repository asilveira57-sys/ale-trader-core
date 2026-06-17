import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listIncidents } from "@/lib/auto-trading.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/incidents")({
  head: () => ({ meta: [{ title: "Incidentes | AleTrader AI" }] }),
  component: IncidentsPage,
});

function IncidentsPage() {
  const fetchFn = useServerFn(listIncidents);
  const { data } = useQuery({ queryKey: ["incidents"], queryFn: () => fetchFn(), refetchInterval: 30_000 });
  return (
    <div className="p-8 space-y-4 max-w-5xl">
      <header>
        <h1 className="text-3xl font-bold flex items-center gap-2"><AlertTriangle className="size-7 text-amber-400" /> Incidentes</h1>
        <p className="text-muted-foreground">Eventos de risco, falhas e ativações de circuit breaker.</p>
      </header>
      <Card>
        <CardHeader><CardTitle>Histórico</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhum incidente.</p> :
            (data ?? []).map((i: any) => (
              <div key={i.id} className="border border-border rounded p-3 text-sm">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Badge variant={i.severity === "critical" ? "destructive" : "secondary"}>{i.severity}</Badge>
                    <span className="font-mono text-xs">{i.kind}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(i.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1">{i.message}</p>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
