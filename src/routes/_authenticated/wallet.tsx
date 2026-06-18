import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCommitteeDashboard, resetSimulatedWallet, liquidateSimulatedWallet } from "@/lib/atrader.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Wallet, TrendingUp, TrendingDown, ChevronDown, ChevronRight, FileSpreadsheet, FileText, AlertTriangle, Info, DollarSign } from "lucide-react";

export const Route = createFileRoute("/_authenticated/wallet")({
  head: () => ({ meta: [{ title: "Carteira simulada — AleTrader AI" }] }),
  component: WalletPage,
});

function WalletPage() {
  const qc = useQueryClient();
  const fetchDash = useServerFn(getCommitteeDashboard);
  const reset = useServerFn(resetSimulatedWallet);
  const liquidate = useServerFn(liquidateSimulatedWallet);
  const [initial, setInitial] = useState(10000);
  const [walletOpen, setWalletOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const PAGE_SIZE = 30;

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

  const mLiquidate = useMutation({
    mutationFn: () => liquidate({ data: { slippage_pct: 0.5 } }),
    onSuccess: (r: any) => {
      toast.success(
        `Liquidação concluída: ${r.sold} vendidas, ${r.cancelled} canceladas · caixa +$${Number(r.proceeds).toFixed(2)} · PnL ${Number(r.pnl) >= 0 ? "+" : ""}$${Number(r.pnl).toFixed(2)}`,
      );
      qc.invalidateQueries({ queryKey: ["committee"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando…</div>;

  const w = data.wallet;
  const initialBalance = Number(w?.initial_balance ?? 0);
  const cash = Number(w?.current_balance ?? 0);

  // Composição: ordens de compra abertas → capital alocado por par
  const openBuys = (data.orders ?? []).filter((o: any) => o.status === "open" && o.side === "buy");
  const byPair = new Map<string, { qty: number; cost: number }>();
  for (const o of openBuys) {
    const qty = Number(o.quantity);
    const cost = qty * Number(o.entry_price);
    const cur = byPair.get(o.pair) ?? { qty: 0, cost: 0 };
    cur.qty += qty; cur.cost += cost;
    byPair.set(o.pair, cur);
  }
  const cryptos = [...byPair.entries()].map(([pair, v]) => {
    const avg = v.qty > 0 ? v.cost / v.qty : 0;
    const posRow = (data.positions ?? []).find((p: any) => p.pair === pair);
    const unreal = posRow ? Number(posRow.unrealized_pnl ?? 0) : 0;
    return { pair, quantity: v.qty, avg_price: avg, value: v.cost, unrealized_pnl: unreal };
  });

  const capitalAlocado = cryptos.reduce((s, p) => s + p.value, 0);
  const unrealizedPnl = cryptos.reduce((s, p) => s + p.unrealized_pnl, 0);
  const openPositionsValue = capitalAlocado + unrealizedPnl; // valor de mercado estimado
  const equity = cash + openPositionsValue;

  // simple equity history from decisions
  const history = [...data.decisions].reverse().slice(-40);
  const max = Math.max(...history.map((d: any) => Number(d.score)), 1);

  // Operações encerradas (auditoria) — apenas compras fechadas
  const closedOps = (data.orders ?? [])
    .filter((o: any) => o.side === "buy" && o.status === "closed" && o.closed_price != null)
    .map((o: any) => {
      const qty = Number(o.quantity);
      const entry = Number(o.entry_price);
      const exit = Number(o.closed_price);
      const pnl = Number(o.realized_pnl ?? (exit - entry) * qty);
      const invested = entry * qty;
      const roi = invested > 0 ? (pnl / invested) * 100 : 0;
      return {
        id: o.id,
        pair: o.pair,
        opened_at: o.created_at,
        closed_at: o.closed_at ?? o.created_at,
        entry,
        exit,
        qty,
        invested,
        proceeds: exit * qty,
        fees: Number(o.fees ?? 0),
        pnl,
        roi,
      };
    })
    .sort((a: any, b: any) => new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime());

  const realizedPnl = closedOps.reduce((s: number, o: any) => s + o.pnl, 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const roiPct = initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0;

  // Consistência: equity esperada = inicial + PnL realizado + PnL não realizado
  const expectedEquity = initialBalance + realizedPnl + unrealizedPnl;
  const equityDiff = equity - expectedEquity;
  const inconsistent = Math.abs(equityDiff) > 1; // tolera 1 USD de arredondamento

  return (
    <div className="p-8 space-y-8 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Carteira simulada</h1>
        <p className="text-sm text-muted-foreground">Saldo de papel — nenhum valor real é movimentado.</p>
      </header>

      {/* Painel principal — separa caixa, posição, equity, PnL */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => setWalletOpen((v) => !v)}
          className="panel p-5 text-left hover:border-primary/50 transition cursor-pointer"
          aria-expanded={walletOpen}
        >
          <p className="text-xs uppercase text-muted-foreground tracking-wider flex items-center gap-2">
            <Wallet className="size-3" />Saldo disponível
            {walletOpen ? <ChevronDown className="size-3 ml-auto" /> : <ChevronRight className="size-3 ml-auto" />}
          </p>
          <p className="text-2xl font-semibold mt-2 font-mono">${cash.toFixed(2)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">caixa em USD · clique para composição</p>
        </button>
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">Capital alocado</p>
          <p className="text-2xl font-semibold mt-2 font-mono">${capitalAlocado.toFixed(2)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{cryptos.length} posição(ões) aberta(s)</p>
        </div>
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">Equity (patrimônio)</p>
          <p className="text-2xl font-semibold mt-2 font-mono">${equity.toFixed(2)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">caixa + posições a mercado</p>
        </div>
        <div className="panel p-5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">ROI</p>
          <p className={`text-2xl font-semibold mt-2 font-mono ${totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
            {totalPnl >= 0 ? "+" : ""}{roiPct.toFixed(2)}%
          </p>
          <p className={`text-[10px] flex items-center gap-1 mt-1 ${totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
            {totalPnl >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            PnL total {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </p>
        </div>
      </section>

      {/* PnL detalhado */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="panel p-4">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Saldo inicial</p>
          <p className="text-lg font-mono mt-1">${initialBalance.toFixed(2)}</p>
        </div>
        <div className="panel p-4">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider">PnL realizado</p>
          <p className={`text-lg font-mono mt-1 ${realizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
            {realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}
          </p>
          <p className="text-[10px] text-muted-foreground">{closedOps.length} operação(ões) encerrada(s)</p>
        </div>
        <div className="panel p-4">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider">PnL não realizado</p>
          <p className={`text-lg font-mono mt-1 ${unrealizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
            {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
          </p>
          <p className="text-[10px] text-muted-foreground">posições abertas a mercado</p>
        </div>
        <div className="panel p-4">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider">PnL total</p>
          <p className={`text-lg font-mono mt-1 ${totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </p>
          <p className="text-[10px] text-muted-foreground">realizado + não realizado</p>
        </div>
      </section>

      {inconsistent && (
        <div className="panel p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-semibold">Divergência detectada entre saldo, posições e PnL.</p>
              <p className="text-destructive/80 mt-1">
                Equity calculada ${equity.toFixed(2)} vs. esperada ${expectedEquity.toFixed(2)} (diferença {equityDiff >= 0 ? "+" : ""}${equityDiff.toFixed(2)}).
                Verifique operações abertas, taxas ou eventos sem vínculo.
              </p>
            </div>
          </div>
        </div>
      )}

      {walletOpen && (
        <section className="panel p-5">
          <h2 className="text-sm font-semibold mb-3">Composição da carteira</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="rounded-md border border-border p-3">
              <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Caixa (USD)</p>
              <p className="text-lg font-mono mt-1">${cash.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground">{equity ? ((cash / equity) * 100).toFixed(1) : "0"}% da equity</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Posições (a mercado)</p>
              <p className="text-lg font-mono mt-1">${openPositionsValue.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground">capital ${capitalAlocado.toFixed(2)} · PnL {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Equity total</p>
              <p className="text-lg font-mono mt-1">${equity.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground">{cryptos.length} cripto(s) em carteira</p>
            </div>
          </div>
          {cryptos.length > 0 ? (
            <div className="text-xs font-mono divide-y divide-border">
              <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr] gap-2 pb-2 text-muted-foreground">
                <span>Par</span><span className="text-right">Quantidade</span><span className="text-right">Preço médio</span><span className="text-right">Capital</span><span className="text-right">PnL não realizado</span>
              </div>
              {cryptos.map((p) => (
                <div key={p.pair} className="grid grid-cols-[80px_1fr_1fr_1fr_1fr] gap-2 py-2">
                  <span>{p.pair}</span>
                  <span className="text-right">{p.quantity.toFixed(8)}</span>
                  <span className="text-right">${p.avg_price.toFixed(4)}</span>
                  <span className="text-right">${p.value.toFixed(2)}</span>
                  <span className={`text-right ${p.unrealized_pnl >= 0 ? "text-success" : "text-destructive"}`}>
                    {p.unrealized_pnl >= 0 ? "+" : ""}${p.unrealized_pnl.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sem cripto em carteira no momento — 100% em caixa.</p>
          )}
        </section>
      )}

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

      {/* Auditoria de operações encerradas */}
      <section className="panel p-5">
        <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-semibold">Auditoria de operações encerradas</h2>
            <p className="text-xs text-muted-foreground mt-1">Cada linha é uma compra que já foi fechada — entrada, saída, PnL realizado e ROI.</p>
          </div>
          <div className="text-xs text-muted-foreground">
            {closedOps.length} encerrada(s) · {openBuys.length} aberta(s)
          </div>
        </div>
        {!closedOps.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma operação encerrada ainda.</p>
        ) : (() => {
          const totalPages = Math.max(1, Math.ceil(closedOps.length / PAGE_SIZE));
          const curPage = Math.min(auditPage, totalPages);
          const rows = closedOps.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
          return (
            <>
              <div className="text-xs font-mono divide-y divide-border overflow-x-auto">
                <div className="grid grid-cols-[70px_140px_140px_70px_80px_80px_90px_90px_70px] gap-2 pb-2 text-muted-foreground min-w-[900px]">
                  <span>Ativo</span><span>Abertura</span><span>Fechamento</span>
                  <span className="text-right">Qtd</span>
                  <span className="text-right">Entrada</span><span className="text-right">Saída</span>
                  <span className="text-right">Investido</span><span className="text-right">PnL</span><span className="text-right">ROI</span>
                </div>
                {rows.map((o: any) => (
                  <div key={o.id} className="grid grid-cols-[70px_140px_140px_70px_80px_80px_90px_90px_70px] gap-2 py-2 min-w-[900px]">
                    <span>{o.pair}</span>
                    <span className="text-muted-foreground">{new Date(o.opened_at).toLocaleString()}</span>
                    <span className="text-muted-foreground">{new Date(o.closed_at).toLocaleString()}</span>
                    <span className="text-right">{o.qty.toFixed(6)}</span>
                    <span className="text-right">${o.entry.toFixed(4)}</span>
                    <span className="text-right">${o.exit.toFixed(4)}</span>
                    <span className="text-right">${o.invested.toFixed(2)}</span>
                    <span className={`text-right ${o.pnl >= 0 ? "text-success" : "text-destructive"}`}>
                      {o.pnl >= 0 ? "+" : ""}${o.pnl.toFixed(2)}
                    </span>
                    <span className={`text-right ${o.roi >= 0 ? "text-success" : "text-destructive"}`}>
                      {o.roi >= 0 ? "+" : ""}{o.roi.toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                <span>página {curPage} de {totalPages}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={curPage <= 1} onClick={() => setAuditPage(curPage - 1)}>Anterior</Button>
                  <Button size="sm" variant="outline" disabled={curPage >= totalPages} onClick={() => setAuditPage(curPage + 1)}>Próxima</Button>
                </div>
              </div>
            </>
          );
        })()}
      </section>

      {/* Extrato Patrimonial da Carteira */}
      {(() => {
        type Mov = {
          ts: string; pair: string; kind: string; side: string;
          qty: number; price: number;
          debito: number; credito: number;
          pnl_realizado: number;
        };
        const movs: Mov[] = [];
        for (const o of data.orders ?? []) {
          const qty = Number(o.quantity);
          const entryPrice = Number(o.entry_price);
          const entryValue = entryPrice * qty;
          if (o.side === "buy") {
            movs.push({
              ts: o.created_at, pair: o.pair, kind: "Compra", side: "buy",
              qty, price: entryPrice,
              debito: entryValue, credito: 0, pnl_realizado: 0,
            });
            if (o.status === "closed" && o.closed_price != null) {
              const exitPrice = Number(o.closed_price);
              const proceeds = exitPrice * qty;
              const pnl = Number(o.realized_pnl ?? (exitPrice - entryPrice) * qty);
              movs.push({
                ts: o.closed_at ?? o.created_at, pair: o.pair, kind: "Venda (fechamento)", side: "sell",
                qty, price: exitPrice,
                debito: 0, credito: proceeds, pnl_realizado: pnl,
              });
            }
          } else if (o.side === "sell" && o.status === "closed" && o.closed_price != null) {
            const exitPrice = Number(o.closed_price);
            movs.push({
              ts: o.closed_at ?? o.created_at, pair: o.pair, kind: "Venda", side: "sell",
              qty, price: exitPrice,
              debito: 0, credito: exitPrice * qty, pnl_realizado: Number(o.realized_pnl ?? 0),
            });
          }
        }
        movs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

        const currentPriceByPair = new Map<string, number>();
        for (const c of cryptos) {
          const px = c.quantity > 0 ? (c.value + c.unrealized_pnl) / c.quantity : c.avg_price;
          currentPriceByPair.set(c.pair, px);
        }
        const priceFor = (pair: string, fallback: number) => currentPriceByPair.get(pair) ?? fallback;

        let caixa = initialBalance;
        let pnlRealAcum = 0;
        const holdings = new Map<string, { qty: number; cost: number }>();
        const ledger = movs.map((m) => {
          caixa = caixa - m.debito + m.credito;
          pnlRealAcum += m.pnl_realizado;
          const h = holdings.get(m.pair) ?? { qty: 0, cost: 0 };
          if (m.side === "buy") {
            h.qty += m.qty; h.cost += m.qty * m.price;
          } else {
            const avg = h.qty > 0 ? h.cost / h.qty : m.price;
            h.cost = Math.max(0, h.cost - m.qty * avg);
            h.qty = Math.max(0, h.qty - m.qty);
          }
          holdings.set(m.pair, h);

          let valorPosicoes = 0;
          let custoPosicoes = 0;
          for (const [p, hh] of holdings.entries()) {
            if (hh.qty > 0) {
              valorPosicoes += hh.qty * priceFor(p, hh.cost / hh.qty);
              custoPosicoes += hh.cost;
            }
          }
          const pnlUnrealAcum = valorPosicoes - custoPosicoes;
          const patrimonio = caixa + valorPosicoes;
          const qtyPair = h.qty;
          const precoAtualPair = qtyPair > 0 ? priceFor(m.pair, m.price) : 0;
          const valorPosicaoPair = qtyPair * precoAtualPair;

          return {
            ...m,
            caixa_apos: caixa,
            qty_carteira_apos: qtyPair,
            preco_atual: precoAtualPair,
            valor_posicao: valorPosicaoPair,
            pnl_realizado_acum: pnlRealAcum,
            pnl_nao_realizado_acum: pnlUnrealAcum,
            patrimonio_apos: patrimonio,
          };
        });

        const allRowsAsc = ledger;
        const allRows = [...ledger].reverse();

        const volumeComprado = movs.reduce((s, m) => s + m.debito, 0);
        const volumeVendido = movs.reduce((s, m) => s + m.credito, 0);
        const variacaoPct = initialBalance > 0 ? ((equity - initialBalance) / initialBalance) * 100 : 0;

        const exportXLSX = async () => {
          const XLSX = await import("xlsx");
          const rows = allRowsAsc.map((r) => ({
            Data: new Date(r.ts).toLocaleString(),
            Ativo: r.pair,
            "Tipo de movimento": r.kind,
            Quantidade: Number(r.qty.toFixed(8)),
            "Preço unitário": Number(r.price.toFixed(6)),
            "Débito USDT": Number(r.debito.toFixed(2)),
            "Crédito USDT": Number(r.credito.toFixed(2)),
            "Saldo caixa após": Number(r.caixa_apos.toFixed(2)),
            "Qtd em carteira após": Number(r.qty_carteira_apos.toFixed(8)),
            "Preço atual": Number(r.preco_atual.toFixed(6)),
            "Valor atual da posição": Number(r.valor_posicao.toFixed(2)),
            "PnL realizado (acum.)": Number(r.pnl_realizado_acum.toFixed(2)),
            "PnL não realizado (acum.)": Number(r.pnl_nao_realizado_acum.toFixed(2)),
            "Patrimônio total após": Number(r.patrimonio_apos.toFixed(2)),
          }));
          const summary = [
            { Métrica: "Saldo inicial (USDT)", Valor: initialBalance },
            { Métrica: "Caixa atual (USDT)", Valor: Number(cash.toFixed(2)) },
            { Métrica: "Valor atual das moedas abertas (USDT)", Valor: Number(openPositionsValue.toFixed(2)) },
            { Métrica: "Patrimônio total atual (USDT)", Valor: Number(equity.toFixed(2)) },
            { Métrica: "PnL realizado", Valor: Number(realizedPnl.toFixed(2)) },
            { Métrica: "PnL não realizado", Valor: Number(unrealizedPnl.toFixed(2)) },
            { Métrica: "Resultado total da carteira", Valor: Number(totalPnl.toFixed(2)) },
            { Métrica: "Variação percentual da carteira (%)", Valor: Number(variacaoPct.toFixed(2)) },
            { Métrica: "Operações abertas", Valor: openBuys.length },
            { Métrica: "Operações encerradas", Valor: closedOps.length },
          ];
          const audit = closedOps.map((o: any) => ({
            Ativo: o.pair,
            Abertura: new Date(o.opened_at).toLocaleString(),
            Fechamento: new Date(o.closed_at).toLocaleString(),
            Quantidade: o.qty,
            "Preço entrada": o.entry,
            "Preço saída": o.exit,
            "Investido (USDT)": Number(o.invested.toFixed(2)),
            "Retornado (USDT)": Number(o.proceeds.toFixed(2)),
            "PnL realizado": Number(o.pnl.toFixed(2)),
            "ROI (%)": Number(o.roi.toFixed(2)),
          }));
          const volumeAudit = [
            { Métrica: "Volume comprado (bruto)", Valor: Number(volumeComprado.toFixed(2)) },
            { Métrica: "Volume vendido (bruto)", Valor: Number(volumeVendido.toFixed(2)) },
            { Métrica: "Volume total movimentado", Valor: Number((volumeComprado + volumeVendido).toFixed(2)) },
          ];
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Resumo Patrimonial");
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Extrato Patrimonial");
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(audit), "Operacoes Encerradas");
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(volumeAudit), "Volume (auditoria)");
          XLSX.writeFile(wb, `extrato-patrimonial-${new Date().toISOString().slice(0, 10)}.xlsx`);
        };

        const exportPDF = async () => {
          const { jsPDF } = await import("jspdf");
          const autoTable = (await import("jspdf-autotable")).default;
          const doc = new jsPDF({ orientation: "landscape" });
          doc.setFontSize(14);
          doc.text("Extrato Patrimonial da Carteira", 14, 14);
          doc.setFontSize(9);
          doc.text(
            [
              `Saldo inicial: $${initialBalance.toFixed(2)}    Caixa atual: $${cash.toFixed(2)}    Valor moedas abertas: $${openPositionsValue.toFixed(2)}    Patrimônio total: $${equity.toFixed(2)}`,
              `PnL realizado: $${realizedPnl.toFixed(2)}    PnL não realizado: $${unrealizedPnl.toFixed(2)}    Resultado total: $${totalPnl.toFixed(2)}    Variação: ${variacaoPct.toFixed(2)}%`,
              `Ops abertas: ${openBuys.length}    Ops encerradas: ${closedOps.length}    Gerado em ${new Date().toLocaleString()}`,
            ],
            14,
            22,
          );
          autoTable(doc, {
            startY: 42,
            head: [["Data", "Ativo", "Movimento", "Qtd", "Preço", "Débito", "Crédito", "Caixa após", "Qtd cart.", "Preço atual", "Valor pos.", "PnL real.", "PnL n/real.", "Patrim."]],
            body: allRowsAsc.map((r) => [
              new Date(r.ts).toLocaleString(),
              r.pair,
              r.kind,
              r.qty.toFixed(6),
              r.price.toFixed(4),
              r.debito > 0 ? `-${r.debito.toFixed(2)}` : "—",
              r.credito > 0 ? `+${r.credito.toFixed(2)}` : "—",
              r.caixa_apos.toFixed(2),
              r.qty_carteira_apos.toFixed(6),
              r.preco_atual > 0 ? r.preco_atual.toFixed(4) : "—",
              r.valor_posicao.toFixed(2),
              `${r.pnl_realizado_acum >= 0 ? "+" : ""}${r.pnl_realizado_acum.toFixed(2)}`,
              `${r.pnl_nao_realizado_acum >= 0 ? "+" : ""}${r.pnl_nao_realizado_acum.toFixed(2)}`,
              r.patrimonio_apos.toFixed(2),
            ]),
            styles: { fontSize: 6 },
            headStyles: { fillColor: [40, 40, 40] },
          });
          const finalY = (doc as any).lastAutoTable?.finalY ?? 200;
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text(
            `Volume bruto — comprado: $${volumeComprado.toFixed(2)} · vendido: $${volumeVendido.toFixed(2)} · total: $${(volumeComprado + volumeVendido).toFixed(2)} (auditoria; não confundir com lucro)`,
            14,
            finalY + 8,
          );
          doc.save(`extrato-patrimonial-${new Date().toISOString().slice(0, 10)}.pdf`);
        };

        return (
          <section className="panel p-5">
            <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold">Extrato Patrimonial da Carteira</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Livro-razão de débitos e créditos por operação — reconstrói a carteira do saldo inicial até o patrimônio final.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportXLSX} disabled={!allRowsAsc.length}>
                  <FileSpreadsheet className="size-4 mr-1" />XLSX
                </Button>
                <Button size="sm" variant="outline" onClick={exportPDF} disabled={!allRowsAsc.length}>
                  <FileText className="size-4 mr-1" />PDF
                </Button>
              </div>
            </div>

            <div className="mt-3 mb-4 flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-md p-2">
              <Info className="size-3.5 mt-0.5 shrink-0" />
              <span>Compra debita caixa e credita ativo. Venda credita caixa e debita ativo (gerando PnL realizado se fechar uma compra). Patrimônio = caixa + Σ (qtd × preço atual).</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 my-4 text-xs">
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">Saldo inicial</p>
                <p className="font-mono">${initialBalance.toFixed(2)}</p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">Caixa atual (USDT)</p>
                <p className="font-mono">${cash.toFixed(2)}</p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">Valor moedas abertas</p>
                <p className="font-mono">${openPositionsValue.toFixed(2)}</p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">Patrimônio total</p>
                <p className="font-mono">${equity.toFixed(2)}</p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">PnL realizado</p>
                <p className={`font-mono ${realizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                  {realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}
                </p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">PnL não realizado</p>
                <p className={`font-mono ${unrealizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                  {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
                </p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">Resultado total</p>
                <p className={`font-mono ${totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
                  {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                </p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">Variação da carteira</p>
                <p className={`font-mono ${variacaoPct >= 0 ? "text-success" : "text-destructive"}`}>
                  {variacaoPct >= 0 ? "+" : ""}{variacaoPct.toFixed(2)}%
                </p>
              </div>
            </div>

            {!allRows.length ? (
              <p className="text-sm text-muted-foreground">Nenhum movimento registrado.</p>
            ) : (() => {
              const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
              const curPage = Math.min(page, totalPages);
              const rows = allRows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
              return (
                <>
                  <div className="overflow-x-auto">
                    <div className="text-[11px] divide-y divide-border font-mono min-w-[1400px]">
                      <div className="grid grid-cols-[130px_70px_140px_80px_80px_90px_90px_100px_90px_80px_90px_90px_90px_100px] gap-2 pb-2 text-muted-foreground">
                        <span>Data</span><span>Ativo</span><span>Movimento</span>
                        <span className="text-right">Qtd</span><span className="text-right">Preço</span>
                        <span className="text-right">Débito</span><span className="text-right">Crédito</span>
                        <span className="text-right">Caixa após</span>
                        <span className="text-right">Qtd carteira</span><span className="text-right">Preço atual</span>
                        <span className="text-right">Valor posição</span>
                        <span className="text-right">PnL real.</span><span className="text-right">PnL n/real.</span>
                        <span className="text-right">Patrimônio</span>
                      </div>
                      {rows.map((r, i) => (
                        <div key={i} className="grid grid-cols-[130px_70px_140px_80px_80px_90px_90px_100px_90px_80px_90px_90px_90px_100px] gap-2 py-2 items-center">
                          <span className="text-muted-foreground">{new Date(r.ts).toLocaleString()}</span>
                          <span>{r.pair}</span>
                          <span className="text-muted-foreground">{r.kind}</span>
                          <span className="text-right">{r.qty.toFixed(6)}</span>
                          <span className="text-right">${r.price.toFixed(4)}</span>
                          <span className={`text-right ${r.debito > 0 ? "text-destructive" : ""}`}>{r.debito > 0 ? `-$${r.debito.toFixed(2)}` : "—"}</span>
                          <span className={`text-right ${r.credito > 0 ? "text-success" : ""}`}>{r.credito > 0 ? `+$${r.credito.toFixed(2)}` : "—"}</span>
                          <span className="text-right">${r.caixa_apos.toFixed(2)}</span>
                          <span className="text-right">{r.qty_carteira_apos.toFixed(6)}</span>
                          <span className="text-right">{r.preco_atual > 0 ? `$${r.preco_atual.toFixed(4)}` : "—"}</span>
                          <span className="text-right">${r.valor_posicao.toFixed(2)}</span>
                          <span className={`text-right ${r.pnl_realizado_acum >= 0 ? "text-success" : "text-destructive"}`}>
                            {r.pnl_realizado_acum >= 0 ? "+" : ""}${r.pnl_realizado_acum.toFixed(2)}
                          </span>
                          <span className={`text-right ${r.pnl_nao_realizado_acum >= 0 ? "text-success" : "text-destructive"}`}>
                            {r.pnl_nao_realizado_acum >= 0 ? "+" : ""}${r.pnl_nao_realizado_acum.toFixed(2)}
                          </span>
                          <span className="text-right font-semibold">${r.patrimonio_apos.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                    <span>{allRows.length} movimentos · página {curPage} de {totalPages} · {PAGE_SIZE}/página</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>Anterior</Button>
                      <Button size="sm" variant="outline" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}>Próxima</Button>
                    </div>
                  </div>
                </>
              );
            })()}
          </section>
        );
      })()}

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
