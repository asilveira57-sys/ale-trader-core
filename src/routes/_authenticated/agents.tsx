import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAgents, toggleAgent } from "@/lib/atrader.functions";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/agents")({
  head: () => ({ meta: [{ title: "Agentes — AleTrader AI" }] }),
  component: AgentsPage,
});

function AgentsPage() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(listAgents);
  const toggleFn = useServerFn(toggleAgent);
  const { data } = useQuery({ queryKey: ["agents"], queryFn: () => fetchFn({}) });
  const mut = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => toggleFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agents"] }); toast.success("Agente atualizado"); },
    onError: (e: any) => toast.error(e.message),
  });

  const agents = data?.agents ?? [];
  const lastVoteByAgent = new Map<string, any>();
  for (const v of data?.votes ?? []) if (!lastVoteByAgent.has(v.agent_id)) lastVoteByAgent.set(v.agent_id, v);

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agentes especialistas</h1>
        <p className="text-sm text-muted-foreground">Nesta fase, os agentes são apenas observados — não decidem ordens.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((a: any) => {
          const last = lastVoteByAgent.get(a.id);
          return (
            <div key={a.id} className="panel p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{a.name}</h3>
                    {a.veto_power && <Badge variant="destructive">veto</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{a.strategy_description}</p>
                </div>
                <Switch checked={a.active} onCheckedChange={(v) => mut.mutate({ id: a.id, active: v })} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><p className="text-muted-foreground">Peso</p><p className="font-mono">{a.weight}</p></div>
                <div><p className="text-muted-foreground">Perfil</p><p>{a.profile}</p></div>
                <div><p className="text-muted-foreground">Status</p><p>{a.active ? "Ativo" : "Inativo"}</p></div>
              </div>
              <div className="text-xs border-t border-border pt-3">
                <p className="text-muted-foreground">Último voto</p>
                {last ? (
                  <p><Badge variant="outline">{last.vote}</Badge> <span className="text-muted-foreground">{last.pair} · confiança {Number(last.confidence).toFixed(2)}</span></p>
                ) : (
                  <p className="text-muted-foreground">Sem votos ainda.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
