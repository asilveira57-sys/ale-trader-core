import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDataCoverage, importBinanceKlines } from "@/lib/backtest.functions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Download, Database } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/backtest/data")({
  head: () => ({ meta: [{ title: "Dados históricos — AleTrader AI" }] }),
  component: DataPage,
});

const TFS = ["15m", "1h", "4h", "1d"];
const PERIODS = [30, 90, 180, 365, 730, 1825];

function DataPage() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getDataCoverage);
  const importFn = useServerFn(importBinanceKlines);
  const { data } = useQuery({ queryKey: ["cover"], queryFn: () => fetchFn({}) });
  const [picks, setPicks] = useState<Record<string, { tf: string; days: number }>>({});

  const mImport = useMutation({
    mutationFn: (v: { asset_id: string; timeframe: any; days: number }) => importFn({ data: v }),
    onSuccess: (r) => { toast.success(`${r.imported} candles ${r.pair}`); qc.invalidateQueries({ queryKey: ["cover"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <header className="flex items-center gap-3">
        <Link to="/backtest"><Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button></Link>
        <Database className="size-5 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dados históricos</h1>
          <p className="text-sm text-muted-foreground">Importe candles da Binance (endpoint público) para alimentar os backtests.</p>
        </div>
      </header>

      <section className="panel p-5">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr><th className="text-left py-2">Ativo</th><th>Cobertura por timeframe</th><th className="text-right">Importar</th></tr>
          </thead>
          <tbody>
            {(data ?? []).map((a: any) => {
              const pick = picks[a.id] ?? { tf: "1h", days: 90 };
              return (
                <tr key={a.id} className="border-b border-border/40">
                  <td className="py-2 font-medium">{a.pair}</td>
                  <td className="text-xs">
                    {TFS.map((t) => {
                      const c = a.coverage?.[t];
                      return (
                        <span key={t} className="inline-block mr-3">
                          <span className="text-muted-foreground">{t}:</span> {c ? `${c.count}` : "—"}
                          {c?.last && <span className="text-muted-foreground"> (até {c.last.slice(0, 10)})</span>}
                        </span>
                      );
                    })}
                  </td>
                  <td className="text-right">
                    <div className="inline-flex gap-2 items-center">
                      <Select value={pick.tf} onValueChange={(v) => setPicks((p) => ({ ...p, [a.id]: { ...pick, tf: v } }))}>
                        <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>{TFS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={String(pick.days)} onValueChange={(v) => setPicks((p) => ({ ...p, [a.id]: { ...pick, days: Number(v) } }))}>
                        <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>{PERIODS.map((d) => <SelectItem key={d} value={String(d)}>{d}d</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="sm" disabled={mImport.isPending} onClick={() => mImport.mutate({ asset_id: a.id, timeframe: pick.tf as any, days: pick.days })}>
                        <Download className="size-4 mr-1" />Importar
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(!data || data.length === 0) && <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">Cadastre ativos primeiro em /assets.</td></tr>}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-muted-foreground">⚠️ Endpoint público da Binance (sem autenticação). Sem trading real.</p>
    </div>
  );
}
