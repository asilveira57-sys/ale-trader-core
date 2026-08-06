import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronUp, ShieldAlert, RefreshCw } from "lucide-react";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import {
  getB3CockpitOverview, closeModeOrderManually, closeAllModesManually, updateB3ModeSettings,
} from "@/lib/b3-simulation.functions";

export const Route = createFileRoute("/_authenticated/b3-cockpit")({
  head: () => ({ meta: [{ title: "Cockpit — Todos os robôs — AleTrader AI" }] }),
  component: CockpitPage,
});

const BRL = (v: number) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const NUM = (v: number, d = 0) => Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const MODE_COLOR: Record<string, string> = {
  conservador: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  moderado: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  equilibrado: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  semi_agressivo: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  agressivo: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

function CockpitPage() {
  const qc = useQueryClient();
  const getOverview = useServerFn(getB3CockpitOverview);
  const closeMode = useServerFn(closeModeOrderManually);
  const closeAll = useServerFn(closeAllModesManually);
  const updEnabled = useServerFn(updateB3ModeSettings);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["b3-cockpit"],
    queryFn: () => getOverview(),
    refetchInterval: useVisibleRefetchInterval(10000),
    refetchIntervalInBackground: false,
  });

  const closeModeM = useMutation({
    mutationFn: (v: { run_id: string; mode: string }) => closeMode({ data: v as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["b3-cockpit"] }); toast.success("Posição encerrada"); },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao fechar"),
  });
  const toggleM = useMutation({
    mutationFn: (v: { run_id: string; mode: string; enabled: boolean }) =>
      updEnabled({ data: { run_id: v.run_id, mode: v.mode as any, patch: { enabled: v.enabled } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["b3-cockpit"] }),
    onError: (e: any) => toast.error(e?.message ?? "Falha ao mudar status"),
  });
  const closeAllM = useMutation({
    mutationFn: async () => {
      const runIds = Array.from(new Set((q.data ?? []).map((c: any) => c.run_id)));
      for (const run_id of runIds) await closeAll({ data: { run_id } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["b3-cockpit"] }); toast.success("Todas as posições foram encerradas e todos os robôs foram pausados."); },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao fechar tudo"),
  });

  const toggleExpand = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const bySymbol = new Map<string, any[]>();
  for (const c of q.data ?? []) {
    if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, []);
    bySymbol.get(c.symbol)!.push(c);
  }

  return (
    <div className="container mx-auto py-6 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Cockpit — todos os robôs</h1>
          <p className="text-sm text-muted-foreground">
            Visão compacta de todas as simulações (demo) rodando agora. Clique num card pra ver os detalhes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />Atualizar
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="destructive" className="bg-red-900 hover:bg-red-800">
                <ShieldAlert className="w-4 h-4 mr-1" />Fechar tudo (todos os ativos)
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Fechar TODAS as posições de TODOS os ativos?</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">
                Isso encerra agora qualquer posição aberta em qualquer robô, de qualquer ativo (WIN, WDO, e os
                que vierem depois) ao preço de mercado atual, e pausa os 5 modos de cada um. Não dá pra desfazer.
              </p>
              <DialogFooter>
                <Button variant="destructive" disabled={closeAllM.isPending} onClick={() => closeAllM.mutate()}>
                  {closeAllM.isPending ? "Fechando..." : "Sim, fechar tudo"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {!q.isLoading && !(q.data ?? []).length && (
        <p className="text-sm text-muted-foreground">Nenhuma simulação rodando no momento.</p>
      )}

      {Array.from(bySymbol.entries()).map(([symbol, cards]) => (
        <div key={symbol} className="space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Badge variant="outline" className="border-primary/40 bg-primary/10">{symbol}</Badge>
            <span className="text-muted-foreground font-normal">{cards.length} robôs</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {cards.map((c: any) => {
              const key = `${c.run_id}:${c.mode}`;
              const isOpen = expanded.has(key);
              const hasPosition = !!c.open;
              const pnlColor = c.unrealized_brl == null ? "" : c.unrealized_brl >= 0 ? "text-emerald-300" : "text-rose-300";
              return (
                <div key={key} className="rounded-lg border border-border/60 bg-card overflow-hidden">
                  {/* ── Cabeçalho compacto: sempre visível ── */}
                  <button
                    className="w-full text-left p-3 space-y-2"
                    onClick={() => toggleExpand(key)}
                  >
                    <div className="flex items-center justify-between">
                      <Badge className={`uppercase text-[10px] ${MODE_COLOR[c.mode]}`}>{c.mode.replace("_", " ")}</Badge>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    {hasPosition ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Badge variant={c.open.side === "buy" ? "default" : "destructive"} className="text-[10px]">
                            {c.open.side === "buy" ? "COMPRA" : "VENDA"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{c.open.quantity}x</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Entrada {NUM(c.open.entry_price)} → agora {c.live_price != null ? NUM(c.live_price) : "—"}
                        </div>
                        <div className={`font-mono font-semibold text-sm ${pnlColor}`}>
                          {c.unrealized_brl != null ? `${c.unrealized_pts! >= 0 ? "+" : ""}${NUM(c.unrealized_pts!)} pts · ${BRL(c.unrealized_brl)}` : "—"}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground italic min-h-[3.2rem] flex items-center">
                        {c.enabled === false ? "Modo desativado" : (c.blocked_reason ?? "Sem posição — aguardando sinal")}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      Hoje: <span className={c.pnl_today >= 0 ? "text-emerald-300" : "text-rose-300"}>{BRL(c.pnl_today)}</span>
                    </div>
                  </button>

                  {/* ── Detalhe expandido ── */}
                  {isOpen && (
                    <div className="border-t border-border/60 p-3 space-y-2 bg-background/40">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Modo ativo</span>
                        <Switch
                          checked={c.enabled !== false}
                          onCheckedChange={(v: boolean) => toggleM.mutate({ run_id: c.run_id, mode: c.mode, enabled: v })}
                        />
                      </div>
                      {c.score != null && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Score / Confiança</span>
                          <span className="font-mono">{NUM(c.score)} / {NUM(c.confidence)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Saldo atual</span>
                        <span className="font-mono">{BRL(c.balance)}</span>
                      </div>
                      {hasPosition && (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="destructive" className="w-full h-7 text-[11px]">
                              Fechar posição agora
                            </Button>
                          </DialogTrigger>
                          <DialogContent onClick={(e) => e.stopPropagation()}>
                            <DialogHeader><DialogTitle>Fechar {c.mode} ({c.symbol}) agora?</DialogTitle></DialogHeader>
                            <p className="text-sm text-muted-foreground">
                              Encerra a posição de {c.open.side === "buy" ? "compra" : "venda"} ao preço de mercado
                              atual ({c.live_price != null ? NUM(c.live_price) : "—"}). Não dá pra desfazer.
                            </p>
                            <DialogFooter>
                              <Button variant="destructive" disabled={closeModeM.isPending}
                                onClick={() => closeModeM.mutate({ run_id: c.run_id, mode: c.mode })}>
                                {closeModeM.isPending ? "Fechando..." : "Sim, fechar agora"}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
