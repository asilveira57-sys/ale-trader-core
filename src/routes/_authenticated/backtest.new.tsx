import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { startBacktest, getDataCoverage } from "@/lib/backtest.functions";
import { listAgents } from "@/lib/atrader.functions";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/backtest/new")({
  head: () => ({ meta: [{ title: "Novo backtest — AleTrader AI" }] }),
  component: NewBacktest,
});

const TFS = ["15m", "1h", "4h", "1d"] as const;
const PERIODS = [
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
  { label: "180 dias", days: 180 },
  { label: "1 ano", days: 365 },
  { label: "2 anos", days: 730 },
  { label: "5 anos", days: 1825 },
];

function NewBacktest() {
  const nav = useNavigate();
  const coverFn = useServerFn(getDataCoverage);
  const agentsFn = useServerFn(listAgents);
  const startFn = useServerFn(startBacktest);
  const { data: cover } = useQuery({ queryKey: ["cover"], queryFn: () => coverFn({}) });
  const { data: agentsData } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn({}) });

  const [name, setName] = useState("Teste " + new Date().toLocaleDateString("pt-BR"));
  const [mode, setMode] = useState<"agent_solo" | "committee" | "strategy">("committee");
  const [soloAgent, setSoloAgent] = useState<string>("");
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [selectedTfs, setSelectedTfs] = useState<string[]>(["1h"]);
  const [periodDays, setPeriodDays] = useState(90);
  const [initialBalance, setInitialBalance] = useState(10000);
  const [maxTradeValue, setMaxTradeValue] = useState(1000);
  const [stopLoss, setStopLoss] = useState(3);
  const [takeProfit, setTakeProfit] = useState(6);
  const [feePct, setFeePct] = useState(0.1);
  const [slippagePct, setSlippagePct] = useState(0.05);
  const [minFavor, setMinFavor] = useState(6);
  const [minConfidence, setMinConfidence] = useState(70);
  const [minScore, setMinScore] = useState(61);
  const [reinvest, setReinvest] = useState(true);
  const [drawdownLimit, setDrawdownLimit] = useState(20);
  const [streakLimit, setStreakLimit] = useState(6);

  const mStart = useMutation({
    mutationFn: () => startFn({
      data: {
        name, mode,
        asset_ids: selectedAssets,
        timeframes: selectedTfs as any,
        period_days: periodDays,
        initial_balance: initialBalance,
        max_trade_value: maxTradeValue,
        stop_loss_pct: stopLoss,
        take_profit_pct: takeProfit,
        fee_pct: feePct,
        slippage_pct: slippagePct,
        min_favor_votes: minFavor,
        min_confidence: minConfidence,
        min_score: minScore,
        reinvest,
        solo_agent: mode === "agent_solo" ? soloAgent : undefined,
        drawdown_limit_pct: drawdownLimit,
        loss_streak_limit: streakLimit,
      },
    }),
    onSuccess: (r: any) => { toast.success("Backtest concluído"); nav({ to: "/backtest/$runId", params: { runId: r.run_id } }); },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleAsset = (id: string) =>
    setSelectedAssets((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const toggleTf = (t: string) =>
    setSelectedTfs((s) => s.includes(t) ? s.filter((x) => x !== t) : [...s, t]);

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <header className="flex items-center gap-3">
        <Link to="/backtest"><Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button></Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Configurar backtest</h1>
          <p className="text-sm text-muted-foreground">Simulação completa — nenhuma ordem real será enviada.</p>
        </div>
      </header>

      <section className="panel p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <Label>Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>Modo</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="committee">Comitê completo</SelectItem>
              <SelectItem value="agent_solo">Agente individual</SelectItem>
              <SelectItem value="strategy">Estratégia customizada</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === "agent_solo" && (
          <div className="md:col-span-2">
            <Label>Agente</Label>
            <Select value={soloAgent} onValueChange={setSoloAgent}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {(agentsData?.agents ?? []).map((a: any) => (
                  <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="md:col-span-2">
          <Label className="mb-2 block">Ativos</Label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {(cover ?? []).map((a: any) => {
              const hasData = Object.values(a.coverage ?? {}).some((c: any) => c.count > 60);
              return (
                <label key={a.id} className={`flex items-center gap-2 border border-border rounded-md p-3 cursor-pointer ${!hasData ? "opacity-60" : ""}`}>
                  <Checkbox checked={selectedAssets.includes(a.id)} onCheckedChange={() => toggleAsset(a.id)} disabled={!hasData} />
                  <div>
                    <p className="text-sm font-medium">{a.pair}</p>
                    <p className="text-xs text-muted-foreground">
                      {hasData ? Object.entries(a.coverage).map(([t, v]: any) => `${t}:${v.count}`).join(" · ") : "sem dados — importe primeiro"}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-2">
          <Label className="mb-2 block">Timeframes</Label>
          <div className="flex gap-2 flex-wrap">
            {TFS.map((t) => (
              <Button key={t} type="button" size="sm" variant={selectedTfs.includes(t) ? "default" : "outline"} onClick={() => toggleTf(t)}>{t}</Button>
            ))}
          </div>
        </div>

        <div>
          <Label>Período</Label>
          <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map((p) => <SelectItem key={p.days} value={String(p.days)}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Saldo inicial (USDT)</Label><Input type="number" value={initialBalance} onChange={(e) => setInitialBalance(Number(e.target.value))} /></div>
        <div><Label>Valor máx por operação</Label><Input type="number" value={maxTradeValue} onChange={(e) => setMaxTradeValue(Number(e.target.value))} /></div>
        <div><Label>Stop loss %</Label><Input type="number" step="0.1" value={stopLoss} onChange={(e) => setStopLoss(Number(e.target.value))} /></div>
        <div><Label>Take profit %</Label><Input type="number" step="0.1" value={takeProfit} onChange={(e) => setTakeProfit(Number(e.target.value))} /></div>
        <div><Label>Taxa corretora %</Label><Input type="number" step="0.01" value={feePct} onChange={(e) => setFeePct(Number(e.target.value))} /></div>
        <div><Label>Slippage %</Label><Input type="number" step="0.01" value={slippagePct} onChange={(e) => setSlippagePct(Number(e.target.value))} /></div>

        <div><Label>Mín votos favoráveis</Label><Input type="number" value={minFavor} onChange={(e) => setMinFavor(Number(e.target.value))} /></div>
        <div><Label>Mín confiança</Label><Input type="number" value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))} /></div>
        <div><Label>Mín score</Label><Input type="number" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} /></div>
        <div className="flex items-center justify-between border border-border rounded-md p-3">
          <Label htmlFor="reinvest">Reinvestir lucros</Label>
          <Switch id="reinvest" checked={reinvest} onCheckedChange={setReinvest} />
        </div>
        <div><Label>Limite drawdown %</Label><Input type="number" value={drawdownLimit} onChange={(e) => setDrawdownLimit(Number(e.target.value))} /></div>
        <div><Label>Limite loss streak</Label><Input type="number" value={streakLimit} onChange={(e) => setStreakLimit(Number(e.target.value))} /></div>
      </section>

      <div className="flex justify-end">
        <Button size="lg" disabled={mStart.isPending || !selectedAssets.length || !selectedTfs.length} onClick={() => mStart.mutate()}>
          {mStart.isPending ? <><Loader2 className="size-4 mr-2 animate-spin" />Executando…</> : "Executar backtest"}
        </Button>
      </div>
    </div>
  );
}
