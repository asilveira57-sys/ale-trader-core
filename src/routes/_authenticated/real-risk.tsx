import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRealDashboard, updateRealRiskLimits } from "@/lib/real-trading.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/real-risk")({
  head: () => ({ meta: [{ title: "Limites Reais — AleTrader AI" }] }),
  component: RealRiskPage,
});

const FIELDS = [
  { k: "max_per_trade", label: "Máx. por operação ($)", step: 5 },
  { k: "max_pct_portfolio", label: "Máx. % carteira por trade", step: 0.5 },
  { k: "daily_loss_limit", label: "Perda diária máx. ($)", step: 10 },
  { k: "weekly_loss_limit", label: "Perda semanal máx. ($)", step: 25 },
  { k: "monthly_loss_limit", label: "Perda mensal máx. ($)", step: 50 },
  { k: "max_trades_per_day", label: "Ops/dia máx.", step: 1 },
  { k: "max_open_positions", label: "Posições abertas máx.", step: 1 },
  { k: "loss_streak_limit", label: "Sequência de perdas máx.", step: 1 },
] as const;

function RealRiskPage() {
  const qc = useQueryClient();
  const fn = useServerFn(getRealDashboard);
  const upd = useServerFn(updateRealRiskLimits);
  const { data } = useQuery({ queryKey: ["real-dashboard"], queryFn: () => fn({}) });
  const [vals, setVals] = useState<Record<string, number>>({});
  useEffect(() => {
    if (data?.limits) {
      const v: any = {};
      FIELDS.forEach((f) => { v[f.k] = Number((data.limits as any)[f.k] ?? 0); });
      setVals(v);
    }
  }, [data]);
  const save = useMutation({
    mutationFn: () => upd({ data: vals as any }),
    onSuccess: () => { toast.success("Limites salvos"); qc.invalidateQueries({ queryKey: ["real-dashboard"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  if (!data) return <div className="p-8 text-muted-foreground">Carregando…</div>;
  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Limites de Risco Reais</h1>
        <p className="text-sm text-muted-foreground">Aplicados antes de qualquer ordem real ser aprovada.</p>
      </header>
      <div className="panel p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {FIELDS.map((f) => (
          <div key={f.k}>
            <Label>{f.label}</Label>
            <Input type="number" step={f.step} value={vals[f.k] ?? 0} onChange={(e) => setVals({ ...vals, [f.k]: Number(e.target.value) })} />
          </div>
        ))}
        <div className="md:col-span-2 flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar limites</Button>
        </div>
      </div>
    </div>
  );
}
