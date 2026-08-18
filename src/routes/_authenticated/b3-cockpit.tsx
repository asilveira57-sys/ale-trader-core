import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronUp, ShieldAlert, RefreshCw, PowerOff, RotateCcw, Lock, AlertTriangle, Copy } from "lucide-react";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import { rootSymbol, PX } from "@/lib/b3-format";
import { buildCockpitCopyText } from "@/lib/b3-cockpit-copy";
import {
  getB3CockpitOverview, getB3CockpitScoreboard, closeModeOrderManually, closeAllPositionsOnly, disableAllModes,
  resetB3DailyStop, updateB3ModeSettings,
} from "@/lib/b3-simulation.functions";

export const Route = createFileRoute("/_authenticated/b3-cockpit")({
  head: () => ({
    meta: [
      { title: "Cockpit — Todos os robôs — AleTrader AI" },
      { name: "description", content: "Visão consolidada dos robôs simulados B3 por ativo, modalidade e modo, com resultado do dia e controles manuais." },
      { property: "og:title", content: "Cockpit — Todos os robôs — AleTrader AI" },
      { property: "og:description", content: "Resultado do dia, posições abertas e controles manuais de todos os robôs simulados B3." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CockpitPage,
});

const BRL = (v: number) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });


const MODE_COLOR: Record<string, string> = {
  conservador: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  moderado: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  equilibrado: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  semi_agressivo: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  agressivo: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};
const VARIANT_LABEL: Record<string, string> = {
  indicador: "Indicador",
  price_action: "Price action",
  mean_reversion: "Reversão à média",
  range: "Faixa",
};
const VARIANT_COLOR: Record<string, string> = {
  indicador: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  price_action: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  mean_reversion: "bg-lime-500/15 text-lime-300 border-lime-500/30",
  range: "bg-orange-500/15 text-orange-300 border-orange-500/30",
};
const variantLabel = (v: string) => VARIANT_LABEL[v] ?? v;
const isRiskBlocked = (c: any) => c.current_status === "blocked_stop" || !!c.protection_block_reason;

// ── Testeira: formatação somente de apresentação ──
const SIGNED_HDR = (v: number) => `${Number(v ?? 0) > 0 ? "+" : ""}${BRL(v)}`;
const PCT = (v: number | null | undefined, digits = 0) =>
  v == null ? "—" : `${(Number(v) * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const PCT_SIGNED = (v: number | null | undefined) =>
  v == null ? "—" : `${Number(v) > 0 ? "+" : ""}${PCT(v, 1)}`;
const BRL0 = (v: number) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const moneyColor = (v: number) => (Number(v ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300");
const VARIANT_SHORT: Record<string, string> = {
  indicador: "ind", price_action: "PA", mean_reversion: "rev", range: "faixa",
};
const roboShort = (r: any) =>
  !r ? "—" : `${VARIANT_SHORT[r.variant] ?? r.variant} ${String(r.mode).replace("_", "-")} ${SIGNED_HDR(r.brl)}`;



type Filter = "all" | "open" | "blocked";
type VariantFilter = "all" | string;

function CockpitPage() {
  const qc = useQueryClient();
  const getOverview = useServerFn(getB3CockpitOverview);
  const closeMode = useServerFn(closeModeOrderManually);
  const closePositions = useServerFn(closeAllPositionsOnly);
  const disableModes = useServerFn(disableAllModes);
  const resetStop = useServerFn(resetB3DailyStop);
  const updEnabled = useServerFn(updateB3ModeSettings);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [variantFilter, setVariantFilter] = useState<VariantFilter>("all");
  const [motivo, setMotivo] = useState("");
  // Faixas de ativo recolhidas — preferência só enquanto a página está aberta.
  const [collapsedAssets, setCollapsedAssets] = useState<Set<string>>(new Set());
  const toggleAsset = (root: string) => setCollapsedAssets((prev) => {
    const next = new Set(prev);
    next.has(root) ? next.delete(root) : next.add(root);
    return next;
  });


  // O filtro de modalidade entra na chave e na chamada: as faixas por ativo,
  // a ordenação e o placar passam a descrever o mesmo recorte dos cards.
  const q = useQuery({
    queryKey: ["b3-cockpit", variantFilter],
    queryFn: () => getOverview({ data: { variant: variantFilter } }),
    refetchInterval: useVisibleRefetchInterval(10000),
    refetchIntervalInBackground: false,
  });

  const all: any[] = q.data?.cards ?? [];
  const porAtivo: any[] = q.data?.por_ativo ?? [];
  const runIds = Array.from(new Set(all.map((c) => c.run_id)));


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
  const zeroAllM = useMutation({
    mutationFn: async () => { for (const run_id of runIds) await closePositions({ data: { run_id } }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["b3-cockpit"] }); toast.success("Posições zeradas. Os robôs seguem ligados."); },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao zerar posições"),
  });
  const disableAllM = useMutation({
    mutationFn: async () => { for (const run_id of runIds) await disableModes({ data: { run_id } }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["b3-cockpit"] }); toast.success("Robôs desligados. Posições abertas não foram alteradas."); },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao desligar robôs"),
  });
  const resetM = useMutation({
    mutationFn: (v: { run_id: string; mode: string; motivo: string }) => resetStop({ data: v as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["b3-cockpit"] }); setMotivo(""); toast.success("Robô reativado e intervenção registrada."); },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao reativar"),
  });

  const toggleExpand = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // ── Copiar estado dos robôs como texto puro (somente interface) ──
  const copyCards = async (cards: any[], scope: string, includeScoreboard = false) => {
    if (!cards.length) { toast.error("Nada para copiar"); return; }
    const text = buildCockpitCopyText(cards, {
      scope,
      scoreboard: includeScoreboard ? qc.getQueryData(["b3-cockpit-scoreboard", variantFilter]) : undefined,
      includeScoreboard,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${cards.length} ${cards.length === 1 ? "robô copiado" : "robôs copiados"}`);
    } catch {
      toast.error("Não foi possível copiar para a área de transferência");
    }
  };


  const totalRobots = all.length;
  const withOpen = all.filter((c) => !!c.open).length;
  const blocked = all.filter(isRiskBlocked).length;
  const waiting = all.filter((c) => !c.open && !isRiskBlocked(c)).length;
  const variantsPresent = Array.from(new Set(all.map((c) => c.variant ?? "indicador")));

  const visible = all
    .filter((c) => filter === "all" ? true : filter === "open" ? !!c.open : isRiskBlocked(c))
    .filter((c) => variantFilter === "all" ? true : (c.variant ?? "indicador") === variantFilter);

  // Agrupa pela RAIZ do ativo (WIN, WDO, PETR4) — o contrato rola de vencimento —
  // e, dentro do ativo, por modalidade (variant).
  const bySymbol = new Map<string, { contracts: Set<string>; byVariant: Map<string, any[]> }>();
  for (const c of visible) {
    const root = rootSymbol(c.symbol);
    if (!bySymbol.has(root)) bySymbol.set(root, { contracts: new Set(), byVariant: new Map() });
    const group = bySymbol.get(root)!;
    group.contracts.add(c.symbol);
    const v = c.variant ?? "indicador";
    if (!group.byVariant.has(v)) group.byVariant.set(v, []);
    group.byVariant.get(v)!.push(c);
  }

  // Testeira por ativo/modalidade vem do servidor (linha do tempo de margem).
  const headerByAsset = new Map<string, any>(porAtivo.map((a) => [a.symbol, a]));
  // Ordena os ativos por resultado do dia, decrescente — o que drena fica embaixo.
  const orderedAssets = Array.from(bySymbol.entries()).sort(
    (a, b) => Number(headerByAsset.get(b[0])?.resultado_brl ?? 0) - Number(headerByAsset.get(a[0])?.resultado_brl ?? 0),
  );
  const allCollapsed = orderedAssets.length > 0 && orderedAssets.every(([root]) => collapsedAssets.has(root));


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
          <Button size="sm" variant="outline"
            onClick={() => copyCards(visible, "todos os robôs", true)}>
            <Copy className="w-4 h-4 mr-1" />Copiar tudo
          </Button>

          <Button size="sm" variant="outline" asChild>
            <Link to="/b3/bi">BI analítico</Link>
          </Button>

          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="destructive" className="bg-red-900 hover:bg-red-800">
                <ShieldAlert className="w-4 h-4 mr-1" />Zerar posições
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Zerar TODAS as posições abertas?</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">
                Encerra agora qualquer posição aberta em qualquer robô, de qualquer ativo, ao preço de mercado
                atual. Os robôs continuam LIGADOS e podem abrir nova posição. Não dá pra desfazer.
              </p>
              <DialogFooter>
                <Button variant="destructive" disabled={zeroAllM.isPending} onClick={() => zeroAllM.mutate()}>
                  {zeroAllM.isPending ? "Zerando..." : "Sim, zerar posições"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <PowerOff className="w-4 h-4 mr-1" />Desligar robôs
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Desligar TODOS os robôs?</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">
                Desativa os 5 modos de cada ativo e modalidade — nenhuma entrada nova será aberta.
                Posições já abertas NÃO são encerradas (use “Zerar posições” pra isso).
              </p>
              <DialogFooter>
                <Button variant="destructive" disabled={disableAllM.isPending} onClick={() => disableAllM.mutate()}>
                  {disableAllM.isPending ? "Desligando..." : "Sim, desligar robôs"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* ── Placar do dia — mesmo recorte do filtro de modalidade ── */}
      <Scoreboard variantFilter={variantFilter} />

      {/* ── Resumo + filtro ── */}
      <section className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
        <p className="text-sm">
          <strong>{totalRobots}</strong> robôs · <strong>{withOpen}</strong> com posição aberta ·{" "}
          <strong>{waiting}</strong> aguardando · <strong>{blocked}</strong> bloqueados
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {([["all", "Todos"], ["open", "Só com posição aberta"], ["blocked", "Só bloqueados"]] as [Filter, string][]).map(([v, label]) => (
            <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} className="h-7 text-[11px]"
              onClick={() => setFilter(v)}>
              {label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Modalidade:</span>
          <Button size="sm" variant={variantFilter === "all" ? "default" : "outline"} className="h-7 text-[11px]"
            onClick={() => setVariantFilter("all")}>
            Todas
          </Button>
          {variantsPresent.map((v: string) => (
            <Button key={v} size="sm" variant={variantFilter === v ? "default" : "outline"} className="h-7 text-[11px]"
              onClick={() => setVariantFilter(v)}>
              {variantLabel(v)}
            </Button>
          ))}
          <Button size="sm" variant="outline" className="h-7 text-[11px] ml-auto"
            onClick={() => setCollapsedAssets(allCollapsed ? new Set() : new Set(orderedAssets.map(([r]) => r)))}>
            {allCollapsed ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronUp className="w-3 h-3 mr-1" />}
            {allCollapsed ? "Expandir todos" : "Recolher todos"}
          </Button>
        </div>

      </section>

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {!q.isLoading && !visible.length && (
        <p className="text-sm text-muted-foreground">Nenhum robô para o filtro selecionado.</p>
      )}

      {orderedAssets.map(([root, group]) => {
        const hdr = headerByAsset.get(root);
        const isCollapsed = collapsedAssets.has(root);
        const robotCount = Array.from(group.byVariant.values()).reduce((s, arr) => s + arr.length, 0);
        return (
        <div key={root} className="space-y-3">
          {/* ── Testeira do ativo: sempre visível, mesmo recolhida ── */}
          <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
            <div className="flex items-start gap-2 flex-wrap">
              <button type="button" onClick={() => toggleAsset(root)}
                aria-label={isCollapsed ? `Expandir ${root}` : `Recolher ${root}`}
                className="mt-0.5 rounded p-0.5 text-muted-foreground hover:text-foreground">
                {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap text-sm font-semibold">
                  <Badge variant="outline" className="border-primary/40 bg-primary/10">{root}</Badge>
                  <span className="text-[11px] text-muted-foreground font-normal">
                    {Array.from(group.contracts).join(" · ")}
                  </span>
                  <span className="text-muted-foreground font-normal">{robotCount} robôs</span>
                  <span className={`ml-auto font-mono text-xl ${moneyColor(hdr?.resultado_brl ?? 0)}`}>
                    {SIGNED_HDR(hdr?.resultado_brl ?? 0)}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {hdr?.ops ?? 0} ops · {hdr?.ganhos ?? 0} no lucro ({PCT(hdr?.taxa_acerto)}){"   "}
                  <span className="mx-1">·</span>
                  pico de capital {BRL0(hdr?.pico_capital_brl ?? 0)} · retorno {PCT_SIGNED(hdr?.retorno_sobre_capital)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  melhor: {roboShort(hdr?.melhor_robo)}
                  <span className="mx-2">·</span>
                  pior: {roboShort(hdr?.pior_robo)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-6 text-[10px]"
                  onClick={() => copyCards(Array.from(group.byVariant.values()).flat(), root, true)}>
                  <Copy className="w-3 h-3 mr-1" />Copiar ativo
                </Button>
                <Button asChild size="sm" variant="outline" className="h-6 text-[10px]">
                  <Link to="/b3/ativo/$symbol" params={{ symbol: root }}>ver painel</Link>
                </Button>
              </div>
            </div>
          </div>

          {!isCollapsed && Array.from(group.byVariant.entries()).map(([variant, cards]) => {
            const sub = (hdr?.por_modalidade ?? []).find((m: any) => m.variant === variant);
            return (
            <div key={variant} className="space-y-2 rounded-lg border border-border/40 bg-background/30 p-3">
              <h3 className="text-xs font-semibold flex items-center gap-2 flex-wrap">
                <Badge className={`text-[10px] ${VARIANT_COLOR[variant] ?? ""}`}>{variantLabel(variant)}</Badge>
                <span className="text-muted-foreground font-normal">{cards.length} robôs</span>
                {/* Com o filtro numa modalidade, a testeira do ativo já mostra
                    exatamente estes números — o subtotal viraria repetição. */}
                {variantFilter === "all" && (
                  <>
                    <span className={`font-mono ${moneyColor(sub?.resultado_brl ?? 0)}`}>
                      {SIGNED_HDR(sub?.resultado_brl ?? 0)}
                    </span>
                    <span className="text-muted-foreground font-normal">
                      {sub?.ops ?? 0} ops · {sub?.ganhos ?? 0} no lucro ({PCT(sub?.taxa_acerto)})
                    </span>
                    <span className="text-muted-foreground font-normal">
                      pico {BRL0(sub?.pico_capital_brl ?? 0)}
                    </span>
                  </>
                )}
                <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto"
                  onClick={() => copyCards(cards, `${root} · ${variantLabel(variant).toLowerCase()}`)}>
                  <Copy className="w-3 h-3 mr-1" />Copiar ativo + modalidade
                </Button>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {cards.map((c: any) => {
                  const key = `${c.run_id}:${c.mode}`;
                  const isOpen = expanded.has(key);
                  const hasPosition = !!c.open;
                  const tick = Number(c.tick_size ?? 5);
                  const pnlColor = c.unrealized_brl == null ? "" : c.unrealized_brl >= 0 ? "text-emerald-300" : "text-rose-300";
                  const riskBlocked = isRiskBlocked(c);
                  const isRealEnv = c.environment && c.environment !== "simulation";
                  return (
                    <div key={key} className="relative rounded-lg border border-border/60 bg-card overflow-hidden">
                      {/* Copiar este robô — fora do <button> do card pra não aninhar botões */}
                      <button
                        type="button"
                        aria-label="Copiar este robô"
                        title="Copiar este robô"
                        className="absolute top-1.5 right-1.5 z-10 rounded p-1 text-muted-foreground/70 hover:text-foreground hover:bg-muted/50"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyCards([c], `${rootSymbol(c.symbol)} · ${variantLabel(c.variant ?? "indicador").toLowerCase()} · ${String(c.mode).replace("_", " ")}`);
                        }}
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      {/* ── Cabeçalho compacto: sempre visível ── */}
                      <button className="w-full text-left p-3 space-y-2" onClick={() => toggleExpand(key)}>

                        <div className="flex items-center justify-between gap-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge className={`uppercase text-[10px] ${MODE_COLOR[c.mode]}`}>{c.mode.replace("_", " ")}</Badge>
                            <Badge className={`text-[10px] ${VARIANT_COLOR[c.variant] ?? ""}`}>{variantLabel(c.variant)}</Badge>
                          </div>
                          {isOpen ? <ChevronUp className="w-4 h-4 mr-5 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 mr-5 text-muted-foreground" />}
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
                              Entrada {PX(c.open.entry_price, tick)} → agora {PX(c.live_price, tick)}
                            </div>
                            <div className={`font-mono font-semibold text-sm ${pnlColor}`}>
                              {c.unrealized_brl != null
                                ? `${c.unrealized_pts! >= 0 ? "+" : ""}${PX(c.unrealized_pts, tick)} pts · ${BRL(c.unrealized_brl)}`
                                : "—"}
                            </div>
                          </>
                        ) : (
                          <div className="text-xs italic min-h-[3.2rem] flex items-center">
                            {riskBlocked ? (
                              <span className="text-amber-300 not-italic flex items-center gap-1">
                                <Lock className="w-3 h-3" />
                                {c.current_status === "blocked_stop" ? "Bloqueado por stop diário" : "Bloqueado por trava de risco"}
                              </span>
                            ) : c.enabled === false ? (
                              <span className="text-muted-foreground">Desligado por configuração</span>
                            ) : (
                              <span className="text-muted-foreground">{c.blocked_reason ?? "Sem posição — aguardando sinal"}</span>
                            )}
                          </div>
                        )}

                        {/* ── Resultado do dia, separado do acumulado ── */}
                        <div className="text-[11px] space-y-0.5 pt-1 border-t border-border/40">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Realizado hoje</span>
                            <span className={`font-mono ${Number(c.realized_today) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                              {BRL(c.realized_today)}
                            </span>
                          </div>
                          {hasPosition && (
                            <div className="flex justify-between opacity-60">
                              <span>Em aberto (não realizado)</span>
                              <span className="font-mono">{c.unrealized_brl != null ? BRL(c.unrealized_brl) : "—"}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Total do dia</span>
                            <span className={`font-mono ${Number(c.total_today) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                              {BRL(c.total_today)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Acumulado</span>
                            <span className="font-mono text-muted-foreground">{BRL(c.pnl_accumulated)}</span>
                          </div>
                        </div>

                        {c.reactivated_today && (
                          <p className="text-[10px] text-amber-300/80">
                            Reativado hoje após stop diário — resultado do dia não é limpo.
                          </p>
                        )}
                      </button>

                      {/* ── Fechar posição: sempre visível quando há posição ── */}
                      {hasPosition && (
                        <div className="px-3 pb-3 space-y-2">
                          {c.pending_stop && (
                            <div className="rounded-md border border-rose-500/60 bg-rose-950/50 px-2 py-1.5 text-[11px] font-semibold text-rose-200 flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                STOP PENDENTE há {Math.max(1, Math.round(Number(c.pending_stop.elapsed_s ?? 0) / 60))} min ·{" "}
                                {Math.round(Number(c.pending_stop.beyond_pts ?? 0))} pts além do nível
                              </span>
                            </div>
                          )}

                          <Dialog>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="destructive" className="w-full h-7 text-[11px]">
                                Fechar posição agora
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Fechar {c.mode} · {variantLabel(c.variant)} ({c.symbol}) agora?</DialogTitle>
                              </DialogHeader>
                              <p className="text-sm text-muted-foreground">
                                Encerra a posição de {c.open.side === "buy" ? "compra" : "venda"} ao preço de mercado
                                atual ({PX(c.live_price, tick)}). Não dá pra desfazer.
                              </p>
                              <DialogFooter>
                                <Button variant="destructive" disabled={closeModeM.isPending}
                                  onClick={() => closeModeM.mutate({ run_id: c.run_id, mode: c.mode })}>
                                  {closeModeM.isPending ? "Fechando..." : "Sim, fechar agora"}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      )}

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
                          {riskBlocked && (
                            <p className="text-[11px] text-amber-300">
                              Trava de risco: {c.protection_block_reason ?? c.current_status}
                            </p>
                          )}
                          {c.score != null && (
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Score / Confiança</span>
                              <span className="font-mono">{c.score} / {c.confidence}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Saldo atual</span>
                            <span className="font-mono">{BRL(c.balance)}</span>
                          </div>

                          <Button asChild size="sm" variant="outline" className="w-full h-7 text-[11px]">
                            <Link to="/b3/ativo/$symbol" params={{ symbol: rootSymbol(c.symbol) }}>
                              Ver painel do ativo
                            </Link>
                          </Button>

                          {c.current_status === "blocked_stop" && (
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline" className="w-full h-7 text-[11px]" disabled={isRealEnv}>
                                  <RotateCcw className="w-3 h-3 mr-1" />Reativar após stop diário
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Reativar {c.mode} · {variantLabel(c.variant)} ({c.symbol})?</DialogTitle>
                                </DialogHeader>
                                <p className="text-sm text-muted-foreground">
                                  O robô bateu o stop diário. Escreva o motivo da reativação (mínimo 20 caracteres).
                                  A intervenção fica registrada com data, ativo, modalidade, modo, resultado no momento e limite vigente.
                                </p>
                                <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)}
                                  placeholder="Motivo da reativação..." rows={3} />
                                <p className="text-[11px] text-muted-foreground">{motivo.trim().length}/20 caracteres</p>
                                <DialogFooter>
                                  <Button disabled={resetM.isPending || motivo.trim().length < 20}
                                    onClick={() => resetM.mutate({ run_id: c.run_id, mode: c.mode, motivo })}>
                                    {resetM.isPending ? "Reativando..." : "Reativar robô"}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          )}
                          {c.current_status === "blocked_stop" && isRealEnv && (
                            <p className="text-[11px] text-rose-300">
                              Conta real: o stop diário não é contornável pelo painel.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
        );
      })}

    </div>
  );
}

// ── Placar digital do dia: poucos números grandes, o resto em linha secundária.
// Somente leitura; nada aqui altera o motor de simulação.
const SIGNED = (v: number) => `${v > 0 ? "+" : ""}${BRL(v)}`;
const pnlColorOf = (v: number) => (v >= 0 ? "text-emerald-400" : "text-rose-400");

function RobotLine({ label, robot }: { label: string; robot: any }) {
  if (!robot) return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">—</p>
    </div>
  );
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs">
        <span className="font-medium">{rootSymbol(robot.symbol)}</span>
        <span className="text-muted-foreground"> · {variantLabel(robot.variant).toLowerCase()} · {robot.mode} </span>
        <span className={`font-mono ${pnlColorOf(Number(robot.brl))}`}>{SIGNED(Number(robot.brl))}</span>
      </p>
    </div>
  );
}

function Scoreboard() {
  const getScoreboard = useServerFn(getB3CockpitScoreboard);
  const q = useQuery({
    queryKey: ["b3-cockpit-scoreboard"],
    queryFn: () => getScoreboard(),
    refetchInterval: useVisibleRefetchInterval(10000),
    refetchIntervalInBackground: false,
  });
  const d: any = q.data;
  if (!d) return <section className="rounded-lg border border-border/60 bg-card p-4 text-sm text-muted-foreground">Carregando placar do dia...</section>;

  const capital = Number(d.capital_disponivel_brl ?? 0);
  const exposicao = Number(d.exposicao_atual_brl ?? 0);
  const pico = Number(d.pico_exposicao_brl ?? 0);
  const overNow = capital > 0 && exposicao > capital;
  const overPeak = capital > 0 && pico > capital;

  const stopsPendentes = Number(d.stops_pendentes ?? 0);
  const quotes: any[] = d.quotes_health ?? [];
  const guardLimit = Number(d.quote_guard_limit_s ?? 45);

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 space-y-4">
      {/* Faixa de alerta — stop pendente não executado */}
      {stopsPendentes > 0 && (
        <div className="-m-4 mb-0 rounded-t-xl bg-rose-600/90 px-4 py-2 text-sm font-semibold text-white flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {stopsPendentes} {stopsPendentes === 1 ? "robô" : "robôs"} com stop pendente não executado
        </div>
      )}

      {/* Linha 1 — números em corpo muito grande */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Saldo do dia</p>
          <p className={`font-mono font-bold text-3xl sm:text-4xl leading-tight ${pnlColorOf(Number(d.saldo_dia_brl))}`}>
            {SIGNED(Number(d.saldo_dia_brl))}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Se fechasse agora</p>
          <p className={`font-mono font-bold text-3xl sm:text-4xl leading-tight ${pnlColorOf(Number(d.se_fechasse_agora_brl))}`}>
            {SIGNED(Number(d.se_fechasse_agora_brl))}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Exposição atual</p>
          <p className={`font-mono font-bold text-3xl sm:text-4xl leading-tight ${overNow ? "text-rose-400" : ""}`}>
            {BRL(exposicao)}
          </p>
          <p className="text-xs text-muted-foreground">
            {d.robots_posicionados} de {d.robots_total} posicionados
          </p>
          {overNow && (
            <p className="text-[11px] text-rose-400">exposição acima do capital disponível</p>
          )}
        </div>
      </div>

      {/* Linha 2 — corpo médio */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-border/40 pt-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Lucro bruto do dia</p>
          <p className="font-mono text-lg text-emerald-400">{BRL(Number(d.lucro_bruto_brl))}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Prejuízo bruto do dia</p>
          <p className="font-mono text-lg text-rose-400">{BRL(Number(d.prejuizo_bruto_brl))}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Aberto positivo</p>
          <p className="font-mono text-lg text-emerald-400">{BRL(Number(d.aberto_positivo_brl))}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Aberto negativo</p>
          <p className="font-mono text-lg text-rose-400">{BRL(Number(d.aberto_negativo_brl))}</p>
        </div>
      </div>

      {/* Linha 3 — corpo pequeno */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-border/40 pt-3">
        <RobotLine label="Melhor robô do dia" robot={d.melhor_robo} />
        <RobotLine label="Pior robô do dia" robot={d.pior_robo} />
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pico de exposição do dia</p>
          <p className={`text-xs font-mono ${overPeak ? "text-rose-400" : ""}`}>
            {BRL(pico)}{d.pico_exposicao_hora ? ` às ${d.pico_exposicao_hora}` : ""}
            <span className="text-muted-foreground font-sans"> · máx. {d.pico_posicoes} posições</span>
          </p>
          {overPeak && <p className="text-[11px] text-rose-400">exposição acima do capital disponível</p>}
        </div>
      </div>

      {/* Saúde da cotação — idade do último tick por ativo */}
      {quotes.length > 0 && (
        <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-2">
          Cotação:{" "}
          {quotes.map((q, i) => (
            <span key={q.symbol}>
              {i > 0 && " · "}
              <span className={q.stale ? "text-rose-400 font-semibold" : ""}>
                {rootSymbol(q.symbol)} {q.age_s == null ? "sem tick" : `${q.age_s}s`}
              </span>
            </span>
          ))}
          <span className="opacity-60"> (limite {guardLimit}s)</span>
        </p>
      )}

    </section>
  );
}
