import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listLabs, createLab, runSimulation, listSimulations } from "@/lib/intelligence.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/strategy-lab")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const labs = useQuery({ queryKey: ["labs"], queryFn: () => listLabs() });
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [weight, setWeight] = useState("1.0");
  const [minScore, setMinScore] = useState("0");

  const create = useMutation({
    mutationFn: () => createLab({ data: { name, description: desc, config: {} } }),
    onSuccess: () => { toast.success("Estratégia criada"); setName(""); setDesc(""); qc.invalidateQueries({ queryKey: ["labs"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const sims = useQuery({
    queryKey: ["sims", selected],
    queryFn: () => listSimulations({ data: { labId: selected! } }),
    enabled: !!selected,
  });

  const run = useMutation({
    mutationFn: () => runSimulation({ data: { labId: selected!, params: { weight_multiplier: Number(weight), min_score: Number(minScore) } } }),
    onSuccess: () => { toast.success("Simulação executada"); qc.invalidateQueries({ queryKey: ["sims", selected] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 space-y-3">
        <h1 className="text-xl font-semibold">Laboratório de Estratégias</h1>
        <Card className="p-3 space-y-2">
          <h2 className="text-sm font-medium">Nova estratégia</h2>
          <Input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea placeholder="Descrição" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Button size="sm" disabled={!name || create.isPending} onClick={() => create.mutate()}>Criar</Button>
        </Card>
        <div className="space-y-1">
          {(labs.data ?? []).map((l: any) => (
            <button
              key={l.id}
              onClick={() => setSelected(l.id)}
              className={`w-full text-left p-3 rounded border ${selected === l.id ? "border-primary bg-accent/50" : "border-border"}`}
            >
              <p className="font-medium text-sm">{l.name}</p>
              <p className="text-xs text-muted-foreground">{l.description ?? "—"}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-2 space-y-3">
        {selected ? (
          <>
            <Card className="p-3 space-y-2">
              <h2 className="text-sm font-medium">Simular alterações</h2>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">Multiplicador de peso
                  <Input value={weight} onChange={(e) => setWeight(e.target.value)} />
                </label>
                <label className="text-xs">Score mínimo
                  <Input value={minScore} onChange={(e) => setMinScore(e.target.value)} />
                </label>
              </div>
              <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()}>Executar simulação</Button>
              <p className="text-xs text-muted-foreground">Simulação isolada — não afeta produção. Para aplicar, gere uma recomendação aprovada.</p>
            </Card>

            <div className="space-y-2">
              {(sims.data ?? []).map((s: any) => (
                <Card key={s.id} className="p-3 text-sm">
                  <div className="flex justify-between">
                    <span>Score: <strong>{Number(s.score ?? 0).toFixed(1)}</strong></span>
                    <span className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs mt-1">
                    <span>PnL esperado: {Number(s.expected_pnl ?? 0).toFixed(2)}</span>
                    <span>DD esperado: {Number(s.expected_drawdown ?? 0).toFixed(2)}</span>
                    <span>WinRate: {(Number(s.expected_winrate ?? 0) * 100).toFixed(1)}%</span>
                  </div>
                  {s.notes && <p className="text-xs mt-1 text-muted-foreground">{s.notes}</p>}
                </Card>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Selecione ou crie uma estratégia.</p>
        )}
      </div>
    </div>
  );
}
