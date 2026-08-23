// Cockpit Real — feita para celular. Somente leitura + os dois botões de
// parada (parar novas entradas / zerar posição). Nada aqui toca no motor de
// simulação, no comitê ou nos classificadores de setup.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, CircleSlash, Clock, Hand, RefreshCw, ShieldOff, XOctagon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useVisibleRefetchInterval } from "@/hooks/use-visible-refetch-interval";
import { BRL, SIGNED_BRL, PX, openSinceText, assetLabel } from "@/lib/b3-format";
import { getB3RealCockpit, stopRealNewEntries, closeRealPositionNow } from "@/lib/b3-real-cockpit.functions";

export const Route = createFileRoute("/_authenticated/cockpit-real")({
  head: () => ({
    meta: [
      { title: "Cockpit Real — dinheiro real no celular — AleTrader AI" },
      { name: "description", content: "Estado do executor real, posição aberta, resultado do dia e parada de emergência da operação com dinheiro real." },
      { property: "og:title", content: "Cockpit Real — AleTrader AI" },
      { property: "og:description", content: "Acompanhe a operação real pelo celular: estado, posição aberta, resultado do dia e parada de emergência." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CockpitRealPage,
});

const PCT = (v: number | null | undefined) =>
  v == null ? "—" : `${Number(v) > 0 ? "+" : ""}${(Number(v) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const money = (v: number) => (Number(v ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300");
const sideLabel = (s: string) => (s === "buy" ? "COMPRA" : "VENDA");
const hhmm = (iso: string | null | undefined) =>
  !iso ? "—" : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const modeLabel = (m: string) => String(m ?? "").replace("_", "-");
const VARIANT_LABEL: Record<string, string> = {
  indicador: "indicador", price_action: "price action",
  mean_reversion: "reversão à média", range: "faixa",
};

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

function Panel({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function CockpitRealPage() {
  const qc = useQueryClient();
  const load = useServerFn(getB3RealCockpit);
  const stopEntries = useServerFn(stopRealNewEntries);
  const closeNow = useServerFn(closeRealPositionNow);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refetchInterval = useVisibleRefetchInterval(15_000);
  const q = useQuery({
    queryKey: ["cockpit-real"],
    queryFn: () => load({ data: undefined as never }),
    refetchInterval,
    refetchIntervalInBackground: false,
  });
  const d = q.data as any;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cockpit-real"] });

  const mStop = useMutation({
    mutationFn: () => stopEntries({ data: {} }),
    onSuccess: (r: any) => {
      invalidate();
      toast.success(`Novas entradas reais desligadas (${r?.disabled ?? 0} autorizações). A simulação segue igual.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao desligar as autorizações reais."),
  });
  const mClose = useMutation({
    mutationFn: () => closeNow({ data: { confirm: true as const } }),
    onSuccess: (r: any) => {
      invalidate();
      setConfirmOpen(false);
      if (r?.ok) toast.success(`Zeragem enviada: ${r.queued} comando(s) a mercado. Autorizações desligadas.`);
      else toast.warning(r?.reason ?? "Nenhuma posição real aberta.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao enfileirar a zeragem."),
  });

  const positions = (d?.positions ?? []) as any[];
  const pos = positions[0] ?? null;
  const st = STATE_UI[d?.executor?.state ?? "sem_comando"] ?? STATE_UI["sem_comando"]!;
  const totalOpen = positions.reduce((a, p) => a + (p.unrealized_brl ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-xl px-3 pb-24 pt-3 sm:px-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-black tracking-tight">Cockpit Real</h1>
          <p className="text-[11px] text-muted-foreground">
            Atualiza sozinho a cada 15s · {d?.server_time ? `dados de ${hhmm(d.server_time)}` : "carregando…"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="outline" onClick={() => q.refetch()} aria-label="Atualizar">
            <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="icon" variant="outline" asChild aria-label="Cockpit de simulação">
            <Link to="/b3-cockpit"><ArrowLeft className="size-4" /></Link>
          </Button>
        </div>
      </header>

      {/* 1. Estado — primeira coisa visível */}
      <div className={`mt-3 rounded-xl border-2 px-3 py-3 ${st.cls}`}>
        <div className="flex items-center gap-2">
          <st.Icon className="size-6 shrink-0" />
          <p className="text-base font-black leading-tight tracking-tight">{st.label}</p>
        </div>
        <p className="mt-1 text-[11px] leading-snug opacity-95">{st.sub}</p>
        <p className="mt-1 text-[11px] font-medium opacity-95">
          Último comando: {d?.executor?.last_command_at ? `${hhmm(d.executor.last_command_at)} (há ${Math.max(0, Math.round((d.executor.last_command_age_s ?? 0) / 60))} min)` : "nenhum registrado"}
          {d?.executor?.last_command
            ? ` · ${d.executor.last_command.action === "open" ? "abertura" : "fechamento"} ${d.executor.last_command.symbol} · ${d.executor.last_command.status}`
            : ""}
        </p>
        {d?.executor?.last_command?.error_message
          ? <p className="mt-1 break-words text-[11px] opacity-90">Resposta do executor: {d.executor.last_command.error_message}</p>
          : null}
      </div>

      {q.isError ? (
        <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          Falha ao ler os dados reais: {(q.error as any)?.message ?? "erro desconhecido"}
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {/* 2. Posição real aberta */}
        <Panel title="Posição real aberta">
          {!pos ? (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-4 text-center text-sm font-semibold text-muted-foreground">
              Sem posição aberta
            </p>
          ) : (
            positions.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-black tracking-tight">
                      {sideLabel(p.side)} {p.quantity}x {p.root}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {assetLabel(p.root)} · {VARIANT_LABEL[p.variant] ?? p.variant} · {modeLabel(p.mode)} · magic {p.magic_number}
                    </p>
                  </div>
                  <p className={`shrink-0 text-lg font-black ${money(p.unrealized_brl ?? 0)}`}>
                    {p.unrealized_brl == null ? "—" : SIGNED_BRL(p.unrealized_brl)}
                  </p>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-muted-foreground">Entrada</dt><dd className="font-semibold">{PX(p.entry_price, p.tick_size)}</dd></div>
                  <div><dt className="text-muted-foreground">Preço atual</dt><dd className="font-semibold">{PX(p.live_price, p.tick_size)}</dd></div>
                  <div><dt className="text-muted-foreground">Aberta</dt><dd className="font-semibold">{openSinceText(p.entry_time) || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Resultado em pontos</dt><dd className="font-semibold">{p.unrealized_pts == null ? "—" : p.unrealized_pts.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</dd></div>
                </dl>
                {p.quote_age_s != null && p.quote_age_s > 30 ? (
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-300">
                    <Clock className="size-3" /> cotação de {p.root} parada há {p.quote_age_s}s — resultado pode estar defasado
                  </p>
                ) : null}
              </div>
            ))
          )}
        </Panel>

        {/* 3. Resultado real de hoje */}
        <Panel
          title="Resultado real de hoje"
          hint={d?.today?.capital_brl ? `Percentual sobre o capital disponível de ${BRL(d.today.capital_brl)}.` : "Capital disponível não configurado — sem percentual."}
        >
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { k: "Realizado", brl: d?.today?.realized_brl ?? 0, pct: d?.today?.realized_pct },
              { k: "Em aberto", brl: d?.today?.unrealized_brl ?? totalOpen, pct: d?.today?.unrealized_pct },
              { k: "Total", brl: d?.today?.total_brl ?? 0, pct: d?.today?.total_pct },
            ].map((c) => (
              <div key={c.k} className="rounded-lg border border-border bg-muted/20 px-1 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.k}</p>
                <p className={`text-sm font-black leading-tight ${money(c.brl)}`}>{SIGNED_BRL(c.brl)}</p>
                <p className={`text-[11px] ${money(c.brl)}`}>{PCT(c.pct)}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {d?.today?.closed_count ?? 0} operação(ões) real(is) encerrada(s) hoje.
          </p>
        </Panel>

        {/* 4. Os dois botões */}
        <Panel
          title="Parar"
          hint="Nenhum dos dois botões toca na simulação. Os robôs simulados continuam operando normalmente."
        >
          <div className="space-y-2">
            <Button
              size="lg"
              className="h-14 w-full justify-start gap-3 bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => mStop.mutate()}
              disabled={mStop.isPending}
            >
              <Hand className="size-5 shrink-0" />
              <span className="min-w-0 text-left">
                <span className="block text-sm font-black">Parar novas entradas</span>
                <span className="block text-[11px] font-medium opacity-80">
                  Sem senha. A posição aberta continua sendo gerida: stop, alvo e zeragem seguem valendo.
                </span>
              </span>
            </Button>

            <Button
              size="lg"
              variant="destructive"
              className="h-14 w-full justify-start gap-3"
              onClick={() => setConfirmOpen(true)}
              disabled={!pos || mClose.isPending}
            >
              <XOctagon className="size-5 shrink-0" />
              <span className="min-w-0 text-left">
                <span className="block text-sm font-black">Zerar posição agora</span>
                <span className="block text-[11px] font-medium opacity-90">
                  {pos
                    ? "Fecha a mercado e desliga as autorizações reais. Pede confirmação."
                    : "sem posição para zerar"}
                </span>
              </span>
            </Button>

            <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
              <ShieldOff className="mt-0.5 size-3 shrink-0" />
              {d?.enabled_count ?? 0} autorização(ões) de conta real ligada(s) agora.
            </p>
          </div>
        </Panel>

        {/* 5. Espelhamento real x simulado */}
        <Panel
          title="Espelhamento — real contra o gêmeo simulado"
          hint="O resultado em reais NÃO vai bater, e isso é esperado: o real opera a quantidade do max_qty da autorização e o simulado opera a quantidade cheia do modo. O que precisa bater é minuto, lado e preço."
        >
          {!(d?.mirror ?? []).length ? (
            <p className="text-xs text-muted-foreground">Nenhum robô com autorização real ligada.</p>
          ) : (
            <div className="space-y-3">
              {(d.mirror as any[]).map((m) => (
                <div key={`${m.symbol}-${m.variant}-${m.mode}`} className="rounded-lg border border-border p-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <p className="truncate text-xs font-bold">
                      {m.symbol} · {VARIANT_LABEL[m.variant] ?? m.variant} · {modeLabel(m.mode)}
                    </p>
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      real {m.max_qty}x
                    </span>
                  </div>
                  {!m.pairs.length && !m.orphan_sim.length ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">Nenhuma operação hoje, real nem simulada.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {m.pairs.map((p: any, i: number) => (
                        <div key={i} className="rounded border border-border/60 bg-muted/20 p-2 text-[11px]">
                          <p className="font-semibold">
                            REAL {p.real.entry_minute} · {sideLabel(p.real.side)} {p.real.quantity}x @ {PX(p.real.entry_price, m.tick_size)}
                          </p>
                          <p className={p.sim ? "" : "text-amber-300"}>
                            {p.sim
                              ? `SIM ${p.sim.entry_minute} · ${sideLabel(p.sim.side)} ${p.sim.quantity}x @ ${PX(p.sim.entry_price, m.tick_size)}`
                              : "SIM — nenhuma operação simulada equivalente encontrada"}
                          </p>
                          {p.sim ? (
                            <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                              <span className={p.same_minute ? "text-emerald-300" : "text-amber-300"}>
                                minuto {p.same_minute ? "igual" : `${p.minute_diff_s}s de diferença`}
                              </span>
                              <span className={p.same_side ? "text-emerald-300" : "text-rose-300"}>
                                lado {p.same_side ? "igual" : "DIFERENTE"}
                              </span>
                              <span className={Math.abs(Number(p.price_diff_pts ?? 0)) <= m.tick_size * 2 ? "text-emerald-300" : "text-amber-300"}>
                                preço {p.price_diff_pts == null ? "—" : `${p.price_diff_pts > 0 ? "+" : ""}${p.price_diff_pts}`}
                              </span>
                            </p>
                          ) : null}
                        </div>
                      ))}
                      {m.orphan_sim.map((s: any, i: number) => (
                        <div key={`o${i}`} className="rounded border border-border/60 p-2 text-[11px] text-muted-foreground">
                          SIM {s.entry_minute} · {sideLabel(s.side)} {s.quantity}x @ {PX(s.entry_price, m.tick_size)} — sem par real
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Realizado hoje: real {SIGNED_BRL(m.real_brl)} · simulado {SIGNED_BRL(m.sim_brl)} (quantidades diferentes, divergência esperada)
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* 6. Avisos da última hora */}
        <Panel title="Avisos da última hora" hint="Só o que aconteceu de fato. O aviso desaparece quando a condição deixa de existir.">
          {!(d?.alerts ?? []).length ? (
            <p className="text-xs text-muted-foreground">Nada anormal na última hora.</p>
          ) : (
            <ul className="space-y-2">
              {(d.alerts as any[]).map((a, i) => (
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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[95vw] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Zerar posição real agora?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                {positions.map((p) => (
                  <p key={p.id} className="text-sm font-semibold text-foreground">
                    {sideLabel(p.side === "buy" ? "sell" : "buy")} {p.quantity}x {p.root} a mercado, resultado atual{" "}
                    <span className={money(p.unrealized_brl ?? 0)}>{p.unrealized_brl == null ? "—" : SIGNED_BRL(p.unrealized_brl)}</span>
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">
                  Em seguida as autorizações de conta real são desligadas. A simulação não é afetada.
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
