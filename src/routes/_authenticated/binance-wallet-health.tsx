import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  auditBinanceExposureParams,
  auditBinanceDecisions72h,
  recalculateBinancePortfolioState,
  rebuildBinanceWalletFromTrades,
  listBinanceReconciliationAudit,
} from "@/lib/binance-wallet-audit.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, RefreshCw, Wrench } from "lucide-react";

export const Route = createFileRoute("/_authenticated/binance-wallet-health")({
  component: Page,
  errorComponent: ({ error }) => <div className="p-6 text-sm text-red-400">Erro: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Não encontrado.</div>,
});

const fmt = (n: number | null | undefined, d = 2) =>
  (n == null ? 0 : Number(n)).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

function Page() {
  const qc = useQueryClient();
  const paramsFn = useServerFn(auditBinanceExposureParams);
  const decisionsFn = useServerFn(auditBinanceDecisions72h);
  const recalcFn = useServerFn(recalculateBinancePortfolioState);
  const rebuildFn = useServerFn(rebuildBinanceWalletFromTrades);
  const reconcFn = useServerFn(listBinanceReconciliationAudit);

  const params = useQuery({ queryKey: ["bin-params"], queryFn: () => paramsFn() });
  const decisions = useQuery({ queryKey: ["bin-decisions"], queryFn: () => decisionsFn() });
  const reconc = useQuery({ queryKey: ["bin-reconc"], queryFn: () => reconcFn() });
  const recalc = useQuery({ queryKey: ["bin-recalc"], queryFn: () => recalcFn() });

  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const rebuild = useMutation({
    mutationFn: () => rebuildFn({ data: { confirm: "RECONSTRUIR" } }),
    onSuccess: (r) => {
      setRebuildMsg(`Carteira reconstruída. Saldo=${fmt(r.cash)} Equity=${fmt(r.equity)} Posições=${r.positions}`);
      qc.invalidateQueries();
    },
    onError: (e: any) => setRebuildMsg(`Falha: ${e.message}`),
  });

  const r = recalc.data;
  const status =
    !r ? { color: "bg-muted", label: "—" }
    : !r.invariant_ok || Math.abs(r.equity_diff) > 1 || r.position_divergences.length > 0
      ? { color: "bg-red-500/20 text-red-300 border-red-500/40", label: "🔴 Divergência detectada" }
    : Math.abs(r.equity_diff) > 0.01
      ? { color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40", label: "🟡 Atenção" }
    : { color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "🟢 Consistente" };

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="size-6 text-primary" /> Saúde da Carteira Binance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Auditoria isolada do módulo Binance. Não afeta B3 / Mini Índice / Day Trade.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => qc.invalidateQueries()}>
            <RefreshCw className="size-4 mr-2" /> Reauditar
          </Button>
          <Button
            variant="destructive"
            onClick={() => { if (confirm("Reconstruir saldo/posições a partir das ordens? (orders preservadas)")) rebuild.mutate(); }}
            disabled={rebuild.isPending}
          >
            <Wrench className="size-4 mr-2" /> {rebuild.isPending ? "Reconstruindo..." : "Reconstruir carteira"}
          </Button>
        </div>
      </header>

      {rebuildMsg && <p className="text-sm">{rebuildMsg}</p>}

      <Card className={status.color}>
        <CardContent className="p-4 font-semibold">{status.label}</CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Saldo (DB)" value={fmt(r?.current_balance_in_db)} />
        <Stat label="Saldo recalculado" value={fmt(r?.calculated_cash)} />
        <Stat label="Valor de mercado aberto" value={fmt(r?.market_value_open)} />
        <Stat label="Equity recalculado" value={fmt(r?.calculated_equity)} />
        <Stat label="PnL realizado" value={fmt(r?.realized_pnl)} />
        <Stat label="PnL não realizado" value={fmt(r?.unrealized_pnl)} />
        <Stat label="Diferença saldo" value={fmt(r?.cash_diff)} valueClass={Math.abs(r?.cash_diff ?? 0) > 0.01 ? "text-red-400" : "text-emerald-400"} />
        <Stat label="Exposição atual" value={`${fmt(r?.exposure_pct, 1)}%`} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Parâmetros que limitam a exposição</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {params.data && (
            <p className="text-xs text-muted-foreground mb-3">
              Cap efetivo por trade: <strong>USDT {fmt(params.data.perTradeCap)}</strong> · Ativos ativos: <strong>{params.data.activeCount}</strong> · Exposição teórica máxima: <strong>{fmt(params.data.theoreticalMaxExposurePct, 1)}%</strong>
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parâmetro</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Impacto na exposição</TableHead>
                <TableHead>Origem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(params.data?.params ?? []).map((p: any) => (
                <TableRow key={p.parameter}>
                  <TableCell className="font-mono text-xs">{p.parameter}</TableCell>
                  <TableCell className="font-mono text-xs">{String(p.current_value)}</TableCell>
                  <TableCell className="text-xs">{p.impact_on_exposure}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.module_source}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Decisões (últimas 72h) — capital parado</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {decisions.data && (
            <p className="text-xs text-muted-foreground mb-3">
              Total: <strong>{decisions.data.total}</strong> · Aprovadas sem ordem: <strong className="text-red-400">{decisions.data.stuck_count}</strong> · Capital parado estimado: <strong>USDT {fmt(decisions.data.stuck_capital_estimate)}</strong>
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead>Decisão</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Conf.</TableHead>
                <TableHead className="text-right">Solic. (USDT)</TableHead>
                <TableHead className="text-right">Aprov. (USDT)</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(decisions.data?.rows ?? []).map((d: any) => (
                <TableRow key={d.decision_id}>
                  <TableCell className="text-xs">{new Date(d.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="font-mono">{d.symbol}</TableCell>
                  <TableCell><Badge variant="outline">{d.decision_type}</Badge></TableCell>
                  <TableCell className="text-right">{fmt(d.committee_score, 1)}</TableCell>
                  <TableCell className="text-right">{fmt(d.risk_score, 1)}</TableCell>
                  <TableCell className="text-right">{fmt(d.requested_capital)}</TableCell>
                  <TableCell className="text-right">{fmt(d.approved_capital)}</TableCell>
                  <TableCell className={`text-xs ${d.reason.includes("SEM ORDEM") ? "text-red-400" : ""}`}>{d.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Divergências registradas</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {(reconc.data?.rows ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma divergência registrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Causa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(reconc.data?.rows ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.detected_at).toLocaleString("pt-BR")}</TableCell>
                    <TableCell><Badge variant="outline">{r.divergence_type}</Badge></TableCell>
                    <TableCell className="font-mono">{r.affected_symbol ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.amount)}</TableCell>
                    <TableCell className="text-xs">{r.root_cause}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
