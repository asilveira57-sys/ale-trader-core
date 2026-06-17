import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { generatePostTrade, listIntelligenceReports } from "@/lib/intelligence.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/post-trade")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["ireports"], queryFn: () => listIntelligenceReports({ data: {} }) });
  const [tradeId, setTradeId] = useState("");
  const gen = useMutation({
    mutationFn: () => generatePostTrade({ data: { automatedTradeId: tradeId } }),
    onSuccess: () => { toast.success("Relatório gerado"); setTradeId(""); qc.invalidateQueries({ queryKey: ["ireports"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Análises Pós-Operação</h1>
      <Card className="p-3 flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground">ID da operação automatizada</label>
          <Input value={tradeId} onChange={(e) => setTradeId(e.target.value)} placeholder="uuid" />
        </div>
        <Button disabled={!tradeId || gen.isPending} onClick={() => gen.mutate()}>Gerar análise</Button>
      </Card>

      <div className="space-y-2">
        {(list.data ?? []).map((r: any) => (
          <Card key={r.id} className="p-3">
            <div className="flex justify-between">
              <span className="font-medium">{r.title}</span>
              <Badge variant="outline">{r.kind}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
            <p className="text-sm mt-1">{r.summary}</p>
            {r.recommendations && (
              <details className="mt-2">
                <summary className="text-xs text-primary cursor-pointer">Ver recomendações</summary>
                <pre className="text-[11px] mt-1 whitespace-pre-wrap">{r.recommendations}</pre>
              </details>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
