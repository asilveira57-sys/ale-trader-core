import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCommitteeDashboard, resetSimulatedWallet } from "@/lib/atrader.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { RotateCcw, Wallet, TrendingUp, TrendingDown, ChevronDown, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/wallet")({
  head: () => ({ meta: [{ title: "Carteira simulada — AleTrader AI" }] }),
  component: WalletPage,
});

function WalletPage() {
  const qc = useQueryClient();
  const fetchDash = useServerFn(getCommitteeDashboard);
  const reset = useServerFn(resetSimulatedWallet);
  const [initial, setInitial] = useState(10000);

  const { data, isLoading } = useQuery({
    queryKey: ["committee"],
    queryFn: () => fetchDash({}),
    refetchInterval: 20000,
  });

  const mReset = useMutation({
    mutationFn: () => reset({ data: { initial_balance: initial } }),
    onSuccess: () => {
      toast.success("Carteira simulada reiniciada");
      qc.invalidateQueries({ queryKey: ["committee"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando…</div>;

  const w = data.wallet;
  const pnl = Number(w?.current_balance ?? 0) - Number(w?.initial_balance ?? 0);
  const pnlPct = Number(w?.initial_balance) ? (pnl / Number(w!.initial_balance)) * 100 : 0;

  // simple equity history from decisions (cumulative score impact)
  const history = [...data.decisions].reverse().slice(-40);
  const max = Math.max(...history.map((d: any) => Number(d.score)), 1);

  return (
    <div className="p-8 space-y-8 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Carteira simulada</h1>
        <p className="text-sm text-muted-foreground">Saldo de papel — nenhum valor real é movimentado.</p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider flex items-center gap-2"><Wallet className="size-3" />Saldo atual</p>
          <p className="text-2xl font-semibold mt-2 font-mono">${Number(w?.current_balance ?? 0).toFixed(2)}</p>
        </div>
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">Saldo inicial</p>
          <p className="text-2xl font-semibold mt-2 font-mono">${Number(w?.initial_balance ?? 0).toFixed(2)}</p>
        </div>
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">PnL simulado</p>
          <p className={`text-2xl font-semibold mt-2 font-mono ${pnl >= 0 ? "text-success" : "text-destructive"}`}>
            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
          </p>
          <p className={`text-xs ${pnl >= 0 ? "text-success" : "text-destructive"} flex items-center gap-1`}>
            {pnl >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            {pnlPct.toFixed(2)}%
          </p>
        </div>
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">Posições abertas</p>
          <p className="text-2xl font-semibold mt-2">{data.positions.filter((p: any) => Number(p.quantity) > 0).length}</p>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-4">Evolução (últimos scores)</h2>
        <div className="flex items-end gap-1 h-32">
          {history.map((d: any, i: number) => (
            <div
              key={d.id ?? i}
              className={`flex-1 rounded-sm ${
                d.final_decision === "buy_approved" ? "bg-success/70" :
                d.final_decision === "sell_approved" ? "bg-destructive/70" :
                d.final_decision === "blocked" ? "bg-destructive/30" :
                "bg-muted-foreground/30"
              }`}
              style={{ height: `${(Number(d.score) / max) * 100}%` }}
              title={`${d.pair} · ${Number(d.score).toFixed(0)}`}
            />
          ))}
          {!history.length && <p className="text-sm text-muted-foreground">Sem dados ainda.</p>}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-1">Extrato (débito / crédito)</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Saldo inicial ${Number(w?.initial_balance ?? 0).toFixed(2)} → saldo atual ${Number(w?.current_balance ?? 0).toFixed(2)}.
          Cada compra debita o capital alocado; o crédito acontece quando a posição é fechada (TP/SL ou venda).
        </p>
        {(() => {
          const events: { ts: string; pair: string; kind: string; delta: number; note: string }[] = [];
          for (const o of data.orders ?? []) {
            const value = Number(o.entry_price) * Number(o.quantity);
            if (o.side === "buy") {
              events.push({ ts: o.created_at, pair: o.pair, kind: "Compra (débito)", delta: -value, note: `qty ${Number(o.quantity).toFixed(6)} @ ${Number(o.entry_price).toFixed(4)}` });
              if (o.status === "closed" && o.closed_price != null) {
                const proceeds = Number(o.closed_price) * Number(o.quantity);
                events.push({ ts: o.closed_at ?? o.created_at, pair: o.pair, kind: "Fechamento compra (crédito)", delta: proceeds, note: `saída @ ${Number(o.closed_price).toFixed(4)} · PnL ${Number(o.realized_pnl ?? 0).toFixed(2)}` });
              }
            } else if (o.side === "sell" && o.status === "closed" && o.closed_price != null) {
              const proceeds = Number(o.closed_price) * Number(o.quantity);
              events.push({ ts: o.closed_at ?? o.created_at, pair: o.pair, kind: "Venda (crédito)", delta: proceeds, note: `qty ${Number(o.quantity).toFixed(6)} @ ${Number(o.closed_price).toFixed(4)} · PnL ${Number(o.realized_pnl ?? 0).toFixed(2)}` });
            } else if (o.status === "cancelled") {
              events.push({ ts: o.closed_at ?? o.created_at, pair: o.pair, kind: "Cancelada", delta: 0, note: `${o.side} ignorada` });
            }
          }
          events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
          let running = Number(w?.initial_balance ?? 0);
          const rows = events.map((e) => { running += e.delta; return { ...e, running }; }).reverse();
          if (!rows.length) return <p className="text-sm text-muted-foreground">Nenhum movimento registrado.</p>;
          return (
            <div className="text-xs divide-y divide-border font-mono">
              <div className="grid grid-cols-[140px_70px_180px_1fr_100px_110px] gap-2 pb-2 text-muted-foreground">
                <span>Data</span><span>Par</span><span>Tipo</span><span>Detalhe</span><span className="text-right">Valor</span><span className="text-right">Saldo</span>
              </div>
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[140px_70px_180px_1fr_100px_110px] gap-2 py-2 items-center">
                  <span className="text-muted-foreground">{new Date(r.ts).toLocaleString()}</span>
                  <span>{r.pair}</span>
                  <span className="text-muted-foreground">{r.kind}</span>
                  <span className="text-muted-foreground truncate">{r.note}</span>
                  <span className={`text-right ${r.delta > 0 ? "text-success" : r.delta < 0 ? "text-destructive" : ""}`}>
                    {r.delta === 0 ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(2)}`}
                  </span>
                  <span className="text-right">${r.running.toFixed(2)}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-4">Posições simuladas</h2>
        <div className="divide-y divide-border text-sm">
          {data.positions.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{p.pair}</p>
                <p className="text-xs text-muted-foreground">Preço médio: ${Number(p.avg_price).toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="font-mono">{Number(p.quantity).toFixed(6)}</p>
                <p className={`text-xs ${Number(p.unrealized_pnl) >= 0 ? "text-success" : "text-destructive"}`}>
                  PnL ${Number(p.unrealized_pnl).toFixed(2)}
                </p>
              </div>
            </div>
          ))}
          {!data.positions.length && <p className="text-sm text-muted-foreground py-4">Sem posições abertas.</p>}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-4">Reiniciar carteira</h2>
        <div className="flex items-end gap-3 max-w-md">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Novo saldo inicial</label>
            <Input type="number" min={100} value={initial} onChange={(e) => setInitial(Number(e.target.value))} />
          </div>
          <Button variant="destructive" onClick={() => mReset.mutate()} disabled={mReset.isPending}>
            <RotateCcw className="size-4 mr-2" /> Reiniciar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Apaga posições simuladas e cancela ordens em aberto.</p>
      </section>
    </div>
  );
}
