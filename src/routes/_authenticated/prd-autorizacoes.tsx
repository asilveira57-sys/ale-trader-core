import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  listPrdAuthorizations, setPrdAuthorization, revokeAllPrdAuthorizations,
  openPrdEditSession, updatePrdAuthorizationParams,
} from "@/lib/prd-authorization.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { rootSymbol } from "@/lib/b3-format";
import { computeGlobalRealStop, brlFromMult, STOPS_POR_DIA } from "@/lib/b3-real-sizing";
import { useModeApelidos } from "@/hooks/use-mode-apelidos";
import { ModeName } from "@/components/b3/ModeName";
import { ShieldAlert, AlertTriangle, Lock, Unlock, Save, PencilLine } from "lucide-react";


type SizingRow = {
  symbol: string; variant: string; mode: string; enabled: boolean;
  max_qty: number; point_value_brl: number; stop_pts: number; sim_max_contracts: number;
  manual_daily_loss_brl: number | null; manual_daily_loss_mult: number | null;
  one_stop_brl: number; max_mult: number; three_stops_brl: number;
  effective_daily_loss_brl: number; limite_origem: "manual" | "tres_stops";
  real_brl: { daily_loss_limit_brl: number | null; daily_gain_target_brl: number | null; peak_lock_min_profit_brl: number | null; escala: number };
};
const toGlobalRobot = (s: SizingRow) => ({
  symbol: s.symbol, variant: s.variant, mode: s.mode,
  enabled: s.enabled, max_qty: s.max_qty, stop_pts: s.stop_pts, point_value_brl: s.point_value_brl,
  // O global soma o limite EFETIVO (o mesmo da coluna "Trava em").
  manual_daily_loss_brl: s.manual_daily_loss_brl,
});
const mult = (v: number | null | undefined) =>
  v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
const brl = (v: number | null | undefined) =>
  v == null ? "—" : `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


export const Route = createFileRoute("/_authenticated/prd-autorizacoes")({
  head: () => ({
    meta: [
      { title: "Autorizações de Conta Real — AleTrader AI" },
      { name: "description", content: "Portão de autorização por ativo e modo para execução em conta real B3." },
      { property: "og:title", content: "Autorizações de Conta Real — AleTrader AI" },
      { property: "og:description", content: "Portão de autorização por ativo e modo para execução em conta real B3." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Atalho vindo do cockpit: ?symbol=&variant=&mode= apenas FILTRA e destaca.
  // Nada é autorizado por URL.
  validateSearch: (search: Record<string, unknown>): { symbol?: string; variant?: string; mode?: string } => ({
    symbol: typeof search.symbol === "string" ? search.symbol : undefined,
    variant: typeof search.variant === "string" ? search.variant : undefined,
    mode: typeof search.mode === "string" ? search.mode : undefined,
  }),
  component: PrdAuthorizationsPage,
});

type Row = {
  id: string; symbol: string; variant: string; mode: string; enabled: boolean;
  max_qty: number; max_daily_loss_brl: number; max_daily_loss_mult: number | null;
  magic_number: number | null;
  authorized_at: string | null; authorized_by: string | null;
};


// MODE_LABEL removido (30/08/2026): o rótulo do modo vem de
// public.b3_mode_apelidos via useModeApelidos. Rótulo duplicado em TypeScript
// diverge do banco com o tempo — mesma lição da colisão de magics 2002..2005.

const VARIANT_LABEL: Record<string, string> = {
  indicador: "Indicador", price_action: "Price Action",
  mean_reversion: "Reversão à média", range: "Range", rompimento: "Rompimento",
  pullback: "Repique", vwap: "VWAP",
};

function PrdAuthorizationsPage() {
  const focus = Route.useSearch();
  const apelidos = useModeApelidos();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listPrdAuthorizations);
  const setAuth = useServerFn(setPrdAuthorization);
  const revokeAll = useServerFn(revokeAllPrdAuthorizations);
  const openSession = useServerFn(openPrdEditSession);
  const updateParams = useServerFn(updatePrdAuthorizationParams);

  const { data, isLoading } = useQuery({ queryKey: ["prd-auth"], queryFn: () => list({}) });

  const [target, setTarget] = useState<Row | null>(null);
  const [password, setPassword] = useState("");
  const [qty, setQty] = useState(1);
  const [lossMult, setLossMult] = useState(2.5);
  const [killStep, setKillStep] = useState<0 | 1 | 2>(0);
  const [killPassword, setKillPassword] = useState("");

  // Sessão de edição de PARÂMETRO (15 min). Só em memória: recarregar ou
  // fechar a aba encerra. Ligar/desligar o real continua pedindo senha.
  const [session, setSession] = useState<{ id: string; token: string; expiresAt: number } | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Rascunho da linha em edição: chave `${symbol}||${variant}||${mode}`.
  const [draft, setDraft] = useState<Record<string, { qty: number; mult: number }>>({});

  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session]);
  useEffect(() => {
    if (session && now >= session.expiresAt) {
      setSession(null); setDraft({});
      toast.info("Sessão de edição expirada — os campos voltaram a ficar travados.");
    }
  }, [session, now]);
  const sessionActive = !!session && now < session.expiresAt;
  const restante = sessionActive ? Math.max(0, session!.expiresAt - now) : 0;
  const restanteLabel = `${String(Math.floor(restante / 60000)).padStart(2, "0")}:${String(Math.floor((restante % 60000) / 1000)).padStart(2, "0")}`;

  const mUnlock = useMutation({
    mutationFn: () => openSession({ data: { password: unlockPassword } }),
    onSuccess: (r: { session_id: string; token: string; expires_at: string }) => {
      setSession({ id: r.session_id, token: r.token, expiresAt: new Date(r.expires_at).getTime() });
      setNow(Date.now());
      setUnlockOpen(false); setUnlockPassword("");
      toast.success("Edição liberada por 15 minutos");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mParams = useMutation({
    mutationFn: (p: { row: Row; max_qty: number; max_daily_loss_mult: number }) =>
      updateParams({
        data: {
          symbol: p.row.symbol as never, variant: (p.row.variant ?? "indicador") as never,
          mode: p.row.mode as never, max_qty: p.max_qty,
          max_daily_loss_mult: p.max_daily_loss_mult, session_token: session?.token ?? "",
        },
      }),
    onSuccess: (_r, p) => {
      toast.success(`${p.row.symbol} · ${p.row.mode}: quantidade ${p.max_qty} contrato(s) — vale da próxima entrada`);
      setDraft((d) => {
        const c = { ...d };
        delete c[`${p.row.symbol}||${p.row.variant ?? "indicador"}||${p.row.mode}`];
        return c;
      });
      qc.invalidateQueries({ queryKey: ["prd-auth"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });



  const mSet = useMutation({
    mutationFn: (p: { row: Row; enabled: boolean; password: string; max_qty: number; max_daily_loss_mult: number }) =>
      setAuth({
        data: {
          symbol: p.row.symbol as never, variant: (p.row.variant ?? "indicador") as never,
          mode: p.row.mode as never,
          enabled: p.enabled, max_qty: p.max_qty,
          max_daily_loss_mult: p.max_daily_loss_mult, password: p.password,
        },
      }),
    onSuccess: () => {
      toast.success("Autorização atualizada");
      setTarget(null); setPassword("");
      qc.invalidateQueries({ queryKey: ["prd-auth"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mKill = useMutation({
    mutationFn: () => revokeAll({ data: { password: killPassword } }),
    onSuccess: (r: { revoked: number }) => {
      toast.success(`${r.revoked} autorização(ões) desligada(s)`);
      setKillStep(0); setKillPassword("");
      qc.invalidateQueries({ queryKey: ["prd-auth"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando autorizações…</div>;

  const allRows = (data.authorizations ?? []) as Row[];
  const sizing = ((data as any).sizing ?? []) as SizingRow[];
  const stopGlobal = computeGlobalRealStop(sizing.map(toGlobalRobot)).total_brl;
  // Cenário "todos a 2 contratos": o multiplicador é adimensional, então o
  // limite manual acompanha o tamanho (e o teto de 3 stops também).
  const stopGlobal2 = computeGlobalRealStop(
    sizing.map((s) => ({
      ...toGlobalRobot(s),
      max_qty: 2,
      manual_daily_loss_brl: s.manual_daily_loss_mult == null
        ? s.manual_daily_loss_brl
        : brlFromMult(s.manual_daily_loss_mult, s.stop_pts, s.point_value_brl, 2),
    })),
  ).total_brl;
  const saldo = (data as any).capital_liquido_brl ?? (data as any).saldo_brl ?? null;
  const pctSaldo = saldo && saldo > 0 ? (stopGlobal / saldo) * 100 : null;
  const sizingFor = (r: Row) =>
    sizing.find((s) => s.symbol === rootSymbol(r.symbol) && s.variant === (r.variant ?? "indicador") && s.mode === r.mode);
  const focused = !!(focus.symbol || focus.variant || focus.mode);
  const rows = allRows.filter((r) =>
    (!focus.symbol || r.symbol === focus.symbol)
    && (!focus.variant || (r.variant ?? "indicador") === focus.variant)
    && (!focus.mode || r.mode === focus.mode));
  // Agrupa por ativo + modalidade: o par autorizado é (ativo, modalidade, modo).
  const grouped = rows.reduce<Record<string, Row[]>>((acc, r) => {
    (acc[`${r.symbol}||${r.variant ?? "indicador"}`] ??= []).push(r);
    return acc;
  }, {});
  const enabledCount = data.enabled_count ?? 0;


  function openDialog(row: Row, enabling: boolean) {
    setTarget({ ...row, enabled: enabling });
    setQty(Number(row.max_qty ?? 1));
    // Multiplicador guardado; linha antiga cai no derivado do sizing.
    const s0 = sizingFor(row);
    setLossMult(Number(row.max_daily_loss_mult ?? s0?.manual_daily_loss_mult ?? 2.5));
    setPassword("");
  }

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldAlert className="size-6 text-orange-500" /> Autorizações de Conta Real
          </h1>
          <p className="text-sm text-muted-foreground">
            Nega por padrão: nenhum comando real é enfileirado sem autorização explícita por ativo e modo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`panel px-4 py-2 text-sm ${enabledCount > 0 ? "border-orange-500/50 bg-orange-500/10 text-orange-300" : "text-muted-foreground"}`}>
            <span className="font-mono text-lg font-semibold">{enabledCount}</span> / {allRows.length} pares ligados
          </div>
          {sessionActive ? (
            <div className="flex items-center gap-2">
              <div className="panel px-3 py-2 text-sm border-emerald-500/50 bg-emerald-500/10 text-emerald-300">
                <PencilLine className="size-4 inline mr-1" /> Edição liberada · <span className="font-mono">{restanteLabel}</span>
              </div>
              <Button variant="outline" onClick={() => { setSession(null); setDraft({}); toast.success("Edição travada"); }}>
                <Lock className="size-4 mr-1" /> Travar agora
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setUnlockOpen(true)}>
              <PencilLine className="size-4 mr-1" /> Destravar edição
            </Button>
          )}
          <Button variant="destructive" onClick={() => setKillStep(1)}>
            <AlertTriangle className="size-4 mr-1" /> Desligar tudo
          </Button>
        </div>

      </header>

      {focused && (
        <div className="panel p-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Filtrado pelo robô do cockpit:</span>
          <Badge variant="outline" className="font-mono">
            {[focus.symbol, focus.variant && (VARIANT_LABEL[focus.variant] ?? focus.variant), focus.mode && apelidos.nick(focus.mode)]
              .filter(Boolean).join(" · ")}
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => navigate({ to: "/prd-autorizacoes", search: {} })}>
            Ver todos os pares
          </Button>
        </div>
      )}

      <div className="panel p-4 border-orange-500/40 bg-orange-500/10 text-sm text-orange-200 space-y-1">
        <p className="font-medium flex items-center gap-2"><AlertTriangle className="size-4" /> Isto controla envio de ordem com DINHEIRO REAL.</p>
        <p className="text-orange-200/80">
          Ao ligar um par ativo+modo, o motor passa a enfileirar comandos reais para aquele robô. As flags{" "}
          <code className="font-mono">DRY_RUN</code> e <code className="font-mono">REAL_TRADING_CONFIRMED</code> do executor
          Python continuam sendo a barreira final — enquanto elas estiverem em modo seguro, nenhum comando vira ordem executada.
        </p>
      </div>

      {/* Stop global DERIVADO — nunca digitado. Soma de 3 × stop_pts × valor do
          ponto × max_qty dos robôs ligados. Muda sozinho ao ligar/desligar
          robô ou alterar a quantidade. */}
      <section className="panel p-5 space-y-3">
        <h2 className="font-medium">Stop global do dia (derivado)</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Stop global</div>
            <div className="font-mono text-2xl font-semibold text-orange-300">{brl(stopGlobal)}</div>
            <div className="text-xs text-muted-foreground">soma do limite que de fato trava cada robô ligado</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Saldo da conta</div>
            <div className="font-mono text-2xl font-semibold">{brl(saldo)}</div>
            <div className="text-xs text-muted-foreground">
              {(data as any).estado_reportado_em
                ? `reportado em ${new Date((data as any).estado_reportado_em).toLocaleString("pt-BR")}`
                : "sem relatório do executor"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Global / saldo</div>
            <div className="font-mono text-2xl font-semibold">{pctSaldo == null ? "—" : `${pctSaldo.toFixed(1)}%`}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Se todos fossem 2 contratos</div>
            <div className="font-mono text-2xl font-semibold text-muted-foreground">{brl(stopGlobal2)}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Ao alcançar o global, nenhum robô real abre nova posição — o simulado continua rodando normalmente.
          Por robô vale o MENOR entre o limite digitado e {STOPS_POR_DIA} stops no tamanho real — e o global é
          exatamente a soma da coluna “Trava em”.
        </p>
      </section>


      {Object.entries(grouped).map(([key, group]) => {
        const [symbol, variant] = key.split("||");
        // Ordenação pela coluna `ordem` da tabela de apelidos (1..8), não alfabética.
        const list = apelidos.sortModes(group, (r) => r.mode);
        return (
        <section key={key} className="panel p-5 space-y-3">
          <h2 className="font-medium flex items-center gap-2">
            {symbol}
            <Badge variant="outline">{VARIANT_LABEL[variant ?? ""] ?? variant}</Badge>
          </h2>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-2">Modo</th>
                <th className="text-left">Modalidade</th>
                <th className="text-left">Status</th>
                <th className="text-right">Qtd. máx.</th>
                <th className="text-right">Perda diária máx. (x stop)</th>
                <th className="text-right">3 stops (real)</th>
                <th className="text-right">Trava em</th>
                <th className="text-left pl-4">Autorizado em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const s = sizingFor(r);
                const dkey = `${r.symbol}||${r.variant ?? "indicador"}||${r.mode}`;
                const d = draft[dkey];
                const curQty = d?.qty ?? Number(r.max_qty ?? 1);
                const curMult = d?.mult ?? Number(r.max_daily_loss_mult ?? s?.manual_daily_loss_mult ?? 2.5);
                const dirty = !!d && (curQty !== Number(r.max_qty ?? 1) || curMult !== Number(r.max_daily_loss_mult ?? s?.manual_daily_loss_mult ?? 2.5));
                const abertoReal = Number(((data as any).posicao_aberta_por_magic ?? {})[String(r.magic_number ?? "")] ?? 0);
                const setD = (patch: { qty?: number; mult?: number }) =>
                  setDraft((prev) => ({ ...prev, [dkey]: { qty: patch.qty ?? curQty, mult: patch.mult ?? curMult } }));
                return (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="py-2"><ModeName mode={r.mode} api={apelidos} stacked /></td>
                  <td className="text-muted-foreground">{VARIANT_LABEL[r.variant] ?? r.variant}</td>
                  <td>
                    {r.enabled
                      ? <Badge className="bg-orange-500 text-white">LIBERADO</Badge>
                      : <Badge variant="secondary">bloqueado</Badge>}
                  </td>
                  <td className="text-right font-mono">
                    {sessionActive ? (
                      <Input type="number" min={1} max={100} value={curQty} aria-label={`Quantidade ${r.symbol} ${r.mode}`}
                        className="h-8 w-20 ml-auto text-right font-mono"
                        onChange={(e) => setD({ qty: Number(e.target.value) })} />
                    ) : r.max_qty}
                    {sessionActive && abertoReal > 0 ? (
                      <div className="text-[10px] text-amber-300 whitespace-nowrap">
                        {abertoReal} aberto(s) agora — fecha nesse tamanho
                      </div>
                    ) : null}
                  </td>
                  <td className="text-right font-mono">
                    {sessionActive ? (
                      <Input type="number" min={0} step={0.05} value={curMult} aria-label={`Perda diária ${r.symbol} ${r.mode}`}
                        className="h-8 w-24 ml-auto text-right font-mono"
                        onChange={(e) => setD({ mult: Number(e.target.value) })} />
                    ) : (
                      <>
                        {mult(r.max_daily_loss_mult ?? s?.manual_daily_loss_mult ?? null)}
                        <span className="ml-1 text-[10px] text-muted-foreground">{brl(r.max_daily_loss_brl)}</span>
                      </>
                    )}
                  </td>
                  <td className="text-right font-mono text-muted-foreground">
                    {s ? brl(s.three_stops_brl) : "—"}
                    {s ? <span className="ml-1 text-[10px]">({s.stop_pts} pts × {s.max_qty})</span> : null}
                  </td>
                  <td className="text-right font-mono">
                    {s ? brl(s.effective_daily_loss_brl) : "—"}
                    {s ? <span className="ml-1 text-[10px] text-muted-foreground">{s.limite_origem === "manual" ? "manual" : "3 stops"}</span> : null}
                  </td>
                  <td className="pl-4 text-muted-foreground">
                    {r.authorized_at ? new Date(r.authorized_at).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {sessionActive && dirty ? (
                      <Button size="sm" className="mr-2" disabled={mParams.isPending}
                        onClick={() => mParams.mutate({ row: r, max_qty: curQty, max_daily_loss_mult: curMult })}>
                        <Save className="size-3.5 mr-1" /> Salvar
                      </Button>
                    ) : null}
                    <Button size="sm" variant={r.enabled ? "outline" : "default"} onClick={() => openDialog(r, !r.enabled)}>
                      {r.enabled ? <><Lock className="size-3.5 mr-1" /> Desligar</> : <><Unlock className="size-3.5 mr-1" /> Ligar</>}
                    </Button>
                  </td>
                </tr>
                );
              })}

            </tbody>

          </table>
        </section>
        );
      })}

      <section className="panel p-5">
        <h2 className="font-medium mb-3">Histórico de mudanças</h2>
        {(data.log ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mudança registrada.</p>
        ) : (
          <ul className="space-y-1 text-xs font-mono">
            {(data.log as any[]).map((l) => (
              <li key={l.id} className="text-muted-foreground">
                {new Date(l.ts).toLocaleString("pt-BR")} · {l.symbol} · {VARIANT_LABEL[l.variant] ?? l.variant ?? "indicador"} · {apelidos.nick(l.mode)} ·{" "}
                <span className={l.para_enabled ? "text-orange-400" : "text-emerald-400"}>
                  {String(l.de_enabled)} → {String(l.para_enabled)}
                </span>{" "}
                · qty {l.de_max_qty} → {l.para_max_qty} · origem {l.origem ?? "—"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setTarget(null); setPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target?.enabled ? "Liberar execução real" : "Bloquear execução real"}</DialogTitle>
            <DialogDescription>
              {target?.enabled
                ? "Confirme com a senha mestra. O robô abaixo passará a enfileirar ordens reais."
                : "Confirme com a senha mestra para bloquear este par."}
            </DialogDescription>
          </DialogHeader>
          {target && (
            <div className="space-y-4">
              <div className="rounded-md border border-border p-3 text-sm space-y-1">
                <div>Ativo: <span className="font-medium">{target.symbol}</span></div>
                <div>Modalidade: <span className="font-medium">{VARIANT_LABEL[target.variant] ?? target.variant}</span></div>
                <div>Modo: <ModeName mode={target.mode} api={apelidos} /></div>
                <div>Quantidade máxima: <span className="font-mono">{qty}</span> contrato(s)</div>
              </div>
              {target.enabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Qtd. máxima (1–100)</Label>
                    <Input type="number" min={1} max={100} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                  </div>
                  <div>
                    <Label>Perda diária máx. (x stop)</Label>
                    <Input type="number" min={0} step={0.05} value={lossMult}
                      onChange={(e) => setLossMult(Number(e.target.value))} />
                    {(() => {
                      const s0 = sizingFor(target);
                      if (!s0 || !(s0.stop_pts > 0)) {
                        return <p className="mt-1 text-xs text-amber-300">Sem stop em pontos para este robô — o valor em reais não pode ser derivado.</p>;
                      }
                      const valor = brlFromMult(lossMult, s0.stop_pts, s0.point_value_brl, qty);
                      const teto = brlFromMult(STOPS_POR_DIA, s0.stop_pts, s0.point_value_brl, qty);
                      return (
                        <>
                          <p className="mt-1 text-xs text-muted-foreground">
                            = <span className="font-mono text-foreground">{brl(valor)}</span> · {s0.stop_pts} pts ×{" "}
                            {brl(s0.point_value_brl)}/pt × {qty} contrato(s)
                          </p>
                          {lossMult > STOPS_POR_DIA ? (
                            <p className="mt-1 text-xs text-amber-300">
                              Acima de {STOPS_POR_DIA}× não tem efeito: o teto de {STOPS_POR_DIA} stops prevalece e o robô
                              vai travar em {brl(teto)}.
                            </p>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
              <div>
                <Label>Senha mestra</Label>
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancelar</Button>
            <Button
              variant={target?.enabled ? "destructive" : "default"}
              disabled={!password || mSet.isPending}
              onClick={() => target && mSet.mutate({ row: target, enabled: target.enabled, password, max_qty: qty, max_daily_loss_mult: lossMult })}
            >
              {target?.enabled ? "Liberar conta real" : "Bloquear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={killStep > 0} onOpenChange={(o) => { if (!o) { setKillStep(0); setKillPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desligar todas as autorizações reais</DialogTitle>
            <DialogDescription>
              {killStep === 1
                ? `Isto bloqueia imediatamente os ${enabledCount} par(es) liberados. Confirme para prosseguir.`
                : "Confirmação final: digite a senha mestra."}
            </DialogDescription>
          </DialogHeader>
          {killStep === 2 && (
            <div>
              <Label>Senha mestra</Label>
              <Input type="password" autoComplete="current-password" value={killPassword} onChange={(e) => setKillPassword(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setKillStep(0); setKillPassword(""); }}>Cancelar</Button>
            {killStep === 1
              ? <Button variant="destructive" onClick={() => setKillStep(2)}>Continuar</Button>
              : <Button variant="destructive" disabled={!killPassword || mKill.isPending} onClick={() => mKill.mutate()}>Desligar tudo agora</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
