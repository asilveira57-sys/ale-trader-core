import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAlerts } from "@/lib/atrader.functions";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({ meta: [{ title: "Alertas — AleTrader AI" }] }),
  component: AlertsPage,
});

function AlertsPage() {
  const fn = useServerFn(listAlerts);
  const { data: alerts = [] } = useQuery({ queryKey: ["alerts"], queryFn: () => fn({}), refetchInterval: 10000 });
  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header><h1 className="text-2xl font-semibold tracking-tight">Alertas</h1>
        <p className="text-sm text-muted-foreground">Eventos de mercado e sistema. Estrutura preparada para envio futuro via Telegram/WhatsApp.</p>
      </header>
      <div className="panel divide-y divide-border">
        {alerts.map((a: any) => (
          <div key={a.id} className="p-4 flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-sm">{a.type}{a.pair ? ` · ${a.pair}` : ""}</p>
              <p className="text-xs text-muted-foreground">{a.message}</p>
              <p className="text-[10px] text-muted-foreground font-mono mt-1">{new Date(a.created_at).toLocaleString()}</p>
            </div>
            <Badge variant={a.severity === "critical" ? "destructive" : a.severity === "warning" ? "secondary" : "outline"}>{a.severity}</Badge>
          </div>
        ))}
        {!alerts.length && <p className="p-6 text-sm text-muted-foreground">Nenhum alerta registrado.</p>}
      </div>
    </div>
  );
}
