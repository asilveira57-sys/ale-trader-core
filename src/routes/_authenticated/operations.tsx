import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLiveState, closePositionManual } from "@/lib/live.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/operations")({
  head: () => ({ meta: [{ title: "Centro de Operações — AleTrader AI" }] }),
  component: OperationsCenter,
});

function OperationsCenter() {
  const qc = useQueryClient();
  const fn = useServerFn(getLiveState);
  const closeFn = useServerFn(closePositionManual);
  const { data } = useQuery({ queryKey: ["live-state"], queryFn: () => fn({}), refetchInterval: 10000 });
  const close = useMutation({
    mutationFn: (id: string) => closeFn({ data: { position_id: id } }),
    onSuccess: (r: any) => { toast.success(`Fechado · PnL $${r.pnl.toFixed(2)}`); qc.invalidateQueries({ queryKey: ["live-state"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!data) return <div className="p-8 text-muted-foreground">Carregando…</div>;

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Centro de Operações</h1>
        <p className="text-sm text-muted-foreground">Acompanhamento detalhado de posições paper trading</p>
      </header>

      <section className="panel p-5">
        <h2 className="font-medium mb-3">Posições abertas ({data.open_positions.length})</h2>
        {data.open_positions.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma.</p> : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground border-b border-border">
              <tr><th className="text-left py-2">Par</th><th>Side</th><th>Entrada</th><th>Qtd</th><th>Atual</th><th>Stop</th><th>Alvo</th><th className="text-right">PnL parcial</th><th></th></tr>
            </thead>
            <tbody>
              {data.open_positions.map((p: any) => {
                const cur = Number(p.last_price ?? p.entry_price);
                const dir = p.side === "buy" ? 1 : -1;
                const pnl = (cur - Number(p.entry_price)) * Number(p.qty) * dir;
                return (
                  <tr key={p.id} className="border-b border-border/40">
                    <td className="py-2 font-medium">{p.pair}</td>
                    <td><Badge variant={p.side === "buy" ? "default" : "destructive"}>{p.side}</Badge></td>
                    <td>${Number(p.entry_price).toFixed(2)}</td>
                    <td className="font-mono">{Number(p.qty).toFixed(5)}</td>
                    <td>${cur.toFixed(2)}</td>
                    <td>${Number(p.stop_loss).toFixed(2)}</td>
                    <td>${Number(p.take_profit).toFixed(2)}</td>
                    <td className={`text-right font-mono ${pnl >= 0 ? "text-emerald-500" : "text-destructive"}`}>${pnl.toFixed(2)}</td>
                    <td className="text-right"><Button size="sm" variant="outline" disabled={close.isPending} onClick={() => close.mutate(p.id)}>Fechar</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="font-medium mb-3">Últimas posições fechadas</h2>
        {data.closed_recent.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma.</p> : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground border-b border-border">
              <tr><th className="text-left py-2">Par</th><th>Side</th><th>Entrada</th><th>Saída</th><th>Motivo</th><th className="text-right">PnL</th><th className="text-right">PnL %</th></tr>
            </thead>
            <tbody>
              {data.closed_recent.map((p: any) => (
                <tr key={p.id} className="border-b border-border/40">
                  <td className="py-2 font-medium">{p.pair}</td>
                  <td>{p.side}</td>
                  <td>${Number(p.entry_price).toFixed(2)}</td>
                  <td>${Number(p.exit_price ?? 0).toFixed(2)}</td>
                  <td><Badge variant="secondary" className="text-[10px]">{p.exit_reason}</Badge></td>
                  <td className={`text-right font-mono ${Number(p.pnl) >= 0 ? "text-emerald-500" : "text-destructive"}`}>${Number(p.pnl).toFixed(2)}</td>
                  <td className={`text-right font-mono ${Number(p.pnl_pct) >= 0 ? "text-emerald-500" : "text-destructive"}`}>{Number(p.pnl_pct).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
