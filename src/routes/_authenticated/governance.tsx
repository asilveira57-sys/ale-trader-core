import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGovernanceState, updateGovernanceSettings, recomputeConfidenceFn, evolveWeightsFn } from "@/lib/auto-trading.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Check, X, Gauge } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/_authenticated/governance")({
  head: () => ({ meta: [{ title: "Governança | AleTrader AI" }] }),
  component: GovernancePage,
});

function GovernancePage() {
  const fetchState = useServerFn(getGovernanceState);
  const updateFn = useServerFn(updateGovernanceSettings);
  const recompConf = useServerFn(recomputeConfidenceFn);
  const evolveW = useServerFn(evolveWeightsFn);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["governance"], queryFn: () => fetchState(), refetchInterval: 30_000 });
  const [form, setForm] = useState<any>(null);

  useEffect(() => { if (data?.gov && !form) setForm(data.gov); }, [data, form]);

  const update = useMutation({
    mutationFn: (patch: any) => updateFn({ data: patch }),
    onSuccess: () => { toast.success("Atualizado"); qc.invalidateQueries({ queryKey: ["governance"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !form) return <div className="p-8">Carregando...</div>;
  const elig = data?.elig;
  const conf = data?.confidence;

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Gauge className="size-7 text-amber-400" /> Centro de Governança</h1>
          <p className="text-muted-foreground">Configurações de risco, automação e supervisão para a Fase 7.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => recompConf({}).then(() => { toast.success("Confiança recalculada"); qc.invalidateQueries({ queryKey: ["governance"] }); })}>Recalcular confiança</Button>
          <Button variant="outline" onClick={() => evolveW({}).then((r: any) => toast.success(`${r.updated} pesos ajustados`))}>Evoluir pesos</Button>
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle className="text-sm">Confiança do robô</CardTitle></CardHeader><CardContent><p className="text-4xl font-bold">{conf?.score ?? "—"}</p><p className="text-xs text-muted-foreground">/100</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Elegibilidade</CardTitle></CardHeader><CardContent><Badge variant={elig?.eligible ? "default" : "destructive"}>{elig?.eligible ? "ELEGÍVEL" : "BLOQUEADO"}</Badge>{!elig?.eligible && <p className="text-xs mt-2">{elig?.failedChecks.join(", ")}</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Kill Switch</CardTitle></CardHeader><CardContent><Badge variant={form.kill_switch_active ? "destructive" : "secondary"}>{form.kill_switch_active ? "ATIVO" : "INATIVO"}</Badge>{form.kill_switch_reason && <p className="text-xs mt-2">{form.kill_switch_reason}</p>}</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Checklist de elegibilidade</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {elig && Object.entries(elig.details ?? {}).map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span>{k}</span><span className="font-mono">{String(v)}</span>
            </div>
          ))}
          <div className="pt-2 flex flex-wrap gap-2">
            {elig?.failedChecks.length === 0
              ? <Badge><Check className="size-3 mr-1" /> Todos os critérios atendidos</Badge>
              : elig?.failedChecks.map((f) => <Badge key={f} variant="destructive"><X className="size-3 mr-1" />{f}</Badge>)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Automação</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Automação habilitada</Label>
            <Switch checked={form.automation_enabled} onCheckedChange={(v) => setForm({ ...form, automation_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Supervisor habilitado</Label>
            <Switch checked={form.supervisor_enabled} onCheckedChange={(v) => setForm({ ...form, supervisor_enabled: v })} />
          </div>
          <div>
            <Label>Nível de automação (1=0.25% / 2=0.5% / 3=1% por trade)</Label>
            <div className="flex gap-2 mt-1">
              {[1, 2, 3].map((n) => (
                <Button key={n} variant={form.automation_level === n ? "default" : "outline"} onClick={() => setForm({ ...form, automation_level: n })}>Nível {n}</Button>
              ))}
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              ["min_confidence_score", "Confiança mínima (0-100)"],
              ["min_score_for_auto", "Score mínimo (0-100)"],
              ["min_consensus_for_auto", "Consenso mínimo (0-1)"],
              ["min_risk_reward", "R:R mínimo"],
              ["max_consecutive_losses", "Máx. perdas consecutivas"],
              ["max_daily_losses", "Máx. perdas diárias"],
              ["max_weekly_losses", "Máx. perdas semanais"],
              ["max_drawdown_pct", "Drawdown máximo %"],
              ["eligibility_min_days", "Elegib.: dias mínimos"],
              ["eligibility_min_trades", "Elegib.: trades mínimos"],
              ["eligibility_min_profit_factor", "Elegib.: profit factor mínimo"],
            ].map(([key, label]) => (
              <div key={key}>
                <Label>{label}</Label>
                <Input type="number" step="0.01" value={form[key] ?? 0} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} />
              </div>
            ))}
          </div>
          <Button onClick={() => update.mutate({
            automation_enabled: form.automation_enabled,
            automation_level: form.automation_level,
            supervisor_enabled: form.supervisor_enabled,
            min_confidence_score: form.min_confidence_score,
            min_score_for_auto: form.min_score_for_auto,
            min_consensus_for_auto: form.min_consensus_for_auto,
            min_risk_reward: form.min_risk_reward,
            max_consecutive_losses: form.max_consecutive_losses,
            max_daily_losses: form.max_daily_losses,
            max_weekly_losses: form.max_weekly_losses,
            max_drawdown_pct: form.max_drawdown_pct,
            eligibility_min_days: form.eligibility_min_days,
            eligibility_min_trades: form.eligibility_min_trades,
            eligibility_min_profit_factor: form.eligibility_min_profit_factor,
          })}>Salvar configurações</Button>
        </CardContent>
      </Card>
    </div>
  );
}
