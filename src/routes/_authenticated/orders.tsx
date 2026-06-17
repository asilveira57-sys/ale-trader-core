import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCommitteeDashboard, closeSimulatedOrder } from "@/lib/atrader.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({ meta: [{ title: "Ordens simuladas — AleTrader AI" }] }),
  component: OrdersPage,
});

function OrdersPage() {
  const qc = useQueryClient();
  const fetchDash = useServerFn(getCommitteeDashboard);
  const close = useServerFn(closeSimulatedOrder);

  const { data, isLoading } = useQuery({
    queryKey: ["committee"],
    queryFn: () => fetchDash({}),
    refetchInterval: 20000,
  });

  const mClose = useMutation({
    mutationFn: (id: string) => close({ data: { order_id: id } }),
    onSuccess: (r: any) => {
      toast.success(`Ordem fechada. PnL ${Number(r.pnl).toFixed(2)}`);
      qc.invalidateQueries({ queryKey: ["committee"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando…</div>;

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ordens simuladas</h1>
        <p className="text-sm text-muted-foreground">Histórico completo das decisões aprovadas pelo comitê — apenas papel.</p>
      </header>

      <div className="panel p-5">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left py-2">Hora</th>
              <th className="text-left">Ativo</th>
              <th className="text-left">Lado</th>
              <th className="text-right">Qtd</th>
              <th className="text-right">Entrada</th>
              <th className="text-right">Stop</th>
              <th className="text-right">Alvo</th>
              <th className="text-right">Score</th>
              <th className="text-left pl-3">A favor/contra</th>
              <th className="text-left">Status</th>
              <th className="text-right">PnL</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.orders.map((o: any) => (
              <tr key={o.id} className="border-b border-border/40">
                <td className="py-2 font-mono text-muted-foreground">{new Date(o.created_at).toLocaleTimeString()}</td>
                <td className="font-medium">{o.pair}</td>
                <td>
                  <Badge className={o.side === "buy" ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"}>
                    {o.side.toUpperCase()}
                  </Badge>
                </td>
                <td className="text-right font-mono">{Number(o.quantity).toFixed(6)}</td>
                <td className="text-right font-mono">${Number(o.entry_price).toFixed(2)}</td>
                <td className="text-right font-mono">{o.stop_price ? `$${Number(o.stop_price).toFixed(2)}` : "—"}</td>
                <td className="text-right font-mono">{o.target_price ? `$${Number(o.target_price).toFixed(2)}` : "—"}</td>
                <td className="text-right font-mono">{Number(o.score).toFixed(0)}</td>
                <td className="pl-3 font-mono text-muted-foreground">{o.agents_favor}/{o.agents_against}</td>
                <td>
                  <Badge variant={o.status === "open" ? "default" : o.status === "closed" ? "secondary" : "outline"}>
                    {o.status}
                  </Badge>
                </td>
                <td className={`text-right font-mono ${Number(o.realized_pnl ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                  {o.realized_pnl != null ? `${Number(o.realized_pnl) >= 0 ? "+" : ""}$${Number(o.realized_pnl).toFixed(2)}` : "—"}
                </td>
                <td className="text-right">
                  {o.status === "open" && (
                    <Button size="sm" variant="outline" onClick={() => mClose.mutate(o.id)} disabled={mClose.isPending}>
                      Fechar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!data.orders.length && (
              <tr><td colSpan={12} className="py-6 text-center text-muted-foreground">Nenhuma ordem simulada ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
