import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { auditBinanceExits, type AuditReport } from "@/lib/binance-exit-audit.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, FileSearch, FileSpreadsheet, FileText } from "lucide-react";

const COLS = [
  "Ativo","Saida","Entrada","Saida_Preco","PnL_Pct","PnL_USDT","Motivo","Classificacao",
  "Preco_1h","Preco_4h","Preco_12h","Preco_24h","Diagnostico",
];

function toCSV(losses: AuditReport["losses"]): string {
  const rows = losses.map((l) => [
    l.pair,
    new Date(l.closed_at).toLocaleString("pt-BR"),
    l.entry_price, l.exit_price, l.pnl_pct, l.pnl,
    (l.exit_reason ?? "").replace(/[;\n\r]/g, " "),
    l.classification,
    l.price_1h ?? "", l.price_4h ?? "", l.price_12h ?? "", l.price_24h ?? "",
    l.premature ? "Prematura" : "Correta",
  ].join(";"));
  return "\uFEFF" + [COLS.join(";"), ...rows].join("\n");
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportCSV(report: AuditReport) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  download(`binance-auditoria-${stamp}.csv`, toCSV(report.losses), "text/csv;charset=utf-8");
}

function exportPDF(report: AuditReport) {
  const stamp = new Date().toLocaleString("pt-BR");
  const fmtN = (n: number | null, d = 2) => n === null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const rows = report.losses.map((l) => `
    <tr>
      <td>${l.pair}</td>
      <td>${new Date(l.closed_at).toLocaleString("pt-BR")}</td>
      <td style="text-align:right">${fmtN(l.entry_price, 4)}</td>
      <td style="text-align:right">${fmtN(l.exit_price, 4)}</td>
      <td style="text-align:right;color:#c00">${fmtN(l.pnl_pct, 1)}%</td>
      <td style="text-align:right;color:#c00">${fmtN(l.pnl)}</td>
      <td>${l.exit_reason ?? "—"}</td>
      <td>${l.classification}</td>
      <td style="text-align:right">${fmtN(l.price_1h, 4)}</td>
      <td style="text-align:right">${fmtN(l.price_4h, 4)}</td>
      <td style="text-align:right">${fmtN(l.price_12h, 4)}</td>
      <td style="text-align:right">${fmtN(l.price_24h, 4)}</td>
      <td>${l.premature ? "Prematura" : "Correta"}</td>
    </tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Auditoria Binance — ${stamp}</title>
<style>
  body{font-family:Arial,sans-serif;color:#111;margin:24px;font-size:11px}
  h1{font-size:18px;margin:0 0 4px}
  h2{font-size:13px;margin:18px 0 6px}
  .muted{color:#666;font-size:10px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}
  .card{border:1px solid #ddd;border-radius:6px;padding:8px}
  .card .l{font-size:10px;color:#666}
  .card .v{font-size:14px;font-weight:600;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th,td{border:1px solid #ddd;padding:4px 6px;text-align:left}
  th{background:#f3f4f6}
  @media print{ @page{size:A4 landscape;margin:10mm} }
</style></head><body>
<h1>Auditoria de Saídas — Binance</h1>
<div class="muted">Gerado em ${stamp}</div>
<div class="grid">
  <div class="card"><div class="l">Fechadas</div><div class="v">${report.total_closed}</div></div>
  <div class="card"><div class="l">Em prejuízo</div><div class="v">${report.total_losses}</div></div>
  <div class="card"><div class="l">Early Exit Score</div><div class="v">${report.early_exit_score.toFixed(1)}%</div></div>
  <div class="card"><div class="l">Qualidade</div><div class="v">${report.quality.label}</div></div>
  <div class="card"><div class="l">Recovery 1h</div><div class="v">${report.recovery_rate_1h.toFixed(1)}%</div></div>
  <div class="card"><div class="l">Recovery 4h</div><div class="v">${report.recovery_rate_4h.toFixed(1)}%</div></div>
  <div class="card"><div class="l">Recovery 12h</div><div class="v">${report.recovery_rate_12h.toFixed(1)}%</div></div>
  <div class="card"><div class="l">Recovery 24h</div><div class="v">${report.recovery_rate_24h.toFixed(1)}%</div></div>
  <div class="card"><div class="l">Prematuras</div><div class="v">${report.premature_count}</div></div>
  <div class="card"><div class="l">Corretas</div><div class="v">${report.correct_count}</div></div>
  <div class="card"><div class="l">Prej. evitável</div><div class="v">${fmtN(report.avoidable_loss_usdt)}</div></div>
  <div class="card"><div class="l">Prej. inevitável</div><div class="v">${fmtN(report.unavoidable_loss_usdt)}</div></div>
</div>
<h2>Vendas em prejuízo (${report.losses.length})</h2>
<table>
  <thead><tr>
    <th>Ativo</th><th>Saída</th><th>Entrada</th><th>Saída ($)</th><th>PnL%</th><th>PnL USDT</th>
    <th>Motivo</th><th>Classe</th><th>+1h</th><th>+4h</th><th>+12h</th><th>+24h</th><th>Diagnóstico</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<script>window.onload=()=>{setTimeout(()=>window.print(),300)}</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

export const Route = createFileRoute("/_authenticated/binance-audit")({
  component: BinanceAuditPage,
  errorComponent: ({ error }) => <div className="p-6 text-sm text-red-400">Erro: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Não encontrado.</div>,
});

const fmt = (n: number, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number) => `${fmt(n, 1)}%`;

function BinanceAuditPage() {
  const fn = useServerFn(auditBinanceExits);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;
  const mutation = useMutation({
    mutationFn: () => fn({ data: {} }),
    onSuccess: (r) => { setReport(r); setPage(1); },
  });
  const totalPages = report ? Math.max(1, Math.ceil(report.losses.length / PAGE_SIZE)) : 1;
  const pagedLosses = report ? report.losses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileSearch className="size-6 text-primary" /> Auditoria de Saídas — Binance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Análise somente leitura do módulo Binance. Identifica vendas em prejuízo que poderiam ter sido evitadas.
            Não altera estratégia, não cria ordens.
          </p>
        </div>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Auditando..." : "Rodar auditoria"}
        </Button>
        {report && report.losses.length > 0 && (
          <>
            <Button variant="outline" onClick={() => exportCSV(report)}>
              <FileSpreadsheet className="size-4 mr-1" /> XLS / CSV
            </Button>
            <Button variant="outline" onClick={() => exportPDF(report)}>
              <FileText className="size-4 mr-1" /> PDF
            </Button>
          </>
        )}
      </header>

      {mutation.isError && <p className="text-sm text-red-400">Falha: {(mutation.error as Error).message}</p>}

      {!report && !mutation.isPending && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Clique em "Rodar auditoria" para coletar as vendas Binance em prejuízo e comparar o preço pós-saída (1h / 4h / 12h / 24h) usando dados públicos da Binance.
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          {report.alert && (
            <Card className="border-red-500/40 bg-red-500/5">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="size-5 text-red-400 mt-0.5" />
                <div>
                  <p className="font-medium text-red-300">{report.alert}</p>
                  <ul className="mt-2 text-sm text-muted-foreground list-disc pl-5 space-y-1">
                    {report.suggestions.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Fechadas (Binance)" value={String(report.total_closed)} />
            <Stat label="Em prejuízo" value={String(report.total_losses)} />
            <Stat label="Early Exit Score" value={pct(report.early_exit_score)} />
            <Stat label="Qualidade das Saídas" value={report.quality.label} valueClass={report.quality.color} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Recovery 1h" value={pct(report.recovery_rate_1h)} />
            <Stat label="Recovery 4h" value={pct(report.recovery_rate_4h)} />
            <Stat label="Recovery 12h" value={pct(report.recovery_rate_12h)} />
            <Stat label="Recovery 24h" value={pct(report.recovery_rate_24h)} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Prematuras" value={String(report.premature_count)} />
            <Stat label="Corretas" value={String(report.correct_count)} />
            <Stat label="Prejuízo evitável (USDT)" value={fmt(report.avoidable_loss_usdt)} valueClass="text-red-300" />
            <Stat label="Prejuízo inevitável (USDT)" value={fmt(report.unavoidable_loss_usdt)} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Classificação da queda</CardTitle></CardHeader>
            <CardContent className="flex gap-4 flex-wrap">
              {Object.entries(report.by_classification).map(([k, v]) => (
                <div key={k} className="px-3 py-2 rounded-md bg-muted/40 text-sm">
                  <span className="text-muted-foreground">{k}:</span> <strong>{v}</strong>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Vendas em prejuízo</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              {report.losses.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma venda em prejuízo registrada no módulo Binance.</p>
              ) : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ativo</TableHead>
                      <TableHead>Saída</TableHead>
                      <TableHead className="text-right">Entrada</TableHead>
                      <TableHead className="text-right">Saída ($)</TableHead>
                      <TableHead className="text-right">PnL%</TableHead>
                      <TableHead className="text-right">PnL USDT</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Classe</TableHead>
                      <TableHead className="text-right">+1h</TableHead>
                      <TableHead className="text-right">+4h</TableHead>
                      <TableHead className="text-right">+12h</TableHead>
                      <TableHead className="text-right">+24h</TableHead>
                      <TableHead>Diagnóstico</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedLosses.map((l) => (
                      <TableRow key={`${l.source}-${l.id}`}>
                        <TableCell className="font-mono">{l.pair}</TableCell>
                        <TableCell className="text-xs">{new Date(l.closed_at).toLocaleString("pt-BR")}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(l.entry_price, 4)}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(l.exit_price, 4)}</TableCell>
                        <TableCell className="text-right text-red-400">{pct(l.pnl_pct)}</TableCell>
                        <TableCell className="text-right text-red-400">{fmt(l.pnl)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{l.exit_reason ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline">{l.classification}</Badge></TableCell>
                        <RecCell price={l.price_1h} exit={l.exit_price} />
                        <RecCell price={l.price_4h} exit={l.exit_price} />
                        <RecCell price={l.price_12h} exit={l.exit_price} />
                        <RecCell price={l.price_24h} exit={l.exit_price} />
                        <TableCell>
                          {l.premature ? (
                            <Badge className="bg-red-500/20 text-red-300 border-red-500/40">Prematura</Badge>
                          ) : (
                            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">Correta</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between mt-3 text-sm">
                  <span className="text-muted-foreground">
                    Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, report.losses.length)} de {report.losses.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</Button>
                    <span className="text-xs text-muted-foreground">Página {page} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Próxima</Button>
                  </div>
                </div>
                </>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Gerado em {new Date(report.generated_at).toLocaleString("pt-BR")} · Preços pós-saída via API pública Binance · Análise restrita ao módulo Binance.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-semibold mt-1 ${valueClass ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function RecCell({ price, exit }: { price: number | null; exit: number }) {
  if (price === null) return <TableCell className="text-right text-muted-foreground">—</TableCell>;
  const diff = ((price - exit) / exit) * 100;
  const better = price > exit;
  return (
    <TableCell className={`text-right font-mono text-xs ${better ? "text-emerald-400" : "text-muted-foreground"}`}>
      {fmt(price, 4)} <span className="opacity-70">({diff >= 0 ? "+" : ""}{fmt(diff, 1)}%)</span>
    </TableCell>
  );
}
