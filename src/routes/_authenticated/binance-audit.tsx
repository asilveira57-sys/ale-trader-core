import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { auditBinanceExits, type AuditReport } from "@/lib/binance-exit-audit.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, FileSearch } from "lucide-react";

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
                    {report.losses.map((l) => (
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
