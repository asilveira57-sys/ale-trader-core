import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboard, setRobotStatus, collectMarket, runCommitteeAll, getTickersByTimeframe, getPairKlines } from "@/lib/atrader.functions";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, RefreshCw, TrendingUp, TrendingDown, Wallet, Wifi, WifiOff, Brain, Activity } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const TIMEFRAMES = [
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hora" },
  { value: "4h", label: "4 horas" },
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
] as const;
type TF = typeof TIMEFRAMES[number]["value"];

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — AleTrader AI" }] }),
  component: DashboardPage,
});

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: n > 1 ? 2 : 6 });

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`size-2 rounded-full ${ok ? "bg-success" : "bg-destructive"}`} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function DashboardPage() {
  const qc = useQueryClient();
  const fetchDash = useServerFn(getDashboard);
  const toggle = useServerFn(setRobotStatus);
  const collect = useServerFn(collectMarket);
  const runAll = useServerFn(runCommitteeAll);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fetchDash({}),
    refetchInterval: 15000,
  });

  const fetchTickers = useServerFn(getTickersByTimeframe);
  const [tf, setTf] = useState<TF>("24h");
  const tickersQ = useQuery({
    queryKey: ["dashboard-tickers", tf],
    queryFn: () => fetchTickers({ data: { timeframe: tf } }),
    refetchInterval: 30000,
  });

  const mToggle = useMutation({
    mutationFn: (status: "active" | "paused") => toggle({ data: { status } }),
    onSuccess: (_, status) => {
      toast.success(status === "active" ? "Robô reativado" : "Robô pausado");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const mCollect = useMutation({
    mutationFn: () => collect({}),
    onSuccess: (r: any) => {
      toast.success(r.skipped ? "Robô pausado — coleta ignorada" : `Coleta: ${r.collected} ativos${r.mock ? " (mock)" : ""}`);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <div className="p-8 text-muted-foreground">Carregando painel…</div>;
  }

  const status = data.settings?.status ?? "paused";
  const mock = data.settings?.binance_mock_mode ?? true;

  return (
    <div className="p-8 space-y-8 max-w-7xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Painel principal</h1>
          <p className="text-sm text-muted-foreground">Modo de operação: <span className="font-medium text-foreground">{data.settings?.mode}</span> · Binance: <span className="font-medium text-foreground">{mock ? "mock" : "leitura"}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => mCollect.mutate()} disabled={mCollect.isPending}>
            <RefreshCw className={`size-4 mr-2 ${mCollect.isPending ? "animate-spin" : ""}`} />
            Coletar agora
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link to="/committee">Ver comitê</Link>
          </Button>
          <Button size="sm" onClick={async () => {
            try { const r: any = await runAll({}); toast.success(`Comitê: ${r.ok}/${r.total}`); qc.invalidateQueries(); }
            catch (e: any) { toast.error(e.message); }
          }}>
            Executar comitê
          </Button>
          {status === "active" ? (
            <Button variant="destructive" size="sm" onClick={() => mToggle.mutate("paused")} disabled={mToggle.isPending}>
              <Pause className="size-4 mr-2" /> Pausar robô
            </Button>
          ) : (
            <Button size="sm" onClick={() => mToggle.mutate("active")} disabled={mToggle.isPending}>
              <Play className="size-4 mr-2" /> Reativar robô
            </Button>
          )}
        </div>
      </header>

      {/* Status row */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Status do robô</p>
            <Activity className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-3 text-2xl font-semibold">
            <Badge variant={status === "active" ? "default" : status === "paused" ? "secondary" : "destructive"} className="text-sm">
              {status === "active" ? "Ativo" : status === "paused" ? "Pausado" : "Erro"}
            </Badge>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Atualizado {new Date(data.settings?.updated_at ?? Date.now()).toLocaleTimeString()}</p>
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Binance</p>
            {data.binance?.connected ? <Wifi className="size-4 text-success" /> : <WifiOff className="size-4 text-destructive" />}
          </div>
          <p className="mt-3 text-lg font-medium">{data.binance?.connected ? "Conectado" : "Desconectado"}</p>
          <StatusDot ok={!!data.binance?.connected} label={data.binance?.account_type ?? "—"} />
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">OpenAI / Lovable AI</p>
            <Brain className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-3 text-lg font-medium">{data.lovable_ai_ok ? "Disponível" : "Indisponível"}</p>
          <StatusDot ok={data.lovable_ai_ok} label="Gateway de IA" />
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Saldo total</p>
            <Wallet className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-3 text-2xl font-semibold font-mono">{fmtUsd(data.total_balance_usdt)}</p>
          <p className="text-xs text-muted-foreground">Valor em USDT (mock)</p>
        </div>
      </section>

      {/* Tickers + balances */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="panel p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold">Ativos monitorados</h2>
              <p className="text-[11px] text-muted-foreground">
                Variação % calculada via Binance (klines) no período selecionado · {tickersQ.data?.fetched_at ? `atualizado ${new Date(tickersQ.data.fetched_at).toLocaleTimeString()}` : "—"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Período:</span>
              <div className="flex rounded-md border border-border overflow-hidden">
                {TIMEFRAMES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTf(opt.value)}
                    className={`px-2 py-1 text-[11px] transition-colors ${tf === opt.value ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="divide-y divide-border">
            {tickersQ.isLoading && <p className="text-sm text-muted-foreground py-6">Carregando cotações…</p>}
            {tickersQ.data?.tickers.map((t: any) => {
              const up = t.change_percent >= 0;
              return (
                <div key={t.pair} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{t.pair}</p>
                    <p className="text-xs text-muted-foreground">{t.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono">{t.ok ? fmtUsd(t.price) : <span className="text-destructive text-xs">indisponível</span>}</p>
                    {t.ok && (
                      <p className={`text-xs flex items-center justify-end gap-1 ${up ? "stat-up" : "stat-down"}`}>
                        {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                        {t.change_percent.toFixed(2)}% <span className="text-muted-foreground">/ {tickersQ.data?.label}</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            {tickersQ.data && !tickersQ.data.tickers.length && <p className="text-sm text-muted-foreground py-6">Nenhum ativo ativo. Cadastre em Ativos.</p>}
          </div>
        </div>


        <div className="panel p-5">
          <h2 className="text-sm font-semibold mb-4">Saldo da carteira</h2>
          <div className="divide-y divide-border">
            {data.balances.map((b: any) => (
              <div key={b.asset} className="flex items-center justify-between py-3 text-sm">
                <span className="font-medium">{b.asset}</span>
                <span className="font-mono text-muted-foreground">{b.free.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Alerts + Logs */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel p-5">
          <h2 className="text-sm font-semibold mb-4">Últimos alertas</h2>
          <ul className="space-y-2">
            {data.alerts.map((a: any) => (
              <li key={a.id} className="flex items-start justify-between gap-3 text-sm border-b border-border pb-2 last:border-0">
                <div>
                  <p className="font-medium">{a.type}{a.pair ? ` · ${a.pair}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{a.message}</p>
                </div>
                <Badge variant={a.severity === "critical" ? "destructive" : a.severity === "warning" ? "secondary" : "outline"}>{a.severity}</Badge>
              </li>
            ))}
            {!data.alerts.length && <p className="text-sm text-muted-foreground">Sem alertas.</p>}
          </ul>
        </div>

        <div className="panel p-5">
          <h2 className="text-sm font-semibold mb-4">Logs recentes</h2>
          <ul className="space-y-2 text-sm">
            {data.logs.map((l: any) => (
              <li key={l.id} className="border-b border-border pb-2 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium">[{l.event_type}] {l.source}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{new Date(l.created_at).toLocaleTimeString()}</span>
                </div>
                <p className="text-xs text-muted-foreground">{l.message}</p>
              </li>
            ))}
            {!data.logs.length && <p className="text-muted-foreground">Sem logs.</p>}
          </ul>
        </div>
      </section>
    </div>
  );
}
