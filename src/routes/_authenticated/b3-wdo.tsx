import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { SimComparePanel } from "@/components/b3/SimComparePanel";

export const Route = createFileRoute("/_authenticated/b3-wdo")({
  head: () => ({ meta: [{ title: "B3 Day Trade (WDO) — AleTrader AI" }] }),
  component: B3WdoPage,
});

// Constantes do mini-dólar — ver b3_asset_profiles (symbol='WDOU26') pro
// valor oficial usado pelo motor. Aqui é só pra exibição no cabeçalho.
const POINT_VALUE_BRL = 10.0; // R$ por ponto por contrato
const TICK = 0.5;             // variação mínima em pontos

function B3WdoPage() {
  return (
    <div className="container mx-auto py-6 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">B3 Day Trade — Mini Dólar (WDO)</h1>
          <p className="text-sm text-muted-foreground">
            1 ponto = R$ {POINT_VALUE_BRL.toFixed(2).replace(".", ",")} por contrato · variação mínima {TICK} ponto.
            O contrato corrente muda mensalmente — confira no MT5 antes de operar de verdade.
          </p>
        </div>
        <Badge variant="outline">SIMULAÇÃO</Badge>
      </header>

      {/* Só os 5 modos, filtrados pra WDO — as abas de Painel/Operar/Comitê/
          Configurações da página do WIN são de um sistema mais antigo,
          específico daquele ativo, e não se aplicam aqui. */}
      <SimComparePanel symbolPrefix="WDO" defaultSymbol="WDOU26" />
    </div>
  );
}
