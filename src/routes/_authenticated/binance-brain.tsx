import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Brain, Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { runBrainAnalysis, getBrainReport, listBrainSymbols } from "@/lib/binance-brain.functions";

export const Route = createFileRoute("/_authenticated/binance-brain")({
  component: BinanceBrainPage,
  head: () => ({ meta: [{ title: "Cérebro Binance · Auditoria" }] }),
});

function classColor(score: number) {
  if (score >= 86) return "bg-emerald-600";
  if (score >= 71) return "bg-green-600";
  if (score >= 51) return "bg-yellow-600";
  if (score >= 31) return "bg-orange-600";
  return "bg-red-600";
}

function BinanceBrainPage() {
  const qc = useQueryClient();
  const listSymbolsFn = useServerFn(listBrainSymbols);
  const runFn = useServerFn(runBrainAnalysis);
  const reportFn = useServerFn(getBrainReport);

  const [symbol, setSymbol] = useState("BTCUSDT");
  const [hours, setHours] = useState(24);

  const symbolsQ = useQuery({ queryKey: ["brain-symbols"], queryFn: () => listSymbolsFn() });
  const reportQ = useQuery({ queryKey: ["brain-report", hours], queryFn: () => reportFn({ data: { hours } }), refetchInterval: 30000 });

  const runMut = useMutation({
    mutationFn: () => runFn({ data: { symbol, notional: 100, persist: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brain-report"] }),
  });

  const report = reportQ.data;
  const last = runMut.data?.analysis;

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Brain className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Cérebro Binance</h1>
        <Badge variant="outline">Auditoria + Score + Ranking</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Rodar análise multitemporal</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Símbolo</label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(symbolsQ.data ?? ["BTCUSDT"]).map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => runMut.mutate()} disabled={runMut.isPending}>
            {runMut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analisando 9 timeframes…</> : "Analisar agora"}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Janela do relatório:</label>
            <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1h</SelectItem>
                <SelectItem value="6">6h</SelectItem>
                <SelectItem value="24">24h</SelectItem>
                <SelectItem value="72">72h</SelectItem>
                <SelectItem value="168">7 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {last && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {last.symbol} · ${last.price.toFixed(2)}
              <Badge className={classColor(last.score) + " text-white"}>Score {last.score.toFixed(0)} · {last.classification}</Badge>
              {last.feeGatePassed ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
              {runMut.data?.flexMode && <Badge variant="outline">Modo flexibilizado ({runMut.data.sample}/300)</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 md:grid-cols-9 gap-2 text-xs">
              {last.timeframes.map((t) => (
                <div key={t.tf} className="border rounded p-2">
                  <div className="font-semibold">{t.tf}</div>
                  <div className="text-muted-foreground">{t.trend}</div>
                  <div className={t.changePct >= 0 ? "text-emerald-500" : "text-red-500"}>{t.changePct.toFixed(2)}%</div>
                </div>
              ))}
            </div>
            {last.timeframeConflict && (
              <div className="flex items-center gap-2 text-amber-500 text-sm"><AlertTriangle className="w-4 h-4" />Conflito multitemporal — confiança reduzida.</div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="border rounded p-2"><div className="text-xs text-muted-foreground">Tendência dominante</div><div className="font-semibold">{last.dominantTrend}</div></div>
              <div className="border rounded p-2"><div className="text-xs text-muted-foreground">Volatilidade</div><div className="font-semibold">{last.volatilityClass}</div></div>
              <div className="border rounded p-2"><div className="text-xs text-muted-foreground">Volume</div><div className="font-semibold">{last.volumeSignal}</div></div>
              <div className="border rounded p-2"><div className="text-xs text-muted-foreground">Lucro líquido esperado</div><div className={"font-semibold " + (last.expectedNet >= 0 ? "text-emerald-500" : "text-red-500")}>${last.expectedNet.toFixed(4)}</div></div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Votos do comitê ({last.approve} aprovam · {last.reject} reprovam · {last.neutral} neutros)</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-xs">
                {last.indicators.map((i) => (
                  <div key={i.indicator} className="flex items-center justify-between border rounded px-2 py-1">
                    <span>{i.indicator}</span>
                    <Badge variant={i.vote === "approve" ? "default" : i.vote === "reject" ? "destructive" : "outline"}>{i.vote}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-sm text-muted-foreground">{last.rationale}</div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-4 gap-3">
        <Card><CardHeader><CardTitle className="text-sm">Análises ({hours}h)</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{report?.total ?? 0}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Aprovadas pelo cérebro</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-emerald-500">{report?.approved ?? 0}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Reprovadas</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-red-500">{report?.rejected ?? 0}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Score médio</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{(report?.avgScore ?? 0).toFixed(1)}</CardContent></Card>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Motivos das rejeições</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Motivo</TableHead><TableHead className="text-right">Qtd</TableHead></TableRow></TableHeader>
              <TableBody>
                {(report?.rejectionReasons ?? []).map((r) => (
                  <TableRow key={r.reason}><TableCell>{r.reason}</TableCell><TableCell className="text-right">{r.count}</TableCell></TableRow>
                ))}
                {!report?.rejectionReasons?.length && <TableRow><TableCell colSpan={2} className="text-muted-foreground text-center">sem rejeições</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Ranking de indicadores</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Indicador</TableHead><TableHead className="text-right">Votos</TableHead><TableHead className="text-right">% aprov.</TableHead></TableRow></TableHeader>
              <TableBody>
                {(report?.indicators ?? []).map((i) => {
                  const total = Number(i.votes_total ?? 0);
                  const ap = Number(i.votes_approve ?? 0);
                  const pct = total ? (ap / total) * 100 : 0;
                  return (
                    <TableRow key={i.id}><TableCell>{i.indicator}</TableCell><TableCell className="text-right">{total}</TableCell><TableCell className="text-right">{pct.toFixed(0)}%</TableCell></TableRow>
                  );
                })}
                {!report?.indicators?.length && <TableRow><TableCell colSpan={3} className="text-muted-foreground text-center">rode uma análise pra popular</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Últimas análises</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Quando</TableHead><TableHead>Símbolo</TableHead><TableHead>Tendência</TableHead><TableHead>Score</TableHead><TableHead>Líquido esperado</TableHead><TableHead>Taxa OK</TableHead><TableHead>Recomendação</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(report?.recent ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell>{r.symbol}</TableCell>
                  <TableCell>{r.dominant_trend}</TableCell>
                  <TableCell><Badge className={classColor(Number(r.score)) + " text-white"}>{Number(r.score).toFixed(0)}</Badge></TableCell>
                  <TableCell className={Number(r.expected_net) >= 0 ? "text-emerald-500" : "text-red-500"}>${Number(r.expected_net).toFixed(4)}</TableCell>
                  <TableCell>{r.fee_gate_passed ? "✅" : "❌"}</TableCell>
                  <TableCell>{r.brain_recommendation}</TableCell>
                </TableRow>
              ))}
              {!report?.recent?.length && <TableRow><TableCell colSpan={7} className="text-muted-foreground text-center">sem análises ainda</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
