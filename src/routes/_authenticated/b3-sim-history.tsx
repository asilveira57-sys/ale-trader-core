import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, FileDown, FileText, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { listB3Simulations, scoreMode } from "@/lib/b3-simulation.functions";
import { listAllB3SimOrders, listB3SimVotesForOrder } from "@/lib/b3-sim-history.functions";

export const Route = createFileRoute("/_authenticated/b3-sim-history")({
  head: () => ({ meta: [{ title: "Histórico Simulação 5 Modos — B3" }] }),
  validateSearch: (search: Record<string, unknown>) => ({ run: typeof search.run === "string" ? search.run : undefined }),
  component: HistoryPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {String(error?.message ?? error)}</div>,
  notFoundComponent: () => <div className="p-6">Não encontrado.</div>,
});

const MODES = ["conservador", "moderado", "equilibrado", "semi_agressivo", "agressivo"] as const;
type Mode = typeof MODES[number];
const MODE_COLOR: Record<Mode, string> = {
  conservador: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  moderado: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  equilibrado: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  semi_agressivo: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  agressivo: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};
const BRL = (v: any) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const NUM = (v: any, d = 0) => Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const DT = (s?: string | null) => (s ? new Date(s).toLocaleString("pt-BR") : "—");

function durationLabel(o: any): string {
  if (!o.exit_time) return "—";
  const ms = new Date(o.exit_time).getTime() - new Date(o.created_at).getTime();
  if (!isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h}h ${rm}m`;
}

function HistoryPage() {
  const list = useServerFn(listB3Simulations);
  const detail = useServerFn(listAllB3SimOrders);
  const votesFn = useServerFn(listB3SimVotesForOrder);

  const search = Route.useSearch();
  const runsQ = useQuery({ queryKey: ["b3-sim-runs"], queryFn: () => list() });
  const [runId, setRunId] = useState<string | null>(search.run ?? null);
  const effRun = runId ?? runsQ.data?.[0]?.id ?? null;

  const dQ = useQuery({
    queryKey: ["b3-sim-history", effRun],
    queryFn: () => detail({ data: { run_id: effRun! } }),
    enabled: !!effRun,
    refetchInterval: useVisibleRefetchInterval(30000),
    refetchIntervalInBackground: false,
  });

  // filtros
  const [fMode, setFMode] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fSide, setFSide] = useState<string>("all");
  const [fReason, setFReason] = useState<string>("all");
  const [fFrom, setFFrom] = useState<string>("");
  const [fTo, setFTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [openVotesFor, setOpenVotesFor] = useState<string | null>(null);

  const allOrders: any[] = dQ.data?.orders ?? [];
  const modes: any[] = dQ.data?.modes ?? [];
  const run: any = dQ.data?.run;

  const reasons = useMemo(() => Array.from(new Set(allOrders.map((o) => o.close_reason).filter(Boolean))) as string[], [allOrders]);

  const filtered = useMemo(() => {
    return allOrders.filter((o) => {
      if (fMode !== "all" && o.mode !== fMode) return false;
      if (fStatus !== "all" && o.status !== fStatus) return false;
      if (fSide !== "all" && o.side !== fSide) return false;
      if (fReason !== "all" && (o.close_reason ?? "") !== fReason) return false;
      if (fFrom && new Date(o.created_at) < new Date(fFrom)) return false;
      if (fTo && new Date(o.created_at) > new Date(fTo)) return false;
      return true;
    });
  }, [allOrders, fMode, fStatus, fSide, fReason, fFrom, fTo]);

  const totals = useMemo(() => {
    const closed = filtered.filter((o) => o.status === "closed");
    const wins = closed.filter((o) => Number(o.net_result_brl) > 0).length;
    const losses = closed.filter((o) => Number(o.net_result_brl) < 0).length;
    const gross = closed.reduce((s, o) => s + Number(o.gross_result_brl ?? 0), 0);
    const fees = filtered.reduce((s, o) => s + Number(o.fees ?? 0), 0);
    const net = closed.reduce((s, o) => s + Number(o.net_result_brl ?? 0), 0);
    const pts = closed.reduce((s, o) => s + Number(o.gross_result_points ?? 0), 0);
    return { trades: filtered.length, closed: closed.length, wins, losses, gross, fees, net, pts,
      winRate: closed.length ? (wins / closed.length) * 100 : 0 };
  }, [filtered]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);

  function exportXLSX() {
    if (!dQ.data) return;
    const wb = XLSX.utils.book_new();

    const resumo = modes.map((m: any) => ({
      Modo: m.mode,
      "Saldo inicial": Number(m.initial_balance),
      "Saldo atual": Number(m.current_balance),
      "PnL realizado": Number(m.realized_pnl),
      Taxas: Number(m.total_fees),
      Trades: Number(m.total_trades),
      Ganhos: Number(m.winning_trades),
      Perdas: Number(m.losing_trades),
      "Taxa de acerto %": Number(m.total_trades) ? ((Number(m.winning_trades) / Number(m.total_trades)) * 100).toFixed(1) : "0",
      "Maior ganho": Number(m.max_gain),
      "Maior perda": Number(m.max_loss),
      "Drawdown máx.": Number(m.max_drawdown),
      "Pontos": Number(m.points_result),
      "Aprovações comitê": Number(m.committee_approvals),
      "Rejeições comitê": Number(m.committee_rejections),
      "Bloqueios risco": Number(m.risk_blocks),
      Score: Number(scoreMode(m).toFixed(2)),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Resumo");

    const ops = filtered.map((o: any) => ({
      Quando: DT(o.created_at),
      Fechamento: DT(o.exit_time),
      Duração: durationLabel(o),
      Modo: o.mode,
      Direção: String(o.side).toUpperCase(),
      Abertura: Number(o.entry_price),
      "Preço fechamento": o.exit_price ?? "",
      Pontos: o.gross_result_points ?? "",
      Bruto: o.gross_result_brl ?? "",
      Taxas: Number(o.fees ?? 0),
      Líquido: o.net_result_brl ?? "",
      Status: o.status,
      Motivo: o.close_reason ?? "",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ops), "Operações");

    // Evolução patrimonial: saldo cumulativo por modo ao longo do tempo (closed only)
    const evo: any[] = [];
    const balances: Record<string, number> = {};
    for (const m of modes) balances[m.mode] = Number(m.initial_balance);
    const closedAsc = [...allOrders].filter((o) => o.status === "closed").sort((a, b) => new Date(a.exit_time ?? a.created_at).getTime() - new Date(b.exit_time ?? b.created_at).getTime());
    for (const o of closedAsc) {
      balances[o.mode] = (balances[o.mode] ?? 0) + Number(o.net_result_brl ?? 0);
      evo.push({
        Quando: DT(o.exit_time ?? o.created_at),
        Modo: o.mode,
        "Líquido op.": Number(o.net_result_brl ?? 0),
        "Saldo após": balances[o.mode],
      });
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(evo), "Evolução patrimonial");

    XLSX.writeFile(wb, `b3-sim-historico-${effRun?.slice(0, 8)}.xlsx`);
  }

  function exportPDF() {
    if (!dQ.data) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text("Histórico — Simulação B3 (3 modos)", 40, 40);
    doc.setFontSize(9);
    doc.text(`Run: ${effRun} · Início: ${DT(run?.started_at)} · Status: ${run?.status ?? "—"}`, 40, 56);

    autoTable(doc, {
      startY: 72,
      head: [["Modo", "Saldo inicial", "Saldo atual", "PnL", "Trades", "Acerto %", "DD máx.", "Score"]],
      body: modes.map((m: any) => [
        m.mode,
        BRL(m.initial_balance),
        BRL(m.current_balance),
        BRL(m.realized_pnl),
        `${m.total_trades} (${m.winning_trades}V/${m.losing_trades}P)`,
        Number(m.total_trades) ? ((Number(m.winning_trades) / Number(m.total_trades)) * 100).toFixed(1) : "0",
        BRL(m.max_drawdown),
        scoreMode(m).toFixed(2),
      ]),
      styles: { fontSize: 8 },
    });

    const ranking = modes.slice().sort((a, b) => scoreMode(b) - scoreMode(a));
    if (ranking.length) {
      const y = (doc as any).lastAutoTable.finalY + 16;
      doc.setFontSize(10);
      doc.text(`Modo sugerido: ${ranking[0].mode.toUpperCase()} (score ${scoreMode(ranking[0]).toFixed(2)})`, 40, y);
    }

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 28,
      head: [["Quando", "Modo", "Dir.", "Abertura", "Fechamento", "Pts", "Líquido", "Status", "Motivo"]],
      body: filtered.map((o: any) => [
        DT(o.created_at),
        o.mode,
        String(o.side).toUpperCase(),
        NUM(o.entry_price),
        o.exit_price ? NUM(o.exit_price) : "—",
        o.gross_result_points != null ? NUM(o.gross_result_points) : "—",
        o.net_result_brl != null ? BRL(o.net_result_brl) : "—",
        o.status,
        o.close_reason ?? "—",
      ]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [40, 40, 40] },
    });

    const yEnd = (doc as any).lastAutoTable.finalY + 16;
    doc.setFontSize(9);
    doc.text(
      `Totais (filtrado): ${totals.trades} ops · ${totals.wins}V/${totals.losses}P · Acerto ${totals.winRate.toFixed(1)}% · Bruto ${BRL(totals.gross)} · Taxas ${BRL(totals.fees)} · Líquido ${BRL(totals.net)} · ${NUM(totals.pts)} pts`,
      40,
      yEnd,
    );

    doc.save(`b3-sim-historico-${effRun?.slice(0, 8)}.pdf`);
  }

  const votesQ = useQuery({
    queryKey: ["b3-sim-votes", openVotesFor],
    queryFn: () => votesFn({ data: { order_id: openVotesFor! } }),
    enabled: !!openVotesFor,
  });

  return (
    <TooltipProvider>
      <div className="container mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Link to="/b3" search={{ tab: "compare" }}><Button variant="outline" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Voltar</Button></Link>
            <h1 className="text-2xl font-semibold">Histórico completo — Simulação 5 Modos</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportXLSX} disabled={!dQ.data}><FileDown className="w-4 h-4 mr-1" />XLSX</Button>
            <Button variant="outline" size="sm" onClick={exportPDF} disabled={!dQ.data}><FileText className="w-4 h-4 mr-1" />PDF</Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Como ler esta tabela</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>O mini-índice (WIN) é um <strong>contrato futuro</strong>. Cada linha é <strong>uma operação completa</strong>: abertura + fechamento.</p>
            <p><strong>BUY (compra/long)</strong> abre comprado e fecha vendendo. <strong>SELL (venda/short)</strong> abre vendido e fecha comprando de volta. Não existem duas linhas separadas para uma mesma operação.</p>
            <p>Ex.: SELL @ 130.400 → fechamento @ 128.710 = +1.690 pts × R$ 0,20 × 1 contrato = R$ 338 bruto − R$ 3 de taxas = <strong>R$ 335 líquido</strong>.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <div className="md:col-span-2">
              <Label className="text-xs">Run</Label>
              <Select value={effRun ?? ""} onValueChange={(v) => { setRunId(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(runsQ.data ?? []).map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>{r.symbol ?? "?"} · {new Date(r.started_at).toLocaleString("pt-BR")} · {r.status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Modo</Label>
              <Select value={fMode} onValueChange={(v) => { setFMode(v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="conservador">Conservador</SelectItem>
                  <SelectItem value="moderado">Moderado</SelectItem>
                  <SelectItem value="equilibrado">Equilibrado</SelectItem>
                  <SelectItem value="semi_agressivo">Semi-agressivo</SelectItem>
                  <SelectItem value="agressivo">Agressivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={fStatus} onValueChange={(v) => { setFStatus(v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="open">Aberta</SelectItem>
                  <SelectItem value="closed">Fechada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Direção</Label>
              <Select value={fSide} onValueChange={(v) => { setFSide(v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="buy">BUY (long)</SelectItem>
                  <SelectItem value="sell">SELL (short)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Motivo</Label>
              <Select value={fReason} onValueChange={(v) => { setFReason(v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {reasons.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">De</Label>
              <Input type="datetime-local" value={fFrom} onChange={(e) => { setFFrom(e.target.value); setPage(1); }} />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="datetime-local" value={fTo} onChange={(e) => { setFTo(e.target.value); setPage(1); }} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Operações ({filtered.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {Number(dQ.data?.legacy_orders_hidden ?? 0) > 0 && (
              <p className="text-xs text-amber-300 mb-2">
                {dQ.data?.legacy_orders_hidden} operação(ões) legada(s) ocultada(s). Com MT5 XP DEMO ativo, o histórico mostra apenas execuções auditadas pelo B3QuoteProvider.
              </p>
            )}
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-2">Abertura</th>
                  <th>Fechamento</th>
                  <th>Duração</th>
                  <th>Modo</th>
                  <th>
                    Direção{" "}
                    <Tooltip><TooltipTrigger><Info className="w-3 h-3 inline" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs">BUY = comprado (long) · SELL = vendido (short). Cada linha é uma operação completa: abertura + fechamento.</TooltipContent></Tooltip>
                  </th>
                  <th>Preço abertura</th>
                  <th>Preço fechamento</th>
                  <th>Pts</th>
                  <th>Bruto</th>
                  <th>Taxas</th>
                  <th>Líquido</th>
                  <th>Status</th>
                  <th>Motivo</th>
                  <th>Votos</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((o: any) => (
                  <tr key={o.id} className="border-t border-border/40">
                    <td className="py-1 pr-2">{DT(o.created_at)}</td>
                    <td>{DT(o.exit_time)}</td>
                    <td>{durationLabel(o)}</td>
                    <td><Badge variant="outline" className={`text-[10px] capitalize ${MODE_COLOR[o.mode as Mode]}`}>{o.mode}</Badge></td>
                    <td className="uppercase font-medium">{o.side}</td>
                    <td>{NUM(o.entry_price)}</td>
                    <td>{o.exit_price ? NUM(o.exit_price) : "—"}</td>
                    <td>{o.gross_result_points != null ? NUM(o.gross_result_points) : "—"}</td>
                    <td>{o.gross_result_brl != null ? BRL(o.gross_result_brl) : "—"}</td>
                    <td>{BRL(o.fees)}</td>
                    <td className={Number(o.net_result_brl) > 0 ? "text-emerald-400" : Number(o.net_result_brl) < 0 ? "text-rose-400" : ""}>
                      {o.net_result_brl != null ? BRL(o.net_result_brl) : "—"}
                    </td>
                    <td>{o.status}</td>
                    <td className="text-muted-foreground">{o.close_reason ?? "—"}</td>
                    <td>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                        onClick={() => setOpenVotesFor(openVotesFor === o.id ? null : o.id)}>
                        {openVotesFor === o.id ? "Ocultar" : "Ver"}
                      </Button>
                    </td>
                  </tr>
                ))}
                {!slice.length && (
                  <tr><td colSpan={14} className="text-center text-muted-foreground py-4">Sem operações para os filtros atuais.</td></tr>
                )}
              </tbody>
            </table>

            {openVotesFor && (
              <div className="mt-3 p-3 rounded border border-border/50 bg-muted/30">
                <p className="text-xs font-semibold mb-2">Votos do comitê (operação {openVotesFor.slice(0, 8)})</p>
                {votesQ.isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
                {!votesQ.isLoading && (votesQ.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">Nenhum voto encontrado.</p>}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {(votesQ.data ?? []).map((v: any) => (
                    <div key={v.id} className="border border-border/40 rounded p-2">
                      <div className="flex justify-between">
                        <span className="font-medium">{v.agent_name}</span>
                        <Badge variant="outline" className="capitalize">{v.vote}</Badge>
                      </div>
                      <p className="text-muted-foreground">Confiança: {NUM(v.confidence)}%</p>
                      <p className="text-muted-foreground">{v.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mt-3 text-xs">
              <span className="text-muted-foreground">
                Página {page} de {pages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</Button>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>Próxima</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Totais (filtrado)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <Stat k="Trades" v={String(totals.trades)} />
            <Stat k="Fechadas" v={String(totals.closed)} />
            <Stat k="Ganhos / Perdas" v={`${totals.wins} / ${totals.losses}`} />
            <Stat k="Taxa de acerto" v={`${NUM(totals.winRate, 1)}%`} />
            <Stat k="Resultado bruto" v={BRL(totals.gross)} accent={totals.gross >= 0 ? "pos" : "neg"} />
            <Stat k="Taxas" v={BRL(totals.fees)} />
            <Stat k="Resultado líquido" v={BRL(totals.net)} accent={totals.net >= 0 ? "pos" : "neg"} />
            <Stat k="Pontos" v={NUM(totals.pts)} accent={totals.pts >= 0 ? "pos" : "neg"} />
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: "pos" | "neg" }) {
  return (
    <div className="flex justify-between border border-border/40 rounded p-2">
      <span className="text-muted-foreground">{k}</span>
      <span className={accent === "pos" ? "text-emerald-400" : accent === "neg" ? "text-rose-400" : ""}>{v}</span>
    </div>
  );
}
