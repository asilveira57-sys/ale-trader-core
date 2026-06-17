import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAuditReport } from "@/lib/real-trading.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/audit/$reportId")({
  head: () => ({ meta: [{ title: "Relatório de Auditoria — AleTrader AI" }] }),
  component: AuditReportPage,
});

function AuditReportPage() {
  const { reportId } = Route.useParams();
  const fn = useServerFn(getAuditReport);
  const { data, isLoading } = useQuery({ queryKey: ["audit-report", reportId], queryFn: () => fn({ data: { id: reportId } }) });
  if (isLoading || !data?.report) return <div className="p-8 text-muted-foreground">Carregando…</div>;
  const r = data.report;
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Auditoria {r.phase.toUpperCase()}</h1>
          <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}{r.classification && ` • ${r.classification.toUpperCase()}`}</p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>Exportar PDF (imprimir)</Button>
      </header>
      <article className="panel p-6 whitespace-pre-wrap text-sm leading-relaxed">{r.summary ?? "(sem resumo)"}</article>
      <details className="panel p-4">
        <summary className="cursor-pointer text-sm">Dados estruturados</summary>
        <pre className="text-xs overflow-x-auto mt-3">{JSON.stringify(r.content, null, 2)}</pre>
      </details>
    </div>
  );
}
