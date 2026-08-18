// Configuração por robô (ativo × modalidade × modo).
// SOMENTE interface e configuração — não altera nenhuma regra do motor.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Settings as SettingsIcon, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { getB3RobotConfig, saveB3RobotConfig } from "@/lib/b3-robot-config.functions";
import { B3_ROBOT_FIELD_LABEL } from "@/lib/b3-robot-fields";
import { BRL, rootSymbol } from "@/lib/b3-format";

const VARIANT_LABEL: Record<string, string> = {
  indicador: "indicador", price_action: "price action",
  mean_reversion: "reversão à média", range: "range",
};
const MODE_LABEL: Record<string, string> = {
  conservador: "conservador", moderado: "moderado", equilibrado: "equilibrado",
  semi_agressivo: "semi-agressivo", agressivo: "agressivo",
};
const vLabel = (v: string) => VARIANT_LABEL[v] ?? String(v ?? "");
const mLabel = (m: string) => MODE_LABEL[m] ?? String(m ?? "");

const GROUPS: Array<{ title: string; fields: Array<{ k: string; step?: number }> }> = [
  {
    title: "Entrada",
    fields: [
      { k: "min_confidence" }, { k: "min_score" }, { k: "min_approve_votes" },
      { k: "max_volatility_pct", step: 0.1 }, { k: "lateral_strength_min", step: 1 },
      { k: "lateral_vol_min", step: 0.1 },
    ],
  },
  { title: "Operação", fields: [{ k: "stop_pts" }, { k: "gain_pts" }, { k: "max_contracts" }] },
  {
    title: "Trailing",
    fields: [{ k: "trailing_activation_pts" }, { k: "trailing_giveback_pts" }],
  },
  {
    title: "Proteção",
    fields: [
      { k: "daily_gain_target_brl", step: 10 }, { k: "minimum_trades_before_profit_lock" },
      { k: "profit_multiplier_before_lock", step: 0.1 }, { k: "post_target_allowed_retracement", step: 0.05 },
      { k: "consecutive_loss_after_target" }, { k: "post_target_size_reduction", step: 0.05 },
    ],
  },
];

const TIME_FIELDS = ["trading_start_time", "entry_cutoff_time", "force_close_time"];

export function RobotConfigDialog({
  runId, mode, symbol, variant, compact,
}: { runId: string; mode: string; symbol: string; variant: string; compact?: boolean }) {
  const qc = useQueryClient();
  const get = useServerFn(getB3RobotConfig);
  const save = useServerFn(saveB3RobotConfig);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const [pendingScope, setPendingScope] = useState<"all_modes" | "all_variants" | null>(null);
  const [copyFrom, setCopyFrom] = useState<string>("");

  const q = useQuery({
    queryKey: ["b3-robot-config", runId, mode],
    queryFn: () => get({ data: { run_id: runId, mode } }),
    enabled: open,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const d = q.data;
  const current = d?.settings ?? null;
  if (open && current && !form) setForm({ ...current });
  const f = form ?? current ?? {};
  const set = (k: string, v: any) => setForm({ ...f, [k]: v });

  const pointValue = Number(d?.asset?.tick_value_brl ?? 0.2);
  const qty = Math.max(1, Number(f.max_contracts ?? 1));
  const stop = Number(f.stop_pts ?? 0);
  const gain = Number(f.gain_pts ?? 0);
  const stopBrl = stop * pointValue * qty;
  const gainBrl = gain * pointValue * qty;
  const derivedLoss = 3 * stop * pointValue * qty;
  const rr = stop > 0 ? gain / stop : null;
  const breakeven = stop + gain > 0 ? (stop / (stop + gain)) * 100 : null;
  const avgRange = d?.avg_range_pts ?? null;
  const targetPctRange = avgRange && avgRange > 0 ? (gain / avgRange) * 100 : null;

  const siblingRr = useMemo(
    () => (d?.siblings ?? []).map((s: any) => s.rr).filter((x: any) => typeof x === "number" && x > 0) as number[],
    [d],
  );
  const rrDiverges = useMemo(() => {
    if (!rr || !siblingRr.length) return false;
    const avg = siblingRr.reduce((a, b) => a + b, 0) / siblingRr.length;
    return Math.abs(rr - avg) / avg > 0.2;
  }, [rr, siblingRr]);
  const siblingRrAvg = siblingRr.length ? siblingRr.reduce((a, b) => a + b, 0) / siblingRr.length : null;

  const targets = useMemo(() => {
    const robots = d?.robots ?? [];
    const root = d?.run?.root ?? rootSymbol(symbol);
    if (pendingScope === "all_modes") {
      return robots.filter((r: any) => r.run_id === runId);
    }
    if (pendingScope === "all_variants") {
      return robots.filter((r: any) => r.root === root && r.mode === mode);
    }
    return [];
  }, [d, pendingScope, runId, mode, symbol]);

  const saveM = useMutation({
    mutationFn: (scope: "this" | "all_modes" | "all_variants") =>
      save({ data: { run_id: runId, mode, patch: f, scope } }),
    onSuccess: (res: any) => {
      const n = res?.applied?.length ?? 0;
      toast.success(n ? `Configuração aplicada em ${n} robô(s)` : "Nada mudou — valores iguais aos atuais");
      qc.invalidateQueries({ queryKey: ["b3-robot-config"] });
      qc.invalidateQueries({ queryKey: ["b3-cockpit"] });
      qc.invalidateQueries({ queryKey: ["b3-mode-settings"] });
      setPendingScope(null);
      setOpen(false);
      setForm(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const copyGet = useServerFn(getB3RobotConfig);
  const copyM = useMutation({
    mutationFn: async (key: string) => {
      const [rid, m] = key.split("::");
      return copyGet({ data: { run_id: rid, mode: m } });
    },
    onSuccess: (src: any) => {
      const s = src?.settings ?? {};
      const next: Record<string, any> = { ...f };
      for (const k of Object.keys(B3_ROBOT_FIELD_LABEL)) if (k in s && k !== "enabled") next[k] = s[k];
      setForm(next);
      toast.success("Valores copiados — revise e salve");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao copiar"),
  });

  const numField = (k: string, step?: number) => (
    <div key={k}>
      <Label className="text-xs">{B3_ROBOT_FIELD_LABEL[k] ?? k}</Label>
      <Input
        type="number"
        step={step ?? 1}
        value={f[k] ?? ""}
        onChange={(e) => set(k, Number(e.target.value))}
      />
      {k === "stop_pts" && (
        <p className="text-[11px] text-muted-foreground mt-1">
          → {BRL(stopBrl)} por operação ({qty} contrato{qty > 1 ? "s" : ""} × {BRL(pointValue)}/ponto)
        </p>
      )}
      {k === "gain_pts" && (
        <p className="text-[11px] text-muted-foreground mt-1">→ {BRL(gainBrl)} por operação</p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(null); setPendingScope(null); } }}>
      <DialogTrigger asChild>
        {compact ? (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Configurar este robô">
            <SettingsIcon className="w-3.5 h-3.5" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 text-[11px]">
            <SettingsIcon className="w-3.5 h-3.5 mr-1" />Configurar robô
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Badge variant="outline">{rootSymbol(symbol)}</Badge>
            <span className="text-muted-foreground">·</span>
            <span>{vLabel(variant)}</span>
            <span className="text-muted-foreground">·</span>
            <span>{mLabel(mode)}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {!current ? (
            <p className="text-sm text-muted-foreground">Carregando configuração…</p>
          ) : (
            <>
              <div className="flex items-center justify-between rounded border border-border/50 p-3">
                <div>
                  <p className="text-sm font-medium">Robô ligado</p>
                  <p className="text-[11px] text-muted-foreground">Desligado, ele não abre novas entradas.</p>
                </div>
                <Switch checked={f.enabled !== false} onCheckedChange={(v) => set("enabled", v)} />
              </div>

              {/* Avisos */}
              <div className="space-y-2">
                <div className={`rounded border p-3 text-xs ${rrDiverges ? "border-amber-500/60 bg-amber-950/30 text-amber-200" : "border-border/50 text-muted-foreground"}`}>
                  <p className="flex items-center gap-1 font-medium">
                    {rrDiverges ? <AlertTriangle className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
                    Risco/retorno {rr ? rr.toFixed(2) : "—"} : 1
                  </p>
                  <p className="mt-1">
                    Precisa acertar {breakeven != null ? breakeven.toFixed(1) : "—"}% das operações só para empatar.
                    {siblingRrAvg != null && ` Média dos outros modos deste ativo: ${siblingRrAvg.toFixed(2)}.`}
                    {rrDiverges && " Este robô está fora do padrão dos demais — confira se é intencional."}
                  </p>
                </div>

                <div className={`rounded border p-3 text-xs ${targetPctRange != null && targetPctRange > 30 ? "border-orange-500/60 bg-orange-950/30 text-orange-200" : "border-border/50 text-muted-foreground"}`}>
                  <p className="flex items-center gap-1 font-medium">
                    {targetPctRange != null && targetPctRange > 30 ? <AlertTriangle className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
                    Alvo x amplitude do ativo
                  </p>
                  <p className="mt-1">
                    {avgRange != null
                      ? `Amplitude média dos últimos ${d?.range_days?.length ?? 0} pregões: ${Math.round(avgRange)} pts. O alvo de ${gain} pts equivale a ${targetPctRange?.toFixed(1)}% dela.`
                      : "Sem candles suficientes para calcular a amplitude média dos últimos pregões."}
                    {targetPctRange != null && targetPctRange > 30 && " Acima de 30% o alvo raramente é atingido no dia."}
                  </p>
                </div>
              </div>

              {GROUPS.map((g) => (
                <div key={g.title} className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{g.title}</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {g.fields.map((fl) => numField(fl.k, fl.step))}
                    {g.title === "Trailing" && (
                      <div>
                        <Label className="text-xs">{B3_ROBOT_FIELD_LABEL.trailing_mode}</Label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={f.trailing_mode ?? "fixed"}
                          onChange={(e) => set("trailing_mode", e.target.value)}
                        >
                          <option value="fixed">Distância fixa do pico</option>
                          <option value="structural">Estrutural (fundo/topo)</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Horários</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {TIME_FIELDS.map((k) => (
                    <div key={k}>
                      <Label className="text-xs">{B3_ROBOT_FIELD_LABEL[k]}</Label>
                      <Input value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} placeholder="HH:MM" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Somente leitura */}
              <div className="rounded border border-border/50 bg-muted/20 p-3 text-xs space-y-1">
                <p className="font-medium">Limite diário de perda: {BRL(Number(current.daily_loss_limit_brl ?? derivedLoss))}</p>
                <p className="text-muted-foreground">
                  Não é editável. O banco calcula sozinho:
                  {" "}3 × stop ({stop} pts) × valor do ponto ({BRL(pointValue)}) × contratos ({qty}) = {BRL(derivedLoss)}.
                  Ele muda automaticamente quando você altera o stop ou a quantidade.
                </p>
              </div>

              {/* Edição em lote */}
              <div className="rounded border border-border/50 p-3 space-y-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Aplicar em outros robôs</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setPendingScope("all_modes")}>
                    Aplicar a todos os modos ({rootSymbol(symbol)} · {vLabel(variant)})
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPendingScope("all_variants")}>
                    Aplicar a todas as modalidades ({rootSymbol(symbol)} · {mLabel(mode)})
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[220px]">
                    <Label className="text-xs">Copiar de outro robô</Label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={copyFrom}
                      onChange={(e) => setCopyFrom(e.target.value)}
                    >
                      <option value="">Selecione a origem…</option>
                      {(d?.robots ?? [])
                        .filter((r: any) => !(r.run_id === runId && r.mode === mode))
                        .map((r: any) => (
                          <option key={`${r.run_id}::${r.mode}`} value={`${r.run_id}::${r.mode}`}>
                            {r.root} · {vLabel(r.variant)} · {mLabel(r.mode)}
                          </option>
                        ))}
                    </select>
                  </div>
                  <Button size="sm" variant="outline" disabled={!copyFrom || copyM.isPending}
                    onClick={() => copyM.mutate(copyFrom)}>
                    Trazer valores
                  </Button>
                </div>
              </div>

              {/* Histórico */}
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Histórico de alterações</p>
                {(d?.notes_history ?? []).length ? (
                  <ul className="text-[11px] text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
                    {(d?.notes_history ?? []).map((h: any, i: number) => (
                      <li key={i} className="font-mono">{h.date ? `${h.date}: ` : ""}{h.text}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Nenhuma alteração registrada.</p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="px-6 pb-6 pt-3 border-t border-border/40">
          <Button variant="ghost" onClick={() => { setOpen(false); setForm(null); }}>Cancelar</Button>
          <Button disabled={saveM.isPending || !current} onClick={() => saveM.mutate("this")}>
            {saveM.isPending ? "Salvando…" : "Salvar só este robô"}
          </Button>
        </DialogFooter>

        {/* Confirmação da edição em lote */}
        <Dialog open={!!pendingScope} onOpenChange={(o) => { if (!o) setPendingScope(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Aplicar em {targets.length} robô(s)?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Os valores desta tela serão gravados nos robôs abaixo. O limite diário de perda de cada um
              é recalculado pelo banco.
            </p>
            <ul className="text-xs font-mono max-h-52 overflow-y-auto space-y-0.5">
              {targets.map((t: any) => (
                <li key={`${t.run_id}::${t.mode}`}>{t.root} · {vLabel(t.variant)} · {mLabel(t.mode)}</li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPendingScope(null)}>Cancelar</Button>
              <Button disabled={saveM.isPending || !targets.length}
                onClick={() => pendingScope && saveM.mutate(pendingScope)}>
                {saveM.isPending ? "Aplicando…" : `Sim, aplicar em ${targets.length}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
