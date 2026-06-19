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
import { Trophy, Play, Pause, StopCircle, RotateCcw, ListPlus, Trash2, Activity, History, Info } from "lucide-react";
import {
  startB3Simulation, setB3SimulationStatus, setB3SimulationWinner,
  listB3Simulations, getB3SimulationDetail, tickB3Simulation,
  listB3MacroEvents, upsertB3MacroEvent, deleteB3MacroEvent, scoreMode,
} from "@/lib/b3-simulation.functions";

const BRL = (v: number) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const NUM = (v: number, d = 0) => Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

const MODES = ["conservador", "moderado", "agressivo"] as const;
type Mode = typeof MODES[number];
const MODE_COLOR: Record<Mode, string> = {
  conservador: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  moderado: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  agressivo: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export function SimComparePanel() {
  const qc = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [ticks, setTicks] = useState(10);

  const listRuns = useServerFn(listB3Simulations);
  const getDetail = useServerFn(getB3SimulationDetail);
  const start = useServerFn(startB3Simulation);
  const setStatus = useServerFn(setB3SimulationStatus);
  const setWinner = useServerFn(setB3SimulationWinner);
  const tick = useServerFn(tickB3Simulation);

  const runsQ = useQuery({ queryKey: ["b3-sim-runs"], queryFn: () => listRuns() });
  const runId = selectedRun ?? runsQ.data?.[0]?.id ?? null;
  const detailQ = useQuery({
    queryKey: ["b3-sim-detail", runId],
    queryFn: () => getDetail({ data: { run_id: runId! } }),
    enabled: !!runId,
    refetchInterval: 4000,
  });

  const startM = useMutation({
    mutationFn: (input: any) => start({ data: input }),
    onSuccess: (run: any) => {
      toast.success("Simulação iniciada nos 3 modos");
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
          <CardTitle className="flex items-center gap-2"><Activity className="w-4 h-4" /> Simulação 3 Modos (sandbox)</CardTitle>
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

      {/* Painel comparativo */}
      {detail && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {modes.map((m: any) => (
            <ModeCard key={m.id} m={m} isWinner={detail.run.winner_mode === m.mode} onPick={() => winnerM.mutate(m.mode)} />
          ))}
        </div>
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
          <CardHeader><CardTitle>Últimas operações simuladas</CardTitle></CardHeader>
          <CardContent>
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
                    <th>Pts</th><th>Bruto</th><th>Taxas</th><th>Líquido</th><th>Status</th><th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.orders ?? []).slice(0, 60).map((o: any) => (
                    <tr key={o.id} className="border-t border-border/40">
                      <td className="py-1 pr-2">{new Date(o.created_at).toLocaleTimeString("pt-BR")}</td>
                      <td>{o.exit_time ? new Date(o.exit_time).toLocaleTimeString("pt-BR") : "—"}</td>
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
                      <td>{o.status}</td>
                      <td className="text-muted-foreground">{o.close_reason ?? "—"}</td>
                    </tr>
                  ))}
                  {(detail.orders ?? []).length === 0 && (
                    <tr><td colSpan={12} className="text-center text-muted-foreground py-4">Sem operações ainda. Rode alguns ticks.</td></tr>
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

function ModeCard({ m, isWinner, onPick }: { m: any; isWinner: boolean; onPick: () => void }) {
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
        <Button size="sm" variant="ghost" onClick={onPick}><Trophy className="w-4 h-4" /></Button>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
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
      </CardContent>
    </Card>
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
  const q = useQuery({ queryKey: ["b3-macro-events"], queryFn: () => list() });
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
