import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3PipelineAudit } from "@/lib/b3-simulation.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, XCircle, ArrowDown } from "lucide-react";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";

const MODE_LABEL: Record<string, string> = {
  conservador: "Conservador",
  moderado: "Moderado",
  equilibrado: "Equilibrado",
  semi_agressivo: "Semi-agressivo",
  agressivo: "Agressivo",
};

function fmt(v: any) {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return String(v);
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}


export function PipelineAuditPanel() {
  const fetchFn = useServerFn(getB3PipelineAudit);
  const auditInterval = useVisibleRefetchInterval(10000);
  const q = useQuery({
    queryKey: ["b3-pipeline-audit"],
    queryFn: () => fetchFn(),
    refetchInterval: auditInterval,
    refetchIntervalInBackground: false,
  });
  const data = q.data as any;

  if (!data?.run) {
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-muted-foreground">
          Nenhuma simulação ativa. Inicie uma simulação para ver o pipeline de decisão.
        </CardContent>
      </Card>
    );
  }

  const modes = data.modes ?? [];
  const history = data.history ?? [];

  return (
    <div className="space-y-4">
      {(data.executions?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Sessão do dia {data.session_date ?? "—"} — {data.executions.length} execução(ões)
              {data.restart_count > 0 && (
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  {data.restart_count} reinício{data.restart_count > 1 ? "s" : ""}
                </Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Todos os ticks, auditorias, ordens, sinais e bloqueios das execuções abaixo são consolidados no diagnóstico. Nada é apagado ao reiniciar.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border/40">
                  <tr className="text-left">
                    <th className="py-1 pr-2">#</th>
                    <th className="py-1 pr-2">Início</th>
                    <th className="py-1 pr-2">Fim</th>
                    <th className="py-1 pr-2">Duração</th>
                    <th className="py-1 pr-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.executions.map((e: any, i: number) => (
                    <tr key={e.run_id} className="border-b border-border/20">
                      <td className="py-1 pr-2 font-mono">{i + 1}</td>
                      <td className="py-1 pr-2 font-mono">{new Date(e.started_at).toLocaleTimeString("pt-BR")}</td>
                      <td className="py-1 pr-2 font-mono">{e.finished_at ? new Date(e.finished_at).toLocaleTimeString("pt-BR") : "em andamento"}</td>
                      <td className="py-1 pr-2 font-mono">{formatDuration(e.duration_s)}</td>
                      <td className="py-1 pr-2">
                        <Badge variant={e.ongoing ? "default" : "outline"} className="text-[10px]">{e.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4 text-primary" /> Pipeline de Decisão — por Robô
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Snapshots auditados: {data.totals?.snapshots_scanned ?? 0} (todas as execuções do dia). Auditoria somente-leitura — nenhuma regra é alterada.
          </p>
        </CardHeader>

        <CardContent className="grid gap-4 md:grid-cols-1 xl:grid-cols-2">
          {modes.map((m: any) => {
            const opened = m.orders_executed > 0;
            const objetivo = opened
              ? `O robô EXECUTOU ${m.orders_executed} ordem(ns). Última: ${m.last_reason ?? "—"}`
              : `O robô NÃO entrou porque: ${m.last_reason ?? "sem análises registradas."}`;
            return (
              <div key={m.mode} className="rounded-md border border-border/60 p-3 space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <Badge variant="outline" className="uppercase text-[10px]">{MODE_LABEL[m.mode] ?? m.mode}</Badge>
                    <p className="mt-2 text-sm font-medium">{objetivo}</p>
                    {m.last_step_blocked && (
                      <p className="text-xs text-amber-400 mt-1">
                        Primeira trava: {m.last_step_blocked.label} — {m.last_step_blocked.detail ?? "sem detalhe"}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    <p>{m.last_snapshot_at ? new Date(m.last_snapshot_at).toLocaleString("pt-BR") : "—"}</p>
                    <p>Score {fmt(m.last_score)} · Conf. {fmt(m.last_confidence)}</p>
                    <p>Setup: {m.last_setup ?? "—"}</p>
                  </div>
                </div>

                {/* Contadores */}
                <div className="grid grid-cols-4 gap-1 text-[11px]">
                  <Stat label="Ticks" v={m.ticks_received} />
                  <Stat label="Válidos" v={m.ticks_valid} />
                  <Stat label="Analisadas" v={m.entries_analyzed} />
                  <Stat label="Autorizadas" v={m.entries_authorized} accent="pos" />
                  <Stat label="Bloqueadas" v={m.entries_blocked} accent="neg" />
                  <Stat label="BUY" v={m.buy_signals} />
                  <Stat label="SELL" v={m.sell_signals} />
                  <Stat label="Ordens" v={m.orders_executed} accent="pos" />
                </div>

                {/* Pipeline ordenado */}
                <div className="rounded border border-border/40 divide-y divide-border/30">
                  {(m.last_pipeline ?? []).length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">Sem etapas registradas.</div>
                  ) : (
                    (m.last_pipeline ?? []).map((c: any, i: number) => (
                      <div key={c.key} className="flex items-center gap-2 px-2 py-1 text-xs">
                        <span className="text-muted-foreground w-4 text-right">{i + 1}.</span>
                        {c.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : c.blocking ? <XCircle className="w-3.5 h-3.5 text-red-500" /> : <ArrowDown className="w-3.5 h-3.5 text-muted-foreground" />}
                        <span className="flex-1">{c.label}</span>
                        <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[45%]" title={c.detail ?? ""}>{c.detail ?? ""}</span>
                        <Badge variant={c.ok ? "outline" : c.blocking ? "destructive" : "secondary"} className="text-[9px]">
                          {c.ok ? "PASSOU" : c.blocking ? "BLOQUEADO" : "N/A"}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Histórico de bloqueios (últimos 100)</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum bloqueio registrado nos snapshots analisados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border/40">
                  <tr className="text-left">
                    <th className="py-1 pr-2">Hora</th>
                    <th className="py-1 pr-2">Robô</th>
                    <th className="py-1 pr-2">Etapa</th>
                    <th className="py-1 pr-2">Detalhe</th>
                    <th className="py-1 pr-2">Motivo final</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h: any, i: number) => (
                    <tr key={i} className="border-b border-border/20">
                      <td className="py-1 pr-2 font-mono">{new Date(h.at).toLocaleTimeString("pt-BR")}</td>
                      <td className="py-1 pr-2"><Badge variant="outline" className="text-[10px]">{MODE_LABEL[h.mode] ?? h.mode}</Badge></td>
                      <td className="py-1 pr-2">{h.step ?? h.step_key}</td>
                      <td className="py-1 pr-2 text-muted-foreground">{h.detail ?? "—"}</td>
                      <td className="py-1 pr-2">{h.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contexto das decisões (últimas 100)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Cada candidato de entrada — aprovado ou rejeitado — com o snapshot completo do mercado no momento da decisão.
          </p>
        </CardHeader>
        <CardContent>
          {(data.decisions ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem decisões registradas.</p>
          ) : (
            <div className="overflow-x-auto max-h-[520px]">
              <table className="w-full text-[11px]">
                <thead className="text-muted-foreground border-b border-border/40 sticky top-0 bg-background">
                  <tr className="text-left">
                    <th className="py-1 pr-2">Hora</th>
                    <th className="py-1 pr-2">Robô</th>
                    <th className="py-1 pr-2">Lado</th>
                    <th className="py-1 pr-2">Preço</th>
                    <th className="py-1 pr-2">Score</th>
                    <th className="py-1 pr-2">Conf.</th>
                    <th className="py-1 pr-2">Votos</th>
                    <th className="py-1 pr-2">Tendência</th>
                    <th className="py-1 pr-2">Vol.%</th>
                    <th className="py-1 pr-2">Spread</th>
                    <th className="py-1 pr-2">VWAP Δ</th>
                    <th className="py-1 pr-2">Máx/Mín Δ</th>
                    <th className="py-1 pr-2">Vol</th>
                    <th className="py-1 pr-2">Accel</th>
                    <th className="py-1 pr-2">Δ1m/3m/5m</th>
                    <th className="py-1 pr-2">Regime</th>
                    <th className="py-1 pr-2">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.decisions ?? []).map((d: any, i: number) => (
                    <tr key={i} className="border-b border-border/20 align-top">
                      <td className="py-1 pr-2 font-mono">{new Date(d.at).toLocaleTimeString("pt-BR")}</td>
                      <td className="py-1 pr-2"><Badge variant="outline" className="text-[9px]">{MODE_LABEL[d.robot] ?? d.robot}</Badge></td>
                      <td className="py-1 pr-2 font-mono uppercase">{d.suggested_side}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.price)}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.score)}/{fmt(d.score_min)}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.confidence)}/{fmt(d.confidence_min)}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.approve_votes)}/{fmt(d.approve_votes_min)}</td>
                      <td className="py-1 pr-2">{d.trend_direction} ({fmt(d.trend_strength)})</td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.volatility_pct)}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.spread_pts)}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.dist_vwap_pts)}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.dist_day_high_pts)}/{fmt(d.dist_day_low_pts)}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.volume_current)}<span className="text-muted-foreground"> (μ {fmt(d.volume_avg)})</span></td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.acceleration_pts_per_min)}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(d.var_1m_pts)}/{fmt(d.var_3m_pts)}/{fmt(d.var_5m_pts)}</td>
                      <td className="py-1 pr-2">{d.market_regime ?? "—"}</td>
                      <td className="py-1 pr-2">
                        <Badge variant={d.committee_result === "approved" ? "default" : "secondary"} className="text-[9px]">
                          {d.committee_result ?? "—"}
                        </Badge>
                        <div className="text-muted-foreground text-[10px] max-w-[240px]" title={d.approval_or_first_block ?? ""}>
                          {d.approval_or_first_block ?? ""}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Operações executadas — contexto de entrada e saída</CardTitle>
          <p className="text-xs text-muted-foreground">
            Preço de entrada/saída, resultado bruto e líquido, maior movimento favorável (MFE) e contrário (MAE), duração.
          </p>
        </CardHeader>
        <CardContent>
          {(data.trade_events ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem operações fechadas no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-muted-foreground border-b border-border/40">
                  <tr className="text-left">
                    <th className="py-1 pr-2">Hora fim</th>
                    <th className="py-1 pr-2">Robô</th>
                    <th className="py-1 pr-2">Lado</th>
                    <th className="py-1 pr-2">Entrada</th>
                    <th className="py-1 pr-2">Saída</th>
                    <th className="py-1 pr-2">Duração</th>
                    <th className="py-1 pr-2">Bruto (pts)</th>
                    <th className="py-1 pr-2">Bruto (R$)</th>
                    <th className="py-1 pr-2">Líquido (R$)</th>
                    <th className="py-1 pr-2">MFE</th>
                    <th className="py-1 pr-2">MAE</th>
                    <th className="py-1 pr-2">Motivo saída</th>
                    <th className="py-1 pr-2">Motivo entrada</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.trade_events ?? []).map((t: any, i: number) => (
                    <tr key={i} className="border-b border-border/20">
                      <td className="py-1 pr-2 font-mono">{new Date(t.at).toLocaleTimeString("pt-BR")}</td>
                      <td className="py-1 pr-2"><Badge variant="outline" className="text-[9px]">{MODE_LABEL[t.mode] ?? t.mode}</Badge></td>
                      <td className="py-1 pr-2 font-mono uppercase">{t.side}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(t.entry_price)}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(t.exit_price)}</td>
                      <td className="py-1 pr-2 font-mono">{formatDuration(t.duration_s)}</td>
                      <td className={`py-1 pr-2 font-mono ${t.gross_pts >= 0 ? "text-emerald-500" : "text-red-500"}`}>{fmt(t.gross_pts)}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(t.gross_brl)}</td>
                      <td className={`py-1 pr-2 font-mono ${t.net_brl >= 0 ? "text-emerald-500" : "text-red-500"}`}>{fmt(t.net_brl)}</td>
                      <td className="py-1 pr-2 font-mono text-emerald-500">{fmt(t.mfe_pts)}</td>
                      <td className="py-1 pr-2 font-mono text-red-500">{fmt(t.mae_pts)}</td>
                      <td className="py-1 pr-2"><Badge variant="secondary" className="text-[9px]">{t.exit_reason}</Badge></td>
                      <td className="py-1 pr-2 text-muted-foreground max-w-[280px] truncate" title={t.entry_reason ?? ""}>{t.entry_reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


function Stat({ label, v, accent }: { label: string; v: number; accent?: "pos" | "neg" }) {
  const cls = accent === "pos" ? "text-emerald-500" : accent === "neg" ? "text-red-500" : "";
  return (
    <div className="rounded border border-border/40 px-2 py-1">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className={`font-mono ${cls}`}>{v ?? 0}</div>
    </div>
  );
}
