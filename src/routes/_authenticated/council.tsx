import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCouncil } from "@/lib/experts.functions";
import { Badge } from "@/components/ui/badge";
import { Brain, Bot } from "lucide-react";

export const Route = createFileRoute("/_authenticated/council")({
  head: () => ({ meta: [{ title: "Conselho — AleTrader AI" }] }),
  component: CouncilPage,
});

function CouncilPage() {
  const fetchFn = useServerFn(getCouncil);
  const { data, isLoading } = useQuery({ queryKey: ["council"], queryFn: () => fetchFn({}), refetchInterval: 15000 });
  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando conselho…</div>;

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Conselho de Especialistas</h1>
        <p className="text-sm text-muted-foreground">
          Todos os agentes votantes — regras determinísticas + especialistas com memória própria.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.agents.map((a: any) => {
          const rep = a.reputation;
          const lv = a.last_vote;
          return (
            <div key={a.id} className="panel p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {a.kind === "expert" ? <Brain className="size-4 text-primary" /> : <Bot className="size-4 text-muted-foreground" />}
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.profile} · peso {Number(a.weight ?? 1).toFixed(2)}</p>
                  </div>
                </div>
                <Badge variant={a.active ? "default" : "secondary"}>{a.active ? "Ativo" : "Inativo"}</Badge>
              </div>
              {lv ? (
                <div className="mt-3 text-sm">
                  <Badge variant="outline" className="uppercase">{lv.vote}</Badge>
                  <span className="ml-2 text-muted-foreground">conf {Number(lv.confidence).toFixed(0)} · {lv.pair}</span>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{lv.justification}</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-3">Sem voto recente</p>
              )}
              {rep && (
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="border border-border rounded p-2">
                    <p className="font-mono text-lg">{Number(rep.score).toFixed(0)}</p>
                    <p className="text-muted-foreground">score</p>
                  </div>
                  <div className="border border-border rounded p-2">
                    <p className="font-mono text-lg text-success">{rep.hits}</p>
                    <p className="text-muted-foreground">acertos</p>
                  </div>
                  <div className="border border-border rounded p-2">
                    <p className="font-mono text-lg text-destructive">{rep.misses}</p>
                    <p className="text-muted-foreground">erros</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
