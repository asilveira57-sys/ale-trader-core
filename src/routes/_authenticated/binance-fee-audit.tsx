import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { getBinanceFeeSummary, updateBinanceProfitGuard } from "@/lib/binance-fee-audit.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/binance-fee-audit")({
  component: BinanceFeeAuditPage,
  errorComponent: ({ error }) => <div className="p-6 text-red-500">Erro: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Não encontrado</div>,
});

const fmt = (n: number, d = 2) => Number(n ?? 0).toFixed(d);
const usd = (n: number) => `US$ ${fmt(n)}`;

function BinanceFeeAuditPage() {
  const router = useRouter();
  const fetchSummary = useServerFn(getBinanceFeeSummary);
  const update = useServerFn(updateBinanceProfitGuard);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["binance-fee-summary"],
    queryFn: () => fetchSummary(),
    refetchInterval: 15000,
  });

  const [form, setForm] = useState<any>({});
  useEffect(() => {
    if (data?.settings && !Object.keys(form).length) {
      setForm({
        taker_fee_pct: data.settings.taker_fee_pct,
        min_expected_roi_pct: data.settings.min_expected_roi_pct,
        min_net_profit_usd: data.settings.min_net_profit_usd,
        fee_coverage_multiplier: data.settings.fee_coverage_multiplier,
        per_trade_capital_pct: data.settings.per_trade_capital_pct,
      });
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (vals: any) => update({ data: vals }),
    onSuccess: () => { refetch(); router.invalidate(); },
  });

  if (isLoading || !data) return <div className="p-6">Carregando auditoria...</div>;
  const s = data.summary;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Binance — Auditoria de Taxas e Lucro Mínimo</h1>
        <p className="text-sm text-muted-foreground">
          Garantia de que toda operação cubra taxas reais, slippage e margem de segurança antes de executar.
        </p>
      </div>

      {s.alert && (
        <Alert variant="destructive">
          <AlertTitle>Alerta de estratégia ineficiente</AlertTitle>
          <AlertDescription>{s.alert} (taxas consumiram {fmt(s.fee_to_gross_ratio_last100 * 100, 1)}% do lucro bruto nos últimos 100 trades)</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Capital movimentado</CardTitle></CardHeader><CardContent className="text-xl font-bold">{usd(s.capital_moved)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Lucro bruto</CardTitle></CardHeader><CardContent className="text-xl font-bold">{usd(s.gross_pnl)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Taxas pagas</CardTitle></CardHeader><CardContent className="text-xl font-bold text-orange-500">{usd(s.total_fees)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Lucro líquido</CardTitle></CardHeader><CardContent className={`text-xl font-bold ${s.net_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>{usd(s.net_pnl)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">ROI líquido médio</CardTitle></CardHeader><CardContent className="text-xl font-bold">{fmt(s.avg_net_roi_pct, 3)}%</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Trades fechados</CardTitle></CardHeader><CardContent className="text-xl font-bold">{s.trades_closed}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Bloqueios totais</CardTitle></CardHeader><CardContent className="text-xl font-bold text-yellow-500">{s.blocked_count}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Taxas / Bruto (100)</CardTitle></CardHeader><CardContent className="text-xl font-bold">{fmt(s.fee_to_gross_ratio_last100 * 100, 1)}%</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Configuração do Guard</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            ["taker_fee_pct", "Taxa Binance (%)"],
            ["min_expected_roi_pct", "ROI mínimo (%)"],
            ["min_net_profit_usd", "Lucro líq. mínimo (US$)"],
            ["fee_coverage_multiplier", "Cobertura taxas (x)"],
            ["per_trade_capital_pct", "Capital por trade (0–1)"],
          ].map(([k, label]) => (
            <div key={k}>
              <Label className="text-xs">{label}</Label>
              <Input type="number" step="0.01" value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} />
            </div>
          ))}
          <div className="col-span-full">
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Motivos de bloqueio</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {Object.entries(data.reasons).length === 0 && <div className="text-sm text-muted-foreground">Nenhum bloqueio.</div>}
          {Object.entries(data.reasons).map(([reason, n]) => (
            <div key={reason} className="flex justify-between border-b py-1 text-sm">
              <span>{reason}</span><Badge variant="secondary">{n as number}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Últimas ordens fechadas</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Par</TableHead><TableHead>Lado</TableHead><TableHead>Qty</TableHead>
              <TableHead>Entry</TableHead><TableHead>Exit</TableHead>
              <TableHead>Taxas</TableHead><TableHead>Bruto</TableHead><TableHead>Líquido</TableHead>
              <TableHead>ROI Liq</TableHead><TableHead>Fechado</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.recent_orders.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell>{o.pair}</TableCell>
                  <TableCell>{o.side}</TableCell>
                  <TableCell>{fmt(Number(o.quantity), 6)}</TableCell>
                  <TableCell>{fmt(Number(o.entry_price), 4)}</TableCell>
                  <TableCell>{o.closed_price ? fmt(Number(o.closed_price), 4) : "-"}</TableCell>
                  <TableCell className="text-orange-500">{usd(Number(o.total_fees ?? 0))}</TableCell>
                  <TableCell>{usd(Number(o.gross_pnl ?? 0))}</TableCell>
                  <TableCell className={Number(o.net_pnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}>{usd(Number(o.net_pnl ?? 0))}</TableCell>
                  <TableCell>{fmt(Number(o.net_roi_pct ?? 0), 3)}%</TableCell>
                  <TableCell className="text-xs">{o.closed_at ? new Date(o.closed_at).toLocaleString("pt-BR") : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Trades bloqueados pelo guard</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Par</TableHead><TableHead>Motivo</TableHead>
              <TableHead>Capital</TableHead><TableHead>Taxas est.</TableHead>
              <TableHead>Lucro liq. esp.</TableHead><TableHead>ROI esp.</TableHead><TableHead>Quando</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.recent_blocks.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell>{b.pair}</TableCell>
                  <TableCell className="text-xs max-w-[400px]">{b.reason}</TableCell>
                  <TableCell>{usd(Number(b.position_value ?? 0))}</TableCell>
                  <TableCell>{usd(Number(b.total_fees_estimated ?? 0))}</TableCell>
                  <TableCell>{usd(Number(b.expected_net_profit ?? 0))}</TableCell>
                  <TableCell>{fmt(Number(b.expected_roi_pct ?? 0), 3)}%</TableCell>
                  <TableCell className="text-xs">{new Date(b.created_at).toLocaleString("pt-BR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
