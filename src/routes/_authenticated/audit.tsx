import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAuditReports } from "@/lib/real-trading.functions";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({ meta: [{ title: "Auditoria — AleTrader AI" }] }),
  component: AuditPage,
});

const COLORS: Record<string, string> = {
  excellent: "text-emerald-400", good: "text-emerald-300",
  neutral: "text-muted-foreground", bad: "text-orange-400", critical: "text-red-500",
};

function AuditPage() {
  const fn = useServerFn(listAuditReports);
  const { data, isLoading } = useQuery({ queryKey: ["audit-reports"], queryFn: () => fn({}) });
  if (isLoading) return <div className="p-8 text-muted-foreground">Carregando…</div>;

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria Automática</h1>
        <p className="text-sm text-muted-foreground">Relatórios gerados antes, durante e depois de cada operação.</p>
      </header>

      <div className="panel divide-y divide-border">
        {(data ?? []).length === 0 && <p className="p-6 text-sm text-muted-foreground">Sem relatórios.</p>}
        {(data ?? []).map((r: any) => (
          <Link key={r.id} to="/audit/$reportId" params={{ reportId: r.id }} className="block px-4 py-3 hover:bg-accent/30">
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-medium">{r.phase.toUpperCase()} • {new Date(r.created_at).toLocaleString("pt-BR")}</span>
              {r.classification && <span className={`text-xs uppercase ${COLORS[r.classification] ?? ""}`}>{r.classification}</span>}
            </div>
            {r.summary && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{r.summary.slice(0, 200)}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}
