import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMt5SimDashboard, updateMt5SimSettings, upsertMt5SimRobot, startMt5SimRun, stopMt5SimRun, tickMt5SimNow, closeMt5SimTrade, manualBuyMt5Sim, manualSellMt5Sim, manualReverseMt5Sim, setMt5SimRobotMode } from "@/lib/b3-mt5sim.functions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ShieldAlert, PlayCircle, PauseCircle, RefreshCw, Activity } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/b3-mt5sim")({
  head: () => ({ meta: [{ title: "Simulação Local MT5 XP (WINQ26) — AleTrader AI" }] }),
  component: Mt5SimPage,
});

const BRL = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const PCT = (v: number) => `${(Number(v || 0) * 100).toFixed(1)}%`;

function Mt5SimPage() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getMt5SimDashboard);
  const updSettings = useServerFn(updateMt5SimSettings);
  const updRobot = useServerFn(upsertMt5SimRobot);
  const startFn = useServerFn(startMt5SimRun);
  const stopFn = useServerFn(stopMt5SimRun);
  const tickFn = useServerFn(tickMt5SimNow);
  const closeFn = useServerFn(closeMt5SimTrade);
  const buyFn = useServerFn(manualBuyMt5Sim);
  const sellFn = useServerFn(manualSellMt5Sim);
  const reverseFn = useServerFn(manualReverseMt5Sim);
  const modeFn = useServerFn(setMt5SimRobotMode);

  const { data, isLoading } = useQuery({ queryKey: ["b3-mt5sim"], queryFn: () => fetchFn({}), refetchInterval: 3000 });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["b3-mt5sim"] });

  const mStart = useMutation({ mutationFn: () => startFn({}), onSuccess: () => { toast.success("Simulação iniciada"); invalidate(); } });
  const mStop = useMutation({ mutationFn: () => stopFn({}), onSuccess: () => { toast.success("Simulação parada"); invalidate(); } });
  const mTick = useMutation({ mutationFn: () => tickFn({}), onSuccess: (r: any) => { toast.success(`Tick: ${r.status} · sinais ${r.signals} · abertas ${r.opened} · fechadas ${r.closed}`); invalidate(); }, onError: (e: any) => toast.error(e.message) });
  const mSettings = useMutation({ mutationFn: (d: any) => updSettings({ data: d }), onSuccess: () => { toast.success("Configuração salva"); invalidate(); } });
  const mRobot = useMutation({ mutationFn: (d: any) => updRobot({ data: d }), onSuccess: () => { toast.success("Robô salvo"); invalidate(); } });
  const mClose = useMutation({ mutationFn: (id: string) => closeFn({ data: { trade_id: id } }), onSuccess: () => { toast.success("Trade fechada"); invalidate(); }, onError: (e: any) => toast.error(e.message) });
  const mBuy = useMutation({ mutationFn: (id: string) => buyFn({ data: { robot_id: id } }), onSuccess: () => { toast.success("Compra simulada aberta"); invalidate(); }, onError: (e: any) => toast.error(e.message) });
  const mSell = useMutation({ mutationFn: (id: string) => sellFn({ data: { robot_id: id } }), onSuccess: () => { toast.success("Venda simulada aberta"); invalidate(); }, onError: (e: any) => toast.error(e.message) });
  const mReverse = useMutation({ mutationFn: (id: string) => reverseFn({ data: { robot_id: id } }), onSuccess: () => { toast.success("Virada simulada aplicada"); invalidate(); }, onError: (e: any) => toast.error(e.message) });
  const mMode = useMutation({ mutationFn: (p: { robot_id: string; mode: "manual"|"auto"|"paused" }) => modeFn({ data: p }), onSuccess: () => { toast.success("Modo do robô atualizado"); invalidate(); } });


  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando…</div>;

  const s = data.settings as any;
  const quote = data.quote as any;
  const running = data.run?.status === "running";
  const staleQuote = data.quote_age_s == null || data.quote_age_s > (s.quote_ttl_seconds ?? 15);

  // Servidor que está de fato alimentando a simulação: prioridade para o servidor do último tick.
  const feedingServer = (quote?.server ?? s.server ?? "XPMT5-DEMO").toUpperCase();
  const isDemo = feedingServer === "XPMT5-DEMO";
  const isPrd = feedingServer === "XPMT5-PRD";
  const bannerText = isDemo
    ? "Simulação Local — Cotação MT5 XP DEMO — Sem envio de ordem"
    : isPrd
      ? "Simulação Local — Cotação MT5 XP PRD — Sem envio de ordem"
      : `Simulação Local — Servidor ${feedingServer || "desconhecido"} — Sem envio de ordem`;
  const bannerAccent = isDemo
    ? "border-sky-500/40 bg-sky-500/10"
    : "border-orange-500/40 bg-orange-500/10";
  const bannerIconColor = isDemo ? "text-sky-400" : "text-orange-400";
  const bannerTagColor = isDemo ? "text-sky-300" : "text-orange-300";

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header destaque */}
      <div className={`panel p-5 border-2 ${bannerAccent}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className={`text-xs uppercase tracking-wider ${bannerTagColor}`}>Modo · Servidor ativo: {feedingServer}</div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <ShieldAlert className={`size-6 ${bannerIconColor}`} />
              {bannerText}
            </h1>
            <div className="text-sm text-muted-foreground mt-1">
              Servidor configurado <span className="font-mono">{s.server}</span> · Alimentando <span className="font-mono">{feedingServer}</span> · Símbolo <span className="font-mono">{s.mt5_symbol}</span> · Robôs ativos: {(data.robots as any[]).filter(r => r.enabled).length} · Ordens reais enviadas: <span className="font-mono text-emerald-400">0</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => mTick.mutate()} variant="outline" disabled={mTick.isPending}><RefreshCw className="size-4 mr-1" /> Tick agora</Button>
            {running
              ? <Button variant="destructive" onClick={() => mStop.mutate()}><PauseCircle className="size-4 mr-1" /> Parar</Button>
              : <Button onClick={() => mStart.mutate()}><PlayCircle className="size-4 mr-1" /> Iniciar Simulação</Button>}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 text-sm">
          <Stat label="Bid" value={quote?.bid != null ? Number(quote.bid).toLocaleString("pt-BR") : "—"} />
          <Stat label="Ask" value={quote?.ask != null ? Number(quote.ask).toLocaleString("pt-BR") : "—"} />
          <Stat label="Último" value={quote?.last != null ? Number(quote.last).toLocaleString("pt-BR") : "—"} />
          <Stat label="Spread" value={quote?.spread != null ? Number(quote.spread).toFixed(1) : "—"} />
          <Stat label="Idade do tick" value={data.quote_age_s != null ? `${Math.round(data.quote_age_s)}s` : "—"} className={staleQuote ? "text-red-400" : ""} />
        </div>
        {staleQuote && (
          <div className="mt-3 text-sm text-red-300 border border-red-500/40 bg-red-500/10 rounded p-2">
            Cotação inválida ou desatualizada — simulação pausada. Verifique o puller local do MT5 ({feedingServer}).
          </div>
        )}
      </div>


      <Tabs defaultValue="painel">
        <TabsList>
          <TabsTrigger value="painel"><Activity className="size-4 mr-1" /> Painel</TabsTrigger>
          <TabsTrigger value="robos">Robôs & Travas</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
          <TabsTrigger value="trades">Trades simuladas</TabsTrigger>
          <TabsTrigger value="blocks">Sinais bloqueados</TabsTrigger>
          <TabsTrigger value="conflicts">Conflitos</TabsTrigger>
          <TabsTrigger value="ingest">Ponte MT5</TabsTrigger>
        </TabsList>

        <TabsContent value="painel" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Carteira simulada por robô — hoje</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2">Robô</th>
                    <th className="text-right">Saldo</th>
                    <th className="text-right">PnL bruto</th>
                    <th className="text-right">PnL líquido</th>
                    <th className="text-right">Taxas</th>
                    <th className="text-right">Trades</th>
                    <th className="text-right">Acerto</th>
                    <th className="text-right">DD</th>
                    <th className="text-right">Pos.</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.robots as any[]).map((r) => {
                    const w = (data.wallets as any[]).find((x) => x.robot_id === r.id) ?? {};
                    return (
                      <tr key={r.id} className="border-b border-border/40">
                        <td className="py-2 font-medium">{r.profile}</td>
                        <td className="text-right font-mono">{BRL(w.current_balance_brl ?? r.initial_balance_brl)}</td>
                        <td className="text-right font-mono">{BRL(w.pnl_gross_brl ?? 0)}</td>
                        <td className={`text-right font-mono ${Number(w.pnl_net_brl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{BRL(w.pnl_net_brl ?? 0)}</td>
                        <td className="text-right font-mono text-muted-foreground">{BRL(w.fees_brl ?? 0)}</td>
                        <td className="text-right font-mono">{w.trades_count ?? 0}</td>
                        <td className="text-right font-mono">{PCT(w.hit_rate ?? 0)}</td>
                        <td className="text-right font-mono">{BRL(w.drawdown_brl ?? 0)}</td>
                        <td className="text-right font-mono">{w.position_side ? `${w.position_side} ${w.position_qty}@${Number(w.position_avg_price).toLocaleString("pt-BR")}` : "—"}</td>
                        <td><Badge variant={r.enabled ? "default" : "secondary"}>{r.enabled ? "ativo" : "desligado"}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Ranking</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border"><tr><th className="text-left py-2">#</th><th className="text-left">Robô</th><th className="text-right">PnL líq.</th><th className="text-right">Acerto</th><th className="text-right">DD</th><th className="text-right">Trades</th><th className="text-right">Score composto</th></tr></thead>
                <tbody>
                  {(data.ranking as any[]).map((r, i) => (
                    <tr key={r.robot_id} className="border-b border-border/40">
                      <td className="py-2 font-mono text-muted-foreground">{i + 1}</td>
                      <td className="font-medium">{r.profile}</td>
                      <td className={`text-right font-mono ${r.pnl_net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{BRL(r.pnl_net)}</td>
                      <td className="text-right font-mono">{PCT(r.hit_rate)}</td>
                      <td className="text-right font-mono">{BRL(r.drawdown)}</td>
                      <td className="text-right font-mono">{r.trades}</td>
                      <td className="text-right font-mono">{r.composite.toFixed(1)}</td>
                    </tr>
                  ))}
                  {(data.ranking as any[]).length === 0 && <tr><td colSpan={7} className="py-4 text-muted-foreground text-center">Sem operações simuladas hoje ainda.</td></tr>}
                </tbody>
              </table>
              <div className="text-xs text-muted-foreground mt-3">Ranking de Simulação Local com Cotação Real — Sem Ordem Executada.</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Critério para próxima fase</CardTitle></CardHeader>
            <CardContent>
              {data.promotion_ready
                ? <div className="text-emerald-400 text-sm">Amostra suficiente. Robôs prontos para consideração de execução real.</div>
                : <div className="text-orange-300 text-sm">Execução real bloqueada — simulação ainda insuficiente. Mínimo por robô: {s.min_trades_per_robot} trades, DD ≤ {BRL(s.max_drawdown_brl)}, acerto ≥ {PCT(s.min_hit_rate)}, PnL líq. ≥ {BRL(s.min_net_pnl_brl)}.</div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="robos">
          <RobotsEditor robots={data.robots as any[]} onSave={(payload) => mRobot.mutate(payload)} />
        </TabsContent>

        <TabsContent value="config">
          <SettingsEditor settings={s} onSave={(payload) => mSettings.mutate(payload)} />
        </TabsContent>

        <TabsContent value="trades">
          <Card><CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border"><tr><th className="text-left py-2 pl-3">Robô</th><th>Side</th><th className="text-right">Vol</th><th className="text-right">Entrada</th><th className="text-right">Saída</th><th className="text-right">Pts</th><th className="text-right">Bruto</th><th className="text-right">Líq.</th><th>Motivo saída</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {(data.trades as any[]).map((t) => {
                  const r = (data.robots as any[]).find((x) => x.id === t.robot_id);
                  return (
                    <tr key={t.id} className="border-b border-border/40">
                      <td className="py-2 pl-3">{r?.profile}</td>
                      <td><Badge className={t.side === "buy" ? "bg-emerald-600" : "bg-red-600"}>{t.side}</Badge></td>
                      <td className="text-right font-mono">{t.volume}</td>
                      <td className="text-right font-mono">{Number(t.price_entry_sim).toLocaleString("pt-BR")}</td>
                      <td className="text-right font-mono">{t.price_exit_sim != null ? Number(t.price_exit_sim).toLocaleString("pt-BR") : "—"}</td>
                      <td className="text-right font-mono">{t.points_result ?? "—"}</td>
                      <td className="text-right font-mono">{t.gross_brl != null ? BRL(t.gross_brl) : "—"}</td>
                      <td className={`text-right font-mono ${Number(t.net_brl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{t.net_brl != null ? BRL(t.net_brl) : "—"}</td>
                      <td className="text-xs">{t.exit_reason ?? "—"}</td>
                      <td><Badge variant="outline">{t.status}</Badge></td>
                      <td className="text-right pr-3">{t.status === "open" && <Button size="sm" variant="outline" onClick={() => mClose.mutate(t.id)}>Fechar</Button>}</td>
                    </tr>
                  );
                })}
                {(data.trades as any[]).length === 0 && <tr><td colSpan={11} className="py-4 text-muted-foreground text-center">Sem trades simuladas ainda.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="blocks">
          <Card><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border"><tr><th className="text-left py-2 pl-3">Hora</th><th>Robô</th><th>Trava</th><th className="text-right">Observado</th><th className="text-right">Limite</th><th>Motivo</th></tr></thead>
              <tbody>
                {(data.blocks as any[]).map((b) => {
                  const r = (data.robots as any[]).find((x) => x.id === b.robot_id);
                  return (
                    <tr key={b.id} className="border-b border-border/40">
                      <td className="py-2 pl-3 font-mono text-muted-foreground">{new Date(b.ts).toLocaleTimeString()}</td>
                      <td>{r?.profile ?? "—"}</td>
                      <td><Badge variant="secondary">{b.lock_kind}</Badge></td>
                      <td className="text-right font-mono">{b.observed ?? "—"}</td>
                      <td className="text-right font-mono">{b.limit_value ?? "—"}</td>
                      <td className="text-xs">{b.reason}</td>
                    </tr>
                  );
                })}
                {(data.blocks as any[]).length === 0 && <tr><td colSpan={6} className="py-4 text-muted-foreground text-center">Nenhum bloqueio.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="conflicts">
          <Card><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border"><tr><th className="text-left py-2 pl-3">Hora</th><th>Robôs</th><th>Lados</th><th>Preços</th></tr></thead>
              <tbody>
                {(data.conflicts as any[]).map((c) => (
                  <tr key={c.id} className="border-b border-border/40">
                    <td className="py-2 pl-3 font-mono text-muted-foreground">{new Date(c.ts).toLocaleTimeString()}</td>
                    <td className="text-xs">{(c.robots as any[]).map((r) => r.profile).join(", ")}</td>
                    <td className="text-xs font-mono">{(c.sides as any[]).join(" · ")}</td>
                    <td className="text-xs font-mono">{(c.prices as any[]).map((p) => Number(p).toLocaleString("pt-BR")).join(" · ")}</td>
                  </tr>
                ))}
                {(data.conflicts as any[]).length === 0 && <tr><td colSpan={4} className="py-4 text-muted-foreground text-center">Sem conflitos.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="ingest">
          <IngestGuide userId={(data.settings as any).user_id} symbol={s.mt5_symbol} server={s.server} />
        </TabsContent>
      </Tabs>

      {(data.order_attempts as any[]).length > 0 && (
        <Card className="border-red-500/40">
          <CardHeader><CardTitle className="text-red-400">Tentativas de ordem real bloqueadas</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border"><tr><th className="text-left py-2">Hora</th><th>Origem</th><th>Ação</th><th>Mensagem</th></tr></thead>
              <tbody>{(data.order_attempts as any[]).map((a) => (
                <tr key={a.id} className="border-b border-border/40">
                  <td className="py-1 font-mono text-muted-foreground">{new Date(a.ts).toLocaleString()}</td>
                  <td>{a.source}</td><td>{a.action}</td><td className="text-xs">{a.message}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-mono ${className}`}>{value}</div>
    </div>
  );
}

function SettingsEditor({ settings, onSave }: { settings: any; onSave: (d: any) => void }) {
  const [s, setS] = useState(settings);
  return (
    <Card><CardContent className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field label="Fonte de preço"><select className="w-full bg-background border rounded px-2 py-1" value={s.price_source} onChange={(e) => setS({ ...s, price_source: e.target.value })}>
        <option value="last">último preço</option><option value="bid_ask">bid/ask</option><option value="bid_ask_slip">bid/ask + slippage</option>
      </select></Field>
      <Field label="Slippage (ticks)"><Input type="number" value={s.slippage_ticks} onChange={(e) => setS({ ...s, slippage_ticks: Number(e.target.value) })} /></Field>
      <Field label="Taxa por contrato (R$)"><Input type="number" step="0.01" value={s.fee_per_contract_brl} onChange={(e) => setS({ ...s, fee_per_contract_brl: Number(e.target.value) })} /></Field>
      <Field label="TTL da cotação (s)"><Input type="number" value={s.quote_ttl_seconds} onChange={(e) => setS({ ...s, quote_ttl_seconds: Number(e.target.value) })} /></Field>
      <Field label="Início pregão (BRT)"><Input value={s.session_start} onChange={(e) => setS({ ...s, session_start: e.target.value })} /></Field>
      <Field label="Fim pregão (BRT)"><Input value={s.session_end} onChange={(e) => setS({ ...s, session_end: e.target.value })} /></Field>
      <Field label="Volume padrão"><Input type="number" value={s.default_volume} onChange={(e) => setS({ ...s, default_volume: Number(e.target.value) })} /></Field>
      <Field label="Kill switch REAL"><Switch checked={!!s.kill_switch_real} onCheckedChange={(v) => setS({ ...s, kill_switch_real: v })} /></Field>
      <Field label="Usar spread"><Switch checked={!!s.use_spread} onCheckedChange={(v) => setS({ ...s, use_spread: v })} /></Field>
      <Field label="Permitir comprado"><Switch checked={!!s.allow_long} onCheckedChange={(v) => setS({ ...s, allow_long: v })} /></Field>
      <Field label="Permitir vendido"><Switch checked={!!s.allow_short} onCheckedChange={(v) => setS({ ...s, allow_short: v })} /></Field>
      <Field label="Permitir virada"><Switch checked={!!s.allow_reverse} onCheckedChange={(v) => setS({ ...s, allow_reverse: v })} /></Field>
      <Field label="Mín. trades/robô"><Input type="number" value={s.min_trades_per_robot} onChange={(e) => setS({ ...s, min_trades_per_robot: Number(e.target.value) })} /></Field>
      <Field label="Mín. dias"><Input type="number" value={s.min_days} onChange={(e) => setS({ ...s, min_days: Number(e.target.value) })} /></Field>
      <Field label="Divergência aceitável (pts)"><Input type="number" value={s.max_price_divergence_pts} onChange={(e) => setS({ ...s, max_price_divergence_pts: Number(e.target.value) })} /></Field>
      <Field label="DD máx aceitável (R$)"><Input type="number" value={s.max_drawdown_brl} onChange={(e) => setS({ ...s, max_drawdown_brl: Number(e.target.value) })} /></Field>
      <Field label="Acerto mínimo (0-1)"><Input type="number" step="0.01" value={s.min_hit_rate} onChange={(e) => setS({ ...s, min_hit_rate: Number(e.target.value) })} /></Field>
      <Field label="PnL líquido mínimo (R$)"><Input type="number" value={s.min_net_pnl_brl} onChange={(e) => setS({ ...s, min_net_pnl_brl: Number(e.target.value) })} /></Field>
      <div className="md:col-span-3 flex justify-end"><Button onClick={() => onSave({ price_source: s.price_source, slippage_ticks: s.slippage_ticks, fee_per_contract_brl: s.fee_per_contract_brl, quote_ttl_seconds: s.quote_ttl_seconds, session_start: s.session_start, session_end: s.session_end, default_volume: s.default_volume, kill_switch_real: s.kill_switch_real, use_spread: s.use_spread, allow_long: s.allow_long, allow_short: s.allow_short, allow_reverse: s.allow_reverse, min_trades_per_robot: s.min_trades_per_robot, min_days: s.min_days, max_price_divergence_pts: s.max_price_divergence_pts, max_drawdown_brl: s.max_drawdown_brl, min_hit_rate: s.min_hit_rate, min_net_pnl_brl: s.min_net_pnl_brl })}>Salvar configuração</Button></div>
    </CardContent></Card>
  );
}

function RobotsEditor({ robots, onSave }: { robots: any[]; onSave: (d: any) => void }) {
  return (
    <Card><CardContent className="p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b border-border"><tr>
          <th className="text-left py-2 pl-3">Robô</th><th>Ativo</th><th>Vol</th><th>Loss/dia</th><th>Ganho/dia</th><th>Máx trades</th><th>DD máx</th><th>Perdas seguidas</th><th>Score mín</th><th>TTL sinal</th><th>Spread máx (ticks)</th><th></th>
        </tr></thead>
        <tbody>{robots.map((r) => <RobotRow key={r.id} robot={r} onSave={onSave} />)}</tbody>
      </table>
    </CardContent></Card>
  );
}

function RobotRow({ robot, onSave }: { robot: any; onSave: (d: any) => void }) {
  const [r, setR] = useState(robot);
  return (
    <tr className="border-b border-border/40">
      <td className="py-2 pl-3 font-medium">{r.profile}</td>
      <td><Switch checked={!!r.enabled} onCheckedChange={(v) => setR({ ...r, enabled: v })} /></td>
      <td><Input className="w-16" type="number" value={r.volume} onChange={(e) => setR({ ...r, volume: Number(e.target.value) })} /></td>
      <td><Input className="w-24" type="number" value={r.daily_loss_limit_brl} onChange={(e) => setR({ ...r, daily_loss_limit_brl: Number(e.target.value) })} /></td>
      <td><Input className="w-24" type="number" value={r.daily_gain_limit_brl} onChange={(e) => setR({ ...r, daily_gain_limit_brl: Number(e.target.value) })} /></td>
      <td><Input className="w-20" type="number" value={r.max_trades_day} onChange={(e) => setR({ ...r, max_trades_day: Number(e.target.value) })} /></td>
      <td><Input className="w-24" type="number" value={r.max_drawdown_brl} onChange={(e) => setR({ ...r, max_drawdown_brl: Number(e.target.value) })} /></td>
      <td><Input className="w-16" type="number" value={r.max_consec_losses} onChange={(e) => setR({ ...r, max_consec_losses: Number(e.target.value) })} /></td>
      <td><Input className="w-16" type="number" value={r.min_score} onChange={(e) => setR({ ...r, min_score: Number(e.target.value) })} /></td>
      <td><Input className="w-20" type="number" value={r.signal_ttl_s} onChange={(e) => setR({ ...r, signal_ttl_s: Number(e.target.value) })} /></td>
      <td><Input className="w-20" type="number" value={r.max_spread_ticks} onChange={(e) => setR({ ...r, max_spread_ticks: Number(e.target.value) })} /></td>
      <td className="pr-3"><Button size="sm" variant="outline" onClick={() => onSave({ id: r.id, enabled: r.enabled, volume: r.volume, daily_loss_limit_brl: r.daily_loss_limit_brl, daily_gain_limit_brl: r.daily_gain_limit_brl, max_trades_day: r.max_trades_day, max_drawdown_brl: r.max_drawdown_brl, max_consec_losses: r.max_consec_losses, min_score: r.min_score, signal_ttl_s: r.signal_ttl_s, max_spread_ticks: r.max_spread_ticks })}>Salvar</Button></td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-xs text-muted-foreground mb-1">{label}</div>{children}</div>;
}

function IngestGuide({ userId, symbol, server }: { userId: string; symbol: string; server: string }) {
  const endpoint = typeof window !== "undefined" ? `${window.location.origin}/api/public/hooks/b3-mt5sim-tick-ingest` : "/api/public/hooks/b3-mt5sim-tick-ingest";
  const code = `# Puller local — MetaTrader 5 XP (${server}) → ${symbol}
# pip install MetaTrader5 requests
import MetaTrader5 as mt5, requests, json, hmac, hashlib, time
from datetime import datetime, timezone

USER_ID = "${userId}"
SYMBOL  = "${symbol}"
ENDPOINT = "${endpoint}"
SECRET  = "SEU_B3_MT5SIM_INGEST_SECRET"  # mesmo valor guardado em Lovable Cloud

assert mt5.initialize(), mt5.last_error()
mt5.symbol_select(SYMBOL, True)

while True:
    t = mt5.symbol_info_tick(SYMBOL)
    info = mt5.symbol_info(SYMBOL)
    acc  = mt5.account_info()
    if t and info:
        payload = {
          "user_id": USER_ID, "symbol": SYMBOL,
          "bid": t.bid, "ask": t.ask, "last": t.last,
          "spread": (t.ask - t.bid) if (t.bid and t.ask) else None,
          "volume": t.volume, "symbol_status": "ok",
          "mt5_connected": True, "server": acc.server if acc else "${server}",
          "account_masked": (str(acc.login)[-4:].rjust(len(str(acc.login)), "*")) if acc else None,
          "tick_ts": datetime.now(timezone.utc).isoformat(),
        }
        body = json.dumps(payload, separators=(",", ":"))
        sig = hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
        try:
            r = requests.post(ENDPOINT, data=body, headers={"content-type":"application/json","x-mt5-signature":sig}, timeout=5)
            print(r.status_code, r.text[:120])
        except Exception as e:
            print("erro", e)
    time.sleep(1)
`;
  return (
    <Card><CardContent className="p-5 space-y-3">
      <div className="text-sm">Este modo lê cotações reais do MT5 sem enviar ordens. Rode este script no PC onde o MetaTrader 5 XP está logado. O endpoint aceita ticks vindos de <code className="font-mono">XPMT5-DEMO</code> e de <code className="font-mono">XPMT5-PRD</code> — na fase inicial, priorize <code className="font-mono">XPMT5-DEMO</code>. Símbolo monitorado: <code className="font-mono">{symbol}</code>.</div>
      <div className="text-xs text-muted-foreground">Endpoint (HMAC-SHA256 sobre o corpo, header <code>x-mt5-signature</code>) — use SEMPRE a URL publicada, nunca a URL de preview (que tem autenticação):</div>
      <code className="block text-xs bg-muted p-2 rounded break-all">{endpoint}</code>
      <div className="text-xs text-orange-300">Resposta esperada em sucesso: <code>{`{"ok":true,"received":true,"server":"XPMT5-DEMO"}`}</code>. Se o puller receber HTML (<code>&lt;!DOCTYPE html&gt;</code>), a URL usada não é a publicada — troque para a URL acima.</div>
      <div className="text-xs text-muted-foreground">Substitua <code>SEU_B3_MT5SIM_INGEST_SECRET</code> pelo valor do secret <code>B3_MT5SIM_INGEST_SECRET</code> gerado no backend (nunca exibido pela plataforma).</div>
      <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre">{code}</pre>
    </CardContent></Card>
  );
}

