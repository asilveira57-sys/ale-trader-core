import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { SimComparePanel } from "@/components/b3/SimComparePanel";

export const Route = createFileRoute("/_authenticated/b3-vale3")({
  head: () => ({ meta: [{ title: "B3 Day Trade (VALE3) — AleTrader AI" }] }),
  component: B3Vale3Page,
});

function B3Vale3Page() {
  return (
    <div className="container mx-auto py-6 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">B3 Day Trade — VALE3 (Vale ON)</h1>
          <p className="text-sm text-muted-foreground">
            Ação, mercado fracionário (não precisa ser múltiplo de 100 — mas pode operar com qualquer quantidade).
            Preço já é direto em R$ — sem conceito de ponto/contrato.
            Pregão de ações: 10:00–16:55, diferente do horário de futuro.
          </p>
        </div>
        <Badge variant="outline">SIMULAÇÃO</Badge>
      </header>

      <SimComparePanel symbolPrefix="VALE3" defaultSymbol="VALE3" />
    </div>
  );
}
