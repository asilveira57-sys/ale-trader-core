import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRealDashboard, pauseRealRobot, resumeRealRobot, resetRealBreaker, closeRealPositionManual } from "@/lib/real-trading.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlertTriangle, ShieldAlert, Pause, Play } from "lucide-react";

export const Route = createFileRoute("/_authenticated/real-dashboard")({
  head: () => ({ meta: [{ title: "Painel Real — AleTrader AI" }] }),
  component: RealDashboardPage,
});

function RealDashboardPage() {
  const qc = useQueryClient();
  const fn = useServerFn(getRealDashboard);
  const pause = useServerFn(pauseRealRobot);
  const resume = useServerFn(resumeRealRobot);
  const reset = useServerFn(resetRealBreaker);
  const closeFn = useServerFn(closeRealPositionManual);
  const { data, isLoading } = useQuery({ queryKey: ["real-dashboard"], queryFn: () => fn({}), refetchInterval: 15000 });

  const mPause = useMutation({ mutationFn: () => pause({}), onSuccess: () => { toast.success("Pausado"); qc.invalidateQueries({ queryKey: ["real-dashboard"] }); } });
  const mResume = useMutation({ mutationFn: () => resume({}), onSuccess: () => { toast.success("Retomado"); qc.invalidateQueries({ queryKey: ["real-dashboard"] }); } });
  const mReset = useMutation({ mutationFn: () => reset({}), onSuccess: () => { toast.success("Breaker resetado"); qc.invalidateQueries({ queryKey: ["real-dashboard"] }); } });
  const mClose = useMutation({
    mutationFn: (id: string) => closeFn({ data: { position_id: id, confirm: "CONFIRMO" as const } }),
    onSuccess: () => { toast.success("Posição fechada"); qc.invalidateQueries({ queryKey: ["real-dashboard"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando painel real…</div>;
  const paused = data.settings?.real_robot_paused;

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldAlert className="size-6 text-orange-500" /> Painel Real
          </h1>
          <p className="text-sm text-muted-foreground">Operação real assistida — aprovação manual obrigatória.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/approval-desk" className="text-sm underline">Mesa de Aprovação ({data.pending_requests.length})</Link>
          {paused
            ? <Button variant="outline" onClick={() => mResume.mutate()}><Play className="size-4 mr-1" /> Retomar</Button>
            : <Button variant="destructive" onClick={() => mPause.mutate()}><Pause className="size-4 mr-1" /> Pausar operações reais</Button>}
        </div>
      </header>

      {data.circuit_breaker && (
        <div className="panel p-4 border-red-500/40 bg-red-500/10 text-red-200 flex items-center justify-between">
          <span className="flex items-center gap-2"><AlertTriangle className="size-5" /> Circuit Breaker REAL: {data.circuit_breaker.message}</span>
          <Button size="sm" variant="outline" onClick={() => mReset.mutate()}>Resetar</Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="P&L hoje" value={`$${data.pnl_day.toFixed(2)}`} pos={data.pnl_day >= 0} />
        <Stat label="P&L semana" value={`$${data.pnl_week.toFixed(2)}`} pos={data.pnl_week >= 0} />
        <Stat label="P&L mês" value={`$${data.pnl_month.toFixed(2)}`} pos={data.pnl_month >= 0} />
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-2">Posições reais abertas ({data.open_positions.length})</h2>
        <div className="panel divide-y divide-border">
          {data.open_positions.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhuma posição real aberta.</p>}
          {data.open_positions.map((p: any) => (
            <div key={p.id} className="p-4 flex justify-between items-center">
              <div>
                <div className="font-medium">{p.pair} <span className={p.side === "buy" ? "text-emerald-400" : "text-red-400"}>{p.side.toUpperCase()}</span></div>
                <div className="text-xs text-muted-foreground">Entrada {Number(p.entry_price).toFixed(2)} • Stop {Number(p.stop_loss).toFixed(2)} • Alvo {Number(p.take_profit).toFixed(2)}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => { if (confirm("Fechar posição REAL agora?")) mClose.mutate(p.id); }}>Fechar</Button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-4">
          <h3 className="text-sm font-medium mb-2">Alertas críticos</h3>
          {data.alerts.length === 0 && <p className="text-xs text-muted-foreground">Sem alertas.</p>}
          <ul className="space-y-1 text-xs">{data.alerts.map((a: any) => <li key={a.id}>{a.message}</li>)}</ul>
        </div>
        <div className="panel p-4">
          <h3 className="text-sm font-medium mb-2">Últimas auditorias</h3>
          <ul className="space-y-1 text-xs">
            {data.recent_audits.map((r: any) => (
              <li key={r.id}><Link to="/audit/$reportId" params={{ reportId: r.id }} className="hover:underline">{r.phase.toUpperCase()} • {new Date(r.created_at).toLocaleString("pt-BR")}</Link></li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, pos }: { label: string; value: string; pos: boolean }) {
  return (
    <div className="panel p-5">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${pos ? "text-emerald-400" : "text-red-400"}`}>{value}</div>
    </div>
  );
}
