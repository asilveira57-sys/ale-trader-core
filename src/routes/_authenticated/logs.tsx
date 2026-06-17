import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listLogs } from "@/lib/atrader.functions";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "Logs — AleTrader AI" }] }),
  component: LogsPage,
});

const sevColor = (s: string) =>
  s === "critical" || s === "error" ? "destructive" : s === "warning" ? "secondary" : "outline";

function LogsPage() {
  const fn = useServerFn(listLogs);
  const { data: logs = [] } = useQuery({ queryKey: ["logs"], queryFn: () => fn({}), refetchInterval: 10000 });
  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header><h1 className="text-2xl font-semibold tracking-tight">Logs do sistema</h1>
        <p className="text-sm text-muted-foreground">Toda chamada à Binance, eventos de coleta, segurança e sistema.</p>
      </header>
      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Quando</th>
              <th className="text-left p-3">Tipo</th>
              <th className="text-left p-3">Origem</th>
              <th className="text-left p-3">Mensagem</th>
              <th className="text-left p-3">Severidade</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l: any) => (
              <tr key={l.id} className="border-t border-border">
                <td className="p-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                <td className="p-3">{l.event_type}</td>
                <td className="p-3 text-muted-foreground">{l.source}</td>
                <td className="p-3">{l.message}</td>
                <td className="p-3"><Badge variant={sevColor(l.severity) as any}>{l.severity}</Badge></td>
              </tr>
            ))}
            {!logs.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Sem logs ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
