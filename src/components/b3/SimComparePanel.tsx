import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Trophy, Play, Pause, StopCircle, RotateCcw, ListPlus, Trash2, Activity, History, Info, Settings as SettingsIcon, ShieldAlert, Clock } from "lucide-react";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import {
  startB3Simulation, setB3SimulationStatus, setB3SimulationWinner,
  listB3Simulations, getB3SimulationDetail, tickB3Simulation,
  scoreMode, listB3ModeSettings, updateB3ModeSettings, resetB3ModeSettings,
} from "@/lib/b3-simulation.functions";
import { listB3MacroEvents, upsertB3MacroEvent, deleteB3MacroEvent } from "@/lib/b3-macro-events.functions";
import { getB3SimulationReport } from "@/lib/b3-reports.functions";

const BRL = (v: number) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const NUM = (v: number, d = 0) => Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

const MODES = ["conservador", "moderado", "equilibrado", "semi_agressivo", "agressivo"] as const;
type Mode = typeof MODES[number];
const MODE_COLOR: Record<Mode, string> = {
  conservador: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  moderado: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  equilibrado: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  semi_agressivo: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  agressivo: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const STATUS_META: Record<string, { label: string; cls: string; canResumeToday: boolean; type: "operando" | "pausa" | "stop_op" | "stop_dia" | "meta" | "risco" | "horario" | "zeragem" | "erro" }> = {
  operando: { label: "Operando", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", canResumeToday: true, type: "operando" },
  pausado: { label: "Pausado", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30", canResumeToday: true, type: "pausa" },
  stop_operacao: { label: "Stop da operação", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", canResumeToday: true, type: "stop_op" },
  bloqueado_perda_diaria: { label: "Bloqueado · limite diário de perda", cls: "bg-rose-600/20 text-rose-200 border-rose-600/40", canResumeToday: false, type: "stop_dia" },
  bloqueado_meta_diaria: { label: "Bloqueado · meta diária atingida", cls: "bg-emerald-600/20 text-emerald-200 border-emerald-600/40", canResumeToday: false, type: "meta" },
  bloqueado_volatilidade: { label: "Bloqueado · volatilidade", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", canResumeToday: true, type: "risco" },
  bloqueado_horario: { label: "Bloqueado · fora do horário", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30", canResumeToday: true, type: "horario" },
  bloqueado_zeragem: { label: "Bloqueado · zeragem obrigatória", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", canResumeToday: false, type: "zeragem" },
  bloqueado_risco: { label: "Bloqueado · risco macro", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30", canResumeToday: true, type: "risco" },
  erro_tecnico: { label: "Erro técnico", cls: "bg-rose-600/30 text-rose-100 border-rose-600/50", canResumeToday: true, type: "erro" },
};

const STOP_EVENT_META: Record<string, { label: string; cls: string; releasedText?: string }> = {
  stop_operacao: { label: "Stop de operação", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", releasedText: "Operação encerrada pelo stop — robô liberado para novas entradas" },
  stop_trade: { label: "Stop de operação", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", releasedText: "Operação encerrada pelo stop — robô liberado para novas entradas" },
  bloqueado_perda_diaria: { label: "Stop diário", cls: "bg-rose-600/20 text-rose-200 border-rose-600/40" },
  bloqueado_horario: { label: "Corte operacional", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
  erro_tecnico: { label: "Erro técnico", cls: "bg-rose-600/30 text-rose-100 border-rose-600/50" },
};

const PROT_LABEL: Record<string, string> = {
  operating_normal: "Operando normal",
  target_reached_observing: "Meta atingida · em observação",
  profit_protected: "Lucro protegido",
  blocked_stop: "Bloqueado · stop diário",
  blocked_drawdown: "Bloqueado · drawdown",
  blocked_volatility: "Bloqueado · volatilidade",
  blocked_ops_failure: "Bloqueado · falha operacional",
  blocked_post_target_loss: "Bloqueado · perda pós-meta",
};
const PROT_COLOR: Record<string, string> = {
  target_reached_observing: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  profit_protected: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  blocked_stop: "bg-rose-600/20 text-rose-200 border-rose-600/40",
  blocked_drawdown: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  blocked_volatility: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  blocked_ops_failure: "bg-rose-600/30 text-rose-100 border-rose-600/50",
  blocked_post_target_loss: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

function sampleStatus(trades: number): { label: string; cls: string } | null {
  if (trades < 100) return { label: "AMOSTRA INSUFICIENTE PARA VALIDAÇÃO ESTATÍSTICA", cls: "bg-amber-500/10 text-amber-300 border-amber-500/30" };
  if (trades < 300) return { label: "Amostra inicial em formação", cls: "bg-sky-500/10 text-sky-300 border-sky-500/30" };
  if (trades < 500) return { label: "Amostra relevante", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" };
  return { label: "Amostra estatística robusta", cls: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40" };
}


export function SimComparePanel() {
  const qc = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [ticks, setTicks] = useState(10);
  const [period, setPeriod] = useState<"today" | "all" | "custom">("today");
  const todayLocalStart = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 16);
  };
  const [fromInput, setFromInput] = useState<string>(todayLocalStart());
  const [toInput, setToInput] = useState<string>(new Date().toISOString().slice(0, 16));

  const listRuns = useServerFn(listB3Simulations);
  const getDetail = useServerFn(getB3SimulationDetail);
  const start = useServerFn(startB3Simulation);
  const setStatus = useServerFn(setB3SimulationStatus);
  const setWinner = useServerFn(setB3SimulationWinner);
  const tick = useServerFn(tickB3Simulation);
  const getReport = useServerFn(getB3SimulationReport);
  const detailInterval = useVisibleRefetchInterval(10000);
  const reportInterval = useVisibleRefetchInterval(30000);

  const runsQ = useQuery({ queryKey: ["b3-sim-runs"], queryFn: () => listRuns() });
  const runId = selectedRun ?? runsQ.data?.[0]?.id ?? null;
  const detailQ = useQuery({
    queryKey: ["b3-sim-detail", runId],
    queryFn: () => getDetail({ data: { run_id: runId! } }),
    enabled: !!runId,
    refetchInterval: detailInterval,
    refetchIntervalInBackground: false,
  });

  const reportQ = useQuery({
    queryKey: ["b3-sim-report", runId, period, fromInput, toInput],
    queryFn: () => getReport({ data: {
      run_id: runId!, period,
      from: period === "custom" ? new Date(fromInput).toISOString() : undefined,
      to: period === "custom" ? new Date(toInput).toISOString() : undefined,
    }}),
    enabled: !!runId,
    refetchInterval: reportInterval,
    refetchIntervalInBackground: false,
  });


  const startM = useMutation({
    mutationFn: (input: any) => start({ data: input }),
    onSuccess: (run: any) => {
      toast.success("Simulação iniciada nos 5 modos");
      setSelectedRun(run.id);
      qc.invalidateQueries({ queryKey: ["b3-sim-runs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao iniciar"),
  });

  const statusM = useMutation({
    mutationFn: (s: "running" | "paused" | "finished" | "cancelled") => setStatus({ data: { run_id: runId!, status: s } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["b3-sim-runs"] }); qc.invalidateQueries({ queryKey: ["b3-sim-detail", runId] }); },
  });

  const winnerM = useMutation({
    mutationFn: (mode: Mode) => setWinner({ data: { run_id: runId!, mode } }),
    onSuccess: () => { toast.success("Modo vencedor definido"); qc.invalidateQueries({ queryKey: ["b3-sim-detail", runId] }); },
  });

  const tickM = useMutation({
    mutationFn: (n: number) => tick({ data: { run_id: runId!, ticks: n } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["b3-sim-detail", runId] });
      toast.success(`Processados ${r?.processed ?? 0} ticks`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha no tick"),
  });

  const detail = detailQ.data;
  const modes = (detail?.modes ?? []).slice().sort((a: any, b: any) => MODES.indexOf(a.mode) - MODES.indexOf(b.mode));
  const ranking = modes.slice().sort((a: any, b: any) => scoreMode(b) - scoreMode(a));
  const winnerCandidate = ranking[0];

  return (
    <TooltipProvider>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          WIN é contrato futuro — cada linha = uma operação completa (abre e fecha). BUY = comprado · SELL = vendido.
        </p>
        <Link to="/b3-sim-history">
          <Button size="sm" variant="outline"><History className="w-4 h-4 mr-1" />Ver histórico completo</Button>
        </Link>
      </div>
      {/* Cabeçalho / controles */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Activity className="w-4 h-4" /> Simulação 5 Modos (sandbox)</CardTitle>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/30">somente simulação</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <StartForm onSubmit={(v) => startM.mutate(v)} loading={startM.isPending} />

          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs text-muted-foreground">Run:</Label>
            <Select value={runId ?? ""} onValueChange={(v) => setSelectedRun(v)}>
              <SelectTrigger className="w-[340px]"><SelectValue placeholder="Selecione uma simulação" /></SelectTrigger>
              <SelectContent>
                {(runsQ.data ?? []).map((r: any) => (
                  <SelectItem key={r.id} value={r.id}>
                    {new Date(r.started_at).toLocaleString("pt-BR")} · {r.status} · {BRL(r.initial_balance)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {detail?.run && (
              <>
                <Badge variant="outline" className="capitalize">{detail.run.status}</Badge>
                <Input className="w-24" type="number" min={1} max={60} value={ticks} onChange={(e) => setTicks(Number(e.target.value) || 1)} />
                <Button size="sm" onClick={() => tickM.mutate(ticks)} disabled={tickM.isPending || detail.run.status !== "running"}>
                  <Play className="w-4 h-4 mr-1" /> Rodar {ticks} tick(s)
                </Button>
                {detail.run.status === "running" ? (
                  <Button size="sm" variant="outline" onClick={() => statusM.mutate("paused")}><Pause className="w-4 h-4 mr-1" />Pausar</Button>
                ) : detail.run.status === "paused" ? (
                  <Button size="sm" variant="outline" onClick={() => statusM.mutate("running")}><Play className="w-4 h-4 mr-1" />Retomar</Button>
                ) : null}
                <Button size="sm" variant="destructive" onClick={() => statusM.mutate("finished")}><StopCircle className="w-4 h-4 mr-1" />Encerrar</Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filtro de período */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Período do relatório</Label>
            <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje (pregão atual)</SelectItem>
                <SelectItem value="all">Acumulado</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {period === "custom" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">De</Label>
                <Input type="datetime-local" value={fromInput} onChange={(e) => setFromInput(e.target.value)} className="w-[200px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Até</Label>
                <Input type="datetime-local" value={toInput} onChange={(e) => setToInput(e.target.value)} className="w-[200px]" />
              </div>
            </>
          )}
          <div className="ml-auto text-xs text-muted-foreground">
            {period === "today" && "Mostrando apenas operações encerradas no pregão de hoje (00:00 BRT)."}
            {period === "all" && "Mostrando o resultado acumulado desde o início da simulação."}
            {period === "custom" && "Janela personalizada baseada no horário de fechamento das operações."}
          </div>
        </CardContent>
      </Card>

      {/* Painel comparativo (período selecionado) */}
      {reportQ.data && (() => {
        const auditModes: any[] = (detail?.snapshots?.[0] as any)?.extra?.engine_audit?.modes ?? [];
        const auditByMode: Record<string, any> = Object.fromEntries(auditModes.map((a: any) => [a.mode, a]));
        const openByMode: Record<string, any> = {};
        for (const o of (detail?.orders ?? []) as any[]) {
          if (o.status === "open" && !openByMode[o.mode]) openByMode[o.mode] = o;
        }
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {reportQ.data.modes.map((mm: any) => (
              <ModeReportCard key={mm.mode} mm={mm} period={period} runId={runId!}
                isWinner={detail?.run.winner_mode === mm.mode}
                audit={auditByMode[mm.mode] ?? null}
                openOrder={openByMode[mm.mode] ?? null}
                onPick={() => winnerM.mutate(mm.mode)} />
            ))}
          </div>
        );
      })()}

      {/* Leitura do dia (conclusão estatística automática) */}
      {reportQ.data && (
        <DailyReadingPanel data={reportQ.data} orders={detail?.orders ?? []} />
      )}

      {/* Painel de Stops e Bloqueios */}
      {reportQ.data && (
        <StopsAndBlocksPanel data={reportQ.data} />
      )}

      {detail && (
        <EngineDiagnosticPanel detail={detail} />
      )}


      {/* Ranking + sugestão */}
      {detail && winnerCandidate && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-400" /> Modo sugerido pelo sistema</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">
              Sugestão: <Badge className={`uppercase ${MODE_COLOR[winnerCandidate.mode as Mode]}`}>{winnerCandidate.mode}</Badge> — score
              composto {NUM(scoreMode(winnerCandidate), 2)} (líquido + acerto + R/R, penaliza drawdown e bloqueios).
            </p>
            <ol className="text-sm space-y-1 list-decimal pl-5">
              {ranking.map((m: any, i: number) => (
                <li key={m.id}>
                  <strong className="capitalize">{m.mode}</strong> · {BRL(m.realized_pnl)} · DD {BRL(m.max_drawdown)} · {m.total_trades} ops · acerto {NUM((Number(m.winning_trades) / Math.max(1, Number(m.total_trades))) * 100, 1)}% · score {NUM(scoreMode(m), 2)}
                </li>
              ))}
            </ol>
            <div className="pt-2">
              <Button size="sm" variant="outline" onClick={() => winnerM.mutate(winnerCandidate.mode)}>
                <Trophy className="w-4 h-4 mr-1" /> Definir {winnerCandidate.mode} como vencedor
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Operações recentes */}
      {detail && (
        <Card>
          <CardHeader><CardTitle>Últimas operações simuladas{detail.price_source === "mt5_xp_demo" ? " · MT5 XP DEMO válidas" : ""}</CardTitle></CardHeader>
          <CardContent>
            {Number(detail.legacy_orders_hidden ?? 0) > 0 && (
              <p className="text-xs text-amber-300 mb-2 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> {detail.legacy_orders_hidden} operação(ões) legada(s) ocultada(s)/invalidada(s). Em MT5 XP DEMO esta tabela só mostra preço auditado pelo B3QuoteProvider.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-2">Abertura</th>
                    <th>Fechamento</th>
                    <th>Modo</th>
                    <th>
                      Direção{" "}
                      <Tooltip><TooltipTrigger asChild><span><Info className="w-3 h-3 inline" /></span></TooltipTrigger>
                        <TooltipContent className="max-w-xs">BUY = comprado (long) · SELL = vendido (short). Cada linha é uma operação completa: abertura + fechamento.</TooltipContent></Tooltip>
                    </th>
                    <th>Preço abertura</th><th>Preço fechamento</th>
                    <th>Pts</th><th>Bruto</th><th>Taxas</th><th>Líquido</th><th>Fonte</th><th>Status</th><th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.orders ?? []).slice(0, 60).map((o: any) => (
                    <tr key={o.id} className="border-t border-border/40">
                      <td className="py-1 pr-2 whitespace-nowrap">{new Date(o.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                      <td className="whitespace-nowrap">{o.exit_time ? new Date(o.exit_time).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</td>
                      <td><Badge variant="outline" className={`text-[10px] capitalize ${MODE_COLOR[o.mode as Mode]}`}>{o.mode}</Badge></td>
                      <td className="uppercase font-medium">{o.side}</td>
                      <td>{NUM(o.entry_price)}</td>
                      <td>{o.exit_price ? NUM(o.exit_price) : "—"}</td>
                      <td>{o.gross_result_points != null ? NUM(o.gross_result_points, 0) : "—"}</td>
                      <td>{o.gross_result_brl != null ? BRL(o.gross_result_brl) : "—"}</td>
                      <td>{BRL(o.fees)}</td>
                      <td className={Number(o.net_result_brl) > 0 ? "text-emerald-400" : Number(o.net_result_brl) < 0 ? "text-rose-400" : ""}>
                        {o.net_result_brl != null ? BRL(o.net_result_brl) : "—"}
                      </td>
                      <td>{o.quote_source ?? "desconhecida"}</td>
                      <td>{o.status}</td>
                      <td className="text-muted-foreground">{o.close_reason ?? "—"}</td>
                    </tr>
                  ))}
                  {(detail.orders ?? []).length === 0 && (
                    <tr><td colSpan={13} className="text-center text-muted-foreground py-4">Sem operações ainda. Rode alguns ticks.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Macro events */}
      <MacroEventsCard />
    </div>
    </TooltipProvider>
  );
}

export function EngineDiagnosticPanel({ detail }: { detail: any }) {
  const audit = detail?.snapshots?.[0]?.extra?.engine_audit;
  const modes = audit?.modes ?? [];
  const cfgLabels: Record<string, string> = {
    volatility: "Volatilidade",
    score: "Score",
    confidence: "Confiança",
    gain: "Gain",
    stop: "Stop",
    contracts: "Contratos",
    daily_loss: "Loss diário",
    daily_target: "Meta diária",
    trading_start_time: "Início",
    entry_cutoff_time: "Corte",
    force_close_time: "Zeragem",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="w-4 h-4 text-amber-400" /> Diagnóstico do Motor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!audit ? (
          <p className="text-xs text-muted-foreground">Nenhuma auditoria registrada ainda. Rode 1 tick da simulação para registrar todas as validações.</p>
        ) : (
          <>
            <div className="grid gap-2 md:grid-cols-6 text-xs">
              <DiagnosticMetric label="Último tick" value={audit.last_tick?.tick_ts ? new Date(audit.last_tick.tick_ts).toLocaleTimeString("pt-BR") : "—"} />
              <DiagnosticMetric label="Bid" value={audit.last_tick?.bid != null ? NUM(Number(audit.last_tick.bid)) : "—"} />
              <DiagnosticMetric label="Ask" value={audit.last_tick?.ask != null ? NUM(Number(audit.last_tick.ask)) : "—"} />
              <DiagnosticMetric label="Último" value={audit.last_tick?.last != null ? NUM(Number(audit.last_tick.last)) : "—"} />
              <DiagnosticMetric label="Servidor" value={audit.last_tick?.server ?? "—"} />
              <DiagnosticMetric label="Símbolo" value={audit.last_tick?.symbol ?? "—"} />
            </div>
            <div className="rounded-md border border-border/60 p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">Proteção Global</p>
                <p className="text-xs text-muted-foreground">{audit.global_protection?.reason ?? "—"}</p>
              </div>
              <Badge variant={audit.global_protection?.active ? "destructive" : "outline"}>
                {audit.global_protection?.status ?? "Inativa"}
              </Badge>
            </div>
            <div className="grid gap-3">
              {modes.map((m: any) => {
                const checks = m.checks ?? [];
                const cfg = m.config_comparison ?? {};
                const dc = m.decision_context ?? {};
                const setup = dc.setup ?? null;
                const sd = setup?.details ?? {};
                const setupOk = setup?.name === "trend_pullback" && setup?.ok;
                const side = dc.suggested_side ?? "buy";
                const priceN = Number(sd.price);
                const vwapN = Number(sd.vwap);
                const priceVsVwap = Number.isFinite(priceN) && Number.isFinite(vwapN)
                  ? priceN > vwapN
                    ? `acima (+${NUM(priceN - vwapN, 0)} pts)`
                    : `abaixo (${NUM(priceN - vwapN, 0)} pts)`
                  : "—";
                const ema9 = Number(sd.ema9);
                const ema21 = Number(sd.ema21);
                const pullback = Number.isFinite(ema9) && Number.isFinite(ema21) && Number.isFinite(priceN)
                  ? side === "buy"
                    ? (priceN <= ema9 * 1.0015 && priceN > ema21 ? "válida (pullback na EMA9, EMA21 preservada)" : "inválida (sem correção ou estrutura rompida)")
                    : (priceN >= ema9 * 0.9985 && priceN < ema21 ? "válida (pullback na EMA9, EMA21 preservada)" : "inválida (sem correção ou estrutura rompida)")
                  : "—";
                const openPx = Number(sd.open);
                const candle = Number.isFinite(priceN) && Number.isFinite(openPx)
                  ? side === "buy"
                    ? (priceN > openPx ? "comprador ✓" : "não comprador ✗")
                    : (priceN < openPx ? "vendedor ✓" : "não vendedor ✗")
                  : "—";
                const rr = Number(sd.risk_reward);
                const rrMin = Number(sd.min_risk_reward ?? 1.5);
                return (
                  <div key={m.mode} className="rounded-md border border-border/60 p-3 space-y-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <Badge variant="outline" className={`text-[10px] uppercase ${MODE_COLOR[m.mode as Mode]}`}>{m.mode}</Badge>
                        <p className="mt-2 text-sm font-medium">Motivo final: {m.last_refusal_reason ?? "—"}</p>
                        {m.first_stop && <p className="text-xs text-amber-300">Primeira trava: {m.first_stop.label} — {m.first_stop.detail ?? "sem detalhe"}</p>}
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>{m.timestamp ? new Date(m.timestamp).toLocaleString("pt-BR") : "—"}</p>
                        <p>Score {m.last_score != null ? NUM(Number(m.last_score), 0) : "—"} · Conf. {m.last_confidence != null ? NUM(Number(m.last_confidence), 0) : "—"}</p>
                        <p>Setup: {m.last_setup ?? "—"}</p>
                      </div>
                    </div>
                    {setup && (
                      <div className="rounded-md border border-border/50 bg-background/40 p-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium">Diagnóstico do setup técnico ({String(side).toUpperCase()})</p>
                          <Badge variant={setupOk ? "outline" : "destructive"} className="text-[10px]">
                            {setupOk ? "trend_pullback_valid" : "no_valid_setup"}
                          </Badge>
                        </div>
                        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 text-[11px]">
                          <div><span className="text-muted-foreground">Setup detectado: </span><span className="font-mono">{setup.name}</span></div>
                          <div><span className="text-muted-foreground">Regime: </span><span className="font-mono">{dc.market_regime ?? "—"}</span></div>
                          <div><span className="text-muted-foreground">Tendência: </span><span className="font-mono">{(sd.trend_direction ?? dc.trend_direction) ?? "—"} · força {(sd.trend_strength ?? dc.trend_strength) ?? "—"}</span></div>
                          <div><span className="text-muted-foreground">VWAP: </span><span className="font-mono">{priceVsVwap}</span></div>
                          <div><span className="text-muted-foreground">Correção (pullback): </span><span className="font-mono">{pullback}</span></div>
                          <div><span className="text-muted-foreground">Candle confirmação: </span><span className="font-mono">{candle}</span></div>
                          <div><span className="text-muted-foreground">R:R estimado: </span><span className="font-mono">{Number.isFinite(rr) ? `${rr.toFixed(2)} / mín ${rrMin.toFixed(2)}` : "—"}</span></div>
                          <div><span className="text-muted-foreground">Dist. topo/fundo: </span><span className="font-mono">{sd.dist_day_high_pts ?? "—"} / {sd.dist_day_low_pts ?? "—"} pts</span></div>
                          <div><span className="text-muted-foreground">Volatilidade: </span><span className="font-mono">{Number(sd.volatility_pct ?? 0).toFixed(2)}%</span></div>
                        </div>
                        {!setupOk && setup.reasons?.length > 0 && (
                          <div className="text-[11px] text-destructive">
                            <span className="text-muted-foreground">Motivo do bloqueio: </span>{setup.reasons.join("; ")}
                          </div>
                        )}
                      </div>
                    )}
                    {dc.score_composition && (
                      <div className="rounded-md border border-border/50 bg-background/40 p-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium">Composição do score</p>
                          <Badge variant={dc.score_composition.veto_cap_applied ? "destructive" : "outline"} className="text-[10px]">
                            {dc.score_composition.veto_cap_applied ? `veto → cap ${dc.score_composition.veto_cap_value}` : `sem veto`}
                          </Badge>
                        </div>
                        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4 text-[11px]">
                          <div><span className="text-muted-foreground">Agentes consultados: </span><span className="font-mono">{dc.score_composition.agents_consulted}</span></div>
                          <div><span className="text-muted-foreground">Consenso (aprovações): </span><span className="font-mono">{dc.score_composition.consensus_pct}% · +{dc.score_composition.consensus_component}</span></div>
                          <div><span className="text-muted-foreground">Confiança média: </span><span className="font-mono">{dc.score_composition.avg_confidence} · +{dc.score_composition.confidence_component}</span></div>
                          <div><span className="text-muted-foreground">Penalização rejeições: </span><span className="font-mono">{dc.score_composition.reject_pct}% · +{dc.score_composition.reject_penalty_component}</span></div>
                          <div><span className="text-muted-foreground">Score bruto: </span><span className="font-mono">{dc.score_composition.raw_score}</span></div>
                          <div><span className="text-muted-foreground">Cap por veto: </span><span className="font-mono">{dc.score_composition.veto_cap_applied ? `sim (≤ ${dc.score_composition.veto_cap_value})` : "não"}</span></div>
                          <div><span className="text-muted-foreground">Score final: </span><span className="font-mono font-medium">{dc.score_composition.final_score}</span></div>
                          <div><span className="text-muted-foreground">Mínimo do modo: </span><span className="font-mono">{dc.score_min ?? "—"}</span></div>
                        </div>
                        {Array.isArray(dc.agent_votes) && dc.agent_votes.length > 0 && (
                          <div className="pt-1 space-y-1">
                            <p className="text-[11px] text-muted-foreground">Votos por agente ({dc.agent_votes.length})</p>
                            <div className="overflow-x-auto">
                              <table className="w-full text-[11px]">
                                <thead className="text-muted-foreground border-b border-border/40">
                                  <tr className="text-left">
                                    <th className="py-1 pr-2">Agente</th>
                                    <th className="pr-2">Voto</th>
                                    <th className="pr-2">Conf.</th>
                                    <th className="pr-2">Veto</th>
                                    <th>Motivo</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {dc.agent_votes.map((av: any, i: number) => (
                                    <tr key={i} className="border-b border-border/20 align-top">
                                      <td className="py-1 pr-2 font-medium">{av.agent_name}</td>
                                      <td className="pr-2">
                                        <Badge variant={av.vote === "approve" ? "outline" : av.vote === "reject" ? "destructive" : "secondary"} className="text-[10px]">
                                          {av.vote}
                                        </Badge>
                                      </td>
                                      <td className="pr-2 font-mono">{Number(av.confidence ?? 0).toFixed(0)}</td>
                                      <td className="pr-2">{av.has_veto ? <Badge variant="destructive" className="text-[10px]">VETO</Badge> : "—"}</td>
                                      <td className="text-muted-foreground">{av.veto_reason || av.reason}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                      {checks.map((c: any) => (
                        <div key={c.key} className="flex items-center justify-between gap-2 rounded border border-border/40 px-2 py-1">
                          <span className="text-muted-foreground">{c.label}</span>
                          <Badge variant={c.ok ? "outline" : c.blocking ? "destructive" : "secondary"} className="text-[10px]">{c.status}</Badge>
                        </div>
                      ))}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground border-b border-border/40">
                          <tr className="text-left"><th className="py-1 pr-2">Configuração</th><th>Tela</th><th>Motor</th><th>Status</th></tr>
                        </thead>
                        <tbody>
                          {Object.entries(cfg).map(([key, value]: [string, any]) => (
                            <tr key={key} className="border-b border-border/20">
                              <td className="py-1 pr-2">{cfgLabels[key] ?? key}</td>
                              <td className="font-mono">{String(value?.screen ?? "—")}</td>
                              <td className="font-mono">{String(value?.motor ?? "—")}</td>
                              <td><Badge variant={value?.matches ? "outline" : "destructive"} className="text-[10px]">{value?.matches ? "OK" : "DIFERENTE"}</Badge></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DiagnosticMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

function ModeCard({ m, runId, isWinner, onPick }: { m: any; runId: string; isWinner: boolean; onPick: () => void }) {
  const trades = Math.max(1, Number(m.total_trades) || 0);
  const acerto = ((Number(m.winning_trades) || 0) / trades) * 100;
  const pnl = Number(m.realized_pnl);
  return (
    <Card className={isWinner ? "ring-2 ring-amber-400/60" : ""}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Badge className={`uppercase ${MODE_COLOR[m.mode as Mode]}`}>{m.mode}</Badge>
          {isWinner && <Trophy className="w-4 h-4 text-amber-400" />}
        </CardTitle>
        <div className="flex items-center gap-1">
          <ModeSettingsDialog runId={runId} mode={m.mode as Mode} />
          <Button size="sm" variant="ghost" onClick={onPick}><Trophy className="w-4 h-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        {(() => {
          const s = sampleStatus(Number(m.total_trades ?? 0));
          return s ? <Badge variant="outline" className={`${s.cls} text-[10px] mb-1`}>{s.label}</Badge> : null;
        })()}
        {m.protection_state && m.protection_state !== "operating_normal" && (
          <Badge variant="outline" className={`${PROT_COLOR[m.protection_state] ?? ""} text-[10px] mb-1 ml-1`}>
            {PROT_LABEL[m.protection_state] ?? m.protection_state}
          </Badge>
        )}
        <Row k="Saldo inicial" v={BRL(m.initial_balance)} />
        <Row k="Saldo atual" v={BRL(m.current_balance)} />
        <Row k="PnL realizado" v={BRL(pnl)} accent={pnl > 0 ? "pos" : pnl < 0 ? "neg" : undefined} />
        <Row k="Taxas" v={BRL(m.total_fees)} />
        <Row k="Trades" v={`${m.total_trades} (${m.winning_trades}V / ${m.losing_trades}P)`} />
        <Row k="Taxa de acerto" v={`${NUM(acerto, 1)}%`} />
        <Row k="Maior ganho" v={BRL(m.max_gain)} />
        <Row k="Maior perda" v={BRL(m.max_loss)} />
        <Row k="Drawdown máx." v={BRL(m.max_drawdown)} />
        <Row k="Pontos" v={NUM(m.points_result, 0)} />
        <Row k="Comitê aprov./rejei." v={`${m.committee_approvals} / ${m.committee_rejections}`} />
        <Row k="Bloqueios de risco" v={String(m.risk_blocks)} />
        {m.target_reached_at && (
          <>
            <div className="pt-1 mt-1 border-t border-border/40 text-[11px] uppercase tracking-wide text-muted-foreground">Pós-meta</div>
            <Row k="Horário da meta" v={new Date(m.target_reached_at).toLocaleTimeString("pt-BR")} />
            <Row k="Lucro na meta" v={BRL(m.profit_at_target_brl)} />
            <Row k="Lucro pós-meta" v={BRL(m.profit_after_target_brl)} accent={Number(m.profit_after_target_brl) > 0 ? "pos" : Number(m.profit_after_target_brl) < 0 ? "neg" : undefined} />
            <Row k="Pico pós-meta" v={BRL(m.peak_profit_after_target_brl)} />
            <Row k="Ops pós-meta" v={String(m.trades_after_target ?? 0)} />
            {m.protection_block_reason && <Row k="Motivo bloqueio" v={String(m.protection_block_reason)} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ModeSettingsDialog({ runId, mode }: { runId: string; mode: Mode }) {
  const qc = useQueryClient();
  const list = useServerFn(listB3ModeSettings);
  const upd = useServerFn(updateB3ModeSettings);
  const reset = useServerFn(resetB3ModeSettings);
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["b3-mode-settings", runId],
    queryFn: () => list({ data: { run_id: runId } }),
    enabled: open && !!runId,
  });
  const current = (q.data ?? []).find((s: any) => s.mode === mode);
  const [form, setForm] = useState<any>(null);
  if (open && current && !form) setForm({ ...current });
  const f = form ?? current ?? {};

  const saveM = useMutation({
    mutationFn: () => upd({ data: { run_id: runId, mode, patch: f } }),
    onSuccess: () => {
      toast.success(`Configuração de ${mode} salva`);
      qc.invalidateQueries({ queryKey: ["b3-mode-settings", runId] });
      qc.invalidateQueries({ queryKey: ["b3-sim-detail", runId] });
      setOpen(false); setForm(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });
  const resetM = useMutation({
    mutationFn: () => reset({ data: { run_id: runId, mode } }),
    onSuccess: () => {
      toast.success("Restaurado para padrão");
      qc.invalidateQueries({ queryKey: ["b3-mode-settings", runId] });
      setForm(null);
    },
  });

  const set = (k: string, v: any) => setForm({ ...f, [k]: v });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Configurar"><SettingsIcon className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="capitalize flex items-center gap-2">
            <Badge className={`uppercase ${MODE_COLOR[mode]}`}>{mode}</Badge>
            Configuração do modo
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
        {current ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2 flex items-center justify-between rounded border border-border/40 p-2">
              <span>Operar este modo</span>
              <Switch checked={f.enabled !== false} onCheckedChange={(v) => set("enabled", v)} />
            </div>
            <Field label="Votos mínimos (aprovação)"><Input type="number" value={f.min_approve_votes ?? ""} onChange={(e) => set("min_approve_votes", Number(e.target.value))} /></Field>
            <Field label="Confiança mínima (%)"><Input type="number" value={f.min_confidence ?? ""} onChange={(e) => set("min_confidence", Number(e.target.value))} /></Field>
            <Field label="Score mínimo"><Input type="number" value={f.min_score ?? ""} onChange={(e) => set("min_score", Number(e.target.value))} /></Field>
            <Field label="Máx. contratos"><Input type="number" value={f.max_contracts ?? ""} onChange={(e) => set("max_contracts", Number(e.target.value))} /></Field>
            <Field label="Stop (pts)"><Input type="number" value={f.stop_pts ?? ""} onChange={(e) => set("stop_pts", Number(e.target.value))} /></Field>
            <Field label="Alvo / Gain (pts)"><Input type="number" value={f.gain_pts ?? ""} onChange={(e) => set("gain_pts", Number(e.target.value))} /></Field>
            <Field label="Volatilidade máx. (%)"><Input type="number" step="0.1" value={f.max_volatility_pct ?? ""} onChange={(e) => set("max_volatility_pct", Number(e.target.value))} /></Field>
            <Field label="Limite diário de perda (R$)"><Input type="number" step="10" value={f.daily_loss_limit_brl ?? ""} onChange={(e) => set("daily_loss_limit_brl", Number(e.target.value))} /></Field>
            <Field label="Meta diária de ganho (R$)"><Input type="number" step="10" value={f.daily_gain_target_brl ?? ""} onChange={(e) => set("daily_gain_target_brl", Number(e.target.value))} /></Field>
            <Field label="Início pregão (HH:MM)"><Input value={f.trading_start_time ?? ""} onChange={(e) => set("trading_start_time", e.target.value)} /></Field>
            <Field label="Corte de entradas"><Input value={f.entry_cutoff_time ?? ""} onChange={(e) => set("entry_cutoff_time", e.target.value)} /></Field>
            <Field label="Zeragem obrigatória"><Input value={f.force_close_time ?? ""} onChange={(e) => set("force_close_time", e.target.value)} /></Field>

            <div className="col-span-2 pt-2 border-t border-border/40 text-xs uppercase tracking-wide text-muted-foreground">
              Flexibilização inteligente (pós-meta)
            </div>
            <Field label="Mín. operações antes do lock"><Input type="number" value={f.minimum_trades_before_profit_lock ?? 15} onChange={(e) => set("minimum_trades_before_profit_lock", Number(e.target.value))} /></Field>
            <Field label="Tempo mín. operando (min)"><Input type="number" value={f.minimum_operating_minutes ?? 90} onChange={(e) => set("minimum_operating_minutes", Number(e.target.value))} /></Field>
            <Field label="Multiplicador da meta (teto)"><Input type="number" step="0.1" value={f.profit_multiplier_before_lock ?? 2.0} onChange={(e) => set("profit_multiplier_before_lock", Number(e.target.value))} /></Field>
            <Field label="Devolução permitida pós-meta (0-1)"><Input type="number" step="0.05" value={f.post_target_allowed_retracement ?? 0.30} onChange={(e) => set("post_target_allowed_retracement", Number(e.target.value))} /></Field>
            <Field label="Perdas consecutivas pós-meta"><Input type="number" value={f.consecutive_loss_after_target ?? 2} onChange={(e) => set("consecutive_loss_after_target", Number(e.target.value))} /></Field>
            <Field label="Redução de size pós-meta (0-1)"><Input type="number" step="0.05" value={f.post_target_size_reduction ?? 0.50} onChange={(e) => set("post_target_size_reduction", Number(e.target.value))} /></Field>

            <div className="col-span-2 text-xs text-muted-foreground">
              Sem prompts: ajuste livremente. Ex.: subir o limite de perda de R$ 300 para R$ 900 e clicar em Salvar.
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        </div>
        <DialogFooter className="px-6 pb-6 pt-2 border-t border-border/40">

          <Button variant="outline" onClick={() => resetM.mutate()} disabled={resetM.isPending}>Restaurar padrão</Button>
          <Button onClick={() => saveM.mutate()} disabled={saveM.isPending || !current}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: "pos" | "neg" }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={accent === "pos" ? "text-emerald-400" : accent === "neg" ? "text-rose-400" : ""}>{v}</span>
    </div>
  );
}

function StartForm({ onSubmit, loading }: { onSubmit: (v: any) => void; loading: boolean }) {
  const [v, setV] = useState({
    initial_balance: 10000, max_contracts: 1, fee_brl: 1.5, slippage_pts: 0,
    trading_start_time: "09:15", entry_cutoff_time: "16:30", force_close_time: "16:55", notes: "",
  });
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
      <Field label="Saldo inicial (R$)"><Input type="number" value={v.initial_balance} onChange={(e) => setV({ ...v, initial_balance: Number(e.target.value) })} /></Field>
      <Field label="Máx. contratos"><Input type="number" value={v.max_contracts} onChange={(e) => setV({ ...v, max_contracts: Number(e.target.value) })} /></Field>
      <Field label="Taxa (R$ por contrato/lado)"><Input type="number" step="0.1" value={v.fee_brl} onChange={(e) => setV({ ...v, fee_brl: Number(e.target.value) })} /></Field>
      <Field label="Slippage (pts)"><Input type="number" step="5" value={v.slippage_pts} onChange={(e) => setV({ ...v, slippage_pts: Number(e.target.value) })} /></Field>
      <Field label="Início pregão"><Input value={v.trading_start_time} onChange={(e) => setV({ ...v, trading_start_time: e.target.value })} /></Field>
      <Field label="Corte de entradas"><Input value={v.entry_cutoff_time} onChange={(e) => setV({ ...v, entry_cutoff_time: e.target.value })} /></Field>
      <Field label="Zeragem obrigatória"><Input value={v.force_close_time} onChange={(e) => setV({ ...v, force_close_time: e.target.value })} /></Field>
      <Button onClick={() => onSubmit(v)} disabled={loading}><RotateCcw className="w-4 h-4 mr-1" />{loading ? "Iniciando..." : "Iniciar nova simulação"}</Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function MacroEventsCard() {
  const qc = useQueryClient();
  const list = useServerFn(listB3MacroEvents);
  const upsert = useServerFn(upsertB3MacroEvent);
  const del = useServerFn(deleteB3MacroEvent);
  const q = useQuery({
    queryKey: ["b3-macro-events"],
    queryFn: async () => {
      try {
        return await list();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/timeout|upstream|temporar|network|fetch/i.test(message)) {
          return qc.getQueryData<any[]>(["b3-macro-events"]) ?? [];
        }
        throw error;
      }
    },
    staleTime: 60_000,
    retry: 2,
  });
  const [form, setForm] = useState({ name: "", category: "macro", block_start: "", block_end: "", severity: "high" as const });

  const addM = useMutation({
    mutationFn: () => upsert({ data: { ...form, block_start: new Date(form.block_start).toISOString(), block_end: new Date(form.block_end).toISOString() } }),
    onSuccess: () => { toast.success("Evento cadastrado"); qc.invalidateQueries({ queryKey: ["b3-macro-events"] }); setForm({ name: "", category: "macro", block_start: "", block_end: "", severity: "high" }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });
  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["b3-macro-events"] }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ListPlus className="w-4 h-4" /> Eventos macroeconômicos (bloqueio)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <Field label="Nome (ex: Copom, FOMC)"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Categoria"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
          <Field label="Início bloqueio"><Input type="datetime-local" value={form.block_start} onChange={(e) => setForm({ ...form, block_start: e.target.value })} /></Field>
          <Field label="Fim bloqueio"><Input type="datetime-local" value={form.block_end} onChange={(e) => setForm({ ...form, block_end: e.target.value })} /></Field>
          <Field label="Severidade">
            <Select value={form.severity} onValueChange={(v: any) => setForm({ ...form, severity: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Baixa</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button onClick={() => addM.mutate()} disabled={!form.name || !form.block_start || !form.block_end || addM.isPending}>
            <ListPlus className="w-4 h-4 mr-1" />Adicionar
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left"><th className="py-1 pr-2">Nome</th><th>Cat.</th><th>Início</th><th>Fim</th><th>Sev.</th><th></th></tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((e: any) => (
                <tr key={e.id} className="border-t border-border/40">
                  <td className="py-1 pr-2">{e.name}</td>
                  <td>{e.category}</td>
                  <td>{new Date(e.block_start).toLocaleString("pt-BR")}</td>
                  <td>{new Date(e.block_end).toLocaleString("pt-BR")}</td>
                  <td><Badge variant="outline" className="capitalize">{e.severity}</Badge></td>
                  <td><Button size="sm" variant="ghost" onClick={() => delM.mutate(e.id)}><Trash2 className="w-3 h-3" /></Button></td>
                </tr>
              ))}
              {(q.data ?? []).length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground py-3">Sem eventos cadastrados.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ModeReportCard({ mm, period, runId, isWinner, onPick, audit, openOrder }: { mm: any; period: string; runId: string; isWinner: boolean; onPick: () => void; audit?: any; openOrder?: any }) {
  const baseStatus = STATUS_META[mm.current_status] ?? STATUS_META.operando;
  const pnl = Number(mm.pnl_periodo ?? 0);

  // ─────── Status ao vivo derivado do último tick auditado ───────
  const firstBlock = audit?.checks?.find?.((c: any) => c.blocking && !c.ok) ?? audit?.first_stop ?? null;
  const committee = audit?.committee ?? null;
  const cfgLoaded = audit?.config_loaded ?? null;
  const minScore = cfgLoaded?.score != null ? Number(cfgLoaded.score) : null;
  const minConfidence = cfgLoaded?.confidence != null ? Number(cfgLoaded.confidence) : null;
  const minVotes = cfgLoaded?.min_approve_votes != null ? Number(cfgLoaded.min_approve_votes) : null;
  const curScore = audit?.last_score != null ? Number(audit.last_score) : null;
  const curConf = audit?.last_confidence != null ? Number(audit.last_confidence) : null;
  const curVotes = committee?.approve_votes != null ? Number(committee.approve_votes) : null;
  const vetoes: string[] = Array.isArray(committee?.vetoes) ? committee.vetoes : [];
  const signalSide = audit?.signals?.evaluated_side ?? committee?.side ?? null;
  const canResumeToday = baseStatus.canResumeToday;

  let liveLabel = baseStatus.label;
  let liveCls = baseStatus.cls;
  if (openOrder) {
    liveLabel = `Posição ${String(openOrder.side).toUpperCase()} aberta`;
    liveCls = "bg-sky-500/15 text-sky-300 border-sky-500/30";
  } else if (audit && canResumeToday && mm.current_status !== "bloqueado_perda_diaria" && mm.current_status !== "bloqueado_meta_diaria") {
    if (firstBlock) {
      liveLabel = `Bloqueado para entrada · ${firstBlock.label ?? firstBlock.key}`;
      liveCls = "bg-rose-500/15 text-rose-300 border-rose-500/30";
    } else if (committee && committee.final !== "approved") {
      liveLabel = "Aguardando aprovação";
      liveCls = "bg-slate-500/15 text-slate-300 border-slate-500/30";
    }
  }

  const gaps: string[] = [];
  if (curScore != null && minScore != null && curScore < minScore) gaps.push(`+${(minScore - curScore).toFixed(0)} score`);
  if (curConf != null && minConfidence != null && curConf < minConfidence) gaps.push(`+${(minConfidence - curConf).toFixed(0)} confiança`);
  if (curVotes != null && minVotes != null && curVotes < minVotes) gaps.push(`+${(minVotes - curVotes)} voto(s)`);

  return (
    <Card className={isWinner ? "ring-2 ring-amber-400/60" : ""}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2">
          <Badge className={`uppercase ${MODE_COLOR[mm.mode as Mode]}`}>{mm.mode}</Badge>
          {isWinner && <Trophy className="w-4 h-4 text-amber-400" />}
        </CardTitle>
        <div className="flex items-center gap-1">
          <ModeSettingsDialog runId={runId} mode={mm.mode as Mode} />
          <Button size="sm" variant="ghost" onClick={onPick}><Trophy className="w-4 h-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        <Badge variant="outline" className={`${liveCls} text-[10px] mb-1`}>
          {baseStatus.type === "stop_dia" || baseStatus.type === "meta" || baseStatus.type === "zeragem" ? <ShieldAlert className="w-3 h-3 mr-1 inline" /> : null}
          {liveLabel}
        </Badge>
        {mm.status_reason && <p className="text-[10px] text-muted-foreground italic">{mm.status_reason}</p>}

        {audit && (
          <div className="rounded-md border border-border/40 bg-muted/20 p-2 space-y-1 my-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Decisão ao vivo</p>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Sinal avaliado</span>
              <span className="font-mono">
                {signalSide ? (
                  <Badge variant="outline" className={signalSide === "buy" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-rose-500/15 text-rose-300 border-rose-500/30"}>
                    {String(signalSide).toUpperCase()}
                  </Badge>
                ) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Score</span>
              <span className={`font-mono ${curScore != null && minScore != null ? (curScore >= minScore ? "text-emerald-300" : "text-rose-300") : ""}`}>
                {curScore != null ? curScore.toFixed(0) : "—"} / mín {minScore ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Confiança</span>
              <span className={`font-mono ${curConf != null && minConfidence != null ? (curConf >= minConfidence ? "text-emerald-300" : "text-rose-300") : ""}`}>
                {curConf != null ? curConf.toFixed(0) : "—"} / mín {minConfidence ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Votos aprovados</span>
              <span className={`font-mono ${curVotes != null && minVotes != null ? (curVotes >= minVotes ? "text-emerald-300" : "text-rose-300") : ""}`}>
                {curVotes != null ? curVotes : "—"} / mín {minVotes ?? "—"}
              </span>
            </div>
            {vetoes.length > 0 && (
              <div className="text-[10px] pt-1">
                <p className="text-rose-300 font-medium">Veto do comitê ({vetoes.length}):</p>
                <ul className="text-rose-200/90 list-disc pl-4">
                  {vetoes.slice(0, 3).map((v, i) => <li key={i}>{v}</li>)}
                </ul>
              </div>
            )}
            {firstBlock && !openOrder && (
              <div className="text-[10px] pt-1 text-amber-300">
                <span className="font-medium">Primeiro bloqueio:</span> {firstBlock.label ?? firstBlock.key}
                {firstBlock.detail ? ` — ${firstBlock.detail}` : ""}
              </div>
            )}
            {gaps.length > 0 && !openOrder && (
              <div className="text-[10px] pt-1 text-muted-foreground">
                <span className="font-medium text-foreground">Falta para liberar:</span> {gaps.join(" · ")}
              </div>
            )}
            {!firstBlock && committee?.final === "approved" && !openOrder && (
              <p className="text-[10px] text-emerald-300 pt-1">Comitê aprovou — aguardando execução da ordem.</p>
            )}
          </div>
        )}

        {(() => {
          const s = sampleStatus(Number(mm.cumulative?.total_trades ?? 0));
          return s ? <Badge variant="outline" className={`${s.cls} text-[10px] mb-1`}>{s.label}</Badge> : null;
        })()}
        <p className="text-[10px] uppercase text-muted-foreground pt-1">
          {period === "today" ? "Hoje" : period === "all" ? "Acumulado" : "Personalizado"}
        </p>
        <Row k="Saldo inicial (período)" v={BRL(mm.saldo_inicial_periodo)} />
        <Row k="Saldo final (período)" v={BRL(mm.saldo_final_periodo)} />
        <Row k="PnL do período" v={BRL(pnl)} accent={pnl > 0 ? "pos" : pnl < 0 ? "neg" : undefined} />
        <Row k="Taxas" v={BRL(mm.taxas)} />
        <Row k="Trades" v={`${mm.trades} (${mm.vitorias}V / ${mm.perdas}P)`} />
        <Row k="Taxa de acerto" v={`${NUM(mm.taxa_acerto, 1)}%`} />
        <Row k="Maior ganho" v={BRL(mm.maior_ganho)} />
        <Row k="Maior perda" v={BRL(mm.maior_perda)} />
        <Row k="Drawdown máx." v={BRL(mm.drawdown_maximo)} />
        <Row k="Pontos líquidos" v={NUM(mm.pontos_liquidos, 0)} />
        <Row k="Comitê aprov./rejei." v={`${mm.comite_aprovou} / ${mm.comite_rejeitou}`} />
        <Row k="Bloqueios de risco" v={String(mm.bloqueios_risco)} />
      </CardContent>
    </Card>
  );
}

function StopsAndBlocksPanel({ data }: { data: any }) {
  const modes = data.modes ?? [];
  const events = (data.block_events ?? []).filter((e: any) => e.new_status !== "operando").slice(0, 100);
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="w-4 h-4 text-amber-400" /> Stops e Bloqueios — situação atual por robô
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border/40">
                <tr className="text-left">
                  <th className="py-1 pr-2">Modo</th>
                  <th>Status atual</th>
                  <th>Último gatilho</th>
                  <th>Horário</th>
                  <th>Motivo</th>
                  <th className="text-right">PnL no momento</th>
                  <th>Volta a operar?</th>
                </tr>
              </thead>
              <tbody>
                {modes.map((mm: any) => {
                  const st = STATUS_META[mm.current_status] ?? STATUS_META.operando;
                  const ev = mm.ultimo_evento;
                  return (
                    <tr key={mm.mode} className="border-b border-border/20">
                      <td className="py-1 pr-2"><Badge variant="outline" className={`text-[10px] capitalize ${MODE_COLOR[mm.mode as Mode]}`}>{mm.mode}</Badge></td>
                      <td><Badge variant="outline" className={`text-[10px] ${st.cls}`}>{st.label}</Badge></td>
                      <td className="text-muted-foreground">{ev?.trigger ?? mm.last_trigger ?? "—"}</td>
                      <td className="font-mono text-[10px]">{ev?.occurred_at ? new Date(ev.occurred_at).toLocaleString("pt-BR") : (mm.status_changed_at ? new Date(mm.status_changed_at).toLocaleString("pt-BR") : "—")}</td>
                      <td className="text-muted-foreground max-w-[280px] truncate">{ev?.message ?? mm.status_reason ?? "—"}</td>
                      <td className="text-right">{ev?.pnl_at_moment != null ? BRL(Number(ev.pnl_at_moment)) : "—"}</td>
                      <td className="text-[10px]">
                        {st.canResumeToday
                          ? <span className="text-emerald-300">Pode voltar ainda hoje</span>
                          : <span className="text-rose-300">Apenas no próximo pregão</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="w-4 h-4" /> Histórico de paradas no período
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma parada registrada no período selecionado.</p>
          ) : (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border/40 sticky top-0 bg-background">
                  <tr className="text-left">
                    <th className="py-1 pr-2">Quando</th>
                    <th>Modo</th>
                    <th>De</th>
                    <th>Para</th>
                    <th>Gatilho</th>
                    <th className="text-right">Valor obs.</th>
                    <th className="text-right">Limite</th>
                    <th className="text-right">PnL</th>
                    <th>Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e: any) => {
                    const meta = STOP_EVENT_META[e.new_status] ?? STOP_EVENT_META[e.trigger] ?? { label: e.new_status, cls: "" };
                    const currentMode = modes.find((m: any) => m.mode === e.mode);
                    const isReleased = currentMode?.current_status === "operando";
                    return (
                    <tr key={e.id} className="border-b border-border/20">
                      <td className="py-1 pr-2 font-mono text-[10px] whitespace-nowrap">{new Date(e.occurred_at).toLocaleString("pt-BR")}</td>
                      <td><Badge variant="outline" className={`text-[10px] capitalize ${MODE_COLOR[e.mode as Mode]}`}>{e.mode}</Badge></td>
                      <td className="text-muted-foreground">{e.prev_status ?? "—"}</td>
                      <td className="space-y-1">
                        <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
                        {meta.releasedText && isReleased && (
                          <div className="text-[10px] text-emerald-300">{meta.releasedText}</div>
                        )}
                      </td>
                      <td><Badge variant="outline" className="text-[10px]">{e.trigger}</Badge></td>
                      <td className="text-right font-mono">{e.observed_value != null ? NUM(Number(e.observed_value), 2) : "—"}</td>
                      <td className="text-right font-mono">{e.limit_value != null ? NUM(Number(e.limit_value), 2) : "—"}</td>
                      <td className="text-right font-mono">{e.pnl_at_moment != null ? BRL(Number(e.pnl_at_moment)) : "—"}</td>
                      <td className="text-muted-foreground max-w-[300px] truncate">{e.message ?? "—"}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DailyReadingPanel({ data, orders }: { data: any; orders: any[] }) {
  const modes: any[] = data?.modes ?? [];
  const fromMs = data?.from ? new Date(data.from).getTime() : null;
  const toMs = data?.to ? new Date(data.to).getTime() : null;
  const closed = (orders ?? []).filter((o: any) => {
    if (o.status !== "closed" || !o.exit_time) return false;
    const t = new Date(o.exit_time).getTime();
    if (fromMs != null && t < fromMs) return false;
    if (toMs != null && t > toMs) return false;
    return true;
  });

  const totalTrades = modes.reduce((s, m) => s + Number(m.trades ?? 0), 0);
  const totalWins = modes.reduce((s, m) => s + Number(m.vitorias ?? 0), 0);
  const totalLosses = modes.reduce((s, m) => s + Number(m.perdas ?? 0), 0);
  const totalPnl = modes.reduce((s, m) => s + Number(m.pnl_periodo ?? 0), 0);
  const avgTrade = totalTrades > 0 ? totalPnl / totalTrades : 0;

  const active = modes.filter((m) => Number(m.trades ?? 0) > 0);
  const byPnlDesc = [...active].sort((a, b) => Number(b.pnl_periodo) - Number(a.pnl_periodo));
  const best = byPnlDesc[0] ?? null;
  const worst = byPnlDesc[byPnlDesc.length - 1] ?? null;
  const bestAcc = [...active].sort((a, b) => Number(b.taxa_acerto) - Number(a.taxa_acerto))[0] ?? null;
  const worstDD = [...active].sort((a, b) => Number(b.drawdown_maximo) - Number(a.drawdown_maximo))[0] ?? null;
  const negatives = active.filter((m) => Number(m.pnl_periodo) < 0);
  const mostHarmful = negatives.length ? [...negatives].sort((a, b) => Number(a.pnl_periodo) - Number(b.pnl_periodo))[0] : null;

  // BUY vs SELL
  let buyPnl = 0, sellPnl = 0, buyN = 0, sellN = 0;
  for (const o of closed) {
    const pnl = Number(o.net_result_brl ?? 0);
    if (String(o.side).toUpperCase() === "BUY") { buyPnl += pnl; buyN++; }
    else if (String(o.side).toUpperCase() === "SELL") { sellPnl += pnl; sellN++; }
  }

  // Horários (bucket por hora BRT)
  const hourBuckets: Record<number, { pnl: number; n: number }> = {};
  for (const o of closed) {
    if (!o.exit_time) continue;
    const h = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date(o.exit_time)));
    if (!Number.isFinite(h)) continue;
    hourBuckets[h] = hourBuckets[h] ?? { pnl: 0, n: 0 };
    hourBuckets[h].pnl += Number(o.net_result_brl ?? 0);
    hourBuckets[h].n += 1;
  }
  const hourEntries = Object.entries(hourBuckets).map(([h, v]) => ({ h: Number(h), ...v }));
  const bestHour = hourEntries.length >= 2 ? [...hourEntries].sort((a, b) => b.pnl - a.pnl)[0] : null;
  const worstHour = hourEntries.length >= 2 ? [...hourEntries].sort((a, b) => a.pnl - b.pnl)[0] : null;

  const bullets: string[] = [];
  if (best) bullets.push(`Melhor resultado líquido: ${best.mode} (${BRL(best.pnl_periodo)}).`);
  if (worst && worst !== best) bullets.push(`Pior resultado líquido: ${worst.mode} (${BRL(worst.pnl_periodo)}).`);
  if (bestAcc && Number(bestAcc.trades) > 0) bullets.push(`Melhor taxa de acerto: ${bestAcc.mode} (${NUM(bestAcc.taxa_acerto, 1)}% em ${bestAcc.trades} ops).`);
  if (worstDD && Number(worstDD.drawdown_maximo) > 0) bullets.push(`Maior drawdown: ${worstDD.mode} (${BRL(worstDD.drawdown_maximo)}).`);
  if (mostHarmful) bullets.push(`Robô que mais prejudicou o consolidado: ${mostHarmful.mode} (${BRL(mostHarmful.pnl_periodo)}).`);
  if (buyN + sellN > 0) bullets.push(`BUY: ${buyN} ops · ${BRL(buyPnl)}  ·  SELL: ${sellN} ops · ${BRL(sellPnl)}.`);
  if (bestHour && worstHour && bestHour.h !== worstHour.h) {
    bullets.push(`Faixa mais lucrativa: ${String(bestHour.h).padStart(2, "0")}h (${BRL(bestHour.pnl)}) · mais prejudicial: ${String(worstHour.h).padStart(2, "0")}h (${BRL(worstHour.pnl)}).`);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="w-4 h-4 text-primary" /> Leitura do dia
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          <div className="rounded-md border border-border/60 p-2">
            <p className="text-muted-foreground">Resultado líquido consolidado</p>
            <p className={`text-sm font-semibold ${totalPnl > 0 ? "text-emerald-400" : totalPnl < 0 ? "text-rose-400" : ""}`}>{BRL(totalPnl)}</p>
          </div>
          <div className="rounded-md border border-border/60 p-2">
            <p className="text-muted-foreground">Total de trades</p>
            <p className="text-sm font-semibold">{totalTrades}</p>
          </div>
          <div className="rounded-md border border-border/60 p-2">
            <p className="text-muted-foreground">Gains</p>
            <p className="text-sm font-semibold text-emerald-400">{totalWins}</p>
          </div>
          <div className="rounded-md border border-border/60 p-2">
            <p className="text-muted-foreground">Stops</p>
            <p className="text-sm font-semibold text-rose-400">{totalLosses}</p>
          </div>
          <div className="rounded-md border border-border/60 p-2">
            <p className="text-muted-foreground">Resultado médio por trade</p>
            <p className={`text-sm font-semibold ${avgTrade > 0 ? "text-emerald-400" : avgTrade < 0 ? "text-rose-400" : ""}`}>{BRL(avgTrade)}</p>
          </div>
        </div>
        {bullets.length > 0 ? (
          <ul className="text-sm space-y-1 list-disc pl-5">
            {bullets.slice(0, 7).map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Sem operações no período para gerar leitura estatística.</p>
        )}
      </CardContent>
    </Card>
  );
}


