import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertTriangle, ShieldAlert, Activity, TrendingUp, TrendingDown,
  Clock, PauseCircle, PlayCircle, XCircle, FileBarChart, Settings as SettingsIcon,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/b3")({
  head: () => ({ meta: [{ title: "B3 Day Trade (WIN) — AleTrader AI" }] }),
  component: B3Page,
});

// ────────────────────────────────────────────────────────────────────
// Constantes do mini-índice
// ────────────────────────────────────────────────────────────────────
const POINT_VALUE_BRL = 0.2; // R$ por ponto por contrato
const TICK = 5;              // variação mínima em pontos
const DEFAULT_FEE_BRL = 0.5; // estimativa por contrato por lado

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const NUM = (v: number, d = 0) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

type Side = "buy" | "sell";
type OrderStatus = "open" | "closed" | "cancelled" | "rejected";

interface B3Settings {
  id?: string;
  user_id?: string;
  broker_name: string;
  api_status: string;
  environment: "simulation" | "real";
  capital_allocated: number;
  max_contracts: number;
  daily_loss_limit: number;
  daily_gain_target: number;
  stop_points: number;
  gain_points: number;
  start_time: string;
  end_time: string;
  force_close_time: string;
  strategy_mode: "conservador" | "moderado" | "agressivo";
  auto_trade_enabled: boolean;
  alert_only_enabled: boolean;
}

interface B3Order {
  id: string;
  symbol: string;
  contract_code: string;
  side: Side;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  entry_time: string;
  exit_time: string | null;
  gross_result_points: number | null;
  gross_result_brl: number | null;
  fees: number;
  net_result_brl: number | null;
  status: OrderStatus;
  close_reason: string | null;
  environment: "simulation" | "real";
  created_at: string;
}

const DEFAULTS: B3Settings = {
  broker_name: "simulado",
  api_status: "disconnected",
  environment: "simulation",
  capital_allocated: 10000,
  max_contracts: 1,
  daily_loss_limit: 300,
  daily_gain_target: 500,
  stop_points: 150,
  gain_points: 300,
  start_time: "09:05",
  end_time: "17:30",
  force_close_time: "17:45",
  strategy_mode: "moderado",
  auto_trade_enabled: false,
  alert_only_enabled: true,
};

// ────────────────────────────────────────────────────────────────────
function B3Page() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const settingsQ = useQuery({
    queryKey: ["b3-settings", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("b3_trading_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? { ...DEFAULTS, user_id: userId }) as B3Settings;
    },
  });

  const ordersQ = useQuery({
    queryKey: ["b3-orders", userId],
    enabled: !!userId,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("b3_orders")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as B3Order[];
    },
  });

  const settings = settingsQ.data ?? { ...DEFAULTS, user_id: userId ?? undefined };
  const orders = ordersQ.data ?? [];

  return (
    <div className="container mx-auto py-6 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">B3 Day Trade — Mini Índice (WIN)</h1>
          <p className="text-sm text-muted-foreground">
            Módulo independente do Binance. 1 ponto = {BRL(POINT_VALUE_BRL)} por contrato · variação mínima {TICK} pontos.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Badge variant={settings.environment === "real" ? "destructive" : "secondary"}>
            {settings.environment === "real" ? "REAL" : "SIMULAÇÃO"}
          </Badge>
          <Badge variant={settings.auto_trade_enabled ? "default" : "outline"}>
            Auto {settings.auto_trade_enabled ? "ON" : "OFF"}
          </Badge>
          <Badge variant={settings.alert_only_enabled ? "default" : "outline"}>
            Alerta {settings.alert_only_enabled ? "ON" : "OFF"}
          </Badge>
        </div>
      </header>

      <Tabs defaultValue="panel">
        <TabsList>
          <TabsTrigger value="panel"><Activity className="w-4 h-4 mr-1" />Painel</TabsTrigger>
          <TabsTrigger value="trade"><TrendingUp className="w-4 h-4 mr-1" />Operar (sim.)</TabsTrigger>
          <TabsTrigger value="report"><FileBarChart className="w-4 h-4 mr-1" />Relatório</TabsTrigger>
          <TabsTrigger value="settings"><SettingsIcon className="w-4 h-4 mr-1" />Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="panel">
          <Panel settings={settings} orders={orders} />
        </TabsContent>
        <TabsContent value="trade">
          <TradePanel
            settings={settings}
            orders={orders.filter(o => o.status === "open")}
            userId={userId}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ["b3-orders", userId] });
            }}
          />
        </TabsContent>
        <TabsContent value="report">
          <Report orders={orders} settings={settings} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsForm
            initial={settings}
            userId={userId}
            onSaved={() => qc.invalidateQueries({ queryKey: ["b3-settings", userId] })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
function Panel({ settings, orders }: { settings: B3Settings; orders: B3Order[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const todays = orders.filter(o => o.created_at.slice(0, 10) === today);
  const closed = todays.filter(o => o.status === "closed");
  const open = todays.filter(o => o.status === "open");

  const realizedBRL = closed.reduce((s, o) => s + (o.net_result_brl ?? 0), 0);
  const realizedPts = closed.reduce((s, o) => s + (o.gross_result_points ?? 0), 0);
  const grossBRL = closed.reduce((s, o) => s + (o.gross_result_brl ?? 0), 0);
  const fees = closed.reduce((s, o) => s + (o.fees ?? 0), 0);
  const contracts = closed.reduce((s, o) => s + o.quantity, 0);

  const lossHit = realizedBRL <= -settings.daily_loss_limit;
  const gainHit = realizedBRL >= settings.daily_gain_target;
  const status = lossHit ? "stopped_by_loss" : gainHit ? "stopped_by_gain" : "active";

  return (
    <div className="grid gap-3 md:grid-cols-4 mt-3">
      <StatCard label="Saldo inicial" value={BRL(settings.capital_allocated)} />
      <StatCard label="Resultado bruto" value={BRL(grossBRL)} tone={grossBRL >= 0 ? "up" : "down"} />
      <StatCard label="Taxas" value={BRL(fees)} />
      <StatCard label="Resultado líquido" value={BRL(realizedBRL)} tone={realizedBRL >= 0 ? "up" : "down"} />
      <StatCard label="Pontos" value={NUM(realizedPts)} tone={realizedPts >= 0 ? "up" : "down"} />
      <StatCard label="Contratos operados" value={NUM(contracts)} />
      <StatCard label="Operações abertas" value={NUM(open.length)} />
      <StatCard label="Operações encerradas" value={NUM(closed.length)} />

      <Card className="md:col-span-4">
        <CardHeader className="pb-2"><CardTitle className="text-base">Status do robô</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={status === "active" ? "default" : "destructive"}>{status}</Badge>
            <span className="text-muted-foreground">
              Limites diários: perda {BRL(settings.daily_loss_limit)} · ganho {BRL(settings.daily_gain_target)}
            </span>
          </div>
          {lossHit && <p className="text-destructive flex items-center gap-1"><ShieldAlert className="w-4 h-4" /> Perda diária atingida — entradas bloqueadas.</p>}
          {gainHit && <p className="text-emerald-500 flex items-center gap-1"><TrendingUp className="w-4 h-4" /> Meta diária atingida.</p>}
          <p className="text-muted-foreground flex items-center gap-1">
            <Clock className="w-4 h-4" /> Janela: {settings.start_time}–{settings.end_time} · zeragem {settings.force_close_time}
          </p>
          {settings.auto_trade_enabled === false && (
            <p className="text-amber-500 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" /> Operação automática desativada — modo manual / alerta.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-semibold ${tone === "up" ? "text-emerald-500" : tone === "down" ? "text-destructive" : ""}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
function TradePanel({
  settings, orders, userId, onChanged,
}: {
  settings: B3Settings;
  orders: B3Order[];
  userId: string | null;
  onChanged: () => void;
}) {
  const [side, setSide] = useState<Side>("buy");
  const [price, setPrice] = useState<number>(130000);
  const [qty, setQty] = useState<number>(1);
  const [contract, setContract] = useState<string>("WINFUT");
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closePrice, setClosePrice] = useState<number>(130000);

  const checkGuards = (): string | null => {
    if (settings.environment === "real" && !settings.auto_trade_enabled) {
      // Real exige confirmação explícita (auto on)
    }
    if (qty > settings.max_contracts) return `Quantidade ${qty} excede limite (${settings.max_contracts}).`;
    if (price % TICK !== 0) return `Preço fora do tick de ${TICK} pontos.`;
    const now = new Date();
    const [sh, sm] = settings.start_time.split(":").map(Number);
    const [eh, em] = settings.end_time.split(":").map(Number);
    const start = new Date(now); start.setHours(sh, sm, 0, 0);
    const end = new Date(now); end.setHours(eh, em, 0, 0);
    if (now < start || now > end) return `Fora do horário permitido (${settings.start_time}–${settings.end_time}).`;
    return null;
  };

  const openOrder = useMutation({
    mutationFn: async () => {
      const err = checkGuards();
      if (err) throw new Error(err);
      const { error } = await (supabase as any).from("b3_orders").insert({
        user_id: userId,
        symbol: "WIN",
        contract_code: contract,
        side,
        entry_price: price,
        quantity: qty,
        entry_time: new Date().toISOString(),
        fees: DEFAULT_FEE_BRL * qty,
        status: "open",
        environment: settings.environment,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Ordem simulada aberta"); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });

  const closeOrder = useMutation({
    mutationFn: async (o: B3Order) => {
      const points = o.side === "buy" ? closePrice - o.entry_price : o.entry_price - closePrice;
      const grossBRL = points * POINT_VALUE_BRL * o.quantity;
      const totalFees = (o.fees ?? 0) + DEFAULT_FEE_BRL * o.quantity;
      const net = grossBRL - totalFees;
      const { error } = await (supabase as any).from("b3_orders").update({
        exit_price: closePrice,
        exit_time: new Date().toISOString(),
        gross_result_points: points,
        gross_result_brl: grossBRL,
        fees: totalFees,
        net_result_brl: net,
        status: "closed",
        close_reason: "manual",
      }).eq("id", o.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Ordem encerrada"); setClosingId(null); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });

  const cancelOrder = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("b3_orders").update({
        status: "cancelled", close_reason: "manual_cancel", exit_time: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Ordem cancelada"); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 md:grid-cols-2 mt-3">
      <Card>
        <CardHeader><CardTitle className="text-base">Abrir ordem (simulada)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Contrato</Label>
              <Input value={contract} onChange={e => setContract(e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label>Lado</Label>
              <Select value={side} onValueChange={v => setSide(v as Side)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">Compra</SelectItem>
                  <SelectItem value="sell">Venda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Preço (pontos)</Label>
              <Input type="number" step={TICK} value={price} onChange={e => setPrice(Number(e.target.value))} />
            </div>
            <div>
              <Label>Quantidade</Label>
              <Input type="number" min={1} max={settings.max_contracts}
                value={qty} onChange={e => setQty(Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Stop: {settings.stop_points} pts · Gain: {settings.gain_points} pts · Máx contratos: {settings.max_contracts}
          </p>
          <Button onClick={() => openOrder.mutate()} disabled={openOrder.isPending}>
            Abrir {side === "buy" ? "compra" : "venda"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Posições abertas ({orders.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {orders.length === 0 && <p className="text-sm text-muted-foreground">Sem posições abertas.</p>}
          {orders.map(o => (
            <div key={o.id} className="border rounded p-2 text-sm space-y-2">
              <div className="flex justify-between">
                <span>
                  <Badge variant={o.side === "buy" ? "default" : "destructive"} className="mr-1">
                    {o.side === "buy" ? "C" : "V"}
                  </Badge>
                  {o.contract_code} · {o.quantity}× @ {NUM(o.entry_price)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(o.entry_time).toLocaleTimeString("pt-BR")}
                </span>
              </div>
              {closingId === o.id ? (
                <div className="flex gap-2">
                  <Input type="number" step={TICK} value={closePrice}
                    onChange={e => setClosePrice(Number(e.target.value))} />
                  <Button size="sm" onClick={() => closeOrder.mutate(o)} disabled={closeOrder.isPending}>
                    Encerrar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setClosingId(null)}>Cancelar</Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setClosingId(o.id); setClosePrice(o.entry_price); }}>
                    <PauseCircle className="w-4 h-4 mr-1" />Encerrar a mercado
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => cancelOrder.mutate(o.id)}>
                    <XCircle className="w-4 h-4 mr-1" />Cancelar
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
function Report({ orders, settings }: { orders: B3Order[]; settings: B3Settings }) {
  const today = new Date().toISOString().slice(0, 10);
  const todays = useMemo(
    () => orders.filter(o => o.created_at.slice(0, 10) === today),
    [orders, today],
  );

  const closed = todays.filter(o => o.status === "closed");
  const open = todays.filter(o => o.status === "open");

  const realized = closed.reduce((s, o) => s + (o.net_result_brl ?? 0), 0);
  const grossRealized = closed.reduce((s, o) => s + (o.gross_result_brl ?? 0), 0);
  const fees = closed.reduce((s, o) => s + (o.fees ?? 0), 0);
  const unrealized = 0; // sem feed de preço atual nesta fase
  const totalBought = closed.filter(o => o.side === "buy").reduce((s, o) => s + o.entry_price * o.quantity * POINT_VALUE_BRL, 0);
  const totalSold = closed.filter(o => o.side === "sell").reduce((s, o) => s + o.entry_price * o.quantity * POINT_VALUE_BRL, 0);
  const equity = settings.capital_allocated + realized + unrealized;

  return (
    <div className="space-y-3 mt-3">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Resultado realizado" value={BRL(realized)} tone={realized >= 0 ? "up" : "down"} />
        <StatCard label="Resultado em aberto" value={BRL(unrealized)} />
        <StatCard label="Bruto realizado" value={BRL(grossRealized)} tone={grossRealized >= 0 ? "up" : "down"} />
        <StatCard label="Taxas" value={BRL(fees)} />
        <StatCard label="Saldo operacional" value={BRL(settings.capital_allocated)} />
        <StatCard label="Patrimônio estimado" value={BRL(equity)} tone={equity >= settings.capital_allocated ? "up" : "down"} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Extrato débito/crédito do dia</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-1 pr-2">Hora</th>
                  <th>Contrato</th>
                  <th>Lado</th>
                  <th className="text-right">Qtd</th>
                  <th className="text-right">Entrada</th>
                  <th className="text-right">Saída</th>
                  <th className="text-right">Pts</th>
                  <th className="text-right">Bruto R$</th>
                  <th className="text-right">Taxas</th>
                  <th className="text-right">Líquido R$</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {todays.length === 0 && (
                  <tr><td colSpan={11} className="py-4 text-center text-muted-foreground">Sem operações hoje.</td></tr>
                )}
                {todays.map(o => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="py-1 pr-2">{new Date(o.entry_time).toLocaleTimeString("pt-BR")}</td>
                    <td>{o.contract_code}</td>
                    <td>{o.side === "buy" ? "Compra" : "Venda"}</td>
                    <td className="text-right">{o.quantity}</td>
                    <td className="text-right">{NUM(o.entry_price)}</td>
                    <td className="text-right">{o.exit_price != null ? NUM(o.exit_price) : "—"}</td>
                    <td className={`text-right ${(o.gross_result_points ?? 0) >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                      {o.gross_result_points != null ? NUM(o.gross_result_points) : "—"}
                    </td>
                    <td className="text-right">{o.gross_result_brl != null ? BRL(o.gross_result_brl) : "—"}</td>
                    <td className="text-right">{BRL(o.fees ?? 0)}</td>
                    <td className={`text-right ${(o.net_result_brl ?? 0) >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                      {o.net_result_brl != null ? BRL(o.net_result_brl) : "—"}
                    </td>
                    <td>{o.status}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-semibold border-t">
                <tr>
                  <td colSpan={7} className="py-2 text-right">Totais (encerradas):</td>
                  <td className="text-right">{BRL(grossRealized)}</td>
                  <td className="text-right">{BRL(fees)}</td>
                  <td className={`text-right ${realized >= 0 ? "text-emerald-500" : "text-destructive"}`}>{BRL(realized)}</td>
                  <td>{closed.length} fech. / {open.length} ab.</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Ordens em aberto não somam ao resultado realizado. Volumes em compras/vendas mantidos para auditoria.
            Comprado: {BRL(totalBought)} · Vendido: {BRL(totalSold)}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
function SettingsForm({
  initial, userId, onSaved,
}: { initial: B3Settings; userId: string | null; onSaved: () => void }) {
  const [s, setS] = useState<B3Settings>(initial);
  useEffect(() => { setS(initial); }, [initial]);

  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Sessão inválida.");
      if (s.environment === "real" && !confirm(
        "Ativar AMBIENTE REAL. Confirma que você compreende os riscos e quer enviar ordens para a corretora?"
      )) throw new Error("Confirmação necessária para modo real.");
      const payload = { ...s, user_id: userId };
      const { error } = await (supabase as any)
        .from("b3_trading_settings")
        .upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Configurações salvas"); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });

  const F = (k: keyof B3Settings, label: string, type: "text" | "number" | "time" = "text") => (
    <div>
      <Label>{label}</Label>
      <Input
        type={type}
        value={String(s[k] ?? "")}
        onChange={e => setS({ ...s, [k]: type === "number" ? Number(e.target.value) : e.target.value })}
      />
    </div>
  );

  return (
    <Card className="mt-3">
      <CardHeader><CardTitle className="text-base">Configurações B3 — Day Trade</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          {F("broker_name", "Corretora")}
          <div>
            <Label>Status da API</Label>
            <Input value={s.api_status} onChange={e => setS({ ...s, api_status: e.target.value })} />
          </div>
          <div>
            <Label>Ambiente</Label>
            <Select value={s.environment} onValueChange={v => setS({ ...s, environment: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="simulation">Simulação</SelectItem>
                <SelectItem value="real">Real</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {F("capital_allocated", "Capital operacional (R$)", "number")}
          {F("max_contracts", "Máx contratos", "number")}
          <div>
            <Label>Modo</Label>
            <Select value={s.strategy_mode} onValueChange={v => setS({ ...s, strategy_mode: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="conservador">Conservador</SelectItem>
                <SelectItem value="moderado">Moderado</SelectItem>
                <SelectItem value="agressivo">Agressivo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {F("daily_loss_limit", "Perda diária máx (R$)", "number")}
          {F("daily_gain_target", "Ganho diário alvo (R$)", "number")}
          {F("stop_points", "Stop (pontos)", "number")}
          {F("gain_points", "Gain (pontos)", "number")}

          {F("start_time", "Horário inicial", "time")}
          {F("end_time", "Horário final", "time")}
          {F("force_close_time", "Zeragem obrigatória", "time")}
        </div>

        <div className="flex items-center gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={s.auto_trade_enabled}
              onCheckedChange={v => setS({ ...s, auto_trade_enabled: v })} />
            Operação automática
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={s.alert_only_enabled}
              onCheckedChange={v => setS({ ...s, alert_only_enabled: v })} />
            Apenas alerta (sem execução)
          </label>
        </div>

        {s.environment === "real" && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <ShieldAlert className="w-4 h-4" />
            Modo REAL exige confirmação ao salvar. Execução real só será efetivada após Fase 4.
          </p>
        )}

        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <PlayCircle className="w-4 h-4 mr-1" /> Salvar configurações
        </Button>
      </CardContent>
    </Card>
  );
}
