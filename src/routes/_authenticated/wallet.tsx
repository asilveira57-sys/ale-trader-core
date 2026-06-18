import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCommitteeDashboard, resetSimulatedWallet } from "@/lib/atrader.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Wallet, TrendingUp, TrendingDown, ChevronDown, ChevronRight, FileSpreadsheet, FileText, AlertTriangle, Info } from "lucide-react";

export const Route = createFileRoute("/_authenticated/wallet")({
  head: () => ({ meta: [{ title: "Carteira simulada — AleTrader AI" }] }),
  component: WalletPage,
});

function WalletPage() {
  const qc = useQueryClient();
  const fetchDash = useServerFn(getCommitteeDashboard);
  const reset = useServerFn(resetSimulatedWallet);
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

      {/* Extrato débito / crédito */}
      {(() => {
        const events: { ts: string; pair: string; kind: string; side: string; delta: number; note: string; qty: number; price: number; pnl: number }[] = [];
        for (const o of data.orders ?? []) {
          const qty = Number(o.quantity);
          const value = Number(o.entry_price) * qty;
          if (o.side === "buy") {
            events.push({ ts: o.created_at, pair: o.pair, kind: "Compra (débito)", side: "buy", delta: -value, note: `qty ${qty.toFixed(6)} @ ${Number(o.entry_price).toFixed(4)}`, qty, price: Number(o.entry_price), pnl: 0 });
            if (o.status === "closed" && o.closed_price != null) {
              const proceeds = Number(o.closed_price) * qty;
              events.push({ ts: o.closed_at ?? o.created_at, pair: o.pair, kind: "Fechamento compra (crédito)", side: "sell", delta: proceeds, note: `saída @ ${Number(o.closed_price).toFixed(4)} · PnL ${Number(o.realized_pnl ?? 0).toFixed(2)}`, qty, price: Number(o.closed_price), pnl: Number(o.realized_pnl ?? 0) });
            }
          } else if (o.side === "sell" && o.status === "closed" && o.closed_price != null) {
            const proceeds = Number(o.closed_price) * qty;
            events.push({ ts: o.closed_at ?? o.created_at, pair: o.pair, kind: "Venda (crédito)", side: "sell", delta: proceeds, note: `qty ${qty.toFixed(6)} @ ${Number(o.closed_price).toFixed(4)} · PnL ${Number(o.realized_pnl ?? 0).toFixed(2)}`, qty, price: Number(o.closed_price), pnl: Number(o.realized_pnl ?? 0) });
          } else if (o.status === "cancelled") {
            events.push({ ts: o.closed_at ?? o.created_at, pair: o.pair, kind: "Cancelada", side: o.side, delta: 0, note: `${o.side} ignorada`, qty, price: 0, pnl: 0 });
          }
        }
        events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
        let running = initialBalance;
        const allRowsAsc = events.map((e) => { running += e.delta; return { ...e, running }; });
        const allRows = [...allRowsAsc].reverse();

        const volumeComprado = allRowsAsc.filter((r) => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0);
        const volumeVendido = allRowsAsc.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);

        const exportXLSX = async () => {
          const XLSX = await import("xlsx");
          const rows = allRowsAsc.map((r) => ({
            Data: new Date(r.ts).toLocaleString(),
            Par: r.pair,
            Tipo: r.kind,
            Lado: r.side,
            Quantidade: r.qty,
            Preço: r.price,
            "Valor (USD)": Number(r.delta.toFixed(2)),
            "PnL realizado": Number(r.pnl.toFixed(2)),
            "Saldo (USD)": Number(r.running.toFixed(2)),
            Detalhe: r.note,
          }));
          const summary = [
            { Métrica: "Saldo inicial", Valor: initialBalance },
            { Métrica: "Saldo disponível", Valor: cash },
            { Métrica: "Capital alocado (posições abertas)", Valor: Number(capitalAlocado.toFixed(2)) },
            { Métrica: "Equity (patrimônio total)", Valor: Number(equity.toFixed(2)) },
            { Métrica: "PnL realizado", Valor: Number(realizedPnl.toFixed(2)) },
            { Métrica: "PnL não realizado", Valor: Number(unrealizedPnl.toFixed(2)) },
            { Métrica: "PnL total", Valor: Number(totalPnl.toFixed(2)) },
            { Métrica: "ROI (%)", Valor: Number(roiPct.toFixed(2)) },
            { Métrica: "Volume comprado (movimentação, não lucro)", Valor: Number(volumeComprado.toFixed(2)) },
            { Métrica: "Volume vendido (movimentação, não lucro)", Valor: Number(volumeVendido.toFixed(2)) },
            { Métrica: "Operações encerradas", Valor: closedOps.length },
            { Métrica: "Posições abertas", Valor: openBuys.length },
            { Métrica: "Movimentos no extrato", Valor: allRowsAsc.length },
          ];
          const audit = closedOps.map((o: any) => ({
            ID: o.id,
            Ativo: o.pair,
            Abertura: new Date(o.opened_at).toLocaleString(),
            Fechamento: new Date(o.closed_at).toLocaleString(),
            Quantidade: o.qty,
            "Preço entrada": o.entry,
            "Preço saída": o.exit,
            "Valor investido": Number(o.invested.toFixed(2)),
            "Valor retornado": Number(o.proceeds.toFixed(2)),
            Taxas: Number(o.fees.toFixed(4)),
            "PnL realizado": Number(o.pnl.toFixed(2)),
            "ROI (%)": Number(o.roi.toFixed(2)),
            Status: "encerrada",
          }));
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Resumo");
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(audit), "Auditoria");
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Extrato");
          XLSX.writeFile(wb, `extrato-carteira-${new Date().toISOString().slice(0, 10)}.xlsx`);
        };

        const exportPDF = async () => {
          const { jsPDF } = await import("jspdf");
          const autoTable = (await import("jspdf-autotable")).default;
          const doc = new jsPDF({ orientation: "landscape" });
          doc.setFontSize(14);
          doc.text("Extrato da carteira simulada", 14, 14);
          doc.setFontSize(9);
          doc.text(
            [
              `Saldo inicial: $${initialBalance.toFixed(2)}    Saldo disponível: $${cash.toFixed(2)}    Capital alocado: $${capitalAlocado.toFixed(2)}    Equity: $${equity.toFixed(2)}`,
              `PnL realizado: $${realizedPnl.toFixed(2)}    PnL não realizado: $${unrealizedPnl.toFixed(2)}    PnL total: $${totalPnl.toFixed(2)}    ROI: ${roiPct.toFixed(2)}%`,
              `Volume comprado: $${volumeComprado.toFixed(2)}    Volume vendido: $${volumeVendido.toFixed(2)}  (movimentação, não lucro)`,
              `Operações encerradas: ${closedOps.length}    Posições abertas: ${openBuys.length}    Gerado em ${new Date().toLocaleString()}`,
            ],
            14,
            22,
          );
          autoTable(doc, {
            startY: 48,
            head: [["Ativo", "Abertura", "Fechamento", "Qtd", "Entrada", "Saída", "Investido", "PnL", "ROI %"]],
            body: closedOps.map((o: any) => [
              o.pair,
              new Date(o.opened_at).toLocaleString(),
              new Date(o.closed_at).toLocaleString(),
              o.qty.toFixed(6),
              o.entry.toFixed(4),
              o.exit.toFixed(4),
              o.invested.toFixed(2),
              `${o.pnl >= 0 ? "+" : ""}${o.pnl.toFixed(2)}`,
              `${o.roi >= 0 ? "+" : ""}${o.roi.toFixed(2)}`,
            ]),
            styles: { fontSize: 7 },
            headStyles: { fillColor: [40, 40, 40] },
            didDrawPage: (d) => {
              doc.setFontSize(10);
              doc.text("Operações encerradas", 14, d.cursor?.y ? 42 : 42);
            },
          });
          autoTable(doc, {
            head: [["Data", "Par", "Tipo", "Qtd", "Preço", "Valor (USD)", "Saldo (USD)", "Detalhe"]],
            body: allRowsAsc.map((r) => [
              new Date(r.ts).toLocaleString(),
              r.pair,
              r.kind,
              r.qty ? r.qty.toFixed(6) : "—",
              r.price ? r.price.toFixed(4) : "—",
              r.delta === 0 ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(2)}`,
              r.running.toFixed(2),
              r.note,
            ]),
            styles: { fontSize: 7 },
            headStyles: { fillColor: [40, 40, 40] },
          });
          doc.save(`extrato-carteira-${new Date().toISOString().slice(0, 10)}.pdf`);
        };

        return (
          <section className="panel p-5">
            <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold">Extrato (débito / crédito)</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Cada compra debita o capital alocado; o crédito acontece quando a posição é fechada (TP/SL ou venda).
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
              <span>Volume comprado e vendido representam movimentação financeira, não lucro. O resultado real está em PnL realizado / não realizado acima.</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 my-4 text-xs">
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">Volume comprado</p>
                <p className="font-mono">${volumeComprado.toFixed(2)}</p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">Volume vendido</p>
                <p className="font-mono">${volumeVendido.toFixed(2)}</p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">PnL realizado</p>
                <p className={`font-mono ${realizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                  {realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}
                </p>
              </div>
              <div className="rounded-md border border-border p-2">
                <p className="text-[10px] uppercase text-muted-foreground">Movimentos</p>
                <p className="font-mono">{allRowsAsc.length}</p>
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
