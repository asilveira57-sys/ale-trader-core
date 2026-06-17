import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getDashboard,
  updateSettings,
  setRobotStatus,
  getCommitteeSettings,
  updateCommitteeSettings,
  listAgents,
  updateAgentConfig,
} from "@/lib/atrader.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configurações — AleTrader AI" }] }),
  component: SettingsPage,
});

const TF_ALL = ["15m", "1h", "4h", "1d"];

function SettingsPage() {
  const qc = useQueryClient();
  const dash = useServerFn(getDashboard);
  const save = useServerFn(updateSettings);
  const toggle = useServerFn(setRobotStatus);
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => dash({}) });

  const [freq, setFreq] = useState(60);
  const [rate, setRate] = useState(60);
  const [tfs, setTfs] = useState<string[]>(TF_ALL);

  useEffect(() => {
    if (data?.settings) {
      setFreq(data.settings.collect_frequency_seconds);
      setRate(data.settings.rate_limit_per_minute);
      setTfs(data.settings.active_timeframes ?? TF_ALL);
    }
  }, [data]);

  const mSave = useMutation({
    mutationFn: () => save({ data: { collect_frequency_seconds: freq, rate_limit_per_minute: rate, active_timeframes: tfs } }),
    onSuccess: () => { toast.success("Configurações salvas"); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mToggle = useMutation({
    mutationFn: (status: "active" | "paused") => toggle({ data: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  if (!data) return <div className="p-8 text-muted-foreground">Carregando…</div>;

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header><h1 className="text-2xl font-semibold tracking-tight">Configurações gerais</h1>
        <p className="text-sm text-muted-foreground">Modo de operação fixo nesta fase: <Badge>leitura</Badge></p>
      </header>

      <div className="panel p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Estado do robô</p>
            <p className="text-xs text-muted-foreground">Pause para interromper toda rotina automática.</p>
          </div>
          {data.settings?.status === "active" ? (
            <Button variant="destructive" onClick={() => mToggle.mutate("paused")}>Pausar robô</Button>
          ) : (
            <Button onClick={() => mToggle.mutate("active")}>Reativar robô</Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div><Label>Frequência de coleta (segundos)</Label><Input type="number" min={10} max={3600} value={freq} onChange={(e) => setFreq(+e.target.value)} /></div>
          <div><Label>Limite de chamadas / min</Label><Input type="number" min={1} max={1200} value={rate} onChange={(e) => setRate(+e.target.value)} /></div>
        </div>

        <div>
          <Label>Timeframes ativos</Label>
          <div className="flex gap-2 mt-2">
            {TF_ALL.map((tf) => {
              const on = tfs.includes(tf);
              return (
                <button key={tf} type="button" onClick={() => setTfs(on ? tfs.filter((x) => x !== tf) : [...tfs, tf])} className={`px-3 py-1.5 rounded-md text-xs font-mono border ${on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>{tf}</button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => mSave.mutate()} disabled={mSave.isPending}>Salvar configurações</Button>
        </div>
      </div>

      <div className="panel p-6 space-y-3">
        <h2 className="font-medium">Binance</h2>
        <p className="text-sm text-muted-foreground">
          Modo atual: <Badge variant="secondary">{data.settings?.binance_mock_mode ? "mock" : "leitura real"}</Badge>
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          As chaves de API ficam armazenadas apenas no backend, nunca no frontend. Nesta fase
          somente endpoints de leitura são permitidos — compra, venda, futuros, margem e saque
          estão bloqueados por design. Para sair do modo mock, adicione <code className="font-mono">BINANCE_API_KEY</code> e
          <code className="font-mono"> BINANCE_API_SECRET</code> via secrets e desative <em>binance_mock_mode</em>.
        </p>
      </div>

      <CommitteeSettingsPanel />
      <AgentsConfigPanel />
    </div>
  );
}

function CommitteeSettingsPanel() {
  const qc = useQueryClient();
  const get = useServerFn(getCommitteeSettings);
  const save = useServerFn(updateCommitteeSettings);
  const { data } = useQuery({ queryKey: ["committee-settings"], queryFn: () => get({}) });
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (data) setS(data); }, [data]);
  const mSave = useMutation({
    mutationFn: () =>
      save({
        data: {
          min_favor_votes: Number(s.min_favor_votes),
          min_confidence: Number(s.min_confidence),
          min_score: Number(s.min_score),
          max_position_value: Number(s.max_position_value),
          default_stop_pct: Number(s.default_stop_pct),
          default_target_pct: Number(s.default_target_pct),
        },
      }),
    onSuccess: () => { toast.success("Configurações do comitê salvas"); qc.invalidateQueries({ queryKey: ["committee-settings"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  if (!s) return null;
  const F = (k: string, label: string, opts: { step?: number; min?: number; max?: number } = {}) => (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        step={opts.step ?? 1}
        min={opts.min}
        max={opts.max}
        value={s[k]}
        onChange={(e) => setS({ ...s, [k]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="panel p-6 space-y-5">
      <div>
        <h2 className="font-medium">Comitê de decisão</h2>
        <p className="text-xs text-muted-foreground">Critérios para aprovar uma operação simulada.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {F("min_favor_votes", "Mínimo de votos favoráveis", { min: 1, max: 10 })}
        {F("min_confidence", "Confiança mínima (%)", { step: 1, min: 0, max: 100 })}
        {F("min_score", "Score mínimo (%)", { step: 1, min: 0, max: 100 })}
        {F("max_position_value", "Valor máx. por operação (USD)", { step: 10 })}
        {F("default_stop_pct", "Stop padrão (%)", { step: 0.1 })}
        {F("default_target_pct", "Alvo padrão (%)", { step: 0.1 })}
      </div>
      <div className="flex justify-end">
        <Button onClick={() => mSave.mutate()} disabled={mSave.isPending}>Salvar comitê</Button>
      </div>
    </div>
  );
}

function AgentsConfigPanel() {
  const qc = useQueryClient();
  const get = useServerFn(listAgents);
  const upd = useServerFn(updateAgentConfig);
  const { data } = useQuery({ queryKey: ["agents-list"], queryFn: () => get({}) });
  const mUpd = useMutation({
    mutationFn: (p: { id: string; active?: boolean; weight?: number }) => upd({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents-list"] }),
    onError: (e: any) => toast.error(e.message),
  });
  if (!data) return null;
  return (
    <div className="panel p-6 space-y-3">
      <div>
        <h2 className="font-medium">Agentes ativos e pesos</h2>
        <p className="text-xs text-muted-foreground">Desative agentes ou ajuste o peso no consenso.</p>
      </div>
      <div className="divide-y divide-border">
        {data.agents.map((a: any) => (
          <div key={a.id} className="py-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-sm">{a.name}</p>
              <p className="text-xs text-muted-foreground">{a.profile}{a.veto_power ? " · pode vetar" : ""}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Peso</Label>
                <Input
                  type="number"
                  step={0.1}
                  min={0}
                  max={10}
                  className="w-20"
                  defaultValue={Number(a.weight)}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== Number(a.weight)) mUpd.mutate({ id: a.id, weight: v });
                  }}
                />
              </div>
              <Switch checked={a.active} onCheckedChange={(v) => mUpd.mutate({ id: a.id, active: v })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
