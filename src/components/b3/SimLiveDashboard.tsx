import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Pause, Play, TrendingUp, TrendingDown, Activity, Users } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  BarChart, Bar, PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis,
} from "recharts";
import { listB3Simulations } from "@/lib/b3-simulation.functions";
import { getB3SimLiveDashboard } from "@/lib/b3-sim-history.functions";

const MODES = ["conservador", "moderado", "equilibrado", "semi_agressivo", "agressivo"] as const;
type Mode = typeof MODES[number];

const COLOR: Record<Mode, string> = {
  conservador: "#10b981",
  moderado: "#0ea5e9",
  equilibrado: "#8b5cf6",
  semi_agressivo: "#f59e0b",
  agressivo: "#f43f5e",
};
const BRL = (v: number) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const NUM = (v: number, d = 0) => Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function SimLiveDashboard() {
  const [runId, setRunId] = useState<string | null>(null);
  const [hours, setHours] = useState<number>(6);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState<Record<Mode, boolean>>(() => Object.fromEntries(MODES.map(m => [m, true])) as Record<Mode, boolean>);

  const listRuns = useServerFn(listB3Simulations);
  const getLive = useServerFn(getB3SimLiveDashboard);

  const liveInterval = useVisibleRefetchInterval(20000);
  const runsQ = useQuery({ queryKey: ["b3-sim-runs"], queryFn: () => listRuns() });
  const effRun = runId ?? runsQ.data?.[0]?.id ?? null;

  const liveQ = useQuery({
    queryKey: ["b3-sim-live", effRun, hours],
    queryFn: () => getLive({ data: { run_id: effRun!, hours } }),
    enabled: !!effRun,
    refetchInterval: paused ? false : liveInterval,
    refetchIntervalInBackground: false,
  });

  const d = liveQ.data;

  const modeById = useMemo(() => {
    const m: Record<string, any> = {};
    (d?.modes ?? []).forEach((x: any) => (m[x.id] = x));
    return m;
  }, [d?.modes]);

  // Série de preço com marcadores de abertura/fechamento
  const priceSeries = useMemo(() => {
    if (!d) return [] as any[];
    return (d.snapshots ?? []).map((s: any) => ({
      t: new Date(s.market_time).getTime(),
      price: Number(s.price ?? s.candle_close ?? 0),
    }));
  }, [d]);

  const tradeMarkers = useMemo(() => {
    if (!d) return { opens: [], closes: [] } as { opens: any[]; closes: any[] };
    const opens: any[] = [];
    const closes: any[] = [];
    (d.orders ?? []).forEach((o: any) => {
      const mode = (modeById[o.simulation_mode_id]?.mode ?? o.mode) as Mode;
      if (!visible[mode]) return;
      if (o.entry_time) opens.push({ t: new Date(o.entry_time).getTime(), price: Number(o.entry_price), mode, side: o.side });
      if (o.status === "closed" && o.exit_time && o.exit_price)
        closes.push({ t: new Date(o.exit_time).getTime(), price: Number(o.exit_price), mode, pnl: Number(o.net_result_brl ?? 0) });
    });
    return { opens, closes };
  }, [d, modeById, visible]);

  // Curvas de patrimônio por modo
  const equitySeries = useMemo(() => {
    if (!d) return [] as any[];
    const byMode = Object.fromEntries(MODES.map(m => [m, [] as { t: number; equity: number }[]])) as Record<Mode, { t: number; equity: number }[]>;
    const initial = Number(d.run?.initial_balance ?? 10000);
    MODES.forEach((m) => byMode[m].push({ t: new Date(d.run.started_at).getTime(), equity: initial }));
    const sorted = [...(d.orders ?? [])].filter((o) => o.status === "closed" && o.exit_time)
      .sort((a, b) => new Date(a.exit_time).getTime() - new Date(b.exit_time).getTime());
    const acc = Object.fromEntries(MODES.map(m => [m, initial])) as Record<Mode, number>;
    sorted.forEach((o) => {
      const mode = (modeById[o.simulation_mode_id]?.mode ?? o.mode) as Mode;
      if (!MODES.includes(mode)) return;
      acc[mode] += Number(o.net_result_brl ?? 0);
      byMode[mode].push({ t: new Date(o.exit_time).getTime(), equity: acc[mode] });
    });
    // merge em timeline única
    const ts = new Set<number>();
    MODES.forEach((m) => byMode[m].forEach((p) => ts.add(p.t)));
    const allT = [...ts].sort((a, b) => a - b);
    const last = Object.fromEntries(MODES.map(m => [m, initial])) as Record<Mode, number>;
    const idx = Object.fromEntries(MODES.map(m => [m, 0])) as Record<Mode, number>;
    return allT.map((t) => {
      const row: any = { t };
      MODES.forEach((m) => {
        while (idx[m] < byMode[m].length && byMode[m][idx[m]].t <= t) { last[m] = byMode[m][idx[m]].equity; idx[m]++; }
        row[m] = last[m];
      });
      return row;
    });
  }, [d, modeById]);

  // Distribuição BUY x SELL por modo + motivos de fechamento
  const distData = useMemo(() => {
    if (!d) return { sides: [], reasons: [] } as any;
    const sides = Object.fromEntries(MODES.map(m => [m, { mode: m, buy: 0, sell: 0 }])) as Record<Mode, { mode: Mode; buy: number; sell: number }>;
    const reasons = Object.fromEntries(MODES.map(m => [m, { mode: m, gain: 0, stop: 0, manual: 0, time: 0 }])) as Record<Mode, any>;
    (d.orders ?? []).forEach((o: any) => {
      const mode = (modeById[o.simulation_mode_id]?.mode ?? o.mode) as Mode;
      if (!MODES.includes(mode)) return;
      if (o.side === "buy") sides[mode].buy++; else sides[mode].sell++;
      if (o.status === "closed") {
        const r = (o.close_reason ?? "").toLowerCase();
        if (r.includes("gain") || r.includes("target") || r.includes("take")) reasons[mode].gain++;
        else if (r.includes("stop") || r.includes("loss")) reasons[mode].stop++;
        else if (r.includes("manual")) reasons[mode].manual++;
        else if (r.includes("time") || r.includes("force") || r.includes("close")) reasons[mode].time++;
        else reasons[mode].time++;
      }
    });
    return { sides: Object.values(sides), reasons: Object.values(reasons) };
  }, [d, modeById]);

  // PnL por modo (líquido, bruto, taxas)
  const pnlByMode = useMemo(() => {
    if (!d) return [] as any[];
    return (d.modes ?? []).map((m: any) => ({
      mode: m.mode,
      liquido: Number(m.realized_pnl ?? 0),
      taxas: Number(m.total_fees ?? 0),
      bruto: Number(m.realized_pnl ?? 0) + Number(m.total_fees ?? 0),
    }));
  }, [d]);

  // Atividade por hora
  const activityByHour = useMemo(() => {
    if (!d) return [] as any[];
    const buckets: Record<number, any> = {};
    for (let h = 9; h <= 18; h++) {
      const row: any = { hour: `${String(h).padStart(2, "0")}h` };
      MODES.forEach(m => { row[m] = 0; });
      buckets[h] = row;
    }
    (d.orders ?? []).forEach((o: any) => {
      const mode = (modeById[o.simulation_mode_id]?.mode ?? o.mode) as Mode;
      if (!MODES.includes(mode)) return;
      const h = new Date(o.entry_time ?? o.created_at).getHours();
      if (buckets[h]) buckets[h][mode]++;
    });
    return Object.values(buckets);
  }, [d, modeById]);

  if (runsQ.isLoading) return <p className="text-sm text-muted-foreground p-6">Carregando simulações…</p>;
  if (!runsQ.data?.length) return <p className="text-sm text-muted-foreground p-6">Nenhuma simulação encontrada. Inicie uma em "Simulação 5 Modos".</p>;

  return (
    <div className="space-y-4 mt-3">
      {/* Controles */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Simulação</Label>
            <Select value={effRun ?? ""} onValueChange={(v) => setRunId(v)}>
              <SelectTrigger className="w-[280px]"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {runsQ.data.map((r: any) => (
                  <SelectItem key={r.id} value={r.id}>
                    {new Date(r.started_at).toLocaleString("pt-BR")} · {r.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Período</Label>
            <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Última 1h</SelectItem>
                <SelectItem value="4">Últimas 4h</SelectItem>
                <SelectItem value="9">Hoje (9h)</SelectItem>
                <SelectItem value="24">Últimas 24h</SelectItem>
                <SelectItem value="72">Últimos 3 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {MODES.map((m) => (
            <div key={m} className="flex items-center gap-2">
              <Switch checked={visible[m]} onCheckedChange={(c) => setVisible((s) => ({ ...s, [m]: c }))} />
              <Label className="text-xs capitalize" style={{ color: COLOR[m] }}>{m}</Label>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>
            {paused ? <><Play className="w-4 h-4 mr-1" />Retomar</> : <><Pause className="w-4 h-4 mr-1" />Pausar</>}
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">
            {paused ? "Atualização pausada" : "Auto-refresh 15s"} · última: {liveQ.dataUpdatedAt ? new Date(liveQ.dataUpdatedAt).toLocaleTimeString("pt-BR") : "—"}
          </span>
        </CardContent>
      </Card>

      {/* Cards de estado por modo */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {(d?.modes ?? []).map((m: any) => {
          const openOrders = (d?.orders ?? []).filter((o: any) => o.simulation_mode_id === m.id && o.status === "open");
          const pnl = Number(m.realized_pnl ?? 0);
          const lastPrice = Number((d as any)?.last_price ?? 0);
          const pointValue = Number((d as any)?.point_value_brl ?? 0.2);
          return (
            <Card key={m.id} style={{ borderColor: COLOR[m.mode as Mode] + "55" }}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base capitalize flex items-center gap-2">
                  <Activity className="w-4 h-4" style={{ color: COLOR[m.mode as Mode] }} />
                  {m.mode}
                </CardTitle>
                <Badge variant={pnl >= 0 ? "default" : "destructive"}>{BRL(pnl)}</Badge>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p className="text-muted-foreground">Patrimônio: <span className="font-semibold text-foreground">{BRL(Number(m.current_balance ?? 0))}</span></p>
                <p className="text-xs text-muted-foreground">Trades: {m.total_trades ?? 0} · ganhos {m.winning_trades ?? 0} · perdas {m.losing_trades ?? 0}</p>
                <p className="text-xs text-muted-foreground">Taxas: {BRL(Number(m.total_fees ?? 0))} · pontos {NUM(Number(m.points_result ?? 0))}</p>
                {openOrders.length > 0 ? (
                  <div className="mt-2 pt-2 border-t border-border/40 space-y-1">
                    <p className="text-xs font-medium text-emerald-400">Posição aberta: SIM</p>
                    {openOrders.map((o: any) => {
                      const entry = Number(o.entry_price);
                      const qty = Number(o.quantity ?? 1);
                      const dir = o.side === "buy" ? 1 : -1;
                      const openPts = lastPrice > 0 ? (lastPrice - entry) * dir : 0;
                      const floatPnl = openPts * qty * pointValue;
                      return (
                        <div key={o.id} className="text-xs space-y-0.5">
                          <p>
                            <Badge variant="outline" className="mr-1">{o.side === "buy" ? "LONG" : "SHORT"}</Badge>
                            {qty}c · entrada {NUM(entry)} · desde {fmtTime(o.entry_time)}
                          </p>
                          <p className="text-muted-foreground">
                            Último tick: {lastPrice > 0 ? NUM(lastPrice) : "—"}
                            {(d as any)?.last_price_at ? ` (${fmtTime((d as any).last_price_at)})` : ""}
                          </p>
                          <p>
                            Pontos em aberto: <span className={openPts >= 0 ? "text-emerald-400" : "text-red-400"}>{NUM(openPts, 0)} pts</span>
                            {" · PnL flutuante: "}
                            <span className={floatPnl >= 0 ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>{BRL(floatPnl)}</span>
                          </p>
                          <p className="text-muted-foreground">
                            Stop {o.stop_loss ? NUM(Number(o.stop_loss)) : "—"} · Alvo {o.take_profit ? NUM(Number(o.take_profit)) : "—"} · Zeragem 17:10
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-xs text-muted-foreground italic">Sem posição aberta</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>


      {/* Preço do WIN ao vivo com marcadores */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Preço do WIN ao vivo · aberturas (▲▼) e fechamentos (○)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => fmtTime(new Date(t).toISOString())} scale="time" tick={{ fontSize: 10 }} />
              <YAxis dataKey="price" domain={["dataMin - 50", "dataMax + 50"]} tick={{ fontSize: 10 }} tickFormatter={(v) => NUM(v)} />
              <ZAxis range={[40, 80]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                formatter={(v: any, k: string) => k === "price" ? NUM(Number(v)) : v}
                labelFormatter={(t: any) => fmtTime(new Date(t).toISOString())}
              />
              <Legend />
              <Scatter name="Preço" data={priceSeries} fill="#94a3b8" line shape="circle" legendType="line" />
              {MODES.filter((m) => visible[m]).map((m) => (
                <Scatter
                  key={`open-${m}`}
                  name={`${m} abre`}
                  data={tradeMarkers.opens.filter((x) => x.mode === m)}
                  fill={COLOR[m]}
                  shape={(props: any) => {
                    const { cx, cy, payload } = props;
                    if (cx == null || cy == null) return <g />;
                    return payload.side === "buy"
                      ? <polygon points={`${cx},${cy - 7} ${cx - 6},${cy + 4} ${cx + 6},${cy + 4}`} fill={COLOR[m]} stroke="#0008" />
                      : <polygon points={`${cx},${cy + 7} ${cx - 6},${cy - 4} ${cx + 6},${cy - 4}`} fill={COLOR[m]} stroke="#0008" />;
                  }}
                />
              ))}
              {MODES.filter((m) => visible[m]).map((m) => (
                <Scatter
                  key={`close-${m}`}
                  name={`${m} fecha`}
                  data={tradeMarkers.closes.filter((x) => x.mode === m)}
                  fill="none"
                  shape={(props: any) => {
                    const { cx, cy } = props;
                    if (cx == null || cy == null) return <g />;
                    return <circle cx={cx} cy={cy} r={6} fill="none" stroke={COLOR[m]} strokeWidth={2} />;
                  }}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
          {priceSeries.length === 0 && <p className="text-xs text-muted-foreground mt-2">Sem snapshots de mercado nesse período ainda — aguarde o próximo tick do cron.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Patrimônio */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Evolução do patrimônio</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={equitySeries}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="t" tickFormatter={(t) => fmtTime(new Date(t).toISOString())} tick={{ fontSize: 10 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} tickFormatter={(v) => BRL(v)} width={90} />
                <Tooltip formatter={(v: any) => BRL(Number(v))} labelFormatter={(t: any) => fmtTime(new Date(t).toISOString())} />
                <Legend />
                {MODES.filter((m) => visible[m]).map((m) => (
                  <Line key={m} type="monotone" dataKey={m} stroke={COLOR[m]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* PnL por modo */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">PnL acumulado por modo</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={pnlByMode}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="mode" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => BRL(v)} width={90} />
                <Tooltip formatter={(v: any) => BRL(Number(v))} />
                <Legend />
                <Bar dataKey="bruto" name="Bruto" fill="#64748b" />
                <Bar dataKey="taxas" name="Taxas" fill="#f59e0b" />
                <Bar dataKey="liquido" name="Líquido">
                  {pnlByMode.map((row: any, i: number) => (
                    <Cell key={i} fill={COLOR[row.mode as Mode]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Distribuição BUY/SELL */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Direção das operações</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {distData.sides.map((s: any) => {
                const data = [{ name: "LONG", value: s.buy }, { name: "SHORT", value: s.sell }];
                const total = s.buy + s.sell;
                return (
                  <div key={s.mode} className="text-center">
                    <p className="text-xs capitalize font-medium" style={{ color: COLOR[s.mode as Mode] }}>{s.mode}</p>
                    <ResponsiveContainer width="100%" height={140}>
                      <PieChart>
                        <Pie data={data} dataKey="value" innerRadius={28} outerRadius={50}>
                          <Cell fill="#10b981" /><Cell fill="#f43f5e" />
                        </Pie>
                        <Tooltip formatter={(v: any) => `${v} ops`} />
                      </PieChart>
                    </ResponsiveContainer>
                    <p className="text-[10px] text-muted-foreground">{total} ops · {s.buy}↑ / {s.sell}↓</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Motivos de fechamento */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Motivos de fechamento</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={distData.reasons}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="mode" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="gain" name="Alvo" stackId="a" fill="#10b981" />
                <Bar dataKey="stop" name="Stop" stackId="a" fill="#f43f5e" />
                <Bar dataKey="manual" name="Manual" stackId="a" fill="#0ea5e9" />
                <Bar dataKey="time" name="Tempo/Outro" stackId="a" fill="#a78bfa" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Atividade por hora */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Atividade por hora do pregão</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={activityByHour}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              {MODES.filter((m) => visible[m]).map((m) => (
                <Bar key={m} dataKey={m} fill={COLOR[m]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Últimos votos do comitê */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> Últimos votos do comitê</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border/40">
                <tr><th className="text-left py-1">Hora</th><th className="text-left">Modo</th><th className="text-left">Agente</th><th className="text-left">Voto</th><th className="text-right">Conf.</th><th className="text-left pl-3">Motivo</th></tr>
              </thead>
              <tbody>
                {(d?.recent_votes ?? []).slice(0, 20).map((v: any, i: number) => (
                  <tr key={i} className="border-b border-border/20">
                    <td className="py-1 font-mono text-muted-foreground">{fmtTime(v.created_at)}</td>
                    <td className="capitalize" style={{ color: COLOR[v.mode as Mode] }}>{v.mode}</td>
                    <td>{v.agent_name}</td>
                    <td>
                      <Badge variant={v.vote === "buy" ? "default" : v.vote === "sell" ? "destructive" : "outline"} className="text-[10px]">
                        {v.vote === "buy" ? <><TrendingUp className="w-3 h-3 mr-1" />LONG</> : v.vote === "sell" ? <><TrendingDown className="w-3 h-3 mr-1" />SHORT</> : v.vote?.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="text-right font-mono">{(Number(v.confidence ?? 0) * 100).toFixed(0)}%</td>
                    <td className="pl-3 text-muted-foreground truncate max-w-[420px]">{v.reason}</td>
                  </tr>
                ))}
                {(d?.recent_votes ?? []).length === 0 && (
                  <tr><td colSpan={6} className="py-3 text-center text-muted-foreground">Sem votos registrados ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
