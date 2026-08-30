// Cockpit Real — desenho de DESKTOP (no padrão do cockpit simulado), com
// degradação para celular. Somente leitura + três ações explícitas:
// parar novas entradas (sem senha), religar (com senha mestra) e zerar posição.
// Nada aqui toca no motor de simulação, no comitê, nos classificadores ou nos freios.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, CircleSlash, Clock, Hand, KeyRound, LayoutDashboard,
  Play, RefreshCw, ShieldOff, XOctagon, Radio, GitCompareArrows,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import { BRL, SIGNED_BRL, PX, openSinceText, assetLabel } from "@/lib/b3-format";
import {
  getB3RealCockpit, stopRealNewEntries, resumeRealExecution, closeRealPositionNow,
  closeRealPositionByBroker, getRealCommandStatus,
} from "@/lib/b3-real-cockpit.functions";

export const Route = createFileRoute("/_authenticated/cockpit-real")({
  head: () => ({
    meta: [
      { title: "Cockpit Real — dinheiro real na XP — AleTrader AI" },
      { name: "description", content: "Posição real aberta, ordens executadas do dia, resultado real e parada de emergência da operação com dinheiro real." },
      { property: "og:title", content: "Cockpit Real — AleTrader AI" },
      { property: "og:description", content: "Posição real aberta, ordens do dia com ticket da corretora, resultado real e botão de parar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CockpitRealPage,
});

const PCT = (v: number | null | undefined) =>
  v == null ? "—" : `${Number(v) > 0 ? "+" : ""}${(Number(v) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const money = (v: number | null | undefined) => (Number(v ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300");
const sideLabel = (s: string | null | undefined) => (s === "buy" ? "COMPRA" : s === "sell" ? "VENDA" : "—");
const hhmm = (iso: string | null | undefined) =>
  !iso ? "—" : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const hhmmss = (iso: string | null | undefined) =>
  !iso ? "—" : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
// Rótulo do modo vem de public.b3_mode_apelidos (useModeApelidos).
const ageText = (s: number | null | undefined) => {
  const sec = Math.max(0, Math.round(Number(s ?? 0)));
  if (sec < 90) return `há ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h${String(min % 60).padStart(2, "0")}`;
  const d = Math.floor(h / 24);
  return `há ${d}d${h % 24}h`;
};

const VARIANT_LABEL: Record<string, string> = {
  indicador: "indicador", price_action: "price action",
  mean_reversion: "reversão à média", range: "faixa", rompimento: "rompimento",
  pullback: "repique", vwap: "VWAP",
};

const STATUS_LABEL: Record<string, string> = {
  filled: "executada", pending: "na fila", claimed: "com o executor",
  rejected: "recusada", error: "erro", expired: "expirada", cancelled: "cancelada",
};
const statusCls = (s: string) =>
  s === "filled" ? "text-emerald-300"
    : s === "rejected" || s === "error" ? "text-rose-300"
      : s === "expired" ? "text-amber-300" : "text-muted-foreground";

const STATE_UI: Record<string, { label: string; sub: string; cls: string; Icon: typeof CheckCircle2 }> = {
  real_ativo: {
    label: "DINHEIRO REAL ATIVO",
    sub: "O executor confirmou execução de verdade no MT5.",
    cls: "bg-rose-600 text-white border-rose-400",
    Icon: AlertTriangle,
  },
  modo_teste: {
    label: "MODO TESTE (DRY-RUN)",
    sub: "O executor está recusando os comandos de propósito. Nenhuma ordem real é enviada.",
    cls: "bg-sky-600 text-white border-sky-300",
    Icon: CheckCircle2,
  },
  sem_sinal: {
    label: "SEM SINAL DO EXECUTOR",
    sub: "Pregão aberto e nenhum comando confirmado nas últimas horas. Não é possível afirmar o estado.",
    cls: "bg-amber-500 text-black border-amber-300",
    Icon: CircleSlash,
  },
  sem_comando: {
    label: "NENHUM COMANDO REAL",
    sub: "Fora do pregão e sem comandos recentes — nada em andamento.",
    cls: "bg-zinc-700 text-white border-zinc-500",
    Icon: CircleSlash,
  },
};

function Panel({
  title, children, hint, className,
}: { title: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-4 ${className ?? ""}`}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-black leading-tight ${cls ?? ""}`}>{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function CockpitRealPage() {
  const apelidos = useModeApelidos();
  const qc = useQueryClient();
  const load = useServerFn(getB3RealCockpit);
  const stopEntries = useServerFn(stopRealNewEntries);
  const resumeReal = useServerFn(resumeRealExecution);
  const closeNow = useServerFn(closeRealPositionNow);
  const closeOne = useServerFn(closeRealPositionByBroker);
  const commandStatus = useServerFn(getRealCommandStatus);

  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showAllRobots, setShowAllRobots] = useState(false);
  // Fechamento pontual de UMA posição reportada pela corretora.
  const [closeTarget, setCloseTarget] = useState<any | null>(null);
  const [lastCommandId, setLastCommandId] = useState<string | null>(null);

  // Ao vivo: sem cache de posição nem de cotação.
  const refetchInterval = useVisibleRefetchInterval(15_000);
  const q = useQuery({
    queryKey: ["cockpit-real"],
    queryFn: () => load({ data: undefined as never }),
    refetchInterval,
    refetchIntervalInBackground: false,
    gcTime: 0,
    staleTime: 0,
  });
  const d = q.data as any;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cockpit-real"] });

  const mStop = useMutation({
    mutationFn: () => stopEntries({ data: {} }),
    onSuccess: (r: any) => {
      invalidate();
      setConfirmStop(false);
      toast.success(`Real PARADO. ${r?.disabled ?? 0} autorização(ões) desligada(s). A simulação segue igual.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao parar as entradas reais."),
  });
  const mResume = useMutation({
    mutationFn: () => resumeReal({ data: { password } }),
    onSuccess: () => {
      invalidate();
      setResumeOpen(false);
      setPassword("");
      toast.success("Real LIBERADO. Nenhum robô foi ligado automaticamente — ligue um por um em Autorizações Reais.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao religar o real."),
  });
  const mClose = useMutation({
    mutationFn: () => closeNow({ data: { confirm: true as const } }),
    onSuccess: (r: any) => {
      invalidate();
      setConfirmClose(false);
      if (r?.ok) toast.success(`Zeragem enviada: ${r.queued} comando(s) a mercado (${(r.detalhe ?? []).join(", ")}). Autorizações desligadas.`);
      else toast.warning(r?.reason ?? "Nenhuma posição real aberta.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao enfileirar a zeragem."),
  });

  // Acompanha o veredito do comando manual até ele sair de 'pending'/'claimed'.
  const cmdQ = useQuery({
    queryKey: ["cockpit-real-cmd", lastCommandId],
    enabled: !!lastCommandId,
    queryFn: () => commandStatus({ data: { command_id: lastCommandId as string } }),
    refetchInterval: (q) => {
      const st = (q.state.data as any)?.status;
      return st && st !== "pending" && st !== "claimed" ? false : 2000;
    },
    gcTime: 0,
    staleTime: 0,
  });

  const mCloseOne = useMutation({
    mutationFn: (p: any) =>
      closeOne({
        data: {
          symbol: p.symbol || p.root,
          side: p.side,
          quantity: p.quantity,
          magic_number: p.magic_number ?? null,
          confirm: true as const,
        },
      }),
    onSuccess: (r: any) => {
      invalidate();
      setCloseTarget(null);
      setLastCommandId(r?.command_id ?? null);
      toast.success(`Comando de fechamento criado (${r?.detalhe ?? ""}). O executor tem até 2 min para executar.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao enfileirar o fechamento."),
  });

  const broker = (d?.broker ?? {}) as any;
  const brokerPositions = (broker.positions ?? []) as any[];
  const positions = (d?.positions ?? []) as any[];
  const orders = (d?.day_orders ?? []) as any[];
  const allRobots = (d?.robots ?? []) as any[];
  // Autorização desligada e sem nenhum rastro no executor é ruído: a lista
  // cheia tem centenas de linhas (todo ativo × modalidade × modo).
  const robots = showAllRobots
    ? allRobots
    : allRobots.filter((r) => r.enabled || r.magic_number != null || r.has_open_position);
  const alerts = (d?.alerts ?? []) as any[];
  const st = STATE_UI[d?.executor?.state ?? "sem_comando"] ?? STATE_UI["sem_comando"]!;
  const realEnabled = d?.real_state?.real_enabled !== false;
  const today = d?.today ?? {};

  return (
    <div className="mx-auto w-full max-w-[1500px] px-3 pb-16 pt-4 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight">Cockpit Real</h1>
          <p className="text-xs text-muted-foreground">
            Dinheiro real na XP · pregão {d?.session_date ?? "—"} · atualiza sozinho a cada 15s
            {d?.server_time ? ` · dados de ${hhmmss(d.server_time)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-black ${realEnabled ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200" : "border-rose-500/60 bg-rose-600 text-white"}`}
          >
            {realEnabled ? "REAL OPERANDO" : "REAL PARADO"}
          </span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className={`mr-1 size-4 ${q.isFetching ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/b3-cockpit"><LayoutDashboard className="mr-1 size-4" /> Cockpit simulado</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/prd-autorizacoes"><KeyRound className="mr-1 size-4" /> Autorizações reais</Link>
          </Button>
        </div>
      </header>

      {/* Estado permanente do real — nunca sai da tela */}
      {!realEnabled ? (
        <div className="mt-3 rounded-xl border-2 border-rose-400 bg-rose-600 px-4 py-3 text-white">
          <p className="flex items-center gap-2 text-base font-black">
            <ShieldOff className="size-5" /> REAL PARADO PELA TELA — nenhuma entrada real nova será enviada
          </p>
          <p className="mt-1 text-xs opacity-95">
            {d?.real_state?.stopped_reason ? `Motivo: ${d.real_state.stopped_reason}. ` : ""}
            Parado desde {hhmm(d?.real_state?.stopped_at)}. A simulação continua coletando e operando normalmente.
            A posição aberta segue sendo gerida (stop, alvo e zeragem valem).
          </p>
        </div>
      ) : null}

      <div className={`mt-3 rounded-xl border-2 px-4 py-3 ${st.cls}`}>
        <div className="flex flex-wrap items-center gap-2">
          <st.Icon className="size-6 shrink-0" />
          <p className="text-base font-black leading-tight tracking-tight">{st.label}</p>
        </div>
        <p className="mt-1 text-[11px] leading-snug opacity-95">{st.sub}</p>
        <p className="mt-1 text-[11px] font-medium opacity-95">
          Último comando: {d?.executor?.last_command_at ? `${hhmm(d.executor.last_command_at)} (${ageText(d.executor.last_command_age_s)})` : "nenhum registrado"}
          {d?.executor?.last_command
            ? ` · ${d.executor.last_command.action === "open" ? "abertura" : "fechamento"} ${d.executor.last_command.symbol} · ${STATUS_LABEL[d.executor.last_command.status] ?? d.executor.last_command.status}`
            : ""}
        </p>
        {d?.executor?.last_command?.error_message
          ? <p className="mt-1 break-words text-[11px] opacity-90">Resposta do executor: {d.executor.last_command.error_message}</p>
          : null}
      </div>

      {broker.has_divergence ? (
        <div className="mt-3 rounded-xl border-2 border-amber-400 bg-amber-500/15 px-4 py-3 text-amber-100">
          <p className="flex items-center gap-2 text-sm font-black">
            <GitCompareArrows className="size-5" /> DIVERGÊNCIA entre a corretora e o cálculo por comandos
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {(broker.divergences ?? []).map((dv: any) => (
              <li key={dv.root}>
                {assetLabel(dv.root)}: corretora <b>{dv.broker_net}</b> · comandos <b>{dv.ledger_net}</b>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] opacity-90">
            Algum comando expirou ou executou quantidade diferente da pedida. A corretora é a verdade;
            o cálculo por comandos é segunda opinião.
          </p>
        </div>
      ) : null}

      {q.isError ? (
        <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          Falha ao ler os dados reais: {(q.error as any)?.message ?? "erro desconhecido"}
        </p>
      ) : null}

      {/* Placar do dia */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Realizado hoje" value={SIGNED_BRL(today.realized_brl ?? 0)} sub={PCT(today.realized_pct)} cls={money(today.realized_brl)} />
        <Tile label="Em aberto" value={today.unrealized_brl == null ? "—" : SIGNED_BRL(today.unrealized_brl)} sub={PCT(today.unrealized_pct)} cls={money(today.unrealized_brl)} />
        <Tile label="Total do dia" value={SIGNED_BRL(today.total_brl ?? 0)} sub={PCT(today.total_pct)} cls={money(today.total_brl)} />
        <Tile
          label="Saldo da conta"
          value={
            today.saldo_conta_brl != null ? BRL(today.saldo_conta_brl)
              : today.saldo_estimado_brl == null ? "—" : BRL(today.saldo_estimado_brl)
          }
          sub={
            today.saldo_conta_brl != null
              ? `reportado pelo executor${today.capital_liquido_brl != null ? ` · líquido ${BRL(today.capital_liquido_brl)}` : ""}`
              : "estimado pelo capital cadastrado — executor não reportou"
          }
        />
        <Tile
          label="Ordens do dia"
          value={`${today.filled_orders ?? 0} exec.`}
          sub={`${today.rejected_orders ?? 0} recusada(s) · ${orders.length} comando(s)`}
        />
        <Tile
          label="Operações encerradas"
          value={String(today.closed_count ?? 0)}
          sub={`${today.wins ?? 0} ganho(s) · ${today.losses ?? 0} perda(s)${today.sem_preco_count ? ` · ${today.sem_preco_count} sem preço` : ""}`}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          {/* Posição real na corretora — verdade reportada pelo executor */}
          <Panel
            title="Posição na corretora (reportada pelo executor)"
            hint="Vem do relatório que o executor manda a cada 2s lendo o MT5. É a verdade — não é cálculo."
          >
            <p className={`mb-2 flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px] ${
              !broker.reported || broker.stale
                ? "border-rose-500/50 bg-rose-500/10 text-rose-100"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
            }`}>
              <Radio className="size-3.5 shrink-0" />
              {!broker.reported
                ? "O executor nunca enviou relatório. Sem isso, só existe o cálculo por comandos — que pode divergir."
                : broker.stale
                  ? `Último relatório ${ageText(broker.report_age_s)} — o executor pode estar parado. Não trate estes números como atuais.`
                  : `Relatório de ${hhmmss(broker.reported_at)} (${ageText(broker.report_age_s)})${broker.account_login ? ` · conta ${broker.account_login}` : ""}${broker.server_name ? ` · ${broker.server_name}` : ""}`}
            </p>

            {!brokerPositions.length ? (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-6 text-center text-sm font-semibold text-muted-foreground">
                {broker.reported ? "Conta zerada na corretora — nenhuma posição aberta" : "Sem relatório do executor"}
              </p>
            ) : (
              <div className="space-y-2">
                {brokerPositions.map((p) => (
                  <div key={`${p.symbol}-${p.ticket ?? p.magic_number}`} className="rounded-lg border-2 border-rose-500/40 bg-rose-500/5 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-lg font-black tracking-tight">
                          {sideLabel(p.side)} {p.quantity}x {p.symbol}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {assetLabel(p.root)}
                          {p.magic_number ? ` · magic ${p.magic_number}` : ""}
                          {p.ticket ? ` · ticket ${p.ticket}` : ""}
                          {p.opened_at ? ` · aberta ${openSinceText(p.opened_at)}` : ""}
                        </p>
                      </div>
                      <p className={`text-2xl font-black ${money(p.profit_brl)}`}>
                        {p.profit_brl == null ? "—" : SIGNED_BRL(p.profit_brl)}
                      </p>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                      <div><dt className="text-muted-foreground">Preço médio</dt><dd className="font-semibold">{PX(p.entry_price, p.tick_size)}</dd></div>
                      <div><dt className="text-muted-foreground">Preço corrente</dt><dd className="font-semibold">{PX(p.price_current, p.tick_size)}</dd></div>
                      <div><dt className="text-muted-foreground">Resultado</dt><dd className={`font-semibold ${money(p.profit_brl)}`}>{p.profit_brl == null ? "—" : SIGNED_BRL(p.profit_brl)}</dd></div>
                    </dl>
                    <Button
                      size="lg"
                      variant="destructive"
                      className="mt-3 h-auto min-h-14 w-full justify-center gap-2 whitespace-normal py-2 text-base font-black"
                      onClick={() => setCloseTarget(p)}
                      disabled={mCloseOne.isPending}
                    >
                      <XOctagon className="size-5 shrink-0" />
                      Fechar esta posição a mercado
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {lastCommandId ? (
              <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2 text-[11px]">
                <p className="font-semibold">
                  Comando de fechamento {STATUS_LABEL[(cmdQ.data as any)?.status ?? "pending"] ?? (cmdQ.data as any)?.status ?? "na fila"}
                </p>
                <p className="text-muted-foreground">
                  {(cmdQ.data as any)?.status === "filled"
                    ? `Executado a ${PX((cmdQ.data as any)?.filled_price, 5)}${(cmdQ.data as any)?.broker_ticket ? ` · ticket ${(cmdQ.data as any).broker_ticket}` : ""} às ${hhmmss((cmdQ.data as any)?.filled_at)}`
                    : (cmdQ.data as any)?.error_message
                      ? `Resposta do executor: ${(cmdQ.data as any).error_message}`
                      : "Aguardando o executor reivindicar e confirmar (validade de 2 min)."}
                </p>
                <Button size="sm" variant="ghost" className="mt-1 h-6 px-2 text-[11px]" onClick={() => setLastCommandId(null)}>
                  dispensar
                </Button>
              </div>
            ) : null}
          </Panel>

          {/* Segunda opinião: livro por comandos */}
          <Panel
            title="Segunda opinião — cálculo por comandos"
            hint="Aberturas executadas menos fechamentos executados, por magic. Serve para detectar comando expirado ou executado fora do previsto — não é a verdade da corretora."
          >
            {!positions.length ? (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-6 text-center text-sm font-semibold text-muted-foreground">
                Sem posição real aberta
              </p>
            ) : (
              <div className="space-y-2">
                {positions.map((p) => (
                  <div key={`${p.root}-${p.magic_number}`} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-base font-black tracking-tight">
                          {sideLabel(p.side)} {p.quantity}x {p.root}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {assetLabel(p.root)} · {VARIANT_LABEL[p.variant] ?? p.variant} · {apelidos.nick(p.mode)} ({apelidos.tech(p.mode)}) · magic {p.magic_number}
                          {p.broker_ticket ? ` · ticket ${p.broker_ticket}` : ""}
                        </p>
                      </div>
                      <p className={`text-2xl font-black ${money(p.unrealized_brl)}`}>
                        {p.unrealized_brl == null ? "—" : SIGNED_BRL(p.unrealized_brl)}
                      </p>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <div><dt className="text-muted-foreground">Entrada</dt><dd className="font-semibold">{PX(p.entry_price, p.tick_size)}</dd></div>
                      <div><dt className="text-muted-foreground">Preço atual</dt><dd className="font-semibold">{PX(p.live_price, p.tick_size)}</dd></div>
                      <div><dt className="text-muted-foreground">Aberta</dt><dd className="font-semibold">{openSinceText(p.entry_time) || "—"}</dd></div>
                      <div><dt className="text-muted-foreground">Pontos</dt><dd className="font-semibold">{p.unrealized_pts == null ? "—" : p.unrealized_pts.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</dd></div>
                    </dl>
                    {p.quote_age_s != null && p.quote_age_s > 30 ? (
                      <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-300">
                        <Clock className="size-3" /> cotação de {p.root} parada há {p.quote_age_s}s — resultado pode estar defasado
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Ordens reais do dia */}
          <Panel title={`Ordens reais de hoje (${orders.length})`} hint="O que o executor mandou para a corretora, com preço executado e ticket da XP.">
            {!orders.length ? (
              <p className="text-xs text-muted-foreground">Nenhum comando real hoje.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-1 text-left">Hora</th>
                      <th className="py-1 text-left">Ação</th>
                      <th className="py-1 text-left">Lado</th>
                      <th className="py-1 text-right">Qtd</th>
                      <th className="py-1 text-left">Ativo</th>
                      <th className="py-1 text-left">Robô</th>
                      <th className="py-1 text-right">Magic</th>
                      <th className="py-1 text-right">Preço exec.</th>
                      <th className="py-1 text-left">Ticket</th>
                      <th className="py-1 text-left">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-b border-border/50 align-top">
                        <td className="py-1 font-mono">{hhmmss(o.at)}</td>
                        <td className="py-1">{o.action === "open" ? "abertura" : o.action === "close" ? "fechamento" : o.action}</td>
                        <td className={`py-1 font-semibold ${o.side === "buy" ? "text-emerald-300" : "text-rose-300"}`}>{sideLabel(o.side)}</td>
                        <td className="py-1 text-right">{o.quantity}</td>
                        <td className="py-1">{o.symbol}</td>
                        <td className="py-1 text-muted-foreground">{VARIANT_LABEL[o.variant] ?? o.variant} · {apelidos.nick(o.mode)}</td>
                        <td className="py-1 text-right font-mono">{o.magic_number || "—"}</td>
                        <td className="py-1 text-right font-mono font-semibold">{o.filled_price == null ? "—" : PX(o.filled_price, o.tick_size)}</td>
                        <td className="py-1 font-mono">{o.broker_ticket ?? "—"}</td>
                        <td className={`py-1 ${statusCls(o.status)}`}>
                          {STATUS_LABEL[o.status] ?? o.status}
                          {o.error_message ? <span className="block max-w-[240px] break-words text-[10px] opacity-80">{o.error_message}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Robôs */}
          <Panel
            title={`Robôs de conta real (${d?.enabled_count ?? 0} ligado(s))`}
            hint="A lista branca ROBOS_REAIS vive na máquina do executor e é o teto: esta tela pode desligar, nunca autorizar. A coluna do executor é evidência do que ele aceitou ou recusou."
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                Mostrando {robots.length} de {allRobots.length} autorização(ões) cadastrada(s).
              </p>
              <Button size="sm" variant="outline" onClick={() => setShowAllRobots((v) => !v)}>
                {showAllRobots ? "Só os relevantes" : "Mostrar todas"}
              </Button>
            </div>
            {!robots.length ? (
              <p className="text-xs text-muted-foreground">Nenhuma autorização real ligada nem com rastro no executor.</p>
            ) : (

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-1 text-left">Robô</th>
                      <th className="py-1 text-right">Magic</th>
                      <th className="py-1 text-left">Autorização</th>
                      <th className="py-1 text-right">Qtd máx.</th>
                      <th className="py-1 text-left">Executor</th>
                      <th className="py-1 text-right">Realizado hoje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {robots.map((r) => (
                      <tr key={`${r.symbol}-${r.variant}-${r.mode}`} className="border-b border-border/50">
                        <td className="py-1">
                          <span className="font-semibold">{r.symbol}</span>{" "}
                          <span className="text-muted-foreground">{VARIANT_LABEL[r.variant] ?? r.variant} · {apelidos.nick(r.mode)}</span>
                          {r.has_open_position ? <span className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] text-amber-200">posicionado</span> : null}
                        </td>
                        <td className="py-1 text-right font-mono">{r.magic_number ?? "—"}</td>
                        <td className={`py-1 font-semibold ${r.enabled ? "text-emerald-300" : "text-muted-foreground"}`}>
                          {r.enabled ? "ligada" : "desligada"}
                        </td>
                        <td className="py-1 text-right">{r.max_qty}</td>
                        <td className="py-1">
                          {r.executor_status === "confirmado" ? <span className="text-emerald-300">confirmou execução</span>
                            : r.executor_status === "recusado" ? <span className="text-rose-300">fora da lista branca</span>
                              : <span className="text-muted-foreground">sem evidência</span>}
                        </td>
                        <td className={`py-1 text-right font-semibold ${money(r.realized_brl)}`}>
                          {SIGNED_BRL(r.realized_brl ?? 0)} <span className="text-[10px] text-muted-foreground">({r.trades_count})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {/* Coluna de ações e avisos */}
        <div className="space-y-3">
          <Panel
            title="Ações sobre dinheiro real"
            hint="Nenhuma destas ações pausa a simulação. Desligar não pede senha; religar pede a senha mestra."
          >
            <div className="space-y-2">
              {realEnabled ? (
                <Button
                  size="lg"
                  className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal bg-amber-500 py-2 text-black hover:bg-amber-400"
                  onClick={() => setConfirmStop(true)}
                  disabled={mStop.isPending}
                >
                  <Hand className="size-5 shrink-0" />
                  <span className="min-w-0 text-left">
                    <span className="block text-sm font-black">Parar novas entradas reais</span>
                    <span className="block text-[11px] font-medium opacity-80">
                      Bloqueia imediatamente qualquer ordem de abertura real e desliga as autorizações. Sem senha. A posição aberta continua sendo gerida.
                    </span>
                  </span>
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal bg-emerald-600 py-2 text-white hover:bg-emerald-500"
                  onClick={() => setResumeOpen(true)}
                  disabled={mResume.isPending}
                >
                  <Play className="size-5 shrink-0" />
                  <span className="min-w-0 text-left">
                    <span className="block text-sm font-black">Liberar entradas reais</span>
                    <span className="block text-[11px] font-medium opacity-90">
                      Pede a senha mestra. Libera só o estado — nenhum robô é ligado automaticamente.
                    </span>
                  </span>
                </Button>
              )}

              <Button
                size="lg"
                variant="destructive"
                className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal py-2"
                onClick={() => setConfirmClose(true)}
                disabled={!positions.length || mClose.isPending}
              >
                <XOctagon className="size-5 shrink-0" />
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-black">Zerar posição real agora</span>
                  <span className="block text-[11px] font-medium opacity-90">
                    {positions.length
                      ? "Envia fechamento a mercado da ponta contrária e desliga as autorizações. Pede confirmação."
                      : "sem posição real para zerar"}
                  </span>
                </span>
              </Button>

              <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
                <ShieldOff className="mt-0.5 size-3 shrink-0" />
                {d?.enabled_count ?? 0} autorização(ões) de conta real ligada(s) agora. Para religar robô por robô, use Autorizações Reais.
              </p>
            </div>
          </Panel>

          <Panel title="Avisos da última hora" hint="Só o que aconteceu de fato. O aviso desaparece quando a condição deixa de existir.">
            {!alerts.length ? (
              <p className="text-xs text-muted-foreground">Nada anormal na última hora.</p>
            ) : (
              <ul className="space-y-2">
                {alerts.map((a, i) => (
                  <li
                    key={i}
                    className={`rounded-lg border p-2 text-[11px] ${a.severity === "critical" ? "border-rose-500/40 bg-rose-500/10 text-rose-100" : "border-amber-500/40 bg-amber-500/10 text-amber-100"}`}
                  >
                    <p className="font-bold uppercase tracking-wide">{a.title}</p>
                    {a.detail ? <p className="mt-0.5 break-words opacity-90">{a.detail}</p> : null}
                    {a.at ? <p className="mt-0.5 opacity-70">{hhmm(a.at)}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* Confirmação: fechar UMA posição reportada pela corretora */}
      <AlertDialog open={!!closeTarget} onOpenChange={(o) => { if (!o) setCloseTarget(null); }}>
        <AlertDialogContent className="max-w-[95vw] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar esta posição real a mercado?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <dl className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-2 text-sm">
                  <div><dt className="text-[10px] uppercase text-muted-foreground">Ativo</dt><dd className="font-black">{closeTarget?.symbol ?? "—"}</dd></div>
                  <div><dt className="text-[10px] uppercase text-muted-foreground">Lado aberto</dt><dd className="font-black">{sideLabel(closeTarget?.side)}</dd></div>
                  <div><dt className="text-[10px] uppercase text-muted-foreground">Quantidade</dt><dd className="font-black">{closeTarget?.quantity ?? "—"}</dd></div>
                  <div><dt className="text-[10px] uppercase text-muted-foreground">Preço corrente</dt><dd className="font-black">{PX(closeTarget?.price_current, closeTarget?.tick_size ?? 5)}</dd></div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  Entra um comando <b>close</b> a mercado na fila (validade 2 min). Quem executa é o executor,
                  que fala com o MT5. Isto NÃO desliga autorizações e NÃO pausa a simulação.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-500"
              onClick={(e) => { e.preventDefault(); if (closeTarget) mCloseOne.mutate(closeTarget); }}
              disabled={mCloseOne.isPending}
            >
              {mCloseOne.isPending ? "Enfileirando…" : "Fechar agora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação: parar */}
      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent className="max-w-[95vw] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Parar novas entradas reais?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left text-sm">
                <p className="font-semibold text-foreground">O que acontece agora:</p>
                <ul className="list-disc pl-4 text-xs text-muted-foreground">
                  <li>o executor deixa de receber ordens de abertura real no próximo ciclo (2s);</li>
                  <li>as autorizações de conta real são desligadas;</li>
                  <li>fechamentos continuam sendo entregues — a posição aberta segue gerida;</li>
                  <li>a simulação NÃO é afetada.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 text-black hover:bg-amber-400"
              onClick={(e) => { e.preventDefault(); mStop.mutate(); }}
              disabled={mStop.isPending}
            >
              {mStop.isPending ? "Parando…" : "Parar o real"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação: religar com senha */}
      <AlertDialog open={resumeOpen} onOpenChange={(o) => { setResumeOpen(o); if (!o) setPassword(""); }}>
        <AlertDialogContent className="max-w-[95vw] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Liberar entradas reais?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p className="text-xs text-muted-foreground">
                  Libera apenas o estado do real. Nenhum robô é ligado automaticamente e a lista branca do executor
                  continua sendo o teto. Exige a senha mestra.
                </p>
                <Input
                  type="password"
                  autoFocus
                  placeholder="senha mestra"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={(e) => { e.preventDefault(); mResume.mutate(); }}
              disabled={!password || mResume.isPending}
            >
              {mResume.isPending ? "Liberando…" : "Liberar o real"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação: zerar */}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent className="max-w-[95vw] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Zerar posição real agora?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                {positions.map((p) => (
                  <p key={`${p.root}-${p.magic_number}`} className="text-sm font-semibold text-foreground">
                    {sideLabel(p.side === "buy" ? "sell" : "buy")} {p.quantity}x {p.root} a mercado, resultado atual{" "}
                    <span className={money(p.unrealized_brl)}>{p.unrealized_brl == null ? "—" : SIGNED_BRL(p.unrealized_brl)}</span>
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">
                  Em seguida o real é parado e as autorizações de conta real são desligadas. A simulação não é afetada.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); mClose.mutate(); }}
              disabled={mClose.isPending}
            >
              {mClose.isPending ? "Enviando…" : "Zerar agora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
