import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listRecommendations, decideRecommendation, generateRecommendations } from "@/lib/intelligence.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recommendations")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["recs", "all"], queryFn: () => listRecommendations({ data: {} }) });
  const decide = useMutation({
    mutationFn: (input: { id: string; decision: "approved" | "rejected" | "applied" }) => decideRecommendation({ data: input }),
    onSuccess: () => { toast.success("Decisão registrada"); qc.invalidateQueries({ queryKey: ["recs"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });
  const gen = useMutation({
    mutationFn: () => generateRecommendations(),
    onSuccess: (r: any) => { toast.success(`${r?.created?.length ?? 0} recomendações geradas`); qc.invalidateQueries({ queryKey: ["recs"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Fila de Melhorias Recomendadas</h1>
          <p className="text-sm text-muted-foreground">O sistema sugere — você aprova. Nada é aplicado sem decisão explícita.</p>
        </div>
        <Button onClick={() => gen.mutate()} disabled={gen.isPending}>Gerar a partir do histórico</Button>
      </header>

      <div className="space-y-3">
        {(q.data ?? []).map((r: any) => (
          <Card key={r.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium">{r.title}</h2>
                <p className="text-xs text-muted-foreground">{r.kind} · {new Date(r.created_at).toLocaleString()}</p>
              </div>
              <Badge variant={r.status === "pending" ? "outline" : r.status === "approved" ? "default" : "secondary"}>{r.status}</Badge>
            </div>
            <p className="text-sm">{r.description}</p>
            {r.rationale && <p className="text-xs text-muted-foreground">{r.rationale}</p>}
            <pre className="text-[11px] bg-muted/30 p-2 rounded overflow-x-auto">{JSON.stringify(r.suggested_changes, null, 2)}</pre>
            {r.status === "pending" && (
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: "approved" })}>Aprovar</Button>
                <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, decision: "applied" })}>Marcar como aplicada</Button>
                <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, decision: "rejected" })}>Rejeitar</Button>
              </div>
            )}
          </Card>
        ))}
        {q.isSuccess && (q.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nenhuma recomendação ainda.</p>}
      </div>
    </div>
  );
}
