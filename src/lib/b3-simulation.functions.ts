// B3 Day Trade — Fase 2.5: simulação comparativa dos 3 modos
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  runB3Agents, buildB3Decision,
  type B3Side, type B3RiskState, type B3CommitteeSettings,
} from "./b3-committee.server";
import {
  evaluateB3Protection, resetB3ProtectionForNewDay, b3DayKeyBRT,
  type B3ProtectionRuntime, type B3ProtectionSettings,
} from "./b3-protection.server";
import {
  B3_MT5_SERVER,
  B3_MT5_SYMBOL,
  B3_MT5_TTL_SECONDS,
  B3QuoteProvider,
  assertB3StrictMt5ExecutionAudit,
  getB3ExecutionAudit,
  quoteAuditBase,
  type B3PriceContextResult,
  type B3QuoteExecutionAudit,
} from "./b3-price-source.server";
import { b3WindowState } from "./b3-window.server";


const POINT_VALUE_BRL = 0.2;
const TICK = 5;

// ─────────────────────── Fase 0: perfil de ativo ───────────────────────
// Extrai os valores que hoje são fixos (POINT_VALUE_BRL, símbolo, contrato,
// preço-base) para uma tabela por símbolo. O fallback abaixo replica
// EXATAMENTE os valores fixos de hoje — se a tabela/linha não existir por
// qualquer motivo, o comportamento não muda em nada.
const WIN_FALLBACK_ASSET_PROFILE = {
  symbol: "WINQ26", quote_symbol: "WIN", contract_code: "WINFUT",
  tick_size: TICK, tick_value_brl: POINT_VALUE_BRL, base_price_fallback: 130000,
  spread_max_price: 15, price_deviation_limit: 2000,
};
async function loadAssetProfile(supabase: any, symbol: string | null | undefined) {
  if (!symbol) return WIN_FALLBACK_ASSET_PROFILE;
  try {
    const { data } = await supabase.from("b3_asset_profiles").select("*").eq("symbol", symbol).maybeSingle();
    if (data) return data;
  } catch {
    // tabela pode não existir ainda (antes da migration) — cai no fallback
  }
  return WIN_FALLBACK_ASSET_PROFILE;
}
// Trava de risco AGREGADA: numa conta real, os 5 modos compartilham o mesmo
// saldo/margem (diferente da simulação, onde cada modo tem saldo virtual
// isolado). Esse limite olha a soma do resultado realizado hoje dos 5 modos
// juntos e bloqueia NOVAS entradas em TODOS os modos quando estourado —
// posições já abertas continuam sendo geridas normalmente (stop/gain/zeragem).
// Valor definido pelo usuário em 04/08/2026.
const GLOBAL_DAILY_LOSS_LIMIT_BRL = 1000;

// ─────────────────────── espelhamento demo → real ───────────────────────
// Toda vez que o motor (demo) abre/fecha uma posição em qualquer um dos 5
// modos, um comando espelhado é inserido em b3_mt5_commands para env='real',
// com quantidade PRÓPRIA da conta real (não a mesma da demo — ver
// REAL_QTY_BY_MODE). O comando só produz ordem de verdade se o conector
// Python estiver com DRY_RUN=False E REAL_TRADING_CONFIRMED=True — até lá,
// fica só registrado e confirmado como dry-run pelo conector.
// Decisão do usuário em 05/08/2026: espelhar os 5 modos desde já, mantendo
// o conector em modo dry-run até validação manual.
const REAL_MIRROR_ENABLED = true;
const REAL_QTY_BY_MODE: Record<Mode, number> = {
  conservador: 1, moderado: 1, equilibrado: 1, semi_agressivo: 1, agressivo: 1,
};
const MODE_INDEX: Record<Mode, number> = {
  conservador: 1, moderado: 2, equilibrado: 3, semi_agressivo: 4, agressivo: 5,
};
// Magic number = 2000 + (bloco de 100 por ativo) + índice do modo (1-5).
// Faixa 2000+ nunca colide com nada que a conta demo venha a usar (essa
// ficaria em 1000+, se um dia o espelho demo também usar essa fila).
// CORRIGIDO em 06/08/2026: antes o número era só por modo, então WIN e WDO
// (e agora PETR4/VALE3) usariam o MESMO magic number — risco real numa
// conta com vários ativos simultâneos. Agora cada ativo tem seu bloco:
// WIN=2001-2005, WDO=2101-2105, PETR4=2201-2205, VALE3=2301-2305.
const REAL_MAGIC_ASSET_BLOCK: Record<string, number> = {
  WIN: 2000, WDO: 2100, PETR4: 2200, VALE3: 2300,
};
function realMagicNumber(quoteSymbol: string, mode: Mode): number {
  const block = REAL_MAGIC_ASSET_BLOCK[quoteSymbol] ?? 2900; // ativo novo não cadastrado: bloco genérico
  return block + MODE_INDEX[mode];
}

async function mirrorToReal(
  supabase: any, userId: string, runId: string, mode: Mode,
  action: "open" | "close", side: "buy" | "sell", idempotencyKey: string,
  requestedBy: "engine_auto" | "user_manual_close" | "user_close_all",
  symbol: string = "WIN",
) {
  if (!REAL_MIRROR_ENABLED) return;

  // ── PORTÃO DE AUTORIZAÇÃO REAL (nega por padrão) ──
  // Sem linha autorizada em b3_prd_authorizations para user+symbol+mode,
  // nenhum comando real é enfileirado. Falha de consulta = falha FECHADA.
  // Nenhum registro de bloqueio é gravado (decisão do usuário).
  let authMaxQty = 1;
  try {
    const { data: auth, error: authErr } = await supabase
      .from("b3_prd_authorizations")
      .select("enabled, max_qty")
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .eq("mode", mode)
      .maybeSingle();
    if (authErr) return;
    if (!auth || auth.enabled !== true) return;
    authMaxQty = Number(auth.max_qty ?? 1);
  } catch {
    return;
  }

  const quantity = Math.max(1, Math.min(REAL_QTY_BY_MODE[mode] ?? 1, authMaxQty));

  try {
    await supabase.from("b3_mt5_commands").insert({
      user_id: userId, env: "real", simulation_run_id: runId, mode,
      action, side, symbol, quantity,
      magic_number: realMagicNumber(symbol, mode), idempotency_key: idempotencyKey,
      requested_by: requestedBy,
    });
  } catch (e) {
    // Espelhamento nunca pode derrubar o motor de simulação — só loga.
    console.error(`[mirror] falha ao espelhar ${action} de ${mode} pra real:`, (e as Error).message);
  }
}

type Mode = "conservador" | "moderado" | "equilibrado" | "semi_agressivo" | "agressivo";
const MODES: Mode[] = ["conservador", "moderado", "equilibrado", "semi_agressivo", "agressivo"];

interface ModeDefaults {
  entry_style: string;
  min_approve_votes: number; min_confidence: number; min_score: number;
  max_contracts: number; stop_pts: number; gain_pts: number; max_volatility_pct: number;
  daily_loss_limit_brl: number; daily_gain_target_brl: number;
  trailing_activation_pts?: number; trailing_giveback_pts?: number; trailing_mode?: string;
}
const MODE_DEFAULTS: Record<Mode, ModeDefaults> = {
  conservador:    { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 70, min_score: 75, max_contracts: 1, stop_pts: 100, gain_pts: 200, max_volatility_pct: 2.5, daily_loss_limit_brl: 100, daily_gain_target_brl: 200, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  moderado:       { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 62, min_score: 65, max_contracts: 2, stop_pts: 150, gain_pts: 300, max_volatility_pct: 3.5, daily_loss_limit_brl: 300, daily_gain_target_brl: 500, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  equilibrado:    { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 62, min_score: 62, max_contracts: 3, stop_pts: 220, gain_pts: 440, max_volatility_pct: 3.8, daily_loss_limit_brl: 500, daily_gain_target_brl: 700, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  semi_agressivo: { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 60, min_score: 60, max_contracts: 4, stop_pts: 300, gain_pts: 600, max_volatility_pct: 4.0, daily_loss_limit_brl: 800, daily_gain_target_brl: 1000, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
  agressivo:      { entry_style: 'indicador', min_approve_votes: 4, min_confidence: 55, min_score: 55, max_contracts: 3, stop_pts: 200, gain_pts: 400, max_volatility_pct: 4.5, daily_loss_limit_brl: 600, daily_gain_target_brl: 1200, trailing_activation_pts: 0, trailing_giveback_pts: 0, trailing_mode: 'fixed' },
};

function hhmmToMin(s: string) { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; }

function saoPauloMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

// ───────────────────── start ─────────────────────
interface StartInput {
  initial_balance?: number;
  max_contracts?: number;
  fee_brl?: number;
  slippage_pts?: number;
  trading_start_time?: string;
  entry_cutoff_time?: string;
  force_close_time?: string;
  notes?: string;
  symbol?: string; // Fase 0: default 'WINQ26'. Precisa existir uma linha correspondente em b3_asset_profiles.
}
// Fuso do pregão B3 — usado para agrupar reinícios do mesmo dia num session_day_id único.
function currentB3SessionDate(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

async function resolveSessionDayId(supabase: any, userId: string, symbol: string, sessionDate: string): Promise<string> {
  const { data } = await supabase
    .from("b3_simulation_runs")
    .select("session_day_id")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .eq("session_date", sessionDate)
    .not("session_day_id", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.session_day_id) return data.session_day_id as string;
  return (globalThis.crypto?.randomUUID?.() ?? cryptoRandomFallback());
}
function cryptoRandomFallback(): string {
  // fallback determinístico-suficiente; runtime Workers já expõe crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const startB3Simulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: StartInput) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const initial = Number(data.initial_balance ?? 10000);
    const symbol = data.symbol ?? "WINQ26";
    const sessionDate = currentB3SessionDate();
    const sessionDayId = await resolveSessionDayId(supabase as any, userId, symbol, sessionDate);
    const { data: run, error } = await (supabase as any)
      .from("b3_simulation_runs")
      .insert({
        user_id: userId,
        initial_balance: initial,
        max_contracts: Number(data.max_contracts ?? 1),
        simulated_fee_brl: Number(data.fee_brl ?? 1.5),
        simulated_slippage_pts: Number(data.slippage_pts ?? 0),
        trading_start_time: data.trading_start_time ?? "09:15",
        entry_cutoff_time: data.entry_cutoff_time ?? "16:30",
        force_close_time: data.force_close_time ?? "16:55",
        notes: data.notes ?? null,
        status: "running",
        symbol,
        session_date: sessionDate,
        session_day_id: sessionDayId,
      })
      .select("*").single();
    if (error) throw error;

    const modeRows = MODES.map(m => ({
      simulation_run_id: run.id, user_id: userId, mode: m,
      initial_balance: initial, current_balance: initial,
    }));
    const { error: mErr } = await (supabase as any).from("b3_simulation_modes").insert(modeRows);
    if (mErr) throw mErr;

    // Usa o padrão salvo pelo usuário (b3_mode_user_defaults) quando
    // existir; cai no MODE_DEFAULTS de fábrica só pros modos sem padrão
    // próprio salvo ainda. Sem isso, TODA simulação nova sempre nascia com
    // os valores de fábrica, obrigando reconfigurar tudo de novo — motivo
    // direto do pedido do usuário (item 7, 06/08/2026).
    // O padrão é POR ATIVO: a chave da tabela é (user_id, symbol, mode).
    // Sem o filtro por symbol, o padrão do WIN era aplicado numa run de WDO
    // e escrevia stop de 300 pts (R$ 3.000+ de risco por contrato no mini
    // dólar, onde o ponto vale R$ 10 contra R$ 0,20 do WIN).
    const { data: userDefaults } = await (supabase as any)
      .from("b3_mode_user_defaults").select("*").eq("user_id", userId).eq("symbol", symbol);
    const userDefaultsByMode: Record<string, any> = {};
    for (const d of userDefaults ?? []) userDefaultsByMode[d.mode] = d;

    const factoryModes: string[] = [];
    const settingRows = MODES.map(m => {
      const ud = userDefaultsByMode[m];
      if (!ud) factoryModes.push(m);
      const base = ud
        ? Object.fromEntries(SETTING_FIELDS.map(k => [k, k in ud && ud[k] != null ? ud[k] : MODE_DEFAULTS[m][k as keyof typeof MODE_DEFAULTS[typeof m]]]))
        : MODE_DEFAULTS[m];
      return {
        simulation_run_id: run.id, user_id: userId, mode: m, ...base,
        trading_start_time: run.trading_start_time,
        entry_cutoff_time: run.entry_cutoff_time,
        force_close_time: run.force_close_time,
      };
    });
    await (supabase as any).from("b3_simulation_mode_settings").insert(settingRows);
    return {
      ...run,
      defaults_symbol: symbol,
      factory_default_modes: factoryModes,
      factory_default_warning: factoryModes.length
        ? `Modos sem padrão salvo para ${symbol} (${factoryModes.join(", ")}) nasceram com o padrão de fábrica, calibrado para mini índice; revise stop, alvo e quantidade antes de operar este ativo.`
        : null,
    };
  });



// ───────────────────── controls ─────────────────────
export const setB3SimulationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; status: "running" | "paused" | "finished" | "cancelled" }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: any = { status: data.status };
    if (data.status === "finished" || data.status === "cancelled") patch.ended_at = new Date().toISOString();
    const { error } = await (supabase as any).from("b3_simulation_runs")
      .update(patch).eq("id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const setB3SimulationWinner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any).from("b3_simulation_runs")
      .update({ winner_mode: data.mode }).eq("id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

// ───────────────────── list / detail ─────────────────────
export const listB3Simulations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any).from("b3_simulation_runs")
      .select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(30);
    if (error) throw error;
    return data ?? [];
  });

export const getB3SimulationDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // I/O: sem select("*") em tabelas grandes e limites enxutos — a tela usa
    // no máximo 60 ordens e o último snapshot (engine_audit).
    const ORDER_COLS = "id, mode, side, status, symbol, contract_code, entry_price, exit_price, exit_time, created_at, quantity, fees, gross_result_brl, gross_result_points, net_result_brl, close_reason, quote_source, provider_name";
    const [runR, modesR, settingsR, ordersR, snapsR] = await Promise.all([
      (supabase as any).from("b3_simulation_runs").select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle(),
      (supabase as any).from("b3_simulation_modes").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId),
      (supabase as any).from("b3_trading_settings").select("price_source").eq("user_id", userId).maybeSingle(),
      (supabase as any).from("b3_simulation_orders").select(ORDER_COLS).eq("simulation_run_id", data.run_id).eq("user_id", userId).order("created_at", { ascending: false }).limit(800),
      (supabase as any).from("b3_simulation_market_snapshots")
        .select("id, market_time, price, quote_source, quote_server, quote_symbol, quote_tick_ts, quote_bid, quote_ask, quote_last, provider_name, extra")
        .eq("simulation_run_id", data.run_id).eq("user_id", userId).order("market_time", { ascending: false }).limit(3),
    ]);

    if (runR.error) throw runR.error;
    if (!runR.data) throw new Error("Run não encontrada");
    const isMt5Source = settingsR.data?.price_source === "mt5_xp_demo";
    const allOrders = (ordersR.data ?? []) as any[];
    const visibleOrders = isMt5Source
      ? allOrders.filter((o) => o.quote_source === "MT5 XP DEMO" && o.provider_name === "B3QuoteProvider").slice(0, 500)
      : allOrders.slice(0, 500);
    const hiddenLegacyCount = isMt5Source
      ? allOrders.filter((o) => o.quote_source !== "MT5 XP DEMO" || o.provider_name !== "B3QuoteProvider").length
      : 0;

    const visibleModes = isMt5Source
      ? ((modesR.data ?? []) as any[]).map((m) => {
        const orders = visibleOrders.filter((o) => o.mode === m.mode);
        const closed = orders.filter((o) => o.status === "closed");
        const realized = closed.reduce((s, o) => s + Number(o.net_result_brl ?? 0), 0);
        const fees = orders.reduce((s, o) => s + Number(o.fees ?? 0), 0);
        const wins = closed.filter((o) => Number(o.net_result_brl ?? 0) > 0).length;
        const losses = closed.filter((o) => Number(o.net_result_brl ?? 0) < 0).length;
        const maxGain = closed.reduce((v, o) => Math.max(v, Number(o.net_result_brl ?? 0)), 0);
        const maxLoss = closed.reduce((v, o) => Math.min(v, Number(o.net_result_brl ?? 0)), 0);
        const points = closed.reduce((s, o) => s + Number(o.gross_result_points ?? 0), 0);
        const contracts = orders.reduce((s, o) => s + Number(o.quantity ?? 0), 0);
        let acc = 0, peak = 0, dd = 0;
        for (const o of closed.slice().sort((a, b) => new Date(a.exit_time ?? a.created_at).getTime() - new Date(b.exit_time ?? b.created_at).getTime())) {
          acc += Number(o.net_result_brl ?? 0);
          peak = Math.max(peak, acc);
          dd = Math.max(dd, peak - acc);
        }
        return {
          ...m,
          realized_pnl: realized,
          unrealized_pnl: 0,
          current_balance: Number(m.initial_balance ?? 0) + realized,
          total_fees: fees,
          total_trades: closed.length,
          winning_trades: wins,
          losing_trades: losses,
          max_gain: maxGain,
          max_loss: maxLoss,
          max_drawdown: dd,
          points_result: points,
          contracts_traded: contracts,
        };
      })
      : (modesR.data ?? []);
    return {
      run: runR.data,
      modes: visibleModes,
      price_source: settingsR.data?.price_source ?? "csv",
      orders: visibleOrders,
      legacy_orders_hidden: hiddenLegacyCount,
      snapshots: snapsR.data ?? [],
    };
  });

// ───────────────────── tick (core, reutilizado por hook público) ─────────────────────
// Estado de I/O em memória (por isolate). Não altera estratégia — apenas evita
// gravações e leituras repetidas no banco.
type SnapMemo = {
  id: string | null;
  persisted_at: number;        // epoch ms da última persistência real
  quote_tick_ts: string | null;
  write_sigs: Record<string, string>;
  last_price: number | null;   // preço/cotação atuais mantidos só em memória
  last_quote: any;
};
const SNAP_MEMO = new Map<string, SnapMemo>();
const TICK_LOCKS = new Map<string, number>();
const SNAP_PERSIST_MS = 10_000;

export async function runB3SimulationTick(
  supabase: any,
  userId: string,
  runId: string,
  ticks = 1,
): Promise<{ ok?: boolean; skipped?: boolean; reason?: string; processed?: number; log: any[] }> {
  ticks = Math.min(Math.max(1, Number(ticks)), 60);

  // Janela rígida da B3 (seg-sex, 09:05-17:00 BRT) validada ANTES do banco:
  // fora dela nada é processado, gravado, logado ou contabilizado.
  const win = b3WindowState();
  if (!win.open) {
    return { skipped: true, reason: "b3_sleeping", log: [] };
  }

  // Lock: impede execuções sobrepostas (cron + UI) para a mesma run.
  const lockKey = `${userId}:${runId}`;
  const lockedAt = TICK_LOCKS.get(lockKey);
  if (lockedAt && Date.now() - lockedAt < 55_000) {
    return { skipped: true, reason: "tick_em_execucao", log: [] };
  }
  TICK_LOCKS.set(lockKey, Date.now());
  try {
    return await runB3SimulationTickInner(supabase, userId, runId, ticks);
  } finally {
    TICK_LOCKS.delete(lockKey);
  }
}

async function runB3SimulationTickInner(
  supabase: any,
  userId: string,
  runId: string,
  ticks: number,
): Promise<{ ok?: boolean; skipped?: boolean; reason?: string; processed?: number; log: any[] }> {


  const { data: run, error: runErr } = await supabase.from("b3_simulation_runs")
    .select("*").eq("id", runId).eq("user_id", userId).maybeSingle();
  if (runErr) throw runErr;
  if (!run) throw new Error("Run não encontrada");
  if (run.status !== "running") return { skipped: true, reason: `Status ${run.status}`, log: [] };
  const asset = await loadAssetProfile(supabase, run.symbol);

  const { data: modeRows, error: mErr } = await supabase.from("b3_simulation_modes")
    .select("*").eq("simulation_run_id", runId).eq("user_id", userId);
  if (mErr) throw mErr;
  const modeById: Record<string, any> = {};
  const modeByName: Record<string, any> = {};
  for (const m of modeRows ?? []) { modeById[m.id] = m; modeByName[m.mode] = m; }

  // settings por modo (criadas no start; backfill garante existência em runs antigas)
  const { data: settingsRows } = await supabase.from("b3_simulation_mode_settings")
    .select("*").eq("simulation_run_id", runId).eq("user_id", userId);
  const settingsByMode: Record<string, any> = {};
  for (const s of settingsRows ?? []) settingsByMode[s.mode] = s;
  // garante defaults se faltar
  for (const m of MODES) {
    if (!settingsByMode[m]) {
      settingsByMode[m] = {
        ...MODE_DEFAULTS[m], enabled: true,
        trading_start_time: run.trading_start_time,
        entry_cutoff_time: run.entry_cutoff_time,
        force_close_time: run.force_close_time,
      };
    }
  }

  const now0 = new Date();
  const { data: macros } = await supabase.from("b3_macro_events")
    .select("*").eq("user_id", userId).eq("active", true)
    .lte("block_start", new Date(now0.getTime() + 24 * 3600 * 1000).toISOString())
    .gte("block_end", new Date(now0.getTime() - 24 * 3600 * 1000).toISOString());

  const log: any[] = [];
  let openOrdersCache: any[] | null = null;
  async function getOpen() {
    if (openOrdersCache) return openOrdersCache;
    const { data: o } = await supabase.from("b3_simulation_orders")
      .select("*").eq("simulation_run_id", runId).eq("user_id", userId).eq("status", "open");
    openOrdersCache = o ?? [];
    return openOrdersCache;
  }

  // ── Travas de I/O (não alteram estratégia) ────────────────────────────────
  // 1) dedup: o mesmo quote_tick_ts não é reprocessado;
  // 2) hard throttle: no máximo 1 gravação de snapshot a cada 10s por
  //    user_id + símbolo + run. Entre elas, preço/cotação ficam só em memória;
  // 3) assinaturas: votos, eventos e contadores gravados só quando o estado muda.
  const memoKey = `${userId}:${runId}:${asset.symbol}`;
  let memo = SNAP_MEMO.get(memoKey);
  if (!memo) {
    const { data: lastSnapRow } = await supabase.from("b3_simulation_market_snapshots")
      .select("id, market_time, quote_tick_ts, extra")
      .eq("simulation_run_id", runId).eq("user_id", userId)
      .order("market_time", { ascending: false }).limit(1).maybeSingle();
    memo = {
      id: lastSnapRow?.id ?? null,
      persisted_at: lastSnapRow?.market_time ? new Date(lastSnapRow.market_time).getTime() : 0,
      quote_tick_ts: lastSnapRow?.quote_tick_ts ?? null,
      write_sigs: { ...(((lastSnapRow as any)?.extra?.write_sigs as any) ?? {}) },
      last_price: null,
      last_quote: null,
    };
    SNAP_MEMO.set(memoKey, memo);
  }
  const writeSigs: Record<string, string> = memo.write_sigs;
  function sigChanged(key: string, value: string) {
    if (writeSigs[key] === value) return false;
    writeSigs[key] = value;
    return true;
  }



  // PnL realizado SOMENTE no dia de hoje (BRT) — usado para gate de
  // daily_loss_limit / daily_gain_target. Antes usávamos m.realized_pnl
  // (cumulativo), o que travava modos que já bateram a meta em dias anteriores.
  async function getRealizedTodayByMode(): Promise<Record<string, number>> {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    // 00:00 BRT (UTC-3) = 03:00 UTC do mesmo dia
    const startUtcIso = `${parts}T03:00:00.000Z`;
    const { data: closedToday } = await supabase.from("b3_simulation_orders")
      .select("mode, net_result_brl, exit_time")
      .eq("simulation_run_id", runId).eq("user_id", userId).eq("status", "closed")
      .gte("exit_time", startUtcIso);
    const map: Record<string, number> = { conservador: 0, moderado: 0, equilibrado: 0, semi_agressivo: 0, agressivo: 0 };
    for (const r of closedToday ?? []) {
      map[r.mode as string] = (map[r.mode as string] || 0) + Number(r.net_result_brl ?? 0);
    }
    return map;
  }
  let realizedTodayByMode = await getRealizedTodayByMode();

  const providerStats = {
    selected_source: "desconhecida" as string,
    provider_used: "B3QuoteProvider",
    mt5_provider_calls: 0,
    legacy_provider_calls: 0,
    fallback_to_csv: false,
    last_entry_price: null as number | null,
    last_exit_price: null as number | null,
    last_price_function: null as string | null,
    valid_mt5_orders: 0,
    legacy_orders_invalidated: 0,
  };

  function rememberProvider(info: B3PriceContextResult) {
    providerStats.selected_source = info.quote_source;
    providerStats.mt5_provider_calls += info.mt5_provider_calls;
    providerStats.legacy_provider_calls += info.legacy_provider_calls;
    providerStats.fallback_to_csv = providerStats.fallback_to_csv || info.fallback_to_csv;
  }

  function mt5InvalidReason(info: B3PriceContextResult): string | null {
    if (info.source !== "mt5_xp_demo") return null;
    const guardEval = info.guard_evaluation;
    if (info.warming_up_after_gap) {
      const sw = info.sample_window;
      return `warming_up_after_gap: ${sw?.fresh_samples ?? 0}/${sw?.required_samples ?? 0} ticks contínuos`
        + (sw?.cut_by_gap_s ? ` (gap de ${sw.cut_by_gap_s}s descartado)` : "")
        + (sw?.eta_ready_at ? ` — previsão ${sw.eta_ready_at}` : "");
    }
    if (!guardEval) return "Guard MT5 sem avaliação.";
    return guardEval.ok ? null : (guardEval.first_block_reason ?? "Guard MT5 rejeitou o tick.");
  }

  let totalsComputedOnce = false;
  async function recomputeModeTotalsFromValidMt5Orders(force = false) {
    // I/O: só recalcula uma vez por execução, salvo mudança real de ordens.
    if (totalsComputedOnce && !force) return;
    totalsComputedOnce = true;
    const { data: validOrders } = await supabase.from("b3_simulation_orders")
      .select("id, mode, status, quantity, fees, net_result_brl, gross_result_points, exit_time, created_at")
      .eq("simulation_run_id", runId).eq("user_id", userId)
      .eq("quote_source", "MT5 XP DEMO").eq("provider_name", "B3QuoteProvider");
    const byMode: Record<string, any[]> = {};
    for (const mode of MODES) byMode[mode] = [];
    for (const o of (validOrders ?? [])) if (byMode[o.mode]) byMode[o.mode].push(o);
    providerStats.valid_mt5_orders = (validOrders ?? []).length;

    for (const mode of MODES) {
      const m = modeByName[mode];
      if (!m) continue;
      const orders = byMode[mode] ?? [];
      const closed = orders.filter((o) => o.status === "closed");
      const realized = closed.reduce((s, o) => s + Number(o.net_result_brl ?? 0), 0);
      const fees = orders.reduce((s, o) => s + Number(o.fees ?? 0), 0);
      const wins = closed.filter((o) => Number(o.net_result_brl ?? 0) > 0).length;
      const losses = closed.filter((o) => Number(o.net_result_brl ?? 0) < 0).length;
      const maxGain = closed.reduce((v, o) => Math.max(v, Number(o.net_result_brl ?? 0)), 0);
      const maxLoss = closed.reduce((v, o) => Math.min(v, Number(o.net_result_brl ?? 0)), 0);
      const points = closed.reduce((s, o) => s + Number(o.gross_result_points ?? 0), 0);
      const contracts = orders.reduce((s, o) => s + Number(o.quantity ?? 0), 0);
      let acc = 0, peak = 0, dd = 0;
      for (const o of closed.slice().sort((a, b) => new Date(a.exit_time ?? a.created_at).getTime() - new Date(b.exit_time ?? b.created_at).getTime())) {
        acc += Number(o.net_result_brl ?? 0);
        peak = Math.max(peak, acc);
        dd = Math.max(dd, peak - acc);
      }
      const patch = {
        realized_pnl: realized,
        unrealized_pnl: 0,
        current_balance: Number(m.initial_balance) + realized,
        total_fees: fees,
        total_trades: closed.length,
        winning_trades: wins,
        losing_trades: losses,
        max_gain: maxGain,
        max_loss: maxLoss,
        max_drawdown: dd,
        points_result: points,
        contracts_traded: contracts,
      };
      // Grava só quando há mudança real de estado.
      const changed = Object.entries(patch).some(([k, v]) => Number(m[k] ?? 0) !== Number(v ?? 0));
      if (!changed) continue;
      await supabase.from("b3_simulation_modes").update(patch).eq("id", m.id).eq("user_id", userId);
      Object.assign(m, patch);
    }
  }

  async function invalidateLegacyOrdersForMt5(info: B3PriceContextResult) {
    if (info.source !== "mt5_xp_demo") return;
    const { data: legacyOrders } = await supabase.from("b3_simulation_orders")
      .select("id, mode, status, entry_price, exit_price, quote_source, provider_name")
      .eq("simulation_run_id", runId).eq("user_id", userId)
      .in("status", ["open", "closed"]);
    // Só ordens ainda ativas/fechadas — as já canceladas não são reprocessadas
    // (era isto que gerava UPDATE e evento a cada tick).
    const rows = (legacyOrders ?? []).filter((o: any) => o.quote_source !== "MT5 XP DEMO" || o.provider_name !== "B3QuoteProvider");
    if (!rows.length) {
      await recomputeModeTotalsFromValidMt5Orders();
      return;
    }
    const nowIso = new Date().toISOString();
    const ids = rows.map((o: any) => o.id);
    await supabase.from("b3_simulation_orders").update({
      status: "cancelled",
      close_reason: "Operação legada invalidada — modo MT5 XP DEMO exige preço B3QuoteProvider",
      exit_time: nowIso,
    }).in("id", ids).eq("user_id", userId);
    providerStats.legacy_orders_invalidated += rows.length;
    openOrdersCache = null;
    for (const o of rows.slice(0, 5)) {

      const m = modeByName[o.mode];
      if (!m) continue;
      await recordStatusIfChanged(o.mode, m, m.current_status ?? "operando", "legacy_price_invalidated", {
        related_order_id: o.id,
        message: "Operação legada ocultada/invalida — modo MT5 XP DEMO exige preço B3QuoteProvider",
        provider_name: info.provider_name,
        price_source: info.quote_source,
        rejected_price: Number(o.exit_price ?? o.entry_price ?? 0),
        mt5_last: info.raw?.last ?? null,
        // Evento idêntico não deve ser forçado novamente; o status/assinatura
        // já impede tempestade de auditoria sem alterar a invalidação da ordem.
        forceLog: false,
        diagnostic_payload: { function: "invalidateLegacyOrdersForMt5", order_quote_source: o.quote_source, order_provider_name: o.provider_name, ...quoteAuditBase(info) },
      });
    }
    await recomputeModeTotalsFromValidMt5Orders(true);

  }

  function orderAuditPatch(audit: B3QuoteExecutionAudit) {
    return {
      quote_source: audit.quote_source,
      quote_server: audit.quote_server,
      quote_symbol: audit.quote_symbol,
      quote_tick_ts: audit.quote_tick_ts,
      quote_bid: audit.quote_bid,
      quote_ask: audit.quote_ask,
      quote_last: audit.quote_last,
      execution_price: audit.execution_price,
      execution_price_origin: audit.execution_price_origin,
      legacy_price_detected: audit.legacy_price_detected,
      provider_name: audit.provider_name,
    };
  }

  // Helper: registra mudança de status operacional (parou de operar / voltou)
  async function recordStatusIfChanged(
    mode: string, m: any, newStatus: string, trigger: string,
    opts: {
      observed?: number; limit?: number; pnl?: number; related_order_id?: string; message?: string;
      provider_name?: string; price_source?: string; rejected_price?: number | null; mt5_last?: number | null; diagnostic_payload?: any;
      forceLog?: boolean;
    } = {},
  ) {
    const prev = m.current_status ?? "operando";
    if (prev === newStatus && !opts.forceLog) return;
    await supabase.from("b3_simulation_block_events").insert({
      simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
      mode, prev_status: prev, new_status: newStatus, trigger,
      observed_value: opts.observed ?? null,
      limit_value: opts.limit ?? null,
      pnl_at_moment: opts.pnl ?? null,
      related_order_id: opts.related_order_id ?? null,
      message: opts.message ?? null,
      provider_name: opts.provider_name ?? null,
      price_source: opts.price_source ?? null,
      rejected_price: opts.rejected_price ?? null,
      mt5_last: opts.mt5_last ?? null,
      diagnostic_payload: opts.diagnostic_payload ?? {},
    });
    if (prev !== newStatus) {
      await supabase.from("b3_simulation_modes").update({
        current_status: newStatus, status_reason: opts.message ?? null,
        status_changed_at: new Date().toISOString(), last_trigger: trigger,
      }).eq("id", m.id);
      m.current_status = newStatus;
      m.status_reason = opts.message ?? null;
      m.status_changed_at = new Date().toISOString();
      m.last_trigger = trigger;
    }
  }

  function auditCheck(key: string, label: string, ok: boolean, detail?: string, blocking = true) {
    return { key, label, status: ok ? "OK" : "NÃO", ok, detail: detail ?? null, blocking };
  }

  function normalizeModeConfig(cfgRow: any) {
    return {
      enabled: cfgRow.enabled !== false,
      volatility: Number(cfgRow.max_volatility_pct),
      score: Number(cfgRow.min_score),
      confidence: Number(cfgRow.min_confidence),
      min_approve_votes: Number(cfgRow.min_approve_votes),
      gain: Number(cfgRow.gain_pts),
      stop: Number(cfgRow.stop_pts),
      contracts: Number(cfgRow.max_contracts),
      daily_loss: Number(cfgRow.daily_loss_limit_brl),
      daily_target: Number(cfgRow.daily_gain_target_brl),
      trading_start_time: String(cfgRow.trading_start_time),
      entry_cutoff_time: String(cfgRow.entry_cutoff_time),
      force_close_time: String(cfgRow.force_close_time),
    };
  }

  function configComparison(cfgRow: any, loaded: any) {
    const saved = normalizeModeConfig(cfgRow);
    const keys = ["volatility", "score", "confidence", "gain", "stop", "contracts", "daily_loss", "daily_target", "trading_start_time", "entry_cutoff_time", "force_close_time"];
    const fields: Record<string, any> = {};
    for (const key of keys) {
      const screen = (saved as any)[key];
      const motor = (loaded as any)[key];
      fields[key] = { screen, motor, matches: String(screen) === String(motor) };
    }
    return { screen: saved, motor: loaded, fields, mismatch_count: Object.values(fields).filter((v: any) => !v.matches).length };
  }

  function finalReasonFromDecision(decision: any, committee: B3CommitteeSettings) {
    if (decision.final === "approved") return `Setup ${decision.side === "buy" ? "BUY" : "SELL"} aprovado.`;
    if (decision.final === "blocked") return decision.vetoes?.length ? `Bloqueado pelo comitê: ${decision.vetoes.join(" | ")}` : "Proteção global ou veto do comitê.";
    if (Number(decision.score) < Number(committee.min_score)) return "Score insuficiente.";
    if (Number(decision.avg_confidence) < Number(committee.min_confidence)) return "Confiança insuficiente.";
    if (Number(decision.approve_votes) < Number(committee.min_approve_votes)) return "Votos insuficientes no comitê.";
    if (decision.final === "rejected") return "Nenhum setup encontrado — agentes rejeitaram o sinal.";
    return "Nenhum setup encontrado.";
  }


  async function fetchMarketHistory(): Promise<any[]> {
    const nowIso = new Date().toISOString();
    const startOfDayBr = (() => {
      const d = new Date();
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(d);
      const y = parts.find(p => p.type === "year")?.value;
      const mo = parts.find(p => p.type === "month")?.value;
      const da = parts.find(p => p.type === "day")?.value;
      return new Date(`${y}-${mo}-${da}T00:00:00-03:00`).toISOString();
    })();
    const { data } = await supabase.from("b3_simulation_market_snapshots")
      // O JSON `extra` tem em média 6,4 KB e não é usado no cálculo abaixo.
      // Excluí-lo evita reler ~1,9 MB por execução do motor.
      .select("market_time, price, quote_bid, quote_ask, quote_last, volume, candle_high, candle_low")
      .eq("user_id", userId)
      .eq("simulation_run_id", runId)
      .gte("market_time", startOfDayBr)
      .lte("market_time", nowIso)
      .order("market_time", { ascending: false })
      .limit(300);
    return data ?? [];
  }

  // Candles M1 REAIS, montados do fluxo de ticks pela função b3_m1_candles.
  // Os campos candle_high/candle_low de b3_simulation_market_snapshots guardam
  // extremos ACUMULADOS de janela (máxima/mínima correntes), e por isso nunca
  // formam fractal (medido: ~3.100 snapshots em 7 pregões = 0 fundos, 1 topo).
  // Toda lógica de estrutura (price action na entrada e trailing estrutural)
  // deve usar esta série, não o histórico de snapshots.
  async function fetchM1Candles(): Promise<any[]> {
    const { data } = await supabase.rpc("b3_m1_candles", {
      p_user_id: userId, p_symbol: asset.symbol, p_limit: 300,
    });
    return ((data as any[]) ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
  }



  function deriveMarketMetrics(history: any[], ctxLocal: any, priceLocal: any) {
    const nowMs = Date.now();
    const prices: number[] = [];
    const volumes: number[] = [];
    let dayHigh = -Infinity, dayLow = Infinity;
    const priceAt = (targetOffsetMs: number) => {
      let best: any = null;
      let bestDiff = Infinity;
      for (const h of history) {
        const t = new Date(h.market_time).getTime();
        const diff = Math.abs(nowMs - targetOffsetMs - t);
        if (diff < bestDiff) { bestDiff = diff; best = h; }
      }
      if (!best) return null;
      const p = Number(best.quote_last ?? best.price ?? 0);
      return Number.isFinite(p) && p > 0 ? p : null;
    };
    for (const h of history) {
      const p = Number(h.quote_last ?? h.price ?? 0);
      if (Number.isFinite(p) && p > 0) {
        prices.push(p);
        if (p > dayHigh) dayHigh = p;
        if (p < dayLow) dayLow = p;
      }
      const v = Number(h.volume ?? 0);
      if (Number.isFinite(v)) volumes.push(v);
    }
    if (!Number.isFinite(dayHigh)) dayHigh = ctxLocal.price;
    if (!Number.isFinite(dayLow)) dayLow = ctxLocal.price;
    const p1 = priceAt(60 * 1000);
    const p3 = priceAt(3 * 60 * 1000);
    const p5 = priceAt(5 * 60 * 1000);
    const cur = ctxLocal.price;
    const var1 = p1 ? cur - p1 : null;
    const var3 = p3 ? cur - p3 : null;
    const var5 = p5 ? cur - p5 : null;
    // aceleração = variação 1m vs variação 3m (média por minuto)
    const accel = (var1 != null && var3 != null) ? (var1) - (var3 / 3) : null;
    const avgVol = volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null;
    return {
      day_high: dayHigh, day_low: dayLow,
      dist_day_high_pts: Math.round(dayHigh - cur),
      dist_day_low_pts: Math.round(cur - dayLow),
      var_1m_pts: var1 != null ? Math.round(var1) : null,
      var_3m_pts: var3 != null ? Math.round(var3) : null,
      var_5m_pts: var5 != null ? Math.round(var5) : null,
      acceleration_pts_per_min: accel != null ? Math.round(accel * 100) / 100 : null,
      avg_volume: avgVol != null ? Math.round(avgVol * 100) / 100 : null,
      samples: prices.length,
    };
  }

  // 07/08/2026: o multiplicador era 5 fixo. Como `rel` normaliza pelo PREÇO e
  // não pela volatilidade, ativos de baixa volatilidade relativa nunca saíam
  // de "lateral" — o WDO precisava de um gap de médias de 1,23x o próprio ATR
  // pra chegar a 30, contra 0,63x do WIN, e abaixo de 30 é bloqueio duro.
  // O fator por ativo equaliza isso. WINQ26 = 5 preserva o comportamento.
  function classifyTrend(ctxLocal: any, strengthFactor?: number): { direction: "alta" | "baixa" | "lateral"; strength: number } {
    const emaGap = ctxLocal.ema9 - ctxLocal.ema21;
    const abs = Math.abs(emaGap);
    const direction = emaGap > 0 ? "alta" : emaGap < 0 ? "baixa" : "lateral";
    const fator = Number(strengthFactor ?? 5) || 5;
    // força: 0..100 baseado no gap absoluto normalizado por preço + momentum
    const rel = ctxLocal.price ? (abs / ctxLocal.price) * 10000 : 0; // em basis points x10
    const strength = Math.max(0, Math.min(100, Math.round(rel * fator + Math.abs(ctxLocal.momentum ?? 0) / 3)));
    return { direction: abs < 1e-6 ? "lateral" : direction, strength };
  }

  function classifyRegime(ctxLocal: any, derived: any): string | null {
    if (!Number.isFinite(ctxLocal.volatility_pct)) return null;
    const vol = ctxLocal.volatility_pct;
    const trend = classifyTrend(ctxLocal, Number(asset?.trend_strength_factor ?? 5));
    if (vol > 3.5) return "alta_volatilidade";
    if (trend.strength >= 50 && trend.direction !== "lateral") return `tendencia_${trend.direction}`;
    if (Math.abs(derived?.var_5m_pts ?? 0) < 30 && vol < 1.5) return "range_estreito";
    return "consolidacao";
  }

  // Classifica o cenário técnico antes da aprovação final da entrada.
  // Fase 1: somente `trend_pullback` é operável. Os demais tipos são registrados
  // apenas para auditoria e bloqueiam a entrada com motivo `no_valid_setup`.
  type B3SetupName =
    | "trend_pullback"
    | "breakout_retest"
    | "consolidation_breakout"
    | "support_resistance_rejection"
    | "no_valid_setup";
  function classifySetup(params: {
    ctxLocal: any; derived: any; intendedSide: "buy" | "sell"; cfg: any;
  }): { name: B3SetupName; ok: boolean; reasons: string[]; details: Record<string, any> } {
    const { ctxLocal, derived, intendedSide, cfg } = params;
    const trend = classifyTrend(ctxLocal, Number(asset?.trend_strength_factor ?? 5));
    const price = Number(ctxLocal.price);
    const vwap = Number(ctxLocal.vwap);
    const ema9 = Number(ctxLocal.ema9);
    const ema21 = Number(ctxLocal.ema21);
    const open = Number(ctxLocal.open);
    const vol = Number(ctxLocal.volatility_pct ?? 0);
    const stopPts = Math.max(1, Number(cfg.stop_pts) || 0);
    const gainPts = Math.max(0, Number(cfg.gain_pts) || 0);
    const rr = stopPts > 0 ? gainPts / stopPts : 0;
    const distHigh = Number(derived?.dist_day_high_pts ?? 0);
    const distLow = Number(derived?.dist_day_low_pts ?? 0);
    // 07/08/2026: era Math.max(stopPts, 50). O piso de 50 vinha do mini índice,
    // que gira 3.770 pontos por dia. WDO gira 28,50; PETR4 1,86; VALE3 1,47 —
    // nesses ativos é impossível estar a mais de 50 pontos da máxima, então a
    // evidência "resistência/suporte próximo" reprovava sempre e eles operavam
    // com 6 de 7 evidências em vez de 6 de 8. WINQ26 = 50 preserva.
    const nearResistancePts = Number(asset?.near_resistance_pts ?? Math.max(stopPts, 50));
    const details: Record<string, any> = {
      trend_direction: trend.direction, trend_strength: trend.strength,
      price, vwap, ema9, ema21, open, volatility_pct: vol,
      risk_reward: Number(rr.toFixed(2)), min_risk_reward: 1.5,
      dist_day_high_pts: distHigh, dist_day_low_pts: distLow,
      near_resistance_pts: nearResistancePts,
    };

    // Bloqueio DURO (estrutura mínima real — não é opinião, é pré-requisito
    // pro trade fazer sentido nesse lado): mercado tem que ter direção.
    const lateralStrengthMin = Number((cfg as any).lateral_strength_min ?? 30);
    const lateralVolMin = Number((cfg as any).lateral_vol_min ?? 0.3);
    const lateral = trend.direction === "lateral" || trend.strength < lateralStrengthMin || vol < lateralVolMin;
    const wrongDirection =
      (intendedSide === "buy" && trend.direction === "baixa") ||
      (intendedSide === "sell" && trend.direction === "alta");
    const hardBlock: string[] = [];
    if (lateral) hardBlock.push("mercado lateral — entrada bloqueada");
    if (wrongDirection) hardBlock.push("tendência contrária ao lado avaliado");

    // Condições "macias" (evidências, não certezas): cada uma some para o
    // placar. Antes era tudo em "E" (9/9 obrigatórias); agora é threshold —
    // reflete que nenhuma delas sozinha invalida a oportunidade.
    const soft: { label: string; pass: boolean }[] = [];
    if (intendedSide === "buy") {
      soft.push({ label: `força de tendência ${trend.strength} < 40`, pass: trend.strength >= 40 });
      soft.push({ label: "preço abaixo da VWAP", pass: price > vwap });
      soft.push({ label: "EMA9 não acima da EMA21", pass: ema9 > ema21 });
      soft.push({ label: "sem correção para a EMA9 (sem pullback)", pass: price <= ema9 * 1.0015 });
      soft.push({ label: "estrutura perdida (preço abaixo da EMA21)", pass: price > ema21 });
      soft.push({ label: "candle atual não é comprador", pass: price > open });
      soft.push({ label: `resistência próxima (${distHigh} pts do topo)`, pass: !(distHigh > 0 && distHigh < nearResistancePts) });
    } else {
      soft.push({ label: `força de tendência ${trend.strength} < 40`, pass: trend.strength >= 40 });
      soft.push({ label: "preço acima da VWAP", pass: price < vwap });
      soft.push({ label: "EMA9 não abaixo da EMA21", pass: ema9 < ema21 });
      soft.push({ label: "sem correção para a EMA9 (sem pullback)", pass: price >= ema9 * 0.9985 });
      soft.push({ label: "estrutura perdida (preço acima da EMA21)", pass: price < ema21 });
      soft.push({ label: "candle atual não é vendedor", pass: price < open });
      soft.push({ label: `suporte próximo (${distLow} pts do fundo)`, pass: !(distLow > 0 && distLow < nearResistancePts) });
    }
    soft.push({ label: `R:R ${rr.toFixed(2)} < 1.5`, pass: rr >= 1.5 });

    const failedSoft = soft.filter((s) => !s.pass).map((s) => s.label);
    // Threshold configurável por modo (padrão: precisa acertar 6 de 8
    // evidências macias). cfg.setup_min_soft_hits permite ajustar por modo
    // sem tocar em código de novo.
    const minHits = Number((cfg as any).setup_min_soft_hits ?? 6);
    const hits = soft.length - failedSoft.length;
    const softOk = hits >= minHits;

    const failures = [...hardBlock, ...(softOk ? [] : failedSoft)];

    if (hardBlock.length === 0 && softOk) {
      return { name: "trend_pullback", ok: true, reasons: [], details: { ...details, soft_hits: hits, soft_total: soft.length } };
    }
    // Classifica em outros setups — agora também operáveis (ok reflete se
    // aquele padrão específico tem evidência suficiente), não só telemetria.
    let name: B3SetupName = "no_valid_setup";
    let altOk = false;
    if (intendedSide === "buy" && distHigh <= 20 && trend.direction === "alta") { name = "breakout_retest"; altOk = hardBlock.length === 0 && hits >= minHits - 1; }
    else if (intendedSide === "sell" && distLow <= 20 && trend.direction === "baixa") { name = "breakout_retest"; altOk = hardBlock.length === 0 && hits >= minHits - 1; }
    else if (Math.abs(Number(derived?.var_5m_pts ?? 0)) < 40 && vol < 1.5) { name = "consolidation_breakout"; altOk = !wrongDirection && rr >= 1.5; }
    else if (intendedSide === "buy" && distLow <= nearResistancePts) { name = "support_resistance_rejection"; altOk = !lateral && rr >= 1.5; }
    else if (intendedSide === "sell" && distHigh <= nearResistancePts) { name = "support_resistance_rejection"; altOk = !lateral && rr >= 1.5; }
    return { name, ok: altOk, reasons: failures, details: { ...details, soft_hits: hits, soft_total: soft.length } };
  }

  // Price action de verdade na entrada: estrutura de fundos/topos confirmados
  // (fractal N=1, mesma técnica já usada no trailing estrutural), em vez de
  // EMA/VWAP. Só é chamada quando cfg.entry_style === 'price_action'.
  // A série vem de b3_m1_candles (candles M1 reais); snapshots não servem
  // porque candle_high/candle_low neles são extremos acumulados de janela.
  function classifySetupPriceAction(params: {
    ctxLocal: any; intendedSide: "buy" | "sell"; cfg: any; m1Candles: any[];
  }): { name: B3SetupName; ok: boolean; reasons: string[]; details: Record<string, any> } {
    const { ctxLocal, intendedSide, cfg, m1Candles } = params;
    const price = Number(ctxLocal.price);
    const open = Number(ctxLocal.open);
    const stopPts = Math.max(1, Number(cfg.stop_pts) || 0);

    const sorted = (m1Candles ?? []).slice().sort((a: any, b: any) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
    if (sorted.length < 5) {
      return {
        name: "no_valid_setup", ok: false,
        reasons: ["aguardando candles de 1 minuto"],
        details: { m1_candles: sorted.length },
      };
    }
    const swingLows: number[] = [];
    const swingHighs: number[] = [];
    for (let i = 1; i < sorted.length - 1; i++) {
      const prev = sorted[i - 1], cur = sorted[i], next = sorted[i + 1];
      const lp = Number(prev.candle_low), lc = Number(cur.candle_low), ln = Number(next.candle_low);
      if ([lp, lc, ln].every(Number.isFinite) && lc < lp && lc < ln) swingLows.push(lc);
      const hp = Number(prev.candle_high), hc = Number(cur.candle_high), hn = Number(next.candle_high);
      if ([hp, hc, hn].every(Number.isFinite) && hc > hp && hc > hn) swingHighs.push(hc);
    }

    const details: Record<string, any> = { swing_lows_found: swingLows.length, swing_highs_found: swingHighs.length, m1_candles: sorted.length };


    if (swingLows.length < 2 || swingHighs.length < 2) {
      return { name: "no_valid_setup", ok: false, reasons: ["estrutura insuficiente — menos de 2 fundos/topos confirmados hoje"], details };
    }

    const [prevLow, lastLow] = swingLows.slice(-2);
    const [prevHigh, lastHigh] = swingHighs.slice(-2);
    const higherLow = lastLow > prevLow;
    const lowerHigh = lastHigh < prevHigh;
    const higherHigh = lastHigh > prevHigh;
    const lowerLow = lastLow < prevLow;
    Object.assign(details, { prev_low: prevLow, last_low: lastLow, prev_high: prevHigh, last_high: lastHigh });

    const hardBlock: string[] = [];
    let stopRef: number, targetRef: number;

    if (intendedSide === "buy") {
      const structureUp = higherLow && higherHigh;
      if (!structureUp) hardBlock.push("sem estrutura de alta confirmada (precisa fundo e topo mais altos)");
      if (price < lastLow) hardBlock.push("rompeu o último fundo estrutural — estrutura de alta invalidada");
      stopRef = lastLow; targetRef = lastHigh;
    } else {
      const structureDown = lowerHigh && lowerLow;
      if (!structureDown) hardBlock.push("sem estrutura de baixa confirmada (precisa topo e fundo mais baixos)");
      if (price > lastHigh) hardBlock.push("rompeu o último topo estrutural — estrutura de baixa invalidada");
      stopRef = lastHigh; targetRef = lastLow;
    }

    const stopDist = Math.abs(price - stopRef);
    const targetDist = Math.abs(targetRef - price);
    const rr = stopDist > 0 ? targetDist / stopDist : 0;

    const soft: { label: string; pass: boolean }[] = [];
    const nearStructPts = Math.max(stopPts * 0.6, 20);
    soft.push({ label: "longe do fundo/topo estrutural (pullback não confirmado)", pass: stopDist <= nearStructPts });
    soft.push({ label: intendedSide === "buy" ? "candle atual não é comprador" : "candle atual não é vendedor",
      pass: intendedSide === "buy" ? price > open : price < open });
    soft.push({ label: `R:R estrutural ${rr.toFixed(2)} < 1.5`, pass: rr >= 1.5 });

    const failedSoft = soft.filter(s => !s.pass).map(s => s.label);
    const minHits = Number((cfg as any).setup_min_soft_hits_pa ?? 2);
    const hits = soft.length - failedSoft.length;
    const softOk = hits >= minHits;
    const failures = [...hardBlock, ...(softOk ? [] : failedSoft)];
    Object.assign(details, { stop_ref: stopRef, target_ref: targetRef, risk_reward: Number(rr.toFixed(2)), soft_hits: hits, soft_total: soft.length });

    if (hardBlock.length === 0 && softOk) {
      return { name: "trend_pullback", ok: true, reasons: [], details };
    }
    return { name: "no_valid_setup", ok: false, reasons: failures, details };
  }

  function buildDecisionContext(params: {
    ctxLocal: any; priceLocal: any; cfg: any; mode: string; intendedSide: string;
    decision: any | null; derived: any; firstStop?: any;
    entry_reason?: string | null;
    setup?: { name: string; ok: boolean; reasons: string[]; details: Record<string, any> } | null;
  }) {
    const { ctxLocal, priceLocal, cfg, mode, intendedSide, decision, derived, firstStop, entry_reason, setup } = params;
    const trend = classifyTrend(ctxLocal, Number(asset?.trend_strength_factor ?? 5));
    return {
      timestamp: new Date().toISOString(),
      asset: priceLocal.quote_symbol ?? "WINQ26",
      robot: mode,
      suggested_side: intendedSide,
      price: ctxLocal.price,
      score: decision?.score ?? null,
      score_min: Number(cfg.min_score),
      confidence: decision?.avg_confidence ?? null,
      confidence_min: Number(cfg.min_confidence),
      approve_votes: decision?.approve_votes ?? null,
      approve_votes_min: Number(cfg.min_approve_votes),
      total_votes: decision?.total_votes ?? null,
      vetoes: decision?.vetoes ?? [],
      committee_result: decision?.final ?? null,
      committee_justification: decision?.justification ?? null,
      score_composition: decision?.composition ?? null,
      agent_votes: decision?.agent_votes ?? [],
      approval_or_first_block:
        decision?.final === "approved"
          ? `Aprovado: ${decision.justification ?? ""}`
          : firstStop ? `Bloqueado em ${firstStop.label}: ${firstStop.detail ?? ""}` : (decision?.justification ?? null),
      entry_reason: entry_reason ?? null,
      trend_direction: trend.direction,
      trend_strength: trend.strength,
      volatility_pct: ctxLocal.volatility_pct,
      spread_pts: Number(ctxLocal.spread_pts ?? priceLocal.raw?.spread ?? 0),
      vwap: ctxLocal.vwap,
      dist_vwap_pts: Math.round(ctxLocal.price - ctxLocal.vwap),
      day_high: derived.day_high,
      day_low: derived.day_low,
      dist_day_high_pts: derived.dist_day_high_pts,
      dist_day_low_pts: derived.dist_day_low_pts,
      volume_current: ctxLocal.volume_ratio,
      volume_avg: derived.avg_volume,
      acceleration_pts_per_min: derived.acceleration_pts_per_min,
      candle: {
        open: ctxLocal.open, high: ctxLocal.high, low: ctxLocal.low, close: ctxLocal.price,
      },
      var_1m_pts: derived.var_1m_pts,
      var_3m_pts: derived.var_3m_pts,
      var_5m_pts: derived.var_5m_pts,
      market_regime: classifyRegime(ctxLocal, derived),
      session_phase: ctxLocal.session_phase,
      setup: setup ? {
        name: setup.name,
        ok: setup.ok,
        reasons: setup.reasons,
        details: setup.details,
      } : null,
    };
  }


  for (let i = 0; i < ticks; i++) {
    const now = new Date();
    const cur = saoPauloMinutes(now);

    const priceSrc = await B3QuoteProvider(supabase, userId, {
      symbol: asset.quote_symbol, contract: asset.contract_code, base: Number(asset.base_price_fallback),
      expectedSymbol: asset.symbol, tickSize: Number(asset.tick_size),
      spreadMaxPoints: Number(asset.spread_max_price), priceDeviationLimit: Number(asset.price_deviation_limit),
      indicatorTimeframe: asset.indicator_timeframe === "m1" ? "m1" : "tick",
    });
    rememberProvider(priceSrc);
    const ctx = priceSrc.ctx;
    const marketHistory = await fetchMarketHistory();
    const m1Candles = await fetchM1Candles();

    const derived = deriveMarketMetrics(marketHistory, ctx, priceSrc);

    const invalidMt5 = mt5InvalidReason(priceSrc);

    // Dedup: se o tick é exatamente o mesmo já processado e não há posição
    // aberta para gerenciar, nada muda — evita gravações e leituras repetidas.
    const tickTs = priceSrc.raw?.tick_ts ?? null;
    const sameTick = Boolean(tickTs && memo.quote_tick_ts
      && new Date(tickTs).getTime() === new Date(memo.quote_tick_ts).getTime());

    if (sameTick && ((await getOpen()) ?? []).length === 0) {
      log.push({ action: "tick_dedup", reason: "quote_tick_ts repetido", tick_ts: tickTs });
      continue;
    }

    await invalidateLegacyOrdersForMt5(priceSrc);
    const macroBlock = (macros ?? []).find((m: any) => {
      const a = new Date(m.block_start).getTime();
      const b = new Date(m.block_end).getTime();
      return now.getTime() >= a && now.getTime() <= b;
    });

    const globalProtectionActive = Boolean(invalidMt5 || macroBlock);
    const globalProtectionReason = invalidMt5
      ? invalidMt5
      : macroBlock
      ? `Evento macro ativo: ${macroBlock.name}`
      : "Inativa";
    const snapshotExtra: any = { ema9: ctx.ema9, ema21: ctx.ema21, rsi: ctx.rsi, macd: ctx.macd, macd_signal: ctx.macd_signal,
      momentum: ctx.momentum, volatility_pct: ctx.volatility_pct, session_phase: ctx.session_phase,
      // Telemetria de tendência do tick (para calibrar lateral_strength_min / lateral_vol_min).
      trend_direction: classifyTrend(ctx, Number(asset?.trend_strength_factor ?? 5)).direction,
      trend_strength: classifyTrend(ctx, Number(asset?.trend_strength_factor ?? 5)).strength,
      volatility: Number(ctx.volatility_pct ?? 0),
      m1_candles: m1Candles.length,
      price_source: priceSrc.source, quote_age_s: priceSrc.quote_age_s, quote_symbol: priceSrc.quote_symbol,

      bid: priceSrc.raw?.bid, ask: priceSrc.raw?.ask, last: priceSrc.raw?.last,
      provider_name: priceSrc.provider_name, fallback_to_csv: priceSrc.fallback_to_csv,
      mt5_provider_calls: providerStats.mt5_provider_calls, legacy_provider_calls: providerStats.legacy_provider_calls,
      global_protection: { active: globalProtectionActive, reason: globalProtectionReason },
      tick_guard: priceSrc.guard_evaluation ? {
        mode: priceSrc.guard.mode,
        ok: priceSrc.guard_evaluation.ok,
        first_block_reason: priceSrc.guard_evaluation.first_block_reason,
        settings: priceSrc.guard_evaluation.settings,
        spread_pts: priceSrc.guard_evaluation.spread_pts,
        spread_ticks: priceSrc.guard_evaluation.spread_ticks,
        tick_age_s: priceSrc.guard_evaluation.tick_age_s,
        checks: priceSrc.guard_evaluation.checks,
      } : null,
    };
    const snapPayload: any = {
      symbol: asset.quote_symbol,
      price: ctx.price, candle_open: ctx.open, candle_high: ctx.high, candle_low: ctx.low,
      candle_close: ctx.price, volume: ctx.volume_ratio, vwap: ctx.vwap,
      market_time: now.toISOString(),
      source: priceSrc.live ? `mt5:${priceSrc.server ?? "xp"}` : (priceSrc.source === "mt5_xp_demo" ? "mt5:sem_tick" : "mock"),
      quote_source: priceSrc.quote_source,
      quote_server: priceSrc.server,
      quote_symbol: priceSrc.quote_symbol,
      quote_tick_ts: tickTs,
      quote_bid: priceSrc.raw?.bid ?? null,
      quote_ask: priceSrc.raw?.ask ?? null,
      quote_last: priceSrc.raw?.last ?? null,
      provider_name: priceSrc.provider_name,
    };
    // Hard throttle: nenhuma gravação intermediária aqui. O snapshot só é
    // persistido (1 INSERT) no fim do tick, e no máximo 1x a cada 10s.
    // Entre as persistências, preço e cotação ficam apenas em memória.
    const persistSnapshot = (now.getTime() - memo.persisted_at) >= SNAP_PERSIST_MS;
    memo.quote_tick_ts = tickTs;
    memo.last_price = ctx.price;
    memo.last_quote = { bid: priceSrc.raw?.bid ?? null, ask: priceSrc.raw?.ask ?? null, last: priceSrc.raw?.last ?? null, tick_ts: tickTs };
    const snapId: string | null = persistSnapshot ? null : memo.id;




    const intendedSide: B3Side = ctx.ema9 >= ctx.ema21 ? "buy" : "sell";
    const tickAudit: any = {
      snapshot_id: snapId,
      tick_index: i + 1,
      timestamp: now.toISOString(),
      source: priceSrc.source,
      provider_name: priceSrc.provider_name,
      last_tick: {
        bid: priceSrc.raw?.bid ?? null,
        ask: priceSrc.raw?.ask ?? null,
        last: priceSrc.raw?.last ?? null,
        spread: priceSrc.raw?.spread ?? ctx.spread_pts ?? null,
        tick_ts: priceSrc.raw?.tick_ts ?? null,
        age_s: priceSrc.quote_age_s,
        server: priceSrc.server,
        symbol: priceSrc.quote_symbol,
      },
      global_protection: {
        status: globalProtectionActive ? "Ativa" : "Inativa",
        active: globalProtectionActive,
        reason: globalProtectionReason,
      },
      tick_guard: snapshotExtra.tick_guard,
      modes: [] as any[],
    };

    // Quote-stall guard: se há qualquer posição aberta e o último tick tem >10s,
    // marcamos o motor como "cotação interrompida com posição aberta" e bloqueamos
    // qualquer ação (nova entrada OU fechamento) até a cotação retomar. Ao retomar
    // (age <= 10s), o fluxo existente processa primeiro o if(open) → stop/gain/zeragem
    // antes de avaliar novas entradas, satisfazendo a ordem exigida.
    const preOpenList = await getOpen();
    const quoteAgeS = Number(priceSrc.quote_age_s ?? 0);
    const anyOpenPre = (preOpenList ?? []).length > 0;
    const quoteStalledOpen = anyOpenPre && quoteAgeS > 10;
    tickAudit.quote_stall = {
      active: quoteStalledOpen,
      duration_s: quoteAgeS,
      any_position_open: anyOpenPre,
      threshold_s: 10,
    };

    // Timings por modo + isolamento de falha: um modo que estoura não pode
    // derrubar os modos seguintes nem impedir a gravação do snapshot.
    const modeTimings: Record<string, number> = {};
    const runT0 = Date.now();
    for (const mode of MODES) {
      const modeT0 = Date.now();
      try {
      const m = modeByName[mode];
      if (!m) continue;
      const cfg = settingsByMode[mode];
      const realizedToday = Number(realizedTodayByMode[mode] ?? 0);
      const startMin = hhmmToMin(cfg.trading_start_time);
      const cutoffMin = hhmmToMin(cfg.entry_cutoff_time);
      const forceMin = hhmmToMin(cfg.force_close_time);
      const insideHours = cur >= startMin && cur <= cutoffMin;
      const forceClose = cur >= forceMin || cur < startMin;
      // Antes da abertura o motor também "força fechamento" (não há nada aberto),
      // mas o rótulo de zeragem é enganoso — este estado é só pré-abertura.
      const beforeOpen = cur < startMin;

      const openList = await getOpen();
      const open = (openList ?? []).find((o: any) => o.simulation_mode_id === m.id);

      if (quoteStalledOpen) {
        await recordStatusIfChanged(mode, m, "cotacao_interrompida_posicao_aberta", "quote_stall_open_position", {
          pnl: realizedToday,
          related_order_id: open?.id ?? null,
          message: `Cotação interrompida há ${quoteAgeS.toFixed(0)}s com posição aberta — novas entradas bloqueadas até retomada.`,
        });
        log.push({ mode, action: "skip", reason: "quote_stall_open_position", stall_s: quoteAgeS, has_open: Boolean(open) });
        // finalizeAudit ainda não está definida neste ponto (é declarada dentro do bloco abaixo),
        // portanto empilhamos manualmente uma entrada mínima no tickAudit e continuamos.
        tickAudit.modes.push({
          mode,
          timestamp: now.toISOString(),
          last_tick: tickAudit.last_tick,
          last_setup: open ? `Posição ${open.side.toUpperCase()} aberta — aguardando retomada` : "Sem posição — aguardando retomada",
          last_refusal_reason: `Cotação interrompida há ${quoteAgeS.toFixed(0)}s — aguardando retomada antes de fechar/abrir.`,
          quote_stall: tickAudit.quote_stall,
          checks: [],
          signals: { evaluated_side: open?.side ?? intendedSide, buy: false, sell: false },
          committee: null,
        });
        continue;
      }

      const loadedConfig = normalizeModeConfig(cfg);
      const cfgCompare = configComparison(cfg, loadedConfig);
      const checks: any[] = [];
      const addCheck = (key: string, label: string, ok: boolean, detail?: string, blocking = true) => checks.push(auditCheck(key, label, ok, detail, blocking));
      const finalizeAudit = (finalReason: string, extra: Record<string, any> = {}) => {
        const firstStop = checks.find((c) => c.blocking && !c.ok);
        const decisionContext = buildDecisionContext({
          ctxLocal: ctx, priceLocal: priceSrc, cfg, mode, intendedSide,
          decision: extra.committee ?? null, derived, firstStop,
          entry_reason: extra.entry_reason ?? null,
          setup: extra.setup ?? null,
        });
        tickAudit.modes.push({
          mode,
          timestamp: now.toISOString(),
          last_tick: tickAudit.last_tick,
          last_analysis: extra.last_analysis ?? null,
          last_score: extra.last_score ?? null,
          last_confidence: extra.last_confidence ?? null,
          last_setup: extra.last_setup ?? "Nenhum setup aprovado",
          last_refusal_reason: finalReason,
          first_stop: firstStop ? { key: firstStop.key, label: firstStop.label, detail: firstStop.detail } : null,
          config_loaded: cfgCompare.motor,
          config_saved: cfgCompare.screen,
          config_comparison: cfgCompare.fields,
          config_mismatch_count: cfgCompare.mismatch_count,
          protection_global: tickAudit.global_protection,
          checks,
          signals: extra.signals ?? { evaluated_side: intendedSide, buy: false, sell: false },
          committee: extra.committee ?? null,
          decision_context: decisionContext,
          trade_event: extra.trade_event ?? null,
          volatility_debug: (priceSrc as any).volatility_debug ?? null,
          series_health: (priceSrc as any).series_health ?? null,
          volatility_limit_pct: Number(cfg.max_volatility_pct),
        });
      };


      addCheck("tick_received", "Tick recebido", priceSrc.source !== "mt5_xp_demo" || Boolean(priceSrc.raw), priceSrc.raw?.tick_ts ? `tick ${priceSrc.raw.tick_ts}` : "sem tick MT5");
      addCheck("mt5_server", "Servidor MT5", priceSrc.source !== "mt5_xp_demo" || priceSrc.server === "XPMT5-DEMO" || priceSrc.server === "XPMT5-PRD", priceSrc.server ? `recebido ${priceSrc.server}` : "sem servidor");
      addCheck("mt5_symbol", `Símbolo ${asset.symbol}`, priceSrc.source !== "mt5_xp_demo" || priceSrc.quote_symbol === asset.symbol, priceSrc.quote_symbol ? `recebido ${priceSrc.quote_symbol}` : "sem símbolo");
      addCheck("market_open", "Mercado aberto", ctx.session_phase !== "fora", `fase ${ctx.session_phase}`);
      addCheck("time_allowed", "Horário permitido", insideHours, `${cfg.trading_start_time}–${cfg.entry_cutoff_time}`);
      addCheck("operation_window", "Janela operacional", insideHours, `${cfg.trading_start_time}–${cfg.entry_cutoff_time}`);
      addCheck("force_close_window", "Janela zeragem", !forceClose, `zeragem ${cfg.force_close_time}`);
      addCheck("valid_quote", "Cotação válida", !invalidMt5, invalidMt5 ?? `bid ${priceSrc.raw?.bid ?? "—"} · ask ${priceSrc.raw?.ask ?? "—"}`);
      addCheck("spread", "Spread", Number(ctx.spread_pts ?? priceSrc.raw?.spread ?? 0) > 0, `${Number(ctx.spread_pts ?? priceSrc.raw?.spread ?? 0)} pts`, false);
      addCheck("global_protection", "Proteção Global", !globalProtectionActive, globalProtectionReason);

      if (invalidMt5) {
        await recordStatusIfChanged(mode, m, "erro_tecnico", "price_source_guard", {
          pnl: realizedToday,
          message: invalidMt5,
          provider_name: priceSrc.provider_name,
          price_source: priceSrc.quote_source,
          rejected_price: ctx.price,
          mt5_last: priceSrc.raw?.last ?? null,
          forceLog: false,
          diagnostic_payload: {
            function: "runB3SimulationTick",
            provider: priceSrc.provider_name,
            selected_source: priceSrc.source,
            quote_source: priceSrc.quote_source,
            symbol: priceSrc.quote_symbol,
            server: priceSrc.server,
            quote_age_s: priceSrc.quote_age_s,
            bid: priceSrc.raw?.bid ?? null,
            ask: priceSrc.raw?.ask ?? null,
            last: priceSrc.raw?.last ?? null,
          },
        });
        log.push({ mode, action: "skip", reason: "mt5_quote_invalid", detail: invalidMt5 });
        finalizeAudit(invalidMt5);
        continue;
      }

      // ─────────── B3 Protection (Flexibilização Inteligente) ───────────
      const todayKey = b3DayKeyBRT(now);
      // Reset diário se virou o dia.
      if (m.protection_day_key && m.protection_day_key !== todayKey) {
        try {
          await supabase.from("b3_daily_protection_history").upsert({
            user_id: userId, simulation_run_id: runId, simulation_mode_id: m.id, mode,
            day_key: m.protection_day_key,
            target_reached_at: m.target_reached_at,
            block_at: m.protection_state?.startsWith("blocked_") ? m.status_changed_at : null,
            profit_at_target_brl: m.profit_at_target_brl,
            peak_profit_after_target_brl: m.peak_profit_after_target_brl,
            profit_after_target_brl: m.profit_after_target_brl,
            given_back_brl: Math.max(0, Number(m.peak_profit_after_target_brl ?? 0) - Number(m.profit_at_target_brl ?? 0) - Number(m.profit_after_target_brl ?? 0)),
            profit_at_close_brl: null,
            trades_total: m.total_trades,
            trades_after_target: m.trades_after_target,
            drawdown_after_target_brl: Math.max(0, Number(m.peak_profit_after_target_brl ?? 0) - (Number(m.profit_at_target_brl ?? 0) + Number(m.profit_after_target_brl ?? 0))),
            block_reason: m.protection_block_reason,
            final_status: m.protection_state,
          }, { onConflict: "user_id,simulation_run_id,mode,day_key" });
        } catch { /* histórico é best-effort */ }
        const reset = resetB3ProtectionForNewDay();
        Object.assign(m, reset);
      }

      // Deriva trades/consecutive losses pós-meta a partir das ordens fechadas.
      let tradesAfterTarget = Number(m.trades_after_target ?? 0);
      let consecLosses = Number(m.consecutive_losses_after_target ?? 0);
      if (m.target_reached_at) {
        const { data: post } = await supabase.from("b3_simulation_orders")
          .select("net_result_brl, exit_time")
          .eq("simulation_run_id", runId).eq("simulation_mode_id", m.id)
          .eq("status", "closed").gte("exit_time", m.target_reached_at)
          .order("exit_time", { ascending: true });
        tradesAfterTarget = (post ?? []).length;
        consecLosses = 0;
        for (let k = (post ?? []).length - 1; k >= 0; k--) {
          if (Number(post![k].net_result_brl ?? 0) < 0) consecLosses++; else break;
        }
      }

      // Tempo operando hoje (BRT) — a partir das 09:00.
      const opMinutes = Math.max(0, saoPauloMinutes(now) - hhmmToMin(cfg.trading_start_time));

      const protCfg: B3ProtectionSettings = {
        minimum_trades_before_profit_lock: Number(cfg.minimum_trades_before_profit_lock ?? 15),
        minimum_operating_minutes: Number(cfg.minimum_operating_minutes ?? 90),
        profit_multiplier_before_lock: Number(cfg.profit_multiplier_before_lock ?? 2.0),
        post_target_allowed_retracement: Number(cfg.post_target_allowed_retracement ?? 0.30),
        consecutive_loss_after_target: Number(cfg.consecutive_loss_after_target ?? 2),
        post_target_size_reduction: Number(cfg.post_target_size_reduction ?? 0.50),
        daily_loss_limit_brl: Number(cfg.daily_loss_limit_brl),
        daily_gain_target_brl: Number(cfg.daily_gain_target_brl),
        max_volatility_pct: Number(cfg.max_volatility_pct),
      };

      const protCur: B3ProtectionRuntime = {
        protection_state: (m.protection_state as any) ?? "operating_normal",
        target_reached_at: m.target_reached_at ?? null,
        profit_at_target_brl: m.profit_at_target_brl != null ? Number(m.profit_at_target_brl) : null,
        trades_at_target: m.trades_at_target != null ? Number(m.trades_at_target) : null,
        peak_profit_after_target_brl: Number(m.peak_profit_after_target_brl ?? 0),
        profit_after_target_brl: Number(m.profit_after_target_brl ?? 0),
        trades_after_target: tradesAfterTarget,
        consecutive_losses_after_target: consecLosses,
        protection_block_reason: m.protection_block_reason ?? null,
      };

      const protDec = evaluateB3Protection(protCur, protCfg, {
        realized_today_brl: realizedToday,
        total_trades_today: Number(m.total_trades ?? 0),
        operating_minutes_today: opMinutes,
        volatility_pct: ctx.volatility_pct,
        drawdown_hit: false,
        now_iso: now.toISOString(),
      });

      // Persistir runtime de proteção — apenas quando algo muda de fato.
      const protPatch = {
        protection_state: protDec.next.protection_state,
        target_reached_at: protDec.next.target_reached_at,
        profit_at_target_brl: protDec.next.profit_at_target_brl,
        trades_at_target: protDec.next.trades_at_target,
        peak_profit_after_target_brl: protDec.next.peak_profit_after_target_brl,
        profit_after_target_brl: protDec.next.profit_after_target_brl,
        trades_after_target: protDec.next.trades_after_target,
        consecutive_losses_after_target: protDec.next.consecutive_losses_after_target,
        protection_block_reason: protDec.next.protection_block_reason,
        protection_day_key: todayKey,
      } as Record<string, any>;
      const protChanged = Object.entries(protPatch).some(([k, v]) => {
        const cur = m[k] ?? null;
        const next = v ?? null;
        if (typeof next === "number" || typeof cur === "number") return Number(cur ?? 0) !== Number(next ?? 0);
        return String(cur ?? "") !== String(next ?? "");
      });
      if (protChanged) {
        await supabase.from("b3_simulation_modes").update(protPatch).eq("id", m.id);
        Object.assign(m, protPatch);
      }


      if (protDec.transition) {
        try {
          await supabase.from("b3_simulation_block_events").insert({
            simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
            mode,
            prev_status: protDec.transition.from,
            new_status: protDec.transition.to,
            trigger: `protection:${protDec.transition.to}`,
            observed_value: realizedToday,
            limit_value: protCfg.daily_gain_target_brl,
            pnl_at_moment: realizedToday,
            message: protDec.transition.reason,
          });
        } catch { /* best-effort */ }
      }
      // ────────────────── fim B3 Protection ──────────────────

      addCheck("mode_enabled", "Robô habilitado", cfg.enabled !== false, cfg.enabled === false ? "Modo desativado nas configurações." : "habilitado");
      addCheck("volatility", "Volatilidade", ctx.volatility_pct <= Number(cfg.max_volatility_pct), `${ctx.volatility_pct.toFixed(2)}% / limite ${Number(cfg.max_volatility_pct).toFixed(2)}%`);
      addCheck("max_trades", "Máximo trades", !open && 1 <= Number(cfg.max_contracts), open ? "Já existe posição aberta neste robô." : `1 / ${Number(cfg.max_contracts)} contrato(s)`);
      addCheck("daily_loss", "Loss diário", realizedToday > -Number(cfg.daily_loss_limit_brl), `${realizedToday.toFixed(2)} / -${Number(cfg.daily_loss_limit_brl).toFixed(2)} BRL`);
      const realizedTodayTotal = Object.values(realizedTodayByMode).reduce((a: number, b: any) => a + Number(b ?? 0), 0);
      addCheck("daily_loss_aggregate", "Perda diária agregada (conta)", realizedTodayTotal > -GLOBAL_DAILY_LOSS_LIMIT_BRL,
        `${realizedTodayTotal.toFixed(2)} / -${GLOBAL_DAILY_LOSS_LIMIT_BRL.toFixed(2)} BRL (5 modos somados)`);
      addCheck("daily_target", "Meta diária", realizedToday < Number(cfg.daily_gain_target_brl) || protDec.allow_new_entry, `${realizedToday.toFixed(2)} / ${Number(cfg.daily_gain_target_brl).toFixed(2)} BRL`);
      addCheck("position_open", "Posição aberta", !open, open ? `ordem ${open.id}` : "NÃO", false);
      addCheck("protection_engine", "Proteção diária", protDec.allow_new_entry, protDec.next.protection_block_reason ?? protDec.next.protection_state);

      if (cfg.enabled === false) {
        await recordStatusIfChanged(mode, m, "pausado", "paused",
          { pnl: realizedToday, message: "Modo desativado nas configurações." });
        log.push({ mode, action: "skip", reason: "modo_desativado" });
        finalizeAudit("Robô desativado nas configurações.");
        continue;
      }

      if (open) {
        if (priceSrc.source === "mt5_xp_demo" && open.quote_source !== "MT5 XP DEMO") {
          await supabase.from("b3_simulation_orders").update({
            status: "cancelled",
            close_reason: "Fonte alterada para MT5 XP DEMO — operação legada invalidada",
          }).eq("id", open.id).eq("user_id", userId);
          openOrdersCache = null;
          log.push({ mode, action: "cancel_legacy_open", reason: "legacy_price_state_invalidated" });
          finalizeAudit("Posição legada aberta foi invalidada antes de nova decisão.");
          continue;
        }
        const dirSign = open.side === "buy" ? 1 : -1;
        let markAudit: B3QuoteExecutionAudit;
        try {
          markAudit = getB3ExecutionAudit(priceSrc, open.side, "mark", "runB3SimulationTick.markToMarket");
          if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(markAudit, "runB3SimulationTick.markToMarket", asset.symbol);
          providerStats.last_price_function = markAudit.execution_price_origin;
        } catch (e) {
          await recordStatusIfChanged(mode, m, "erro_tecnico", "price_source_guard", {
            pnl: realizedToday,
            related_order_id: open.id,
            message: (e as Error).message,
            provider_name: priceSrc.provider_name,
            price_source: priceSrc.quote_source,
            rejected_price: ctx.price,
            mt5_last: priceSrc.raw?.last ?? null,
            forceLog: false,
            diagnostic_payload: { function: "runB3SimulationTick.markToMarket", attempted_context_price: ctx.price, ...quoteAuditBase(priceSrc) },
          });
          log.push({ mode, action: "skip", reason: "price_guard", message: (e as Error).message });
          finalizeAudit((e as Error).message);
          continue;
        }
        const markPrice = markAudit.execution_price;
        const movePts = (markPrice - Number(open.entry_price)) * dirSign;
        const hitStop = movePts <= -Number(cfg.stop_pts);
        const hitGain = movePts >= Number(cfg.gain_pts);

        // ────────── proteção de lucro: ativação + recuo (trailing) ──────────
        // Desligada por padrão (trailing_activation_pts=0). Quando ligada,
        // olha o histórico de mercado desde a entrada pra achar o MELHOR
        // ponto já alcançado (peakPts) — não confundir com o preço atual.
        // Dois modos, escolhidos por cfg.trailing_mode:
        //  'fixed'      → fecha se recuar trailing_giveback_pts do pico (pts fixos)
        //  'structural' → fecha se romper o último fundo/topo CONFIRMADO
        //                 (fractal N=1: candle_low[i] menor que o candle antes
        //                 e depois dele = fundo confirmado; simétrico pra topo
        //                 em posição vendida). Mais fiel a price action, mas
        //                 só reconhece o fundo/topo DEPOIS que o candle seguinte
        //                 já fechou — atraso é inerente ao conceito, não é bug.
        let hitTrailing = false;
        let peakPts = movePts;
        let trailingDebug: any = null;
        const trailingOn = Number(cfg.trailing_activation_pts) > 0;
        const entryMsForTrailing = open.entry_time ? new Date(open.entry_time).getTime() : null;
        if (trailingOn && entryMsForTrailing) {
          const sinceEntry = marketHistory
            .filter((h: any) => {
              const t = new Date(h.market_time).getTime();
              return t >= entryMsForTrailing && t <= Date.now();
            })
            .sort((a: any, b: any) => new Date(a.market_time).getTime() - new Date(b.market_time).getTime());

          for (const h of sinceEntry) {
            const p = Number(h.quote_last ?? h.price ?? 0);
            if (!Number.isFinite(p) || p <= 0) continue;
            const move = (p - Number(open.entry_price)) * dirSign;
            if (move > peakPts) peakPts = move;
          }
          const armed = peakPts >= Number(cfg.trailing_activation_pts);

          if (armed && cfg.trailing_mode === "structural") {
            // Fractal N=1 sobre candles M1 REAIS (b3_m1_candles): candle i é
            // fundo (compra) se candle_low[i] < low[i-1] e < low[i+1]; é topo
            // (venda) se candle_high[i] > high[i-1] e > high[i+1].
            // Snapshots não servem: seus extremos são acumulados de janela.
            const candlesSinceEntry = m1Candles.filter((c: any) => {
              const t = new Date(c.minute_ts).getTime();
              return t >= entryMsForTrailing && t <= Date.now();
            });
            let structuralStopPrice: number | null = null;
            for (let i = 1; i < candlesSinceEntry.length - 1; i++) {
              const prev = candlesSinceEntry[i - 1], cur = candlesSinceEntry[i], next = candlesSinceEntry[i + 1];
              if (open.side === "buy") {
                const lowPrev = Number(prev.candle_low), lowCur = Number(cur.candle_low), lowNext = Number(next.candle_low);
                if ([lowPrev, lowCur, lowNext].every(Number.isFinite) && lowCur < lowPrev && lowCur < lowNext) {
                  if (structuralStopPrice === null || lowCur > structuralStopPrice) structuralStopPrice = lowCur;
                }
              } else {
                const highPrev = Number(prev.candle_high), highCur = Number(cur.candle_high), highNext = Number(next.candle_high);
                if ([highPrev, highCur, highNext].every(Number.isFinite) && highCur > highPrev && highCur > highNext) {
                  if (structuralStopPrice === null || highCur < structuralStopPrice) structuralStopPrice = highCur;
                }
              }
            }
            trailingDebug = { mode: "structural", structural_stop_price: structuralStopPrice, peak_pts: peakPts, m1_candles_since_entry: candlesSinceEntry.length };

            if (structuralStopPrice !== null) {
              hitTrailing = dirSign === 1 ? markPrice <= structuralStopPrice : markPrice >= structuralStopPrice;
            }
          } else if (armed && Number(cfg.trailing_giveback_pts) > 0) {
            hitTrailing = (peakPts - movePts) >= Number(cfg.trailing_giveback_pts);
            trailingDebug = { mode: "fixed", peak_pts: peakPts, giveback_pts: Number(cfg.trailing_giveback_pts) };
          }
        }

        if (forceClose || hitStop || hitGain || hitTrailing) {
          const reason = forceClose ? "force_close" : hitStop ? "stop" : hitGain ? "gain" : "trailing_stop";
          const tradeCtx = await closeOrder(supabase, userId, run, m, open, markAudit, reason, marketHistory, asset);
          providerStats.last_exit_price = markPrice;
          openOrdersCache = null;
          realizedTodayByMode = await getRealizedTodayByMode();
          if (reason === "stop") {
            await recordStatusIfChanged(mode, m, "stop_operacao", "stop_trade",
              { observed: movePts, limit: -Number(cfg.stop_pts), pnl: realizedTodayByMode[mode] ?? 0,
                related_order_id: open.id, message: `Stop da operação atingido (${movePts.toFixed(0)} pts).` });
          }
          log.push({ mode, action: "close", reason, price: markPrice, source: markAudit.quote_source, origin: markAudit.execution_price_origin });
          finalizeAudit(`Posição existente encerrada por ${reason}.`, {
            last_setup: `Posição ${open.side.toUpperCase()} em gestão`,
            signals: { evaluated_side: open.side, buy: false, sell: false },
            trade_event: tradeCtx,
          });
          continue;
        }

      }

      // Bloqueio de proteção B3 substitui o antigo gate "meta atingida".
      if (!protDec.allow_new_entry) {
        await recordStatusIfChanged(mode, m, protDec.next.protection_state, `protection:${protDec.next.protection_state}`,
          { pnl: realizedToday, message: protDec.next.protection_block_reason ?? "Bloqueio pós-meta." });
        log.push({ mode, action: "skip", reason: protDec.next.protection_state });
        finalizeAudit(protDec.next.protection_block_reason ?? "Proteção global/diária bloqueou nova entrada.");
        continue;
      }

      // Diagnóstico visual: rotula o estado atual (sem bloquear gainHit).
      const lossHit = realizedToday <= -Number(cfg.daily_loss_limit_brl);
      if (lossHit) {
        await recordStatusIfChanged(mode, m, "bloqueado_perda_diaria", "daily_loss",
          { observed: realizedToday, limit: -Number(cfg.daily_loss_limit_brl), pnl: realizedToday,
            message: `Limite diário de perda atingido (${realizedToday.toFixed(2)} BRL).` });
      } else if (beforeOpen) {
        await recordStatusIfChanged(mode, m, "aguardando_abertura", "before_open",
          { pnl: realizedToday, message: `Fora da janela de operação — abre às ${cfg.trading_start_time}.` });
      } else if (forceClose) {
        await recordStatusIfChanged(mode, m, "bloqueado_zeragem", "force_close",
          { pnl: realizedToday, message: "Janela de zeragem obrigatória." });

      } else if (!insideHours) {
        await recordStatusIfChanged(mode, m, "bloqueado_horario", "time",
          { pnl: realizedToday, message: "Fora da janela operacional." });
      } else if (macroBlock) {
        await recordStatusIfChanged(mode, m, "bloqueado_risco", "macro_risk",
          { pnl: realizedToday, message: `Evento macro: ${macroBlock.name}.` });
      } else if (ctx.volatility_pct > Number(cfg.max_volatility_pct)) {
        const vdbg = (priceSrc as any).volatility_debug ?? null;
        await recordStatusIfChanged(mode, m, "bloqueado_volatilidade", "volatility",
          { observed: ctx.volatility_pct, limit: Number(cfg.max_volatility_pct), pnl: realizedToday,
            message: `Volatilidade ${ctx.volatility_pct.toFixed(2)}% acima do limite ${Number(cfg.max_volatility_pct).toFixed(2)}%${vdbg ? ` (raw ${vdbg.raw_pct}%, ${vdbg.formula}, amostras ${vdbg.samples})` : ""}.`,
            diagnostic_payload: vdbg ? { volatility_debug: vdbg } : undefined });
      } else if (protDec.next.protection_state === "target_reached_observing") {
        await recordStatusIfChanged(mode, m, "target_reached_observing", "protection",
          { pnl: realizedToday, message: "Meta atingida — em observação (size reduzido)." });
      } else if (protDec.next.protection_state === "profit_protected") {
        await recordStatusIfChanged(mode, m, "profit_protected", "protection",
          { pnl: realizedToday, message: "Lucro protegido (size reduzido)." });
      } else {
        await recordStatusIfChanged(mode, m, "operando", "ok",
          { pnl: realizedToday, message: "Operando normalmente." });
      }

      if (!insideHours || forceClose) {
        log.push({ mode, action: "skip", reason: beforeOpen ? "aguardando_abertura" : !insideHours ? "fora_horario" : "zeragem" });
        finalizeAudit(beforeOpen
          ? `Fora da janela de operação — abre às ${cfg.trading_start_time}.`
          : !insideHours ? "Fora da janela operacional." : "Janela de zeragem obrigatória.");
        continue;
      }

      if (macroBlock) {
        log.push({ mode, action: "skip", reason: `macro:${macroBlock.name}` });
        if (sigChanged(`block:${mode}`, `macro:${macroBlock.name}`)) {
          await supabase.from("b3_simulation_modes")
            .update({ risk_blocks: (Number(m.risk_blocks) || 0) + 1 }).eq("id", m.id);
          m.risk_blocks = (Number(m.risk_blocks) || 0) + 1;
        }
        finalizeAudit(`Proteção global: evento macro ${macroBlock.name}.`);
        continue;
      }

      if (open) {
        finalizeAudit("Posição já aberta — motor apenas gerencia stop/gain/zeragem.", {
          last_setup: `Posição ${open.side.toUpperCase()} aberta`,
          signals: { evaluated_side: open.side, buy: false, sell: false },
        });
        continue;
      }

      // Se protegido/observando, elevamos o daily_gain_target passado ao Risco
      // para não bloquear por "meta atingida" — a decisão de continuar já foi tomada aqui.
      const inProtectionRun = protDec.next.protection_state === "target_reached_observing"
        || protDec.next.protection_state === "profit_protected";
      const risk: B3RiskState = {
        daily_loss_limit: Number(cfg.daily_loss_limit_brl),
        daily_gain_target: inProtectionRun ? Number.MAX_SAFE_INTEGER : Number(cfg.daily_gain_target_brl),
        realized_today_brl: realizedToday,
        open_contracts: 0,
        max_contracts: Number(cfg.max_contracts),
        requested_qty: 1,
        inside_hours: insideHours,
        force_close_now: forceClose,
        strategy_mode: mode,
      };
      const localCtx = { ...ctx };
      if (localCtx.volatility_pct > Number(cfg.max_volatility_pct)) {
        if (sigChanged(`block:${mode}`, "volatility")) {
          await supabase.from("b3_simulation_modes")
            .update({ risk_blocks: (Number(m.risk_blocks) || 0) + 1 }).eq("id", m.id);
          m.risk_blocks = (Number(m.risk_blocks) || 0) + 1;
        }

        log.push({ mode, action: "skip", reason: "volatilidade" });
        finalizeAudit("Bloqueado por volatilidade.");
        continue;
      }


      // Agentes recebem os limites REAIS do modo — sem isso os 5 modos
      // avaliavam o mesmo tick com constantes idênticas (3,5% / 150-300 pts).
      const votes = runB3Agents(localCtx, intendedSide, risk, {
        max_volatility_pct: Number(cfg.max_volatility_pct),
        min_volatility_pct: Number((cfg as any).min_volatility_pct ?? 0.6),
        stop_pts: Number(cfg.stop_pts),
        gain_pts: Number(cfg.gain_pts),
      });

      const committee: B3CommitteeSettings = {
        min_approve_votes: Number(cfg.min_approve_votes),
        min_confidence: Number(cfg.min_confidence),
        min_score: Number(cfg.min_score),
      };
      const decision = buildB3Decision(votes, intendedSide, committee);
      addCheck("score", "Score", Number(decision.score) >= Number(cfg.min_score), `${decision.score.toFixed(0)} / mínimo ${Number(cfg.min_score).toFixed(0)}`);
      addCheck("confidence", "Confiança", Number(decision.avg_confidence) >= Number(cfg.min_confidence), `${decision.avg_confidence.toFixed(0)} / mínimo ${Number(cfg.min_confidence).toFixed(0)}`);
      addCheck("committee", "Comitê", decision.final === "approved", decision.justification);
      addCheck("signal_buy", "Sinal BUY", decision.final === "approved" && intendedSide === "buy", intendedSide === "buy" ? decision.final : "lado avaliado SELL", false);
      addCheck("signal_sell", "Sinal SELL", decision.final === "approved" && intendedSide === "sell", intendedSide === "sell" ? decision.final : "lado avaliado BUY", false);

      // Telemetria por modo dos limiares de lateralidade efetivamente aplicados.
      {
        const tTel = classifyTrend(localCtx, Number(asset?.trend_strength_factor ?? 5));
        snapshotExtra.lateral_gates = {
          ...(snapshotExtra.lateral_gates ?? {}),
          [mode]: {
            trend_direction: tTel.direction,
            trend_strength: tTel.strength,
            volatility: Number(localCtx.volatility_pct ?? 0),
            lateral_strength_min: Number((cfg as any).lateral_strength_min ?? 30),
            lateral_vol_min: Number((cfg as any).lateral_vol_min ?? 0.3),
          },
        };
      }

      // Classificação de setup técnico — Fase 2: os 4 padrões classificados
      // podem operar (trend_pullback, breakout_retest, consolidation_breakout,
      // support_resistance_rejection), cada um com sua própria checagem de
      // evidência mínima dentro de classifySetup. no_valid_setup nunca opera.
      const setupInfo = cfg.entry_style === "price_action"
        ? classifySetupPriceAction({ ctxLocal: localCtx, intendedSide, cfg, m1Candles })
        : classifySetup({ ctxLocal: localCtx, derived, intendedSide, cfg });

      const setupAllowed = setupInfo.name !== "no_valid_setup" && setupInfo.ok;
      addCheck(
        "setup",
        "Setup técnico",
        setupAllowed,
        setupAllowed
          ? `${setupInfo.name} validado`
          : `${setupInfo.name}${setupInfo.reasons.length ? ` — ${setupInfo.reasons.join("; ")}` : ""}`,
      );

      // Votos: gravados só quando o comitê muda (mesmo veredito em ticks
      // seguidos não gera novas linhas). Nenhuma regra de decisão é alterada.
      const voteSig = `${decision.final}|${intendedSide}|${votes.map(v => `${v.agent_name}:${v.vote}:${Math.round(Number(v.confidence) || 0)}`).join(",")}`;
      if (sigChanged(`votes:${mode}`, voteSig)) {
        const voteRows = votes.map(v => ({
          simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
          mode, agent_name: v.agent_name, vote: v.vote, confidence: v.confidence, reason: v.reason,
          market_data_snapshot: {
            snapshot_id: snapId, decision: decision.final, score: decision.score,
            price: ctx.price, side: intendedSide, has_veto: v.has_veto, veto_reason: v.veto_reason ?? null,
          } as any,
        }));
        await supabase.from("b3_simulation_agent_votes").insert(voteRows);
      }

      if (decision.final === "approved" && !setupAllowed) {
        // Comitê aprovou, mas o setup técnico não é operável (Fase 1: só trend_pullback).
        const reason = `Setup ${setupInfo.name} — ${setupInfo.reasons.join("; ") || "critérios de trend_pullback não atendidos"}`;
        if (sigChanged(`block:${mode}`, `no_valid_setup:${setupInfo.name}`)) {
          await supabase.from("b3_simulation_modes")
            .update({ committee_rejections: (Number(m.committee_rejections) || 0) + 1 }).eq("id", m.id);
          m.committee_rejections = (Number(m.committee_rejections) || 0) + 1;
        }

        log.push({ mode, action: "reject", reason: "no_valid_setup", setup: setupInfo.name, side: intendedSide });
        finalizeAudit(reason, {
          last_analysis: decision.justification,
          last_score: decision.score,
          last_confidence: decision.avg_confidence,
          last_setup: `Bloqueado: ${setupInfo.name}`,
          signals: { evaluated_side: intendedSide, buy: false, sell: false },
          committee: decision,
          setup: setupInfo,
        });
      } else if (decision.final === "approved") {
        let entryAudit: B3QuoteExecutionAudit;
        try {
          entryAudit = getB3ExecutionAudit(priceSrc, intendedSide, "entry", "runB3SimulationTick.openOrder");
          if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(entryAudit, "runB3SimulationTick.openOrder", asset.symbol);
          providerStats.last_price_function = entryAudit.execution_price_origin;
        } catch (e) {
          await recordStatusIfChanged(mode, m, "erro_tecnico", "price_source_guard", {
            pnl: realizedToday,
            message: (e as Error).message,
            provider_name: priceSrc.provider_name,
            price_source: priceSrc.quote_source,
            rejected_price: ctx.price,
            mt5_last: priceSrc.raw?.last ?? null,
            forceLog: false,
            diagnostic_payload: { function: "runB3SimulationTick.openOrder", attempted_context_price: ctx.price, ...quoteAuditBase(priceSrc) },
          });
          log.push({ mode, action: "blocked", reason: "price_guard", message: (e as Error).message });
          finalizeAudit((e as Error).message, {
            last_analysis: decision.justification,
            last_score: decision.score,
            last_confidence: decision.avg_confidence,
            last_setup: `Setup ${intendedSide.toUpperCase()} aprovado, bloqueado no preço`,
            signals: { evaluated_side: intendedSide, buy: intendedSide === "buy", sell: intendedSide === "sell" },
            committee: decision,
            setup: setupInfo,
          });
          continue;
        }
        if (priceSrc.source !== "mt5_xp_demo") {
          const slip = Number(run.simulated_slippage_pts) || 0;
          entryAudit = {
            ...entryAudit,
            execution_price: Math.round((intendedSide === "buy" ? entryAudit.execution_price + slip : entryAudit.execution_price - slip) / asset.tick_size) * asset.tick_size,
            execution_price_origin: `${entryAudit.execution_price_origin}+legacy_slippage`,
          };
        }
        const entry = entryAudit.execution_price;
        // Base de contratos = configuração do modo (Conservador=1, Moderado=2,
        // Equilibrado=3, Semi_agressivo=4, Agressivo=3), não mais fixa em 1.
        // O multiplicador de proteção de risco (size_multiplier) continua
        // reduzindo o tamanho quando o motor de risco pede cautela — ele
        // agora reduz a partir da base certa, em vez de reduzir 1 contrato.
        const baseQty = Number(cfg.max_contracts) || 1;
        const qty = Math.max(1, Math.round(baseQty * Math.max(0.05, protDec.size_multiplier)));
        const { data: insertedOrder, error: oErr } = await supabase.from("b3_simulation_orders").insert({
          simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
          mode, symbol: asset.quote_symbol, contract_code: asset.contract_code, side: intendedSide,
          entry_price: Math.round(entry / asset.tick_size) * asset.tick_size, quantity: qty,
          fees: Number(run.simulated_fee_brl) || 0, status: "open",
          ...orderAuditPatch(entryAudit),
        }).select("id").single();
        if (oErr) throw oErr;
        await mirrorToReal(supabase, userId, runId, mode as Mode, "open", intendedSide, `open-${insertedOrder.id}`, "engine_auto", asset.quote_symbol);
        providerStats.last_entry_price = entry;
        openOrdersCache = null;
        await supabase.from("b3_simulation_modes")
          .update({
            committee_approvals: (Number(m.committee_approvals) || 0) + 1,
            contracts_traded: (Number(m.contracts_traded) || 0) + qty,
          }).eq("id", m.id);
        m.committee_approvals = (Number(m.committee_approvals) || 0) + 1;
        m.contracts_traded = (Number(m.contracts_traded) || 0) + qty;
        log.push({ mode, action: "open", side: intendedSide, price: entry, score: decision.score, source: entryAudit.quote_source, origin: entryAudit.execution_price_origin, setup: setupInfo.name });
        finalizeAudit(`Setup trend_pullback ${intendedSide.toUpperCase()} aprovado e ordem simulada aberta.`, {
          last_analysis: decision.justification,
          last_score: decision.score,
          last_confidence: decision.avg_confidence,
          last_setup: `trend_pullback ${intendedSide.toUpperCase()}`,
          signals: { evaluated_side: intendedSide, buy: intendedSide === "buy", sell: intendedSide === "sell" },
          committee: decision,
          setup: setupInfo,
        });
      } else {
        const field = decision.final === "blocked" ? "risk_blocks" : "committee_rejections";
        if (sigChanged(`block:${mode}`, `${decision.final}:${field}`)) {
          await supabase.from("b3_simulation_modes")
            .update({ [field]: (Number(m[field]) || 0) + 1 }).eq("id", m.id);
          m[field] = (Number(m[field]) || 0) + 1;
        }
        log.push({ mode, action: "reject", final: decision.final, score: decision.score });
        finalizeAudit(finalReasonFromDecision(decision, committee), {
          last_analysis: decision.justification,
          last_score: decision.score,
          last_confidence: decision.avg_confidence,
          last_setup: "Nenhum setup aprovado",
          signals: { evaluated_side: intendedSide, buy: false, sell: false },
          committee: decision,
          setup: setupInfo,
        });
      }
      } catch (modeErr: any) {
        const elapsedMs = Date.now() - modeT0;
        log.push({ mode, action: "error", message: modeErr?.message ?? String(modeErr), elapsed_ms: elapsedMs });
        try {
          await supabase.from("system_logs").insert({
            event_type: "b3_mode_error",
            source: "b3-simulation-tick",
            severity: "error",
            message: String(modeErr?.message ?? modeErr),
            technical_data: {
              run_id: runId,
              symbol: run?.symbol ?? asset?.symbol ?? null,
              variant: run?.variant ?? null,
              mode,
              stack: String(modeErr?.stack ?? "").slice(0, 2000),
              elapsed_ms: elapsedMs,
            },
          });
        } catch { /* log nunca deve derrubar o tick */ }
        continue;
      } finally {
        modeTimings[mode] = Date.now() - modeT0;
      }
    }
    snapshotExtra.timings = {
      total_ms: Date.now() - runT0,
      por_modo: modeTimings,
    };
    snapshotExtra.engine_audit = tickAudit;
    snapshotExtra.write_sigs = writeSigs;
    // Persistência única: 1 INSERT a cada 10s. Fora da janela, nada é gravado
    // (sem INSERT, UPDATE ou UPSERT) — o estado corrente vive só em memória.
    if (persistSnapshot) {
      const { data: snapIns, error: sErr } = await supabase.from("b3_simulation_market_snapshots")
        .insert({ simulation_run_id: runId, user_id: userId, ...snapPayload, extra: snapshotExtra })
        .select("id").single();
      if (sErr) throw sErr;
      memo.id = snapIns.id;
      memo.persisted_at = now.getTime();
      tickAudit.snapshot_id = snapIns.id;
    }
    log.push({ action: "engine_audit", snapshot_id: memo.id, persisted: persistSnapshot, modes: tickAudit.modes.map((m: any) => ({ mode: m.mode, final_reason: m.last_refusal_reason, first_stop: m.first_stop?.label ?? null })) });


  }

  return { ok: true, processed: ticks, log: [{ action: "provider_diagnostic", ...providerStats }, ...log] };
}

export const tickB3Simulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; ticks?: number }) => d)
  .handler(async ({ data, context }) => {
    return runB3SimulationTick(context.supabase, context.userId, data.run_id, data.ticks ?? 1);
  });

// ─────────────────── Escopo de sessão diária ───────────────────
// Retorna todos os runs que compartilham o session_day_id do run mais recente
// (rodando, pausado ou finalizado). Reinícios no mesmo dia = mesmo session_day_id
// = execuções consolidadas no diagnóstico.
async function resolveSessionScope(supabase: any, userId: string) {
  const { data: latest } = await supabase.from("b3_simulation_runs")
    .select("id, status, started_at, ended_at, session_day_id, session_date, symbol")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!latest) return { latest: null, runs: [] as any[], runIds: [] as string[], executions: [] as any[], restartCount: 0 };
  const sid = latest.session_day_id;
  let runs: any[] = [];
  if (sid) {
    const { data } = await supabase.from("b3_simulation_runs")
      .select("id, status, started_at, ended_at, session_day_id, session_date, symbol, notes")
      .eq("user_id", userId).eq("session_day_id", sid)
      .order("started_at", { ascending: true });
    runs = data ?? [latest];
  } else {
    runs = [latest];
  }
  const executions = runs.map((r) => {
    const start = new Date(r.started_at).getTime();
    const end = r.ended_at ? new Date(r.ended_at).getTime() : Date.now();
    return {
      run_id: r.id,
      status: r.status,
      started_at: r.started_at,
      finished_at: r.ended_at,
      duration_s: Math.max(0, Math.round((end - start) / 1000)),
      ongoing: !r.ended_at,
    };
  });
  return {
    latest,
    runs,
    runIds: runs.map((r) => r.id),
    executions,
    restartCount: Math.max(0, executions.length - 1),
    sessionDate: latest.session_date,
    sessionDayId: sid,
  };
}

export const getB3EngineDiagnostic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const scope = await resolveSessionScope(supabase as any, userId);
    if (!scope.latest) return { run: null, audit: null, snapshot: null, settings: [], price_source: null, executions: [], restart_count: 0, session_date: null };
    const activeRun = scope.runs.find((r) => r.status === "running" || r.status === "paused") ?? scope.latest;
    const [{ data: snapshot }, { data: settings }, { data: tradeSettings }] = await Promise.all([
      (supabase as any).from("b3_simulation_market_snapshots")
        .select("id, market_time, price, volume, vwap, source, quote_source, quote_server, quote_symbol, quote_tick_ts, quote_bid, quote_ask, quote_last, provider_name, extra")
        .in("simulation_run_id", scope.runIds).eq("user_id", userId)
        .order("market_time", { ascending: false }).limit(1).maybeSingle(),

      (supabase as any).from("b3_simulation_mode_settings").select("*")
        .eq("simulation_run_id", activeRun.id).eq("user_id", userId),
      (supabase as any).from("b3_trading_settings").select("price_source")
        .eq("user_id", userId).maybeSingle(),
    ]);
    return {
      run: activeRun,
      snapshot: snapshot ?? null,
      audit: (snapshot?.extra as any)?.engine_audit ?? null,
      settings: settings ?? [],
      price_source: tradeSettings?.price_source ?? "csv",
      executions: scope.executions,
      restart_count: scope.restartCount,
      session_date: scope.sessionDate,
    };
  });


// ─────────────────── Pipeline de Diagnóstico (read-only) ───────────────────
// Agrega os últimos snapshots com engine_audit e produz, por robô:
//   - a última execução do pipeline (etapas ordenadas com valor observado × limite)
//   - contadores (ticks, entradas analisadas, bloqueadas, autorizadas, buy/sell, ordens)
//   - histórico dos últimos 100 bloqueios
// NÃO altera regras nem parâmetros — só lê snapshots já existentes.
const PIPELINE_STEP_ORDER = [
  "tick_received",
  "valid_quote",
  "mt5_server",
  "mt5_symbol",
  "market_open",
  "time_allowed",
  "operation_window",
  "force_close_window",
  "spread",
  "global_protection",
  "mode_enabled",
  "volatility",
  "max_trades",
  "daily_loss",
  "daily_target",
  "position_open",
  "protection_engine",
  "score",
  "confidence",
  "committee",
  "signal_buy",
  "signal_sell",
] as const;

export const getB3PipelineAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const scope = await resolveSessionScope(supabase as any, userId);
    const run = scope.latest;
    if (!run) return { run: null, modes: [], history: [], totals: null, executions: [], restart_count: 0, session_date: null };

    const { data: snaps } = await (supabase as any).from("b3_simulation_market_snapshots")
      .select("id, market_time, extra, simulation_run_id")
      .in("simulation_run_id", scope.runIds).eq("user_id", userId)
      .order("market_time", { ascending: false })
      .limit(400);

    const list = (snaps ?? []).filter((s: any) => s?.extra?.engine_audit);


    // contadores por robô
    const perMode: Record<string, any> = {};
    for (const mode of MODES) {
      perMode[mode] = {
        mode,
        ticks_received: 0,
        ticks_valid: 0,
        entries_analyzed: 0,
        entries_blocked: 0,
        entries_authorized: 0,
        buy_signals: 0,
        sell_signals: 0,
        orders_executed: 0,
        last_reason: null,
        last_step_blocked: null,
        last_pipeline: [] as any[],
        last_snapshot_at: null,
        last_tick: null,
        last_score: null,
        last_confidence: null,
        last_setup: null,
        last_decision_context: null as any,
        last_decision_id: null as string | null,
        last_decision_at: null as string | null,
        decisions: [] as any[],
        trade_events: [] as any[],
      };
    }
    const history: any[] = [];
    const allDecisions: any[] = [];
    const allTradeEvents: any[] = [];


    // snapshots vêm em ordem decrescente; iterar reverso para popular "last_*" corretamente
    for (const s of [...list].reverse()) {
      const audit = s.extra.engine_audit;
      const tick = audit.last_tick ?? null;
      for (const m of audit.modes ?? []) {
        const bucket = perMode[m.mode];
        if (!bucket) continue;
        bucket.ticks_received += 1;
        const guardOk = audit.tick_guard ? audit.tick_guard.ok !== false : true;
        if (guardOk && !audit.global_protection?.active) bucket.ticks_valid += 1;
        bucket.entries_analyzed += 1;
        const approved = /aprovado/i.test(m.last_refusal_reason ?? "") && !/bloqueado/i.test(m.last_refusal_reason ?? "");
        const opened = /ordem simulada aberta/i.test(m.last_refusal_reason ?? "");
        if (opened) { bucket.entries_authorized += 1; bucket.orders_executed += 1; }
        else bucket.entries_blocked += 1;
        if (m.signals?.buy) bucket.buy_signals += 1;
        if (m.signals?.sell) bucket.sell_signals += 1;

        bucket.last_reason = m.last_refusal_reason ?? bucket.last_reason;
        bucket.last_step_blocked = m.first_stop ?? bucket.last_step_blocked;
        bucket.last_snapshot_at = s.market_time;
        bucket.last_tick = tick;
        // Card e detalhe devem descrever SEMPRE a mesma avaliação. Antes cada
        // campo era arrastado individualmente com `??`, então um tick sem score
        // mantinha o score antigo enquanto o decision_context vinha de outro
        // tick — daí card e detalhe divergirem (ex.: 72 no card, 25 no detalhe).
        // Agora score/confiança/setup/contexto só avançam em bloco, junto com o
        // id da decisão (snapshot que a originou).
        const hasEvaluation = m.last_score != null || m.decision_context != null;
        if (hasEvaluation) {
          bucket.last_score = m.last_score ?? null;
          bucket.last_confidence = m.last_confidence ?? null;
          bucket.last_setup = m.last_setup ?? null;
          bucket.last_decision_context = m.decision_context ?? null;
          bucket.last_decision_id = s.id;
          bucket.last_decision_at = s.market_time;
        }
        if (m.decision_context) {
          const dec = { ...m.decision_context, at: s.market_time, decision_id: s.id };
          bucket.decisions.push(dec);
          allDecisions.push(dec);
        }

        if (m.trade_event) {
          bucket.trade_events.push({ ...m.trade_event, at: s.market_time });
          allTradeEvents.push({ ...m.trade_event, at: s.market_time, mode: m.mode });
        }

        const byKey: Record<string, any> = {};
        for (const c of m.checks ?? []) byKey[c.key] = c;
        bucket.last_pipeline = PIPELINE_STEP_ORDER
          .filter((k) => byKey[k])
          .map((k) => byKey[k]);

        if (!opened && m.first_stop) {
          history.push({
            at: s.market_time,
            mode: m.mode,
            step: m.first_stop.label,
            step_key: m.first_stop.key,
            detail: m.first_stop.detail,
            reason: m.last_refusal_reason,
          });
        }
      }
    }

    history.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    allDecisions.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    allTradeEvents.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    for (const mk of MODES) {
      const b = perMode[mk];
      b.decisions = b.decisions.slice(-50).reverse();
      b.trade_events = b.trade_events.slice(-20).reverse();
    }


    return {
      run,
      modes: MODES.map((m) => perMode[m]),
      history: history.slice(0, 100),
      decisions: allDecisions.slice(0, 100),
      trade_events: allTradeEvents.slice(0, 50),
      totals: {
        snapshots_scanned: list.length,
        decisions_recorded: allDecisions.length,
        trades_recorded: allTradeEvents.length,
      },
      executions: scope.executions,
      restart_count: scope.restartCount,
      session_date: scope.sessionDate,
    };
  });



// ─────────────────── Auditoria de Entradas (Fase 1, read-only) ───────────────────
// Lê os snapshots do período, monta funil por robô, agrega motivos de bloqueio
// (com dedup: ocorrência única + repetições), categoriza técnico/operacional/estratégico,
// e cruza com ordens executadas do período. NÃO altera nenhuma regra.

const REASON_CATEGORY: Record<string, "tecnico" | "operacional" | "estrategico"> = {
  tick_received: "tecnico",
  valid_quote: "tecnico",
  mt5_server: "tecnico",
  mt5_symbol: "tecnico",
  spread: "tecnico",
  market_open: "operacional",
  time_allowed: "operacional",
  operation_window: "operacional",
  force_close_window: "operacional",
  global_protection: "operacional",
  mode_enabled: "operacional",
  max_trades: "operacional",
  daily_loss: "operacional",
  daily_target: "operacional",
  position_open: "operacional",
  protection_engine: "operacional",
  volatility: "estrategico",
  score: "estrategico",
  confidence: "estrategico",
  committee: "estrategico",
  signal_buy: "estrategico",
  signal_sell: "estrategico",
};

const CATEGORY_LABEL: Record<string, string> = {
  tecnico: "Bloqueio técnico",
  operacional: "Bloqueio operacional",
  estrategico: "Rejeição estratégica",
};

export const getB3EntryAuditReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { hours?: number } | undefined) => ({ hours: Math.min(Math.max(1, Number(input?.hours ?? 24)), 168) }))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - data.hours * 3600_000).toISOString();

    const scope = await resolveSessionScope(supabase as any, userId);
    const run = scope.latest;
    if (!run) return { run: null, period: { since, hours: data.hours }, modes: [], reasons: [], config_mismatches: [], totals: { snapshots_scanned: 0 }, executions: [], restart_count: 0, session_date: null };

    const { data: snaps } = await (supabase as any).from("b3_simulation_market_snapshots")
      .select("market_time, extra")
      .in("simulation_run_id", scope.runIds).eq("user_id", userId)
      .gte("market_time", since)
      .order("market_time", { ascending: true })
      .limit(1200);

    const { data: orders } = await (supabase as any).from("b3_simulation_orders")
      .select("mode, status, net_result_brl, entry_time")
      .in("simulation_run_id", scope.runIds).eq("user_id", userId)
      .gte("entry_time", since);


    const ordersByMode: Record<string, { total: number; net: number }> = {};
    for (const m of MODES) ordersByMode[m] = { total: 0, net: 0 };
    for (const o of orders ?? []) {
      const b = ordersByMode[o.mode]; if (!b) continue;
      b.total += 1; b.net += Number(o.net_result_brl ?? 0);
    }

    const list = (snaps ?? []).filter((s: any) => s?.extra?.engine_audit);

    // Estado para dedup por (mode|step_key). Um novo "grupo" começa quando muda step_key ou detail.
    type Group = { mode: string; category: string; step_key: string; label: string; detail: string; first_at: string; last_at: string; repetitions: number; observed_values: number[]; limit_values: number[] };
    const groups: Group[] = [];
    const activeByMode: Record<string, Group | null> = {};
    for (const m of MODES) activeByMode[m] = null;

    const funnel: Record<string, any> = {};
    for (const m of MODES) {
      funnel[m] = {
        mode: m,
        ciclos: 0,
        ticks_validos: 0,
        sinais_brutos: 0,
        filtrados_ok: 0,
        enviados_comite: 0,
        aprovados_comite: 0,
        rejeitados_comite: 0,
        bloqueios_tecnicos: 0,
        bloqueios_operacionais: 0,
        rejeicoes_estrategicas: 0,
        entradas_executadas: 0,
        resultado_liquido_brl: 0,
      };
    }
    let configMismatchesLatest: any[] = [];
    let latestAt: string | null = null;

    const parseObs = (detail: string | null | undefined): { obs?: number; lim?: number } => {
      if (!detail) return {};
      // patterns like "58 < 62", "Confiança 53 < 70"
      const m1 = detail.match(/(-?\d+[\d.,]*)\s*[<>]=?\s*(-?\d+[\d.,]*)/);
      if (m1) return { obs: Number(m1[1].replace(",", ".")), lim: Number(m1[2].replace(",", ".")) };
      const m2 = detail.match(/idade\s+(\d+)\s+segundos.*limite\s+(\d+)/i);
      if (m2) return { obs: Number(m2[1]), lim: Number(m2[2]) };
      return {};
    };

    for (const s of list) {
      const audit = s.extra.engine_audit;
      latestAt = s.market_time;
      if (Array.isArray(audit.config_mismatches) && audit.config_mismatches.length) {
        configMismatchesLatest = audit.config_mismatches;
      } else if (audit.modes) {
        // derivar de config_comparison do último snapshot
        const mism: any[] = [];
        for (const m of audit.modes) {
          const comp = m.config_comparison ?? {};
          for (const [field, v] of Object.entries<any>(comp)) {
            if (v && v.matches === false) mism.push({ mode: m.mode, field, screen: v.screen, motor: v.motor });
          }
        }
        if (mism.length) configMismatchesLatest = mism;
      }

      for (const m of audit.modes ?? []) {
        const f = funnel[m.mode]; if (!f) continue;
        f.ciclos += 1;
        const guardOk = audit.tick_guard ? audit.tick_guard.ok !== false : true;
        const globalOk = !audit.global_protection?.active;
        if (guardOk && globalOk) f.ticks_validos += 1;

        const buy = !!m.signals?.buy;
        const sell = !!m.signals?.sell;
        if (buy || sell) f.sinais_brutos += 1;

        const first = m.first_stop;
        const opened = /ordem simulada aberta/i.test(m.last_refusal_reason ?? "");

        if (!first && !opened) f.filtrados_ok += 1;
        if (m.committee) {
          f.enviados_comite += 1;
          if (m.committee.final === "approved") f.aprovados_comite += 1;
          else f.rejeitados_comite += 1;
        }

        if (first && !opened) {
          const cat = REASON_CATEGORY[first.key] ?? "estrategico";
          if (cat === "tecnico") f.bloqueios_tecnicos += 1;
          else if (cat === "operacional") f.bloqueios_operacionais += 1;
          else f.rejeicoes_estrategicas += 1;

          const sig = `${first.key}|${(first.detail ?? "").slice(0, 80)}`;
          const active = activeByMode[m.mode];
          if (active && `${active.step_key}|${active.detail.slice(0, 80)}` === sig) {
            active.repetitions += 1;
            active.last_at = s.market_time;
            const { obs, lim } = parseObs(first.detail);
            if (obs != null) active.observed_values.push(obs);
            if (lim != null) active.limit_values.push(lim);
          } else {
            const g: Group = {
              mode: m.mode, category: cat, step_key: first.key,
              label: first.label ?? first.key, detail: first.detail ?? "",
              first_at: s.market_time, last_at: s.market_time,
              repetitions: 1, observed_values: [], limit_values: [],
            };
            const { obs, lim } = parseObs(first.detail);
            if (obs != null) g.observed_values.push(obs);
            if (lim != null) g.limit_values.push(lim);
            groups.push(g);
            activeByMode[m.mode] = g;
          }
        } else {
          activeByMode[m.mode] = null;
        }
      }
    }

    // Somar ordens executadas do banco (fonte de verdade)
    for (const m of MODES) {
      funnel[m].entradas_executadas = ordersByMode[m].total;
      funnel[m].resultado_liquido_brl = Math.round(ordersByMode[m].net * 100) / 100;
    }

    // Ranking de motivos: agrupar por (mode, step_key), somando ocorrências únicas e repetições
    type ReasonAgg = { mode: string; category: string; category_label: string; step_key: string; label: string; occurrences: number; repetitions: number; first_at: string; last_at: string; avg_observed: number | null; avg_limit: number | null; avg_distance: number | null; last_detail: string };
    const rmap = new Map<string, ReasonAgg>();
    const modeSignals: Record<string, number> = Object.fromEntries(MODES.map((m) => [m, funnel[m].ciclos || 1]));
    for (const g of groups) {
      const k = `${g.mode}|${g.step_key}`;
      const obs = g.observed_values.length ? g.observed_values.reduce((a, b) => a + b, 0) / g.observed_values.length : null;
      const lim = g.limit_values.length ? g.limit_values.reduce((a, b) => a + b, 0) / g.limit_values.length : null;
      const dist = obs != null && lim != null ? obs - lim : null;
      let r = rmap.get(k);
      if (!r) {
        r = { mode: g.mode, category: g.category, category_label: CATEGORY_LABEL[g.category], step_key: g.step_key, label: g.label, occurrences: 0, repetitions: 0, first_at: g.first_at, last_at: g.last_at, avg_observed: null, avg_limit: null, avg_distance: null, last_detail: g.detail };
        rmap.set(k, r);
      }
      r.occurrences += 1;
      r.repetitions += g.repetitions;
      if (g.first_at < r.first_at) r.first_at = g.first_at;
      if (g.last_at > r.last_at) { r.last_at = g.last_at; r.last_detail = g.detail; }
      // média ponderada simples pelas amostras coletadas neste grupo
      if (obs != null) r.avg_observed = r.avg_observed == null ? obs : (r.avg_observed + obs) / 2;
      if (lim != null) r.avg_limit = r.avg_limit == null ? lim : (r.avg_limit + lim) / 2;
      if (dist != null) r.avg_distance = r.avg_distance == null ? dist : (r.avg_distance + dist) / 2;
    }
    const reasons = [...rmap.values()]
      .map((r) => ({ ...r, pct_of_cycles: Math.round((r.repetitions / (modeSignals[r.mode] || 1)) * 1000) / 10 }))
      .sort((a, b) => b.repetitions - a.repetitions);

    return {
      run,
      period: { since, until: latestAt, hours: data.hours },
      modes: MODES.map((m) => {
        const f = funnel[m];
        const sinais = f.sinais_brutos || 0;
        const comite = f.enviados_comite || 0;
        return {
          ...f,
          taxa_geracao_sinal: f.ciclos ? Math.round((sinais / f.ciclos) * 10000) / 100 : 0,
          taxa_aprov_filtros: sinais ? Math.round((comite / sinais) * 10000) / 100 : 0,
          taxa_aprov_comite: comite ? Math.round((f.aprovados_comite / comite) * 10000) / 100 : 0,
          taxa_execucao: f.aprovados_comite ? Math.round((f.entradas_executadas / f.aprovados_comite) * 10000) / 100 : 0,
          conversao_final: sinais ? Math.round((f.entradas_executadas / sinais) * 10000) / 100 : 0,
        };
      }),
      reasons,
      config_mismatches: configMismatchesLatest,
      totals: { snapshots_scanned: list.length },
      executions: scope.executions,
      restart_count: scope.restartCount,
      session_date: scope.sessionDate,
    };
  });





async function closeOrder(supabase: any, userId: string, run: any, mode: any, order: any, exitAudit: B3QuoteExecutionAudit, reason: string, marketHistory: any[] = [], assetProfile: any = WIN_FALLBACK_ASSET_PROFILE) {
  if (exitAudit.quote_source === "MT5 XP DEMO") assertB3StrictMt5ExecutionAudit(exitAudit, "closeOrder", assetProfile.symbol);
  const exitPrice = exitAudit.execution_price;
  const dir = order.side === "buy" ? 1 : -1;
  const grossPts = (exitPrice - Number(order.entry_price)) * dir;
  const qty = Number(order.quantity) || 1;
  const grossBrl = grossPts * Number(assetProfile.tick_value_brl) * qty;
  // Custo derivado do PERFIL DO ATIVO (não mais de run.simulated_fee_brl):
  // futuros = R$ por contrato/ponta; ações = % sobre o volume financeiro.
  const fees = computeB3Fees({ assetProfile, quantity: qty, entryPrice: Number(order.entry_price), exitPrice: exitPrice });
  const netBrl = grossBrl - fees;

  // MFE / MAE (em pontos) a partir dos snapshots entre entry_time e agora.
  const entryTimeMs = order.entry_time ? new Date(order.entry_time).getTime() : null;
  const nowMs = Date.now();
  let mfePts = 0, maePts = 0;
  if (entryTimeMs) {
    for (const h of marketHistory) {
      const t = new Date(h.market_time).getTime();
      if (t < entryTimeMs || t > nowMs) continue;
      const p = Number(h.quote_last ?? h.price ?? 0);
      if (!Number.isFinite(p) || p <= 0) continue;
      const move = (p - Number(order.entry_price)) * dir;
      if (move > mfePts) mfePts = move;
      if (move < maePts) maePts = move;
    }
  }
  const durationS = entryTimeMs ? Math.max(0, Math.round((nowMs - entryTimeMs) / 1000)) : null;

  await supabase.from("b3_simulation_orders").update({
    exit_price: Math.round(exitPrice / assetProfile.tick_size) * assetProfile.tick_size,
    exit_time: new Date().toISOString(),
    gross_result_points: grossPts,
    gross_result_brl: grossBrl,
    fees, net_result_brl: netBrl,
    status: "closed", close_reason: reason,
    quote_source: exitAudit.quote_source,
    quote_server: exitAudit.quote_server,
    quote_symbol: exitAudit.quote_symbol,
    quote_tick_ts: exitAudit.quote_tick_ts,
    quote_bid: exitAudit.quote_bid,
    quote_ask: exitAudit.quote_ask,
    quote_last: exitAudit.quote_last,
    execution_price: exitAudit.execution_price,
    execution_price_origin: exitAudit.execution_price_origin,
    legacy_price_detected: exitAudit.legacy_price_detected,
    provider_name: exitAudit.provider_name,
  }).eq("id", order.id).eq("user_id", userId);

  await mirrorToReal(supabase, userId, run.id, mode.mode as Mode, "close", order.side, `close-${order.id}`,
    reason === "manual_close_user" ? "user_manual_close" : reason === "manual_close_all_user" ? "user_close_all" : "engine_auto",
    assetProfile.quote_symbol);

  const newRealized = Number(mode.realized_pnl) + netBrl;
  const newBalance = Number(mode.current_balance) + netBrl;
  const wins = Number(mode.winning_trades) + (netBrl > 0 ? 1 : 0);
  const losses = Number(mode.losing_trades) + (netBrl < 0 ? 1 : 0);
  const maxGain = Math.max(Number(mode.max_gain) || 0, netBrl);
  const maxLoss = Math.min(Number(mode.max_loss) || 0, netBrl);
  const peak = Number(mode.initial_balance) + Math.max(0, newRealized);
  const dd = Math.max(Number(mode.max_drawdown) || 0, peak - newBalance);
  const totalPts = Number(mode.points_result) + grossPts;

  await supabase.from("b3_simulation_modes").update({
    realized_pnl: newRealized,
    current_balance: newBalance,
    total_fees: Number(mode.total_fees) + fees,
    total_trades: Number(mode.total_trades) + 1,
    winning_trades: wins, losing_trades: losses,
    max_gain: maxGain, max_loss: maxLoss, max_drawdown: dd,
    points_result: totalPts,
  }).eq("id", mode.id);

  mode.realized_pnl = newRealized; mode.current_balance = newBalance;
  mode.total_fees = Number(mode.total_fees) + fees;
  mode.total_trades = Number(mode.total_trades) + 1;
  mode.winning_trades = wins; mode.losing_trades = losses;
  mode.max_gain = maxGain; mode.max_loss = maxLoss; mode.max_drawdown = dd;
  mode.points_result = totalPts;

  return {
    order_id: order.id,
    mode: mode.mode ?? null,
    side: order.side,
    entry_reason: order.entry_reason ?? null,
    exit_reason: reason,
    entry_price: Number(order.entry_price),
    exit_price: Math.round(exitPrice / assetProfile.tick_size) * assetProfile.tick_size,
    entry_time: order.entry_time,
    exit_time: new Date().toISOString(),
    duration_s: durationS,
    gross_pts: grossPts,
    gross_brl: grossBrl,
    fees,
    net_brl: netBrl,
    quantity: qty,
    mfe_pts: Math.round(mfePts),
    mae_pts: Math.round(maePts),
  };
}


// ───────────────────── ranking / sugestão ─────────────────────
export function scoreMode(m: any) {
  const net = Number(m.realized_pnl) || 0;
  const dd = Math.max(1, Number(m.max_drawdown) || 0);
  const trades = Math.max(1, Number(m.total_trades) || 0);
  const winRate = (Number(m.winning_trades) || 0) / trades;
  const rr = net / dd;
  const blocks = Number(m.risk_blocks) || 0;
  // peso: lucro líquido normalizado + taxa de acerto + r/r - drawdown - blocks
  const norm = net / Math.max(1000, Number(m.initial_balance) * 0.05);
  return 0.40 * norm + 0.25 * (winRate * 4) + 0.20 * Math.max(-2, Math.min(2, rr)) - 0.10 * (dd / 1000) - 0.05 * (blocks / 10);
}

// ───────────────────── settings por modo ─────────────────────
export const listB3ModeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await (supabase as any).from("b3_simulation_mode_settings")
      .select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    // garantir 3 linhas
    const byMode: Record<string, any> = {};
    for (const r of rows ?? []) byMode[r.mode] = r;
    const missing = MODES.filter(m => !byMode[m]);
    if (missing.length) {
      const ins = missing.map(m => ({
        simulation_run_id: data.run_id, user_id: userId, mode: m, ...MODE_DEFAULTS[m],
      }));
      const { data: created } = await (supabase as any).from("b3_simulation_mode_settings").insert(ins).select("*");
      for (const r of created ?? []) byMode[r.mode] = r;
    }
    return MODES.map(m => byMode[m]);
  });

const SETTING_FIELDS = [
  "enabled","entry_style","min_approve_votes","min_confidence","min_score","max_contracts",
  "stop_pts","gain_pts","max_volatility_pct","daily_loss_limit_brl","daily_gain_target_brl",
  "trading_start_time","entry_cutoff_time","force_close_time","notes",
  "trailing_activation_pts","trailing_giveback_pts","trailing_mode",
  // B3 Protection
  "minimum_trades_before_profit_lock","minimum_operating_minutes","profit_multiplier_before_lock",
  "post_target_allowed_retracement","consecutive_loss_after_target","post_target_size_reduction",
] as const;

export const updateB3ModeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode; patch: Record<string, any> }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, any> = {};
    for (const k of SETTING_FIELDS) if (k in data.patch) patch[k] = data.patch[k];
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await (supabase as any).from("b3_simulation_mode_settings")
      .update(patch).eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const resetB3ModeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run } = await (supabase as any).from("b3_simulation_runs")
      .select("symbol").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    const symbol = run?.symbol ?? "WINQ26";
    const { data: ud } = await (supabase as any)
      .from("b3_mode_user_defaults").select("*")
      .eq("user_id", userId).eq("symbol", symbol).eq("mode", data.mode).maybeSingle();
    // Sem padrão salvo pra esse (symbol, mode) NÃO aplicamos MODE_DEFAULTS:
    // os valores de fábrica são escala de mini índice e destruiriam a
    // calibração de WDO / PETR4 / VALE3. Deixa a configuração como está.
    if (!ud) return { ok: false, source: "none", symbol, mode: data.mode };
    const fab = MODE_DEFAULTS[data.mode];
    const def = Object.fromEntries(
      SETTING_FIELDS.map(k => [k, k in ud && ud[k] != null ? ud[k] : fab[k as keyof typeof fab]]),
    );
    const { error } = await (supabase as any).from("b3_simulation_mode_settings")
      .update({ ...def, enabled: true })
      .eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId);
    if (error) throw error;
    return { ok: true, source: "user_default", symbol, mode: data.mode };
  });

// ─────────────────── "meu padrão" por modo + ATIVO ───────────────────
// A chave é (user_id, symbol, mode): o padrão do WIN não vale pro WDO.
export const saveModeAsDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode; values: Record<string, any> }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run } = await (supabase as any).from("b3_simulation_runs")
      .select("symbol").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (!run) throw new Error("Run não encontrada");
    const symbol = run.symbol ?? "WINQ26";
    const patch: Record<string, any> = {};
    for (const k of SETTING_FIELDS) if (k in data.values && k !== "enabled" && k !== "notes") patch[k] = data.values[k];
    const { error } = await (supabase as any).from("b3_mode_user_defaults")
      .upsert({ user_id: userId, symbol, mode: data.mode, ...patch }, { onConflict: "user_id,symbol,mode" });
    if (error) throw error;
    return { ok: true, symbol };
  });

export const listModeUserDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { symbol?: string } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = (supabase as any).from("b3_mode_user_defaults").select("*").eq("user_id", userId);
    if (data.symbol) q = q.eq("symbol", data.symbol);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const deleteModeUserDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { mode: Mode; symbol: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any).from("b3_mode_user_defaults")
      .delete().eq("user_id", userId).eq("symbol", data.symbol).eq("mode", data.mode);
    if (error) throw error;
    return { ok: true };
  });


// ─────────────────── Painel unificado (cockpit) — todos os ativos ───────────────────
// Junta os 5 modos de CADA simulação 'running' do usuário (hoje: WIN + WDO,
// escala sozinho quando mais ativos forem adicionados) num formato enxuto
// pra um card compacto — não reaproveita getB3SimulationDetail (que traz
// até 500 ordens) porque o cockpit só precisa da posição aberta atual e do
// resultado de hoje, não do histórico completo.
export const getB3CockpitOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: runs, error: runsErr } = await (supabase as any)
      .from("b3_simulation_runs").select("id, symbol").eq("user_id", userId).eq("status", "running");
    if (runsErr) throw runsErr;

    const cards: any[] = [];
    for (const run of runs ?? []) {
      const asset = await loadAssetProfile(supabase, run.symbol);
      const [{ data: modes }, { data: settings }, { data: openOrders }, { data: snaps }] = await Promise.all([
        (supabase as any).from("b3_simulation_modes").select("mode, initial_balance, current_balance")
          .eq("simulation_run_id", run.id).eq("user_id", userId),
        (supabase as any).from("b3_simulation_mode_settings").select("mode, enabled")
          .eq("simulation_run_id", run.id).eq("user_id", userId),
        (supabase as any).from("b3_simulation_orders").select("id, mode, side, entry_price, quantity, created_at")
          .eq("simulation_run_id", run.id).eq("user_id", userId).eq("status", "open"),
        (supabase as any).from("b3_simulation_market_snapshots").select("price, extra")
          .eq("simulation_run_id", run.id).eq("user_id", userId).order("market_time", { ascending: false }).limit(1),
      ]);

      const livePrice = Number(snaps?.[0]?.price ?? 0) || null;
      const auditModes: any[] = snaps?.[0]?.extra?.engine_audit?.modes ?? [];
      const enabledByMode: Record<string, boolean> = {};
      for (const s of settings ?? []) enabledByMode[s.mode] = s.enabled !== false;
      const openByMode: Record<string, any> = {};
      for (const o of openOrders ?? []) openByMode[o.mode] = o;
      const auditByMode: Record<string, any> = {};
      for (const a of auditModes) auditByMode[a.mode] = a;

      for (const m of MODES) {
        const mode = (modes ?? []).find((x: any) => x.mode === m);
        const open = openByMode[m];
        const audit = auditByMode[m];
        let unrealizedPts: number | null = null, unrealizedBrl: number | null = null;
        if (open && livePrice != null) {
          const dir = open.side === "buy" ? 1 : -1;
          unrealizedPts = (livePrice - Number(open.entry_price)) * dir;
          unrealizedBrl = unrealizedPts * Number(asset.tick_value_brl) * Number(open.quantity);
        }
        cards.push({
          run_id: run.id, symbol: run.symbol, mode: m,
          enabled: enabledByMode[m] ?? true,
          open: open ? { side: open.side, entry_price: Number(open.entry_price), quantity: Number(open.quantity) } : null,
          live_price: livePrice,
          unrealized_pts: unrealizedPts, unrealized_brl: unrealizedBrl,
          balance: Number(mode?.current_balance ?? mode?.initial_balance ?? 0),
          pnl_today: Number(mode?.current_balance ?? 0) - Number(mode?.initial_balance ?? 0),
          score: audit?.last_score ?? null, confidence: audit?.last_confidence ?? null,
          blocked_reason: open ? null : (audit?.first_stop?.label ?? audit?.last_refusal_reason ?? null),
        });
      }
    }
    return cards;
  });


// Botão de fechamento manual por modo. Usa a MESMA cadeia de validação de
// cotação que o motor automático (B3QuoteProvider + getB3ExecutionAudit +
// assertB3StrictMt5ExecutionAudit) — ou seja, se a cotação estiver vencida,
// o fechamento manual é recusado exatamente como o fechamento automático
// seria, em vez de fechar "no escuro" com preço desatualizado.
export const closeModeOrderManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run } = await supabase.from("b3_simulation_runs")
      .select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (!run) throw new Error("Simulação não encontrada.");
    const { data: mode } = await (supabase as any).from("b3_simulation_modes")
      .select("*").eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId).maybeSingle();
    if (!mode) throw new Error("Modo não encontrado nessa simulação.");
    const { data: open } = await (supabase as any).from("b3_simulation_orders")
      .select("*").eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId)
      .eq("status", "open").maybeSingle();
    if (!open) throw new Error("Não há posição aberta nesse modo agora.");

    const asset = await loadAssetProfile(supabase, run.symbol);
    const priceSrc = await B3QuoteProvider(supabase, userId, {
      symbol: asset.quote_symbol, contract: asset.contract_code, base: Number(asset.base_price_fallback),
      expectedSymbol: asset.symbol, tickSize: Number(asset.tick_size),
      spreadMaxPoints: Number(asset.spread_max_price), priceDeviationLimit: Number(asset.price_deviation_limit),
      indicatorTimeframe: asset.indicator_timeframe === "m1" ? "m1" : "tick",
    });
    const exitAudit = getB3ExecutionAudit(priceSrc, open.side, "exit", "closeModeOrderManually");
    if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(exitAudit, "closeModeOrderManually", asset.symbol);

    const closed = await closeOrder(supabase, userId, run, mode, open, exitAudit, "manual_close_user", [], asset);
    return { ok: true, closed };
  });

// Botão de pânico: fecha toda posição aberta nos 5 modos dessa simulação e
// desativa (enabled=false) os 5, pra nada reabrir sozinho depois. Continua
// mesmo se algum modo individual falhar ao fechar (ex: sem posição aberta
// naquele modo) — reporta o resultado de cada um em vez de abortar tudo.
export const closeAllModesManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run } = await supabase.from("b3_simulation_runs")
      .select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (!run) throw new Error("Simulação não encontrada.");

    const asset = await loadAssetProfile(supabase, run.symbol);
    const priceSrc = await B3QuoteProvider(supabase, userId, {
      symbol: asset.quote_symbol, contract: asset.contract_code, base: Number(asset.base_price_fallback),
      expectedSymbol: asset.symbol, tickSize: Number(asset.tick_size),
      spreadMaxPoints: Number(asset.spread_max_price), priceDeviationLimit: Number(asset.price_deviation_limit),
      indicatorTimeframe: asset.indicator_timeframe === "m1" ? "m1" : "tick",
    });

    const results: Record<string, any> = {};
    for (const modeName of MODES) {
      try {
        const { data: mode } = await (supabase as any).from("b3_simulation_modes")
          .select("*").eq("simulation_run_id", data.run_id).eq("mode", modeName).eq("user_id", userId).maybeSingle();
        const { data: open } = await (supabase as any).from("b3_simulation_orders")
          .select("*").eq("simulation_run_id", data.run_id).eq("mode", modeName).eq("user_id", userId)
          .eq("status", "open").maybeSingle();
        if (!mode || !open) { results[modeName] = { closed: false, reason: "sem posição aberta" }; continue; }
        const exitAudit = getB3ExecutionAudit(priceSrc, open.side, "exit", "closeAllModesManually");
        if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(exitAudit, "closeAllModesManually", asset.symbol);
        const closed = await closeOrder(supabase, userId, run, mode, open, exitAudit, "manual_close_all_user", [], asset);
        results[modeName] = { closed: true, result: closed };
      } catch (e) {
        results[modeName] = { closed: false, reason: (e as Error).message };
      }
    }

    // Pausa os 5 modos — evita qualquer entrada nova até o usuário reativar
    // manualmente cada um (mesmo padrão do toggle "enabled" já existente).
    await (supabase as any).from("b3_simulation_mode_settings")
      .update({ enabled: false })
      .eq("simulation_run_id", data.run_id).eq("user_id", userId);

    return { ok: true, results };
  });

// ───────────────────── B3 Protection: state & history ─────────────────────
export const getB3ProtectionState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await (supabase as any).from("b3_simulation_modes")
      .select("id, mode, protection_state, target_reached_at, profit_at_target_brl, trades_at_target, peak_profit_after_target_brl, profit_after_target_brl, trades_after_target, consecutive_losses_after_target, protection_block_reason, protection_day_key, total_trades, realized_pnl")
      .eq("simulation_run_id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    return rows ?? [];
  });

export const listB3ProtectionHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { from?: string; to?: string; mode?: Mode; run_id?: string; limit?: number }) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = (supabase as any).from("b3_daily_protection_history")
      .select("*").eq("user_id", userId)
      .order("day_key", { ascending: false })
      .limit(Math.min(500, Math.max(1, Number(data.limit ?? 200))));
    if (data.from) q = q.gte("day_key", data.from);
    if (data.to) q = q.lte("day_key", data.to);
    if (data.mode) q = q.eq("mode", data.mode);
    if (data.run_id) q = q.eq("simulation_run_id", data.run_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });
