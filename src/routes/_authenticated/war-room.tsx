import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLiveState, startSession, stopSession, resumeSession, tickNow } from "@/lib/live.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Play, Square, Zap, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/war-room")({
  head: () => ({ meta: [{ title: "Sala de Guerra — AleTrader AI" }] }),
  component: WarRoom,
});

function WarRoom() {
  const qc = useQueryClient();
  const fn = useServerFn(getLiveState);
  const mStart = useServerFn(startSession);
  const mStop = useServerFn(stopSession);
  const mResume = useServerFn(resumeSession);
  const mTick = useServerFn(tickNow);
  const [mode, setMode] = useState<"reading" | "simulation" | "testnet">("simulation");
  const [autoTick, setAutoTick] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ["live-state"],
    queryFn: () => fn({}),
    refetchInterval: 10000,
  });

  const start = useMutation({
    mutationFn: () => mStart({ data: { mode, initial_balance: 10000 } }),
    onSuccess: () => { toast.success("Sessão iniciada"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: (id: string) => mStop({ data: { session_id: id } }),
    onSuccess: () => { toast.success("Sessão parada"); refetch(); },
  });
  const resume = useMutation({
    mutationFn: (id: string) => mResume({ data: { session_id: id } }),
    onSuccess: () => { toast.success("Circuit breaker resetado"); refetch(); },
  });
  const tick = useMutation({
    mutationFn: (id: string) => mTick({ data: { session_id: id } }),
    onSuccess: (r: any) => {
      if (r?.opened || r?.closed) toast.success(`Tick: ${r.opened ?? 0} aberta(s), ${r.closed ?? 0} fechada(s)`);
      qc.invalidateQueries({ queryKey: ["live-state"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  useEffect(() => {
    if (!autoTick || !data?.session || data.session.status !== "running") return;
    const id = setInterval(() => tick.mutate(data.session.id), 30000);
    return () => clearInterval(id);
  }, [autoTick, data?.session?.id, data?.session?.status]);

  if (!data) return <div className="p-8 text-muted-foreground">Carregando…</div>;
  const session = data.session;
  const cb = data.circuit_breaker;
  const open = data.open_positions;
  const closed = data.closed_recent;
  const dayPnl = closed.filter((c: any) => new Date(c.exit_time).getTime() > Date.now() - 86400000).reduce((s: number, c: any) => s + Number(c.pnl), 0);
  const weekPnl = closed.reduce((s: number, c: any) => s + Number(c.pnl), 0);

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      {cb && (
        <div className="border border-destructive/50 bg-destructive/10 rounded-lg p-3 flex items-center gap-2">
          <ShieldAlert className="size-5 text-destructive" />
          <p className="text-sm flex-1"><strong>Circuit Breaker ATIVO:</strong> {cb.message}</p>
          {session && <Button size="sm" variant="outline" onClick={() => resume.mutate(session.id)}>Resetar</Button>}
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sala de Guerra</h1>
          <p className="text-sm text-muted-foreground">Operação em tempo real · dados reais Binance · sem dinheiro real</p>
        </div>
        <Badge variant="outline" className="text-xs">MODO PAPER — NENHUM DINHEIRO REAL</Badge>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Sessão" value={session?.status ?? "—"} />
        <Stat label="Modo" value={session?.mode ?? "—"} />
        <Stat label="Saldo" value={`$${Number(session?.current_balance ?? 0).toFixed(2)}`} />
        <Stat label="PnL 24h" value={`$${dayPnl.toFixed(2)}`} accent={dayPnl >= 0 ? "pos" : "neg"} />
        <Stat label="PnL 30d" value={`$${weekPnl.toFixed(2)}`} accent={weekPnl >= 0 ? "pos" : "neg"} />
      </section>

      <div className="panel p-4 flex flex-wrap items-center gap-3">
        {!session || session.status === "stopped" ? (
          <>
            <Select value={mode} onValueChange={(v: any) => setMode(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reading">Leitura</SelectItem>
                <SelectItem value="simulation">Simulação</SelectItem>
                <SelectItem value="testnet" disabled={!data.testnet_ready}>Testnet {!data.testnet_ready && "(sem chaves)"}</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => start.mutate()} disabled={start.isPending}><Play className="size-4 mr-2" />Iniciar sessão</Button>
          </>
        ) : (
          <>
            <Button onClick={() => tick.mutate(session.id)} disabled={tick.isPending || session.status !== "running"}>
              <Zap className="size-4 mr-2" />Tick agora
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoTick} onChange={(e) => setAutoTick(e.target.checked)} />
              Auto-tick 30s
            </label>
            <Button variant="outline" onClick={() => stop.mutate(session.id)}><Square className="size-4 mr-2" />Parar</Button>
          </>
        )}
        <div className="ml-auto text-xs text-muted-foreground">Produção: <Badge variant="destructive" className="text-[10px]">BLOQUEADA</Badge></div>
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4">
          <h2 className="font-medium mb-3">Posições abertas ({open.length})</h2>
          {open.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma posição aberta.</p> : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr><th className="text-left py-1">Par</th><th>Side</th><th>Entrada</th><th>Atual</th><th>Stop</th><th>Alvo</th><th className="text-right">PnL %</th></tr>
              </thead>
              <tbody>
                {open.map((p: any) => {
                  const cur = Number(p.last_price ?? p.entry_price);
                  const dir = p.side === "buy" ? 1 : -1;
                  const pct = ((cur - Number(p.entry_price)) / Number(p.entry_price)) * 100 * dir;
                  return (
                    <tr key={p.id} className="border-b border-border/40">
                      <td className="py-1 font-medium">{p.pair}</td>
                      <td><Badge variant={p.side === "buy" ? "default" : "destructive"} className="text-[10px]">{p.side}</Badge></td>
                      <td>${Number(p.entry_price).toFixed(2)}</td>
                      <td>${cur.toFixed(2)}</td>
                      <td>${Number(p.stop_loss).toFixed(2)}</td>
                      <td>${Number(p.take_profit).toFixed(2)}</td>
                      <td className={`text-right font-mono ${pct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{pct.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel p-4">
          <h2 className="font-medium mb-3">Ativos monitorados ({data.assets.length})</h2>
          <div className="space-y-1.5">
            {data.assets.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between text-xs border-b border-border/40 pb-1.5">
                <span className="font-medium">{a.pair}</span>
                <span className="text-muted-foreground">{a.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {data.risk_events.length > 0 && (
        <section className="panel p-4">
          <h2 className="font-medium mb-2 flex items-center gap-2"><AlertTriangle className="size-4 text-amber-500" />Eventos de risco recentes</h2>
          <ul className="text-xs space-y-1">
            {data.risk_events.slice(0, 5).map((r: any) => (
              <li key={r.id} className="flex gap-3"><span className="text-muted-foreground w-32 shrink-0">{new Date(r.created_at).toLocaleString()}</span><span className="font-mono text-amber-500">{r.kind}</span><span>{r.message}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "pos" | "neg" }) {
  return (
    <div className="panel p-3 text-center">
      <p className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</p>
      <p className={`text-lg font-mono font-semibold mt-1 ${accent === "pos" ? "text-emerald-500" : accent === "neg" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}
