import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getB3PipelineAudit } from "@/lib/b3-simulation.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, XCircle, ArrowDown } from "lucide-react";

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

export function PipelineAuditPanel() {
  const fetchFn = useServerFn(getB3PipelineAudit);
  const q = useQuery({
    queryKey: ["b3-pipeline-audit"],
    queryFn: () => fetchFn(),
    refetchInterval: 3000,
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
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4 text-primary" /> Pipeline de Decisão — por Robô
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Snapshots auditados: {data.totals?.snapshots_scanned ?? 0}. Auditoria somente-leitura — nenhuma regra é alterada.
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
