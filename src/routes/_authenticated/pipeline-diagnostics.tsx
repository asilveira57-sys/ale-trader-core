import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPipelineDiagnostics } from "@/lib/pipeline-diagnostics.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/pipeline-diagnostics")({
  head: () => ({ meta: [{ title: "Diagnóstico do Pipeline — AleTrader AI" }] }),
  component: PipelineDiagnosticsPage,
});

function StatusBadge({ status }: { status: "ok" | "warning" | "fail" }) {
  if (status === "ok") return <Badge className="bg-success text-success-foreground gap-1"><CheckCircle2 className="size-3" />OK</Badge>;
  if (status === "warning") return <Badge className="bg-amber-500 text-white gap-1"><AlertTriangle className="size-3" />Aviso</Badge>;
  return <Badge variant="destructive" className="gap-1"><XCircle className="size-3" />Falha</Badge>;
}

function PipelineDiagnosticsPage() {
  const fetchFn = useServerFn(getPipelineDiagnostics);
  const { data, isLoading } = useQuery({ queryKey: ["pipeline-diagnostics"], queryFn: () => fetchFn(), refetchInterval: 15000 });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Analisando pipeline…</div>;

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Activity className="size-6 text-primary" /> Diagnóstico do Pipeline
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{data.verdict}</p>
        <div className="flex gap-2 mt-3 text-xs">
          <Badge className="bg-success text-success-foreground">{data.summary.ok} OK</Badge>
          <Badge className="bg-amber-500 text-white">{data.summary.warning} Avisos</Badge>
          <Badge variant="destructive">{data.summary.fail} Falhas</Badge>
        </div>
      </header>

      <Card className="p-4">
        <h2 className="text-sm font-medium mb-2">Sessão de trading</h2>
        <p className="text-xs text-muted-foreground">
          Ativas: <span className="font-mono">{data.session.active}</span>
          {data.session.started_at && ` · iniciada ${new Date(data.session.started_at).toLocaleString()}`}
        </p>
      </Card>

      <section className="space-y-3">
        {data.stages.map((s) => (
          <Card key={s.key} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{s.label}</h3>
                  <StatusBadge status={s.status} />
                </div>
                <p className="text-sm text-muted-foreground mt-1">{s.detail}</p>
                <p className="text-[11px] text-muted-foreground mt-2">
                  <span className="uppercase tracking-wider">Gatilho:</span> {s.trigger}
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground shrink-0">
                <p className="font-mono text-lg text-foreground">{s.count}</p>
                <p>{s.last_at ? new Date(s.last_at).toLocaleString() : "sem registros"}</p>
              </div>
            </div>
          </Card>
        ))}
      </section>

      <Card className="p-4 border-amber-500/40">
        <h2 className="text-sm font-medium mb-2">Resumo da auditoria</h2>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
          <li><strong>Binance</strong> grava em <code>market_snapshots</code> mas não popula <code>candles</code> nem <code>indicators</code>.</li>
          <li><strong>runCommittee</strong> (que cria votos, decisões e ordens simuladas) só é executado quando chamado manualmente — não há cron.</li>
          <li><strong>auto-tick</strong> (<code>/api/public/hooks/auto-tick</code>) existe, mas depende de decisões pré-existentes do comitê e não está agendado no pg_cron.</li>
          <li><strong>Supervisor</strong> só roda dentro do <code>auto-tick</code>; sem decisões, nunca é chamado.</li>
          <li><strong>Inteligência</strong> depende de <code>daily-report</code>/<code>weekly-report</code> — também sem agendamento.</li>
          <li>Resumo: o fluxo está parado no <strong>elo Coleta → Comitê</strong>. Nenhum job conecta a coleta de mercado à execução do comitê.</li>
        </ul>
      </Card>
    </div>
  );
}
