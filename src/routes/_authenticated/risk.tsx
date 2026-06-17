import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLiveState, updateRiskSettings } from "@/lib/live.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/risk")({
  head: () => ({ meta: [{ title: "Gestão de Risco — AleTrader AI" }] }),
  component: RiskPage,
});

const FIELDS: Array<{ k: string; label: string; step?: number }> = [
  { k: "max_per_trade", label: "Máximo por operação (USD)", step: 10 },
  { k: "max_per_asset", label: "Máximo por ativo (USD)", step: 10 },
  { k: "max_portfolio_exposure", label: "Exposição máxima total (USD)", step: 100 },
  { k: "daily_loss_limit", label: "Perda diária máxima (USD)", step: 10 },
  { k: "weekly_loss_limit", label: "Perda semanal máxima (USD)", step: 50 },
  { k: "monthly_loss_limit", label: "Perda mensal máxima (USD)", step: 100 },
  { k: "max_loss_streak", label: "Sequência de perdas máx.", step: 1 },
  { k: "default_stop_pct", label: "Stop padrão (%)", step: 0.1 },
  { k: "default_take_pct", label: "Alvo padrão (%)", step: 0.1 },
];

function RiskPage() {
  const qc = useQueryClient();
  const fn = useServerFn(getLiveState);
  const upd = useServerFn(updateRiskSettings);
  const { data } = useQuery({ queryKey: ["live-state"], queryFn: () => fn({}) });
  const [vals, setVals] = useState<Record<string, number>>({});
  useEffect(() => { if (data?.settings) { const v: any = {}; FIELDS.forEach(f => { v[f.k] = Number((data.settings as any)[f.k] ?? 0); }); setVals(v); } }, [data]);
  const save = useMutation({
    mutationFn: () => upd({ data: vals as any }),
    onSuccess: () => { toast.success("Salvo"); qc.invalidateQueries({ queryKey: ["live-state"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  if (!data) return <div className="p-8 text-muted-foreground">Carregando…</div>;

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <header><h1 className="text-2xl font-semibold tracking-tight">Gestão de Risco</h1>
        <p className="text-sm text-muted-foreground">Limites globais aplicados antes de qualquer abertura de posição</p>
      </header>

      <div className="panel p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {FIELDS.map((f) => (
          <div key={f.k}>
            <Label>{f.label}</Label>
            <Input type="number" step={f.step ?? 1} value={vals[f.k] ?? 0} onChange={(e) => setVals({ ...vals, [f.k]: Number(e.target.value) })} />
          </div>
        ))}
        <div className="md:col-span-3 flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar limites</Button>
        </div>
      </div>

      <div className="panel p-5">
        <h2 className="font-medium mb-3">Eventos de risco</h2>
        {data.risk_events.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum.</p> : (
          <ul className="space-y-1 text-sm">
            {data.risk_events.map((r: any) => (
              <li key={r.id} className="border-b border-border/40 py-1 flex gap-3 text-xs">
                <span className="text-muted-foreground w-40 shrink-0">{new Date(r.created_at).toLocaleString()}</span>
                <span className="font-mono text-amber-500 w-32 shrink-0">{r.kind}</span>
                <span>{r.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
