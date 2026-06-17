import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getGovernanceState, listAutomatedTrades, triggerAutoCycleFn } from "@/lib/auto-trading.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Play } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/auto-dashboard")({
  head: () => ({ meta: [{ title: "Painel Automático | AleTrader AI" }] }),
  component: AutoDashboard,
});

function AutoDashboard() {
  const fetchState = useServerFn(getGovernanceState);
  const fetchTrades = useServerFn(listAutomatedTrades);
  const trigger = useServerFn(triggerAutoCycleFn);
  const { data: state } = useQuery({ queryKey: ["governance"], queryFn: () => fetchState(), refetchInterval: 30_000 });
  const { data: trades } = useQuery({ queryKey: ["auto-trades"], queryFn: () => fetchTrades(), refetchInterval: 30_000 });
  const [sessionId, setSessionId] = useState("");

  const tick = useMutation({
    mutationFn: () => trigger({ data: { session_id: sessionId } }),
    onSuccess: (r: any) => toast.success(`Ciclo: ${r.cycle.status} • Monitorado: ${r.mon.closed} fechadas`),
    onError: (e: any) => toast.error(e.message),
  });

  const open = (trades ?? []).filter((t: any) => t.status === "open");
  const closed = (trades ?? []).filter((t: any) => t.status === "closed");
  const pnl = closed.reduce((s: number, t: any) => s + Number(t.pnl ?? 0), 0);

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Bot className="size-7 text-emerald-400" /> Painel Automático</h1>
          <p className="text-muted-foreground">Execução automática controlada — Fase 7</p>
        </div>
        <div className="flex items-center gap-2">
          <Input className="w-72" placeholder="session UUID p/ tick manual" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          <Button onClick={() => tick.mutate()} disabled={!sessionId}><Play className="size-4 mr-1" />Tick</Button>
        </div>
      </header>

      <div className="grid md:grid-cols-4 gap-4">
        <Card><CardHeader><CardTitle className="text-sm">Automação</CardTitle></CardHeader><CardContent><Badge variant={state?.gov?.automation_enabled ? "default" : "secondary"}>{state?.gov?.automation_enabled ? "ON" : "OFF"}</Badge></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Nível</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">N{state?.gov?.automation_level}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Confiança</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{state?.confidence?.score ?? "—"}/100</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">P&L Auto</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{pnl.toFixed(2)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Posições automáticas abertas ({open.length})</CardTitle></CardHeader>
        <CardContent>
          {open.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma posição aberta.</p> :
            <div className="space-y-2">
              {open.map((t: any) => (
                <div key={t.id} className="flex justify-between text-sm border-b border-border py-2">
                  <span>{t.side.toUpperCase()} {Number(t.qty).toFixed(6)} @ {Number(t.entry_price).toFixed(2)}</span>
                  <span className="text-muted-foreground">SL {Number(t.stop_loss).toFixed(2)} • TP {Number(t.take_profit).toFixed(2)}</span>
                </div>
              ))}
            </div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Histórico ({closed.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm max-h-96 overflow-auto">
            {closed.slice(0, 50).map((t: any) => (
              <div key={t.id} className="flex justify-between border-b border-border py-1">
                <span>{t.side.toUpperCase()} • {t.exit_reason}</span>
                <span className={Number(t.pnl) >= 0 ? "text-emerald-400" : "text-red-400"}>{Number(t.pnl).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
