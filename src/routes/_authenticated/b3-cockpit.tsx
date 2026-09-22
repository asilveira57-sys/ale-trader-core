import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useModeApelidos } from "@/hooks/use-mode-apelidos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RobotConfigDialog } from "@/components/b3/RobotConfigDialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronUp, ShieldAlert, RefreshCw, PowerOff, RotateCcw, Lock, Unlock, AlertTriangle, Copy } from "lucide-react";

import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import { openSinceText, rootSymbol, PX, B3_ASSETS, assetLabel, freiosAcionadosTexto, somarSombrasDia, type SombraDia } from "@/lib/b3-format";
import { buildCockpitCopyText } from "@/lib/b3-cockpit-copy";
import {
  getB3CockpitOverview, getB3CockpitScoreboard, closeModeOrderManually, closeAllPositionsOnly, disableAllModes,
  resetB3DailyStop, updateB3ModeSettings,
} from "@/lib/b3-simulation.functions";
import { getB3SimPeriodSummary } from "@/lib/b3-sim-period.functions";
import { listLiberacoesFreio, liberarFreioReal, travarFreioReal } from "@/lib/b3-liberacao-freio.functions";

import {
  PeriodBar, HistoricalBanner, NoMovementNotice, TruncatedNotice, PerDayTable,
  DEFAULT_PERIOD, type PeriodInput,
} from "@/components/b3/PeriodBar";

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

// ── Indicador de pico e recuo ────────────────────────────────────────────────
// Canal visual PRÓPRIO: a cor da linha do robô continua significando
// constância (b3_cor_do_robo) e não é usada aqui.
//
// 04/09/2026 — A BOLINHA SAIU. Era um anel de 20px com o número do lado; nos
// cards em 8 colunas o anel aparecia vazio e o número ficava solto, sem dizer
// de que ele era. Agora é um selo escrito: sempre diz o que o número significa.
function PeakRing({ peak, atual, limite }: { peak: number; atual: number; limite: number }) {
  if (!(peak > 0)) return null;
  const recuo = Math.min(1, Math.max(0, (peak - atual) / peak));
  const lim = limite > 0 ? limite : 0.4;
  const razao = recuo / lim;
  const cor = razao >= 0.8
    ? "border-rose-400/50 text-rose-300 bg-rose-500/10"
    : razao >= 0.5
      ? "border-amber-300/50 text-amber-200 bg-amber-500/10"
      : "border-emerald-400/40 text-emerald-300 bg-emerald-500/10";
  const faltaPct = Math.max(0, lim - recuo) * 100;
  const title = [
    `Devolvido do pico do dia: ${(recuo * 100).toFixed(0)}%`,
    `Pico do dia: ${BRL(peak)}`,
    `Resultado agora: ${BRL(atual)}`,
    `Freio de pico em ${(lim * 100).toFixed(0)}% de devolução`,
    recuo >= lim ? "Freio de pico no limite" : `Faltam ${faltaPct.toFixed(0)} pontos percentuais para o freio`,
  ].join(" · ");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1 py-[1px] text-[10px] font-mono ${cor}`}
      title={title}
      aria-label={title}
    >
      <span aria-hidden>↓</span>
      {(recuo * 100).toFixed(0)}%
      <span className="opacity-70 font-sans">do pico</span>
    </span>
  );
}





const MODE_COLOR: Record<string, string> = {
  conservador: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  cauteloso: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  moderado: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  equilibrado: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  semi_agressivo: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  arrojado: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  agressivo: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  // Cor própria: enoir é outro perfil, não o topo da rampa.
  enoir: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
};
const VARIANT_LABEL: Record<string, string> = {
  indicador: "Indicador",
  price_action: "Price action",
  mean_reversion: "Reversão à média",
  range: "Faixa",
  rompimento: "Rompimento",
  pullback: "Repique",
  vwap: "VWAP",
};
const VARIANT_COLOR: Record<string, string> = {
  indicador: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  price_action: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  mean_reversion: "bg-lime-500/15 text-lime-300 border-lime-500/30",
  range: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  rompimento: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  pullback: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  vwap: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
};
const variantLabel = (v: string) => VARIANT_LABEL[v] ?? v;
const isRiskBlocked = (c: any) => c.current_status === "blocked_stop" || !!c.protection_block_reason;

// Cor da curadoria — quem calcula é o banco (b3_cor_do_robo); aqui só pintamos.
// Borda + faixa lateral do card, para não competir com o P&L (verde/vermelho).
const ROBOT_COLOR: Record<string, { border: string; bar: string; label: string }> = {
  ouro: { border: "border-yellow-400/70", bar: "bg-yellow-400", label: "Ouro — 1º do ranking com medalha" },
  prata: { border: "border-zinc-300/70", bar: "bg-zinc-300", label: "Prata — 2º do ranking com medalha" },
  bronze: { border: "border-amber-600/70", bar: "bg-amber-600", label: "Bronze — 3º do ranking com medalha" },
  verde: { border: "border-emerald-500/70", bar: "bg-emerald-500", label: "Verde — 3 dias bons ou mais" },
  azul: { border: "border-sky-500/70", bar: "bg-sky-500", label: "Azul — 2 dias bons" },
  branco: { border: "border-slate-200/70", bar: "bg-slate-200", label: "Branco — 1 dia bom" },
  amarelo: { border: "border-yellow-500/70", bar: "bg-yellow-500", label: "Amarelo — caiu de verde, 1 dia negativo" },
  laranja: { border: "border-orange-500/70", bar: "bg-orange-500", label: "Laranja — caiu de verde, 2 dias negativos" },
  vermelho: { border: "border-rose-600/80", bar: "bg-rose-600", label: "Vermelho — 3 dias negativos ou mais" },
};
const robotColor = (cor: string | null | undefined) => ROBOT_COLOR[String(cor ?? "")] ?? null;

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
  rompimento: "romp",
  pullback: "rep", vwap: "vwap",
};
const roboShort = (r: any) =>
  !r ? "—" : `${VARIANT_SHORT[r.variant] ?? r.variant} ${String(r.mode).replace("_", "-")} ${SIGNED_HDR(r.brl)}`;

const horaFreio = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
  : null;

function EfeitoDia({ sombra, compacto = false, horarios, grupoNivel }: {
  sombra: SombraDia | null | undefined;
  compacto?: boolean;
  horarios?: Record<string, string | null | undefined>;
  grupoNivel?: number | null;
}) {
  const comFreio = Number(sombra?.resultado_sombra_brl ?? 0);
  const semFreio = Number(sombra?.resultado_livre_brl ?? 0);
  return (
    <div className={`border-t border-border/40 ${compacto ? "mt-2 pt-2" : "pt-1"}`}>
      <p className="mb-1 text-[9px] font-semibold uppercase text-muted-foreground">Efeito no dia</p>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 text-[10px]">
        <span className="text-muted-foreground">Com freio</span><span className={`text-right font-mono ${moneyColor(comFreio)}`}>{BRL(comFreio)}</span>
        <span className="text-muted-foreground">Sem freio</span><span className={`text-right font-mono ${moneyColor(semFreio)}`}>{BRL(semFreio)}</span>
      </div>
    </div>
  );
}



type Filter = "all" | "open" | "blocked";
type Sort = "none" | "desc" | "asc";

// Ordem de exibição = ordem de agressividade (cauteloso e arrojado no meio).
const MODE_LIST = ["conservador", "cauteloso", "moderado", "equilibrado", "semi_agressivo", "arrojado", "agressivo", "enoir"] as const;
// MODE_LABEL removido (30/08/2026): rótulo vem de public.b3_mode_apelidos
// (useModeApelidos). MODE_LIST acima são CHAVES de identidade, não rótulos.
const VARIANT_LIST = Object.keys(VARIANT_LABEL);

// PERSISTÊNCIA DO RECORTE (26/08/2026)
// São 250 robôs; quem está acompanhando um ativo não quer remarcar tudo a cada
// visita. Guardado no navegador, sem tocar em banco — é preferência de tela.
const FILTER_STORAGE_KEY = "b3-cockpit-filtros-v2";
type SavedFilters = {
  symbols: string[]; variants: string[]; modes: string[]; filter: Filter; sort: Sort;
};
const DEFAULT_FILTERS: SavedFilters = {
  symbols: [...B3_ASSETS], variants: [...VARIANT_LIST], modes: [...MODE_LIST],
  filter: "all", sort: "none",
};
function loadFilters(): SavedFilters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const p = JSON.parse(raw);
    return {
      symbols: Array.isArray(p.symbols) ? p.symbols : DEFAULT_FILTERS.symbols,
      variants: Array.isArray(p.variants) ? p.variants : DEFAULT_FILTERS.variants,
      modes: Array.isArray(p.modes) ? p.modes : DEFAULT_FILTERS.modes,
      filter: (["all", "open", "blocked"].includes(p.filter) ? p.filter : "all") as Filter,
      sort: (["none", "desc", "asc"].includes(p.sort) ? p.sort : "none") as Sort,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

// ── LIBERAÇÃO MANUAL DE FREIO PARA O REAL (16/09/2026) ───────────────────────
// Isto NÃO destrava o simulador: com o modo sombra o robô já continua entrando.
// O que volta a acontecer é o ESPELHO enfileirar comando real ignorando UM freio
// escolhido. Liberar pede a senha mestra; travar de volta não pede nada.
// O disjuntor diário da conta real fica fora de propósito: é a última linha de
// defesa da conta inteira e não tem botão de contorno.
export type FreioLib = "grupo" | "pico" | "pos_meta" | "stop_diario";
const FREIOS_LIB: { v: FreioLib; label: string }[] = [
  { v: "grupo", label: "freio de grupo" },
  { v: "pico", label: "freio de pico" },
  { v: "pos_meta", label: "proteção pós-meta" },
  { v: "stop_diario", label: "stop diário do robô" },
];
const FREIO_LIB_LABEL = (f: string) => FREIOS_LIB.find((x) => x.v === f)?.label ?? f;

type Lib = { escopo: "grupo" | "robo"; symbol: string; variant: string; mode: string | null; freio: string; desde: string };

// Liberações que valem para este robô (inclui as de escopo de grupo).
function libsDoRobo(libs: Lib[], root: string, variant: string, mode: string | null) {
  return libs.filter((l) =>
    l.symbol === root && l.variant === variant &&
    (l.escopo === "grupo" ? true : mode != null && l.mode === mode));
}

function LiberacaoBloco({
  escopo, root, variant, mode, libs, liberarM, travarM, defaultFreio,
}: {
  escopo: "grupo" | "robo";
  root: string; variant: string; mode: string | null;
  libs: Lib[];
  liberarM: any; travarM: any;
  defaultFreio?: FreioLib;
}) {
  // Seleção MÚLTIPLA (16/09/2026): liberar não é escolher um freio, é definir um
  // estado — vários freios podem estar soltos ao mesmo tempo.
  const [freios, setFreios] = useState<FreioLib[]>(defaultFreio ? [defaultFreio] : []);
  const toggleFreio = (v: FreioLib) =>
    setFreios((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  const [senha, setSenha] = useState("");
  const [open, setOpen] = useState(false);
  // No card do robô só aparecem as liberações que o afetam; no card do grupo,
  // as de escopo de grupo (as por robô são desfeitas no card do robô).
  const ativas = escopo === "grupo"
    ? libs.filter((l) => l.escopo === "grupo" && l.symbol === root && l.variant === variant)
    : libsDoRobo(libs, root, variant, mode);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {ativas.map((l) => (
        <span key={`${l.escopo}-${l.freio}`}
          className="inline-flex items-center gap-1 rounded border border-amber-400 bg-amber-500/25 px-1.5 py-[2px] text-[10px] font-bold text-amber-100">
          LIBERADO — {FREIO_LIB_LABEL(l.freio)} ignorado
          {l.escopo === "grupo" && escopo === "robo" && " (grupo)"}
          <button type="button"
            className="ml-1 rounded bg-amber-100 px-1 py-[1px] text-[10px] font-semibold text-amber-950 hover:bg-white"
            disabled={travarM.isPending}
            onClick={(e) => {
              e.stopPropagation();
              travarM.mutate({ escopo: l.escopo, symbol: l.symbol, variant: l.variant, mode: l.mode, freio: l.freio });
            }}>
            Travar de volta
          </button>
        </span>
      ))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-6 border-amber-400/60 text-[10px] text-amber-200"
            onClick={(e) => e.stopPropagation()}>
            <Unlock className="mr-1 h-3 w-3" />
            {escopo === "grupo" ? "Liberar grupo no real" : "Liberar real"}
          </Button>
        </DialogTrigger>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>
              {escopo === "grupo"
                ? `Liberar o real de ${root}/${variant} (grupo inteiro)`
                : `Liberar o real de ${root}/${variant}/${mode}`}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O simulado não muda em nada: ele já continua entrando com o freio em sombra.
            O que volta a acontecer é o real seguir o simulado, ignorando o freio escolhido.
            A liberação vale até você travar de volta, até o botão de pânico ou até o fim do pregão —
            ela não atravessa o dia. O disjuntor diário da conta real não é liberável.
          </p>
          <div className="space-y-1">
            <p className="text-xs font-semibold">Quais freios quero ignorar</p>
            <label className="flex items-center gap-2 text-[11px] font-semibold">
              <input type="checkbox" className="h-3.5 w-3.5 accent-amber-400"
                checked={freios.length === FREIOS_LIB.length}
                onChange={(e) => setFreios(e.target.checked ? FREIOS_LIB.map((f) => f.v) : [])} />
              Selecionar todos
            </label>
            <div className="space-y-1 pt-1">
              {FREIOS_LIB.map((f) => (
                <label key={f.v} className="flex items-center gap-2 text-[11px]">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-amber-400"
                    checked={freios.includes(f.v)} onChange={() => toggleFreio(f.v)} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
          <Input type="password" value={senha} autoComplete="current-password"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSenha(e.target.value)} placeholder="Senha mestra" />
          <DialogFooter>
            <Button disabled={liberarM.isPending || senha.length < 1 || freios.length === 0}
              onClick={() => liberarM.mutate(
                { escopo, symbol: root, variant, mode: escopo === "grupo" ? null : mode, freios, password: senha },
                { onSuccess: () => { setSenha(""); setOpen(false); } },
              )}>
              {liberarM.isPending
                ? "Liberando..."
                : freios.length === 0
                  ? "Marque ao menos um freio"
                  : `Liberar ${freios.length} de ${FREIOS_LIB.length} freios até o fim do pregão`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function CockpitPage() {
  const apelidos = useModeApelidos();
  const qc = useQueryClient();
  const getOverview = useServerFn(getB3CockpitOverview);
  const closeMode = useServerFn(closeModeOrderManually);
  const closePositions = useServerFn(closeAllPositionsOnly);
  const disableModes = useServerFn(disableAllModes);
  const resetStop = useServerFn(resetB3DailyStop);
  const updEnabled = useServerFn(updateB3ModeSettings);
  // Liberação manual de freio para o real: leitura leve e independente do
  // overview (nada do motor é tocado por esta tela).
  const listLibs = useServerFn(listLiberacoesFreio);
  const liberarFn = useServerFn(liberarFreioReal);
  const travarFn = useServerFn(travarFreioReal);
  const lq = useQuery({
    queryKey: ["b3-liberacoes-freio"],
    queryFn: () => listLibs(),
    refetchInterval: useVisibleRefetchInterval(30_000),
    refetchIntervalInBackground: false,
  });
  const liberacoes: Lib[] = ((lq.data as any)?.liberacoes ?? []) as Lib[];
  const invalidarLib = () => {
    qc.invalidateQueries({ queryKey: ["b3-liberacoes-freio"] });
    qc.invalidateQueries({ queryKey: ["b3-cockpit"] });
  };
  const liberarM = useMutation({
    mutationFn: (v: any) => liberarFn({ data: v }),
    onSuccess: () => { invalidarLib(); toast.success("Freio liberado no real. Acompanhe a tela — a liberação não atravessa o pregão."); },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao liberar"),
  });
  const travarM = useMutation({
    mutationFn: (v: any) => travarFn({ data: v }),
    onSuccess: () => { invalidarLib(); toast.success("Freio travado de volta. Ele volta a valer para o real imediatamente."); },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao travar de volta"),
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<SavedFilters>(DEFAULT_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  // Leitura do navegador só depois da hidratação: ler no initializer do useState
  // dá divergência entre servidor e cliente.
  useEffect(() => { setSaved(loadFilters()); setHydrated(true); }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(saved)); } catch { /* modo privado */ }
  }, [saved, hydrated]);

  const { symbols: symbolsSel, variants: variantsSel, modes: modesSel, filter, sort } = saved;
  const patch = (p: Partial<SavedFilters>) => setSaved((s) => ({ ...s, ...p }));
  const setFilter = (v: Filter) => patch({ filter: v });

  // Recortes combináveis: ativo × modalidade × modo.
  const FULL: Record<"symbols" | "variants" | "modes", string[]> = {
    symbols: [...B3_ASSETS], variants: [...VARIANT_LIST], modes: [...MODE_LIST],
  };
  // SELEÇÃO MÚLTIPLA DE VERDADE (04/09/2026): antes, clicar isolava o item e só
  // com Ctrl/⌘/Shift somava — quem usa no celular não tem essas teclas e ficava
  // preso a um ativo por vez. Agora o clique simples MARCA E DESMARCA, e os três
  // recortes (ativo, modalidade, modo) se combinam. "Todos" continua sendo o
  // atalho para limpar ou marcar tudo.
  const clickItem = (
    key: "symbols" | "variants" | "modes",
    value: string,
    e?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ) =>
    setSaved((s) => {
      const cur = s[key];
      const additive = !!(e?.ctrlKey || e?.metaKey || e?.shiftKey);
      // Tudo marcado + clique simples = "quero ver só este" (o caminho mais
      // comum). Com Ctrl/⌘ o clique soma direto, sem isolar.
      if (!additive && cur.length === FULL[key].length) return { ...s, [key]: [value] };
      const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
      // Desmarcar o último item deixaria a tela vazia sem querer: volta para tudo.
      return { ...s, [key]: next.length ? next : FULL[key] };
    });
  // "Todos" é alternador: tudo marcado -> desmarca tudo.
  const toggleAll = (key: "symbols" | "variants" | "modes", isAll: boolean) =>
    patch({ [key]: isAll ? [] : FULL[key] } as Partial<SavedFilters>);



  const allSymbols = symbolsSel.length === B3_ASSETS.length;
  const allVariants = variantsSel.length === VARIANT_LIST.length;
  const allModes = modesSel.length === MODE_LIST.length;
  const filtroAtivo = !allSymbols || !allVariants || !allModes || filter !== "all";
  const [motivo, setMotivo] = useState("");
  // Recorte de DATA. Nunca persistido: a tela sempre abre em "Hoje".
  const [period, setPeriod] = useState<PeriodInput>(DEFAULT_PERIOD);
  // Faixas de ativo recolhidas — preferência só enquanto a página está aberta.
  const [collapsedAssets, setCollapsedAssets] = useState<Set<string>>(new Set());
  const toggleAsset = (root: string) => setCollapsedAssets((prev) => {
    const next = new Set(prev);
    next.has(root) ? next.delete(root) : next.add(root);
    return next;
  });

  // Recorte enviado ao servidor: lista completa vira `null` para não pagar
  // filtro nenhum, e a chave da consulta carrega o recorte para que cards,
  // testeira por ativo e PLACAR descrevam sempre o mesmo subconjunto.
  const orNull = (list: string[], full: boolean) => (full ? null : list);
  const filterArgs = {
    symbols: orNull(symbolsSel, allSymbols),
    variants: orNull(variantsSel, allVariants),
    modes: orNull(modesSel, allModes),
  };
  const filterKey = JSON.stringify(filterArgs);

  const vivo = (period.preset ?? "hoje") === "hoje";
  const q = useQuery({
    queryKey: ["b3-cockpit", filterKey],
    queryFn: () => getOverview({ data: filterArgs as any }),
    refetchInterval: useVisibleRefetchInterval(10000),
    refetchIntervalInBackground: false,
    enabled: vivo,
  });

  // Leitura histórica (só quando o recorte não é "hoje"): agregados do período
  // por pregão e por robô, sem tocar em nada do motor.
  const getPeriodo = useServerFn(getB3SimPeriodSummary);
  const hq = useQuery({
    queryKey: ["b3-cockpit-periodo", period.preset, period.start, period.end, filterKey],
    queryFn: () => getPeriodo({ data: { ...period, ...filterArgs } as never }),
    enabled: !vivo,
    gcTime: 0,
  });
  const hd = hq.data as any;

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
      scoreboard: includeScoreboard ? qc.getQueryData(["b3-cockpit-scoreboard", filterKey]) : undefined,
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
  // Quantos robôs estão com algum freio liberado agora. Fica no topo: saindo do
  // card, ainda tem de ficar visível que há liberação ativa.
  const robosLiberados = all.filter((c) =>
    libsDoRobo(liberacoes, rootSymbol(c.symbol), c.variant ?? "indicador", c.mode).length > 0).length;


  // Ativo/modalidade/modo já vêm recortados do servidor; aqui só ficam os
  // atalhos de pregão (posicionado / bloqueado) e a ordenação.
  const visible = all
    .filter((c) => filter === "all" ? true : filter === "open" ? !!c.open : isRiskBlocked(c));

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

  // Ordenação opcional por resultado do dia (realizado + aberto a mercado),
  // aplicada dentro de cada modalidade e também na ordem dos ativos.
  const cardResult = (c: any) => Number(c.realized_today ?? 0) + Number(c.unrealized_brl ?? 0);
  if (sort !== "none") {
    const dir = sort === "desc" ? -1 : 1;
    for (const group of bySymbol.values()) {
      for (const list of group.byVariant.values()) list.sort((a, b) => dir * (cardResult(a) - cardResult(b)));
    }
  }

  // Testeira por ativo/modalidade vem do servidor (linha do tempo de margem).
  const headerByAsset = new Map<string, any>(porAtivo.map((a) => [a.symbol, a]));
  // Ordena os ativos por resultado do dia — o que drena fica embaixo (ou no topo
  // quando o usuário pede "menor resultado").
  const assetDir = sort === "asc" ? 1 : -1;
  const orderedAssets = Array.from(bySymbol.entries()).sort(
    (a, b) => assetDir * (Number(headerByAsset.get(a[0])?.resultado_brl ?? 0) - Number(headerByAsset.get(b[0])?.resultado_brl ?? 0)),
  );
  const allCollapsed = orderedAssets.length > 0 && orderedAssets.every(([root]) => collapsedAssets.has(root));


  // mx-auto + teto largo: o `container` do Tailwind satura em 1536px e impede
  // um ultrawide de mostrar os 8 modos em linha. Teto generoso aproveita a
  // largura real (e responde ao menu lateral retrátil).
  return (
    <div className="mx-auto w-full max-w-[2400px] px-3 py-4 space-y-4 sm:px-4 sm:py-6">
      <header className="grid gap-2 sm:flex sm:items-center sm:justify-between sm:flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">Cockpit — todos os robôs</h1>
          <p className="text-sm text-muted-foreground">
            Visão compacta de todas as simulações (demo) rodando agora. Clique num card pra ver os detalhes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Liberação de freio ativa: some da vista se ficar sutil. */}
          {robosLiberados > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-amber-400 bg-amber-500/25 px-2 py-1 text-xs font-bold text-amber-100">
              <Unlock className="h-3.5 w-3.5" />
              {robosLiberados} {robosLiberados === 1 ? "robô com freio liberado" : "robôs com freio liberado"}
            </span>
          )}



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

      <PeriodBar value={period} onChange={setPeriod} resolved={hd?.period ?? { label: "Hoje", includes_today: true }} busy={q.isFetching || hq.isFetching} />
      <HistoricalBanner resolved={hd?.period} />

      {/* ── Placar do dia — recalcula no MESMO recorte dos filtros ── */}
      {vivo ? <Scoreboard filterArgs={filterArgs} filterKey={filterKey} /> : null}

      {/* ── Leitura histórica do período (modo histórico) ── */}
      {!vivo ? (
        <section className="space-y-3 rounded-lg border border-border/60 bg-card p-3">
          {hq.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando o período…</p>
          ) : hd?.no_movement ? (
            <NoMovementNotice label={hd?.period?.label} />
          ) : (
            <>
              {hd?.rows_truncated ? <TruncatedNotice limit={hd?.rows_limit} /> : null}
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-lg font-bold">Resultado de {hd?.period?.label ?? "período"}</h2>
                <span className={`font-mono text-xl font-black ${Number(hd?.total_brl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {BRL(Number(hd?.total_brl ?? 0))}
                </span>
                <span className="text-xs text-muted-foreground">
                  {hd?.ops ?? 0} operação(ões) · {hd?.ganhos ?? 0} ganho(s) · {hd?.perdas ?? 0} perda(s)
                </span>
              </div>

              {hd?.period?.single_day === false ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">Por pregão</p>
                  <PerDayTable rows={(hd?.by_day ?? []) as any[]} brl={(v) => BRL(Number(v ?? 0))} />
                </div>
              ) : null}

              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground">Por robô</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-xs">
                    <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-1 text-left">Robô</th>
                        <th className="py-1 text-right">Operações</th>
                        <th className="py-1 text-right">Ganhos</th>
                        <th className="py-1 text-right">Perdas</th>
                        <th className="py-1 text-right">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((hd?.robots ?? []) as any[]).map((r) => (
                        <tr key={r.key} className="border-b border-border/50">
                          <td className="py-1">
                            <span className="font-semibold">{r.symbol}</span>{" "}
                            <span className="text-muted-foreground">{variantLabel(r.variant)} · {apelidos.nick(r.mode)}</span>
                          </td>
                          <td className="py-1 text-right">{r.ops}</td>
                          <td className="py-1 text-right">{r.ganhos}</td>
                          <td className="py-1 text-right">{r.perdas}</td>
                          <td className={`py-1 text-right font-mono font-black ${Number(r.resultado_brl) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                            {BRL(Number(r.resultado_brl))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      ) : null}

      {/* ── Resumo + filtros (ativo, modalidade, modo) ── */}
      <section className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">
            <strong>{totalRobots}</strong> robôs · <strong>{withOpen}</strong> com posição aberta ·{" "}
            <strong>{waiting}</strong> aguardando · <strong>{blocked}</strong> bloqueados
          </p>
          {filtroAtivo && (
            <>
              <Badge className="bg-amber-500/20 text-amber-200 border border-amber-500/40 text-[10px]">
                filtro ativo — os números acima e o placar são só deste recorte
              </Badge>
              <Button size="sm" variant="outline" className="h-6 text-[10px]"
                onClick={() => patch(DEFAULT_FILTERS)}>
                Limpar filtros
              </Button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {([["all", "Todos"], ["open", "Só posicionado"], ["blocked", "Só bloqueado"]] as [Filter, string][]).map(([v, label]) => (
            <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} className="h-7 text-[11px]"
              onClick={() => setFilter(v)}>
              {label}
            </Button>
          ))}
          <span className="text-[11px] text-muted-foreground ml-2">Ordenar:</span>
          {([["none", "Padrão"], ["desc", "Maior resultado"], ["asc", "Menor resultado"]] as [Sort, string][]).map(([v, label]) => (
            <Button key={v} size="sm" variant={sort === v ? "default" : "outline"} className="h-7 text-[11px]"
              onClick={() => patch({ sort: v })}>
              {label}
            </Button>
          ))}
          <Button size="sm" variant="outline" className="h-7 text-[11px] ml-auto"
            onClick={() => setCollapsedAssets(allCollapsed ? new Set() : new Set(orderedAssets.map(([r]) => r)))}>
            {allCollapsed ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronUp className="w-3 h-3 mr-1" />}
            {allCollapsed ? "Expandir todos" : "Recolher todos"}
          </Button>
        </div>

        {/* Ativo (raiz do contrato: WIN, WDO...) — clique marca e desmarca.
            No celular cada faixa rola na horizontal: nada de texto cortado nem
            de filtro empurrando os cartões para fora da tela. */}
        <div className="grid gap-1 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5">
          <span className="text-[11px] text-muted-foreground sm:w-20">Ativo:</span>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <Button size="sm" variant={allSymbols ? "default" : "outline"} className="h-8 shrink-0 text-[11px] sm:h-7"
              title={allSymbols ? "Desmarcar todos" : "Marcar todos"}
              onClick={() => toggleAll("symbols", allSymbols)}>Todos</Button>
            {B3_ASSETS.map((s) => (
              <Button key={s} size="sm" variant={symbolsSel.includes(s) ? "default" : "outline"}
                className="h-8 shrink-0 text-[11px] sm:h-7" title={`${assetLabel(s)} — clique marca e desmarca; os três recortes se combinam`}
                onClick={(e) => clickItem("symbols", s, e)}>
                {s}
              </Button>
            ))}
          </div>
        </div>

        {/* Modalidade */}
        <div className="grid gap-1 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5">
          <span className="text-[11px] text-muted-foreground sm:w-20">Modalidade:</span>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <Button size="sm" variant={allVariants ? "default" : "outline"} className="h-8 shrink-0 text-[11px] sm:h-7"
              title={allVariants ? "Desmarcar todas" : "Marcar todas"}
              onClick={() => toggleAll("variants", allVariants)}>Todas</Button>
            {VARIANT_LIST.map((v) => (
              <Button key={v} size="sm" variant={variantsSel.includes(v) ? "default" : "outline"}
                className="h-8 shrink-0 text-[11px] sm:h-7" title="Clique marca e desmarca; os três recortes se combinam"
                onClick={(e) => clickItem("variants", v, e)}>
                {variantLabel(v)}
              </Button>
            ))}
          </div>
        </div>

        {/* Modo de risco — apelidos na ordem da coluna `ordem` do banco */}
        <div className="grid gap-1 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5">
          <span className="text-[11px] text-muted-foreground sm:w-20">Modo:</span>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <Button size="sm" variant={allModes ? "default" : "outline"} className="h-8 shrink-0 text-[11px] sm:h-7"
              title={allModes ? "Desmarcar todos" : "Marcar todos"}
              onClick={() => toggleAll("modes", allModes)}>Todos</Button>
            {apelidos.sortModes([...MODE_LIST] as string[]).map((m) => (
              <Button key={m} size="sm" variant={modesSel.includes(m) ? "default" : "outline"}
                className="h-8 shrink-0 text-[11px] sm:h-7" title="Clique marca e desmarca; os três recortes se combinam"
                onClick={(e) => clickItem("modes", m, e)}>
                {apelidos.nick(m)}
              </Button>
            ))}
          </div>
        </div>


      </section>


      {vivo && q.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {vivo && !q.isLoading && !visible.length && (
        <p className="text-sm text-muted-foreground">Nenhum robô para o filtro selecionado.</p>
      )}

      {vivo && orderedAssets.map(([root, group]) => {
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
            <EfeitoDia
              sombra={somarSombrasDia((hdr?.por_modalidade ?? []).map((m: any) => m.sombra))}
              compacto
            />
          </div>

          {!isCollapsed && Array.from(group.byVariant.entries()).map(([variant, cards]) => {
            const sub = (hdr?.por_modalidade ?? []).find((m: any) => m.variant === variant);
            return (
            <div key={variant} className="@container space-y-2 rounded-lg border border-border/40 bg-background/30 p-3">
              <h3 className="text-xs font-semibold flex items-center gap-2 flex-wrap">
                <Badge className={`text-[10px] ${VARIANT_COLOR[variant] ?? ""}`}>{variantLabel(variant)}</Badge>
                <span className="text-muted-foreground font-normal">{cards.length} robôs</span>
                {/* Com uma única modalidade visível, a testeira do ativo já mostra
                    exatamente estes números — o subtotal viraria repetição. */}
                {variantsSel.length > 1 && (
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
                {/* Um freio de GRUPO trava todos os robôs do grupo de uma vez:
                    desfazer de um em um seriam sete cliques para uma decisão só. */}
                <LiberacaoBloco
                  escopo="grupo" root={root} variant={variant} mode={null}
                  libs={liberacoes} liberarM={liberarM} travarM={travarM} defaultFreio="grupo"
                />
                <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto"
                  onClick={() => copyCards(cards, `${root} · ${variantLabel(variant).toLowerCase()}`)}>
                  <Copy className="w-3 h-3 mr-1" />Copiar ativo + modalidade
                </Button>

              </h3>
              <EfeitoDia sombra={sub?.sombra} compacto grupoNivel={cards[0]?.grupo?.nivel ?? null} />

              {/* Degraduação em degraus previsíveis (8→4→2→1) por container query:
                  mede a largura real disponível — inclusive após recolher o menu
                  lateral — em vez do viewport. Cortes na área útil do grid:
                    < 380px → 1 col | 380–780 → 2 | 780–1500 → 4 | ≥1500 → 8. */}
              <div className="grid grid-cols-1 @[380px]:grid-cols-2 @[780px]:grid-cols-4 @[1500px]:grid-cols-8 gap-3">
                {cards.map((c: any) => {
                  const key = `${c.run_id}:${c.mode}`;
                  const isOpen = expanded.has(key);
                  const hasPosition = !!c.open;
                  const tick = Number(c.tick_size ?? 5);
                  const pnlColor = c.unrealized_brl == null ? "" : c.unrealized_brl >= 0 ? "text-emerald-300" : "text-rose-300";
                  const riskBlocked = isRiskBlocked(c);
                   const isRealEnv = c.environment && c.environment !== "simulation";
                   const cor = robotColor(c.cor);
                   return (
                     <div
                       key={key}
                       title={cor?.label}
                       className={`relative rounded-lg border bg-card overflow-hidden ${cor ? cor.border : "border-border/60"}`}
                     >
                       {cor && <span aria-hidden className={`absolute left-0 top-0 h-full w-1 ${cor.bar}`} />}
                      {/* Configurar este robô — fora do <button> do card pra não aninhar botões */}
                      <div className="absolute top-1 right-7 z-10">
                        <RobotConfigDialog
                          runId={c.run_id}
                          mode={c.mode}
                          symbol={c.symbol}
                          variant={c.variant ?? "indicador"}
                          compact
                        />
                      </div>
                      {/* Autorização real deste robô — leva à tela já filtrada.
                          Não autoriza nada: a autorização continua exigindo ação explícita. */}
                      <Link
                        to="/prd-autorizacoes"
                        search={{ symbol: c.symbol, variant: c.variant ?? "indicador", mode: c.mode }}
                        aria-label="Abrir autorização real deste robô"
                        title="Abrir autorização real deste robô"
                        className="absolute top-1.5 right-[3.4rem] z-10 rounded p-1 text-muted-foreground/70 hover:text-orange-300 hover:bg-muted/50"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                      </Link>
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
                            <Badge className={`text-[10px] ${MODE_COLOR[c.mode]}`}>{apelidos.nick(c.mode)}<span className="ml-1 opacity-70 text-[9px]">{apelidos.tech(c.mode)}</span></Badge>
                            <Badge className={`text-[10px] ${VARIANT_COLOR[c.variant] ?? ""}`}>{variantLabel(c.variant)}</Badge>
                            {/* DINHEIRO DE VERDADE (04/09/2026): autorização ligada
                                e não revogada para este ativo/modalidade/modo. Sem
                                selo = só simulação. */}
                            {c.real_auth && (
                              <span
                                className="inline-flex items-center gap-1 rounded border border-orange-400/60 bg-orange-500/15 px-1 py-[1px] text-[10px] font-semibold text-orange-200"
                                title={`Robô autorizado no real — até ${c.real_auth.max_qty} contrato(s) por operação`}
                              >
                                REAL {c.real_auth.max_qty}x
                              </span>
                            )}

                            <PeakRing
                              peak={Number(c.day_peak_profit_brl ?? 0)}
                              atual={Number(c.total_today ?? 0)}
                              limite={Number(c.peak_giveback_pct ?? 0.4)}
                            />
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
                              {/* Hora de entrada e tempo em posição: com robôs em lados
                                  opostos, é o que diz quem entrou primeiro. */}
                              {openSinceText(c.open.entry_time) && (
                                <span className="text-[11px] text-muted-foreground/80">
                                  {openSinceText(c.open.entry_time)}
                                </span>
                              )}
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
                                {/* Freio é RÓTULO no simulado: o robô continua entrando. */}
                                {c.current_status === "blocked_stop" ? "Stop diário acionado (sombra) — segue entrando" : "Freio acionado (sombra) — segue entrando"}
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
                        {c.grupo?.texto && (
                          <p className={`text-[10px] font-semibold ${
                            c.grupo.sem_limite ? "text-orange-400" : c.grupo.travado ? "text-rose-300" : "text-amber-300"
                          }`}>
                            {c.grupo.sem_limite ? "⚠ " : ""}{c.grupo.texto}
                            {c.grupo.travado ? " · simulado entra, real recusado" : ""}
                            {c.grupo.desde ? ` (${openSinceText(c.grupo.desde).replace(/\s\(.*\)$/, "")})` : ""}
                          </p>
                        )}
                        {/* Freios ACIONADOS agora: o robô continua entrando
                            (sombra) e a tela tem que dizer que ele roda apesar
                            deles, com o horário de cada um. */}
                        {(() => {
                          const txt = freiosAcionadosTexto(c.freios_acionados, c.grupo);
                          if (!txt) return null;
                          return (
                            <div className="mt-1 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1">
                              <p className="text-[10px] font-bold text-amber-300">
                                FREIOS ACIONADOS (sombra): {txt}
                              </p>
                              <p className="text-[9px] italic text-amber-200/80">
                                entradas continuam, marcadas como sombra
                              </p>
                            </div>
                          );
                        })()}
                        <EfeitoDia
                          sombra={c.grupo?.sombra}
                          horarios={Object.fromEntries((c.freios_acionados ?? []).map((f: any) => [f.freio, f.desde]).concat([["grupo", c.grupo?.desde ?? null]]))}
                          grupoNivel={c.grupo?.nivel ?? null}
                        />

                      </button>


                      {/* ── Liberar o REAL deste robô (senha mestra) ──
                          Fora do <button> do card para não aninhar botões. O
                          simulado não muda: o freio já está em sombra. */}
                      <div className="px-3 pb-2">
                        <LiberacaoBloco
                          escopo="robo"
                          root={rootSymbol(c.symbol)}
                          variant={c.variant ?? "indicador"}
                          mode={c.mode}
                          libs={liberacoes}
                          liberarM={liberarM}
                          travarM={travarM}
                          defaultFreio={
                            c.grupo?.travado ? "grupo"
                              : String(c.current_status ?? "").includes("peak") || String(c.current_status ?? "").includes("pico") ? "pico"
                              : String(c.current_status ?? "").includes("post_target") || String(c.current_status ?? "").includes("pos_meta") ? "pos_meta"
                              : String(c.current_status ?? "").includes("stop") ? "stop_diario"
                              : "grupo"
                          }
                        />
                      </div>

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

function PairedMoney({ label, comFreio, semFreio, large = false }: {
  label: string; comFreio: number; semFreio: number; large?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className={`grid grid-cols-[auto_1fr] gap-x-3 ${large ? "text-lg sm:text-xl" : "text-xs"}`}>
        <span className="text-muted-foreground">Com freio</span>
        <span className={`text-right font-mono font-semibold ${pnlColorOf(comFreio)}`}>{BRL(comFreio)}</span>
        <span className="text-muted-foreground">Sem freio</span>
        <span className={`text-right font-mono font-semibold ${pnlColorOf(semFreio)}`}>{BRL(semFreio)}</span>
      </div>
    </div>
  );
}

function RobotValue({ robot }: { robot: any }) {
  if (!robot) return <span className="font-mono">R$ 0,00</span>;
  return (
    <span className="min-w-0">
      <span className="font-medium">{rootSymbol(robot.symbol)}</span>
      <span className="text-muted-foreground"> · {variantLabel(robot.variant).toLowerCase()} · {robot.mode} </span>
      <span className={`font-mono ${pnlColorOf(Number(robot.brl))}`}>{BRL(Number(robot.brl))}</span>
    </span>
  );
}

function RobotPair({ label, comFreio, semFreio }: { label: string; comFreio: any; semFreio: any }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
        <span className="text-muted-foreground">Com freio</span><RobotValue robot={comFreio} />
        <span className="text-muted-foreground">Sem freio</span><RobotValue robot={semFreio} />
      </div>
    </div>
  );
}

function Scoreboard({ filterArgs, filterKey }: {
  filterArgs: { symbols: string[] | null; variants: string[] | null; modes: string[] | null };
  filterKey: string;
}) {
  const getScoreboard = useServerFn(getB3CockpitScoreboard);
  const q = useQuery({
    queryKey: ["b3-cockpit-scoreboard", filterKey],
    queryFn: () => getScoreboard({ data: filterArgs as any }),
    refetchInterval: useVisibleRefetchInterval(10000),
    refetchIntervalInBackground: false,
  });
  const d: any = q.data;
  if (!d) return <section className="rounded-lg border border-border/60 bg-card p-4 text-sm text-muted-foreground">Carregando placar do dia...</section>;

  const capital = Number(d.capital_disponivel_brl ?? 0);
  const exposicao = Number(d.exposicao_atual_brl ?? 0);
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
        <PairedMoney label="Saldo do dia" comFreio={Number(d.saldo_dia_com_freio_brl)} semFreio={Number(d.saldo_dia_brl)} large />
        <PairedMoney label="Se fechasse agora" comFreio={Number(d.se_fechasse_agora_com_freio_brl)} semFreio={Number(d.se_fechasse_agora_brl)} large />
        <PairedMoney label="Exposição atual" comFreio={Number(d.exposicao_atual_com_freio_brl)} semFreio={Number(d.exposicao_atual_brl)} large />
      </div>

      {/* Linha 2 — corpo médio */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-border/40 pt-3">
        <PairedMoney label="Lucro bruto do dia" comFreio={Number(d.lucro_bruto_com_freio_brl)} semFreio={Number(d.lucro_bruto_brl)} />
        <PairedMoney label="Prejuízo bruto do dia" comFreio={Number(d.prejuizo_bruto_com_freio_brl)} semFreio={Number(d.prejuizo_bruto_brl)} />
        <PairedMoney label="Aberto positivo" comFreio={Number(d.aberto_positivo_com_freio_brl)} semFreio={Number(d.aberto_positivo_brl)} />
        <PairedMoney label="Aberto negativo" comFreio={Number(d.aberto_negativo_com_freio_brl)} semFreio={Number(d.aberto_negativo_brl)} />
      </div>

      {/* Linha 3 — corpo pequeno */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-border/40 pt-3">
        <RobotPair label="Melhor robô do dia" comFreio={d.melhor_robo_com_freio} semFreio={d.melhor_robo} />
        <RobotPair label="Pior robô do dia" comFreio={d.pior_robo_com_freio} semFreio={d.pior_robo} />
        <PairedMoney label="Pico de exposição do dia" comFreio={Number(d.pico_exposicao_com_freio_brl)} semFreio={Number(d.pico_exposicao_brl)} />
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
