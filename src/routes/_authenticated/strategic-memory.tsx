import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listStrategicMemory, searchStrategicMemory } from "@/lib/intelligence.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/strategic-memory")({ component: Page });

function Page() {
  const [query, setQuery] = useState("");
  const list = useQuery({ queryKey: ["memory"], queryFn: () => listStrategicMemory({ data: {} }) });
  const search = useMutation({ mutationFn: (q: string) => searchStrategicMemory({ data: { query: q } }) });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Memória Estratégica</h1>
      <p className="text-sm text-muted-foreground">Banco de conhecimento proprietário: operações, debates, auditorias, padrões.</p>

      <div className="flex gap-2">
        <Input placeholder='Ex: "Operações semelhantes às últimas perdas em BTC"' value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button onClick={() => search.mutate(query)} disabled={!query || search.isPending}>Buscar</Button>
      </div>

      {search.data && (
        <section>
          <h2 className="text-sm font-medium mb-2">Resultados semânticos</h2>
          <div className="space-y-2">
            {(search.data as any[]).map((r: any) => (
              <Card key={r.id} className="p-3">
                <div className="flex justify-between mb-1">
                  <Badge variant="outline">{r.kind}</Badge>
                  <span className="text-xs text-muted-foreground">sim {(Number(r.similarity) * 100).toFixed(0)}%</span>
                </div>
                <p className="text-sm font-medium">{r.title ?? "—"}</p>
                <p className="text-xs text-muted-foreground line-clamp-3">{r.content}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium mb-2">Últimas memórias</h2>
        <div className="space-y-2">
          {(list.data ?? []).map((r: any) => (
            <Card key={r.id} className="p-3">
              <div className="flex justify-between">
                <Badge variant="outline">{r.kind}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <p className="text-sm font-medium mt-1">{r.title ?? "—"}</p>
              <p className="text-xs text-muted-foreground line-clamp-2">{r.content}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
