// B3QuoteProvider — fonte central de cotação do módulo B3 Day Trade.
// Multiativo desde 06/08/2026 (Fase 2): expectedSymbol/tickSize controlam
// qual ativo é buscado — antes, TUDO usava a constante B3_MT5_SYMBOL
// ("WINQ26") independente do que fosse passado, fazendo qualquer simulação
// de outro ativo (WDO, PETR4, VALE3) operar sobre o preço do WIN.
// Regra crítica: quando a fonte selecionada é MT5 XP DEMO, nenhum fallback
// para CSV/mock/candle antigo é permitido para execução.

import { buildMockB3Context, type B3Context } from "./b3-committee.server";
import { b3BrtDate } from "./b3-window.server";


export type B3PriceSource = "csv" | "mt5_xp_demo";
export type B3GuardMode = "validation" | "protected";

const TICK = 5;
export const B3_MT5_SYMBOL = "WINQ26";
export const B3_MT5_SERVER = "XPMT5-DEMO";
export const B3_MT5_ALLOWED_SERVERS = new Set(["XPMT5-DEMO", "XPMT5-PRD"]);
export const B3_MT5_TTL_SECONDS = 15;
export const B3_MT5_PRICE_DEVIATION_LIMIT = 2000;

export interface B3GuardSettings {
  mode: B3GuardMode;
  ttl_seconds: number;
  ttl_tolerance_seconds: number;
  spread_max_points: number;
  price_deviation_limit: number;
  require_nonzero_volume: boolean;
  require_nonzero_last: boolean;
}

export const B3_DEFAULT_GUARD: B3GuardSettings = {
  mode: "validation",
  ttl_seconds: 15,
  ttl_tolerance_seconds: 30,
  spread_max_points: 15,
  price_deviation_limit: 2000,
  require_nonzero_volume: false,
  require_nonzero_last: false,
};

export interface B3GuardCheck {
  rule: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  observed: string | number | null;
  limit: string | number | null;
  message: string;
}

export interface B3GuardEvaluation {
  ok: boolean;
  first_block_reason: string | null;
  checks: B3GuardCheck[];
  settings: B3GuardSettings;
  spread_pts: number | null;
  spread_ticks: number | null;
  tick_age_s: number | null;
}

export type B3QuoteSourceLabel = "MT5 XP DEMO" | "CSV legado" | "inválida" | "desconhecida";

export interface B3QuoteProviderRaw {
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
  volume: number | null;
  tick_ts: string | null;
  server: string | null;
  symbol: string | null;
}

export interface B3QuoteExecutionAudit {
  quote_source: B3QuoteSourceLabel;
  quote_server: string | null;
  quote_symbol: string | null;
  quote_tick_ts: string | null;
  quote_bid: number | null;
  quote_ask: number | null;
  quote_last: number | null;
  execution_price: number;
  execution_price_origin: string;
  legacy_price_detected: boolean;
  provider_name: string;
}

export function isB3StrictMt5AuditRow(row: any, expectedSymbol: string = B3_MT5_SYMBOL): boolean {
  return row?.quote_source === "MT5 XP DEMO"
    && row?.provider_name === "B3QuoteProvider"
    && row?.quote_server === B3_MT5_SERVER
    && row?.quote_symbol === expectedSymbol
    && row?.legacy_price_detected === false
    && Number(row?.quote_bid) > 0
    && Number(row?.quote_ask) > 0
    && Number(row?.quote_last) > 0
    && Number(row?.execution_price) > 0;
}

export function assertB3StrictMt5ExecutionAudit(audit: B3QuoteExecutionAudit, functionName: string, expectedSymbol: string = B3_MT5_SYMBOL): void {
  if (!isB3StrictMt5AuditRow(audit, expectedSymbol)) {
    throw new Error(`Tentativa de preço legado bloqueada — modo MT5 XP DEMO ativo (${functionName})`);
  }
}

function saoPauloPhase(d: Date): B3Context["session_phase"] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const h = Number(parts.find(p => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find(p => p.type === "minute")?.value ?? 0);
  const cur = h * 60 + m;
  if (cur < 9 * 60 + 5 || cur > 17 * 60 + 55) return "fora";
  if (cur < 9 * 60 + 30) return "abertura";
  if (cur < 12 * 60) return "manha";
  if (cur < 14 * 60) return "almoco";
  if (cur < 17 * 60) return "tarde";
  return "fechamento";
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let v = values[0];
  for (let i = 1; i < values.length; i++) v = values[i] * k + v * (1 - k);
  return v;
}

function rsi14(values: number[]): number {
  if (values.length < 2) return 50;
  const n = Math.min(14, values.length - 1);
  let gains = 0, losses = 0;
  for (let i = values.length - n; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  if (gains + losses === 0) return 50;
  const rs = gains / Math.max(1e-9, losses);
  return 100 - 100 / (1 + rs);
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const varc = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(varc);
}

export interface B3PriceContextResult {
  ctx: B3Context;
  source: B3PriceSource;
  live: boolean;                // true se veio de tick MT5 real
  quote_age_s: number | null;   // idade do tick mais recente
  server: string | null;        // XPMT5-DEMO / XPMT5-PRD / null
  quote_symbol: string | null;  // WINQ26 etc
  tick_size: number;            // variação mínima do ativo — usado no arredondamento de preço
  raw: B3QuoteProviderRaw | null;
  provider_name: "B3QuoteProvider";
  quote_source: B3QuoteSourceLabel;
  fallback_to_csv: boolean;
  mt5_provider_calls: number;
  legacy_provider_calls: number;
  guard: B3GuardSettings;
  guard_evaluation: B3GuardEvaluation | null;
  volatility_debug?: {
    formula: string;
    samples: number;
    stddev: number | null;
    mean_price: number | null;
    raw_pct: number | null;
    normalized_pct: number;
    cap_pct: number;
  };
  /** Diagnóstico (read-only) da janela de amostras usada nos indicadores.
   *  Não altera nenhum cálculo — apenas expõe se a série atravessa uma
   *  interrupção de ticks, o que distorce EMA/VWAP/volatilidade. */
  series_health?: {
    samples: number;
    span_minutes: number | null;
    oldest_sample_age_s: number | null;
    largest_gap_s: number | null;
    crosses_tick_gap: boolean;
    gap_threshold_s: number;
  };
  /** Janela de amostras efetivamente usada (após corte por gap/pregão). */
  sample_window?: B3SampleWindow;
  /** true quando ainda não há amostra contínua suficiente após uma interrupção. */
  warming_up_after_gap?: boolean;
  /** Série usada nos indicadores: ticks crus ou candles de 1 minuto. */
  indicator_timeframe?: "tick" | "m1";
  /** Quantidade de amostras da série de indicadores. */
  indicator_samples?: number;
}


function emptyContext(symbol: string, contract: string): B3Context {
  const now = new Date();
  return {
    symbol, contract_code: contract,
    price: 0, prev_close: 0, open: 0, high: 0, low: 0, vwap: 0,
    ema9: 0, ema21: 0, rsi: 50, macd: 0, macd_signal: 0,
    volume_ratio: 0, volatility_pct: 0, momentum: 0, spread_pts: 0,
    now, session_phase: saoPauloPhase(now),
  };
}

function toNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rawFromRow(row: any): B3QuoteProviderRaw {
  const bid = toNumber(row?.bid);
  const ask = toNumber(row?.ask);
  const last = toNumber(row?.last);
  const spread = toNumber(row?.spread ?? ((ask ?? 0) - (bid ?? 0)));
  const volume = toNumber(row?.volume);
  return {
    bid, ask, last, spread, volume,
    tick_ts: row?.tick_ts ?? row?.received_at ?? null,
    server: row?.server ?? null,
    symbol: row?.symbol ?? null,
  };
}

export function quoteAuditBase(info: B3PriceContextResult): Omit<B3QuoteExecutionAudit, "execution_price" | "execution_price_origin" | "legacy_price_detected"> {
  return {
    quote_source: info.quote_source,
    quote_server: info.server,
    quote_symbol: info.quote_symbol,
    quote_tick_ts: info.raw?.tick_ts ?? null,
    quote_bid: info.raw?.bid ?? null,
    quote_ask: info.raw?.ask ?? null,
    quote_last: info.raw?.last ?? null,
    provider_name: info.provider_name,
  };
}

function guardCheck(rule: string, label: string, ok: boolean, blocking: boolean, observed: string | number | null, limit: string | number | null, message: string): B3GuardCheck {
  return { rule, label, ok, blocking, observed, limit, message };
}

export function evaluateMt5Guard(info: {
  source: B3PriceSource;
  live: boolean;
  raw: B3QuoteProviderRaw | null;
  server: string | null;
  quote_symbol: string | null;
  quote_age_s: number | null;
  guard: B3GuardSettings;
}, expectedSymbol: string = B3_MT5_SYMBOL, tickSize: number = TICK): B3GuardEvaluation {
  const s = info.guard;
  const checks: B3GuardCheck[] = [];
  const bid = info.raw?.bid ?? null;
  const ask = info.raw?.ask ?? null;
  const last = info.raw?.last ?? null;
  const spread = bid != null && ask != null ? Math.max(0, Number(ask) - Number(bid)) : null;
  const spreadTicks = spread != null ? Math.round(spread / tickSize) : null;
  const age = info.quote_age_s;

  const push = (c: B3GuardCheck) => checks.push(c);

  push(guardCheck("tick_present", "Tick MT5 recebido", Boolean(info.raw), true, info.raw?.tick_ts ?? "—", "≠ null",
    info.raw ? "Tick MT5 recebido." : "Nenhum tick MT5 disponível."));
  push(guardCheck("mt5_server", "Servidor MT5", info.server != null && B3_MT5_ALLOWED_SERVERS.has(info.server), true, info.server ?? "—", "XPMT5-DEMO/PRD",
    info.server ? `Servidor ${info.server}.` : "Servidor MT5 ausente."));
  push(guardCheck("mt5_symbol", `Símbolo ${expectedSymbol}`, info.quote_symbol === expectedSymbol, true, info.quote_symbol ?? "—", expectedSymbol,
    info.quote_symbol === expectedSymbol ? "Símbolo correto." : `Símbolo ${info.quote_symbol ?? "—"} diferente de ${expectedSymbol}.`));
  push(guardCheck("bid_positive", "Bid > 0", (bid ?? 0) > 0, true, bid, "> 0",
    (bid ?? 0) > 0 ? `Bid ${bid}.` : "Bid zerado ou ausente."));
  push(guardCheck("ask_positive", "Ask > 0", (ask ?? 0) > 0, true, ask, "> 0",
    (ask ?? 0) > 0 ? `Ask ${ask}.` : "Ask zerado ou ausente."));
  push(guardCheck("ask_ge_bid", "Ask ≥ Bid", bid != null && ask != null && ask >= bid, true, `bid ${bid ?? "—"} / ask ${ask ?? "—"}`, "ask ≥ bid",
    bid != null && ask != null && ask >= bid ? "Book coerente." : "Ask menor que Bid."));

  // Last: no modo Validação, só bloqueia se explicitamente exigido.
  const requireLast = s.require_nonzero_last || s.mode === "protected";
  push(guardCheck("last_positive", "Último preço > 0", (last ?? 0) > 0, requireLast, last, "> 0",
    (last ?? 0) > 0 ? `Último ${last}.` : "Último zerado — aceito no modo Validação quando Bid/Ask válidos."));

  // Volume: idem
  const vol = info.raw?.volume ?? null;
  const requireVol = s.require_nonzero_volume || s.mode === "protected";
  push(guardCheck("volume_positive", "Volume > 0", (vol ?? 0) > 0, requireVol, vol, "> 0",
    (vol ?? 0) > 0 ? `Volume ${vol}.` : "Volume zero — aceito no modo Validação."));

  // Spread (em pontos)
  const spreadLimit = s.spread_max_points;
  const spreadOk = spread == null ? false : spread <= spreadLimit;
  push(guardCheck("spread_pts", `Spread ≤ ${spreadLimit} pts`, spreadOk, true,
    spread == null ? "—" : `${spread} pts (${spreadTicks ?? "—"} ticks)`,
    `${spreadLimit} pts (${Math.round(spreadLimit / tickSize)} ticks)`,
    spread == null ? "Spread indisponível." :
    spreadOk ? `Spread ${spread} pts (${spreadTicks} ticks) dentro do limite.` :
    `Spread ${spread} pts (${spreadTicks} ticks) acima do limite de ${spreadLimit} pts.`));

  // Idade do tick — bloqueia acima do TTL + tolerância
  const ttlHard = s.ttl_seconds + s.ttl_tolerance_seconds;
  const ageOk = age != null && age <= ttlHard;
  push(guardCheck("tick_age", `Idade ≤ ${ttlHard}s`, ageOk, true, age == null ? "—" : `${age}s`, `${ttlHard}s (TTL ${s.ttl_seconds}s + tolerância ${s.ttl_tolerance_seconds}s)`,
    age == null ? "Idade do tick indisponível." :
    ageOk ? `Idade ${age}s dentro do limite (${ttlHard}s).` :
    `Tick bloqueado: idade ${age} segundos, limite ${ttlHard} segundos.`));

  // Aviso não bloqueante para idade entre TTL e TTL+tolerância
  if (age != null && age > s.ttl_seconds && age <= ttlHard) {
    push(guardCheck("tick_age_warn", "Idade > TTL alvo", false, false, `${age}s`, `${s.ttl_seconds}s`,
      `Tick com atraso: ${age}s (alvo ${s.ttl_seconds}s, tolerado até ${ttlHard}s).`));
  }

  const firstBlock = checks.find((c) => c.blocking && !c.ok);
  return {
    ok: !firstBlock,
    first_block_reason: firstBlock?.message ?? null,
    checks,
    settings: s,
    spread_pts: spread,
    spread_ticks: spreadTicks,
    tick_age_s: age,
  };
}

export function assertFreshMt5Quote(info: B3PriceContextResult, functionName: string): void {
  if (info.source !== "mt5_xp_demo") throw new Error(`${functionName}: fonte selecionada não é MT5 XP DEMO`);
  const evalRes = info.guard_evaluation ?? evaluateMt5Guard({
    source: info.source, live: info.live, raw: info.raw, server: info.server,
    quote_symbol: info.quote_symbol, quote_age_s: info.quote_age_s, guard: info.guard,
  });
  if (!evalRes.ok) throw new Error(`${functionName}: ${evalRes.first_block_reason ?? "guard MT5 rejeitou o tick"}`);
}

export function getB3ExecutionAudit(
  info: B3PriceContextResult,
  side: "buy" | "sell",
  action: "entry" | "exit" | "mark",
  functionName: string,
): B3QuoteExecutionAudit {
  if (info.source === "mt5_xp_demo") {
    assertFreshMt5Quote(info, functionName);
    const bid = Number(info.raw!.bid);
    const ask = Number(info.raw!.ask);
    const last = Number(info.raw!.last);
    const price = action === "entry"
      ? (side === "buy" ? ask : bid)
      : (side === "buy" ? bid : ask);
    const limit = info.guard.price_deviation_limit || B3_MT5_PRICE_DEVIATION_LIMIT;
    if (Math.abs(price - last) > limit) {
      throw new Error(`Preço de execução incompatível com a cotação MT5 — operação bloqueada (${functionName}; provider=B3QuoteProvider; MT5=${last}; rejeitado=${price}; limite=${limit})`);
    }
    return {
      ...quoteAuditBase(info),
      execution_price: Math.round(price / info.tick_size) * info.tick_size,
      execution_price_origin: action === "entry"
        ? (side === "buy" ? "mt5_ask_entry" : "mt5_bid_entry")
        : (side === "buy" ? "mt5_bid_exit_mark" : "mt5_ask_exit_mark"),
      legacy_price_detected: false,
    };
  }

  const price = Math.round(Number(info.ctx.price || 0) / info.tick_size) * info.tick_size;
  return {
    ...quoteAuditBase(info),
    execution_price: price,
    execution_price_origin: `${functionName}:csv_context_price`,
    legacy_price_detected: true,
  };
}

/** Interrupção máxima tolerada dentro da janela de indicadores. */
export const B3_SAMPLE_GAP_THRESHOLD_S = 120;
/** Amostras contínuas mínimas para calcular indicadores (EMA21/RSI14). */
export const B3_MIN_FRESH_SAMPLES = 30;

export interface B3SampleWindow {
  rows: any[];                       // ticks (mais recente primeiro) já saneados
  total_rows: number;                // ticks lidos do banco
  fresh_samples: number;             // ticks contínuos após o último gap
  required_samples: number;
  warming_up_after_gap: boolean;
  cut_by_gap_s: number | null;       // tamanho do gap que cortou a janela
  cut_by_session: boolean;           // houve corte por pregão anterior
  cadence_s: number | null;          // cadência observada
  eta_ready_at: string | null;       // previsão (diagnóstico apenas)
}

/**
 * Saneamento da fonte de dados (não é flexibilização de estratégia):
 * mantém apenas a sequência contínua da sessão atual, cortando no gap mais
 * recente acima de 120s e descartando ticks de pregões anteriores.
 */
function buildFreshWindow(rowsDesc: any[]): B3SampleWindow {
  const total = rowsDesc.length;
  const tsOf = (r: any) => new Date(r?.tick_ts ?? r?.received_at ?? 0).getTime();
  const today = b3BrtDate(new Date());
  const sameSession = rowsDesc.filter((r) => {
    const t = tsOf(r);
    return Number.isFinite(t) && t > 0 && b3BrtDate(new Date(t)) === today;
  });
  const cutBySession = sameSession.length !== total;

  const asc = sameSession.slice().reverse();
  let start = 0;
  let cutGap: number | null = null;
  for (let i = 1; i < asc.length; i++) {
    const g = (tsOf(asc[i]) - tsOf(asc[i - 1])) / 1000;
    if (g > B3_SAMPLE_GAP_THRESHOLD_S) {
      start = i;
      cutGap = Math.round(g);
    }
  }
  const fresh = asc.slice(start);

  let cadence: number | null = null;
  if (fresh.length > 1) {
    const span = (tsOf(fresh[fresh.length - 1]) - tsOf(fresh[0])) / 1000;
    cadence = span > 0 ? Number((span / (fresh.length - 1)).toFixed(2)) : null;
  }
  const missing = Math.max(0, B3_MIN_FRESH_SAMPLES - fresh.length);
  const eta = missing > 0 && cadence && cadence > 0
    ? new Date(Date.now() + missing * cadence * 1000).toISOString()
    : null;

  return {
    rows: fresh.slice().reverse(),
    total_rows: total,
    fresh_samples: fresh.length,
    required_samples: B3_MIN_FRESH_SAMPLES,
    warming_up_after_gap: fresh.length < B3_MIN_FRESH_SAMPLES,
    cut_by_gap_s: cutGap,
    cut_by_session: cutBySession,
    cadence_s: cadence,
    eta_ready_at: eta,
  };
}


/**
 * Constrói o B3Context de acordo com a fonte configurada em b3_trading_settings.price_source.
 * Se MT5 estiver selecionado mas não houver tick válido, NÃO cai para CSV.
 * Retorna live=false e ctx zerado para o chamador bloquear execução.
 */
export async function getB3PriceContext(
  supabase: any,
  userId: string,
  opts: {
    symbol?: string; contract?: string; base?: number;
    // Fase 2 (06/08/2026): antes, a busca de cotação SEMPRE usava a
    // constante B3_MT5_SYMBOL ("WINQ26"), não importa o que fosse passado
    // aqui — bug real que fazia qualquer ativo (WDO, PETR4, VALE3) operar
    // em cima do preço do WIN. Agora expectedSymbol controla a busca de
    // verdade; default preserva o comportamento antigo pra quem não passar.
    expectedSymbol?: string;
    tickSize?: number;
    spreadMaxPoints?: number;
    priceDeviationLimit?: number;
    indicatorTimeframe?: "tick" | "m1";
  } = {},
): Promise<B3PriceContextResult> {
  const symbol = opts.symbol ?? "WIN";
  const contract = opts.contract ?? "WINFUT";
  const base = opts.base ?? 130000;
  const expectedSymbol = opts.expectedSymbol ?? B3_MT5_SYMBOL;
  const tickSize = opts.tickSize ?? TICK;
  const indicatorTimeframe = opts.indicatorTimeframe === "m1" ? "m1" : "tick";

  const { data: settings } = await supabase
    .from("b3_trading_settings")
    .select("price_source, mt5_guard_mode, mt5_tick_ttl_seconds, mt5_tick_ttl_tolerance_seconds, mt5_spread_max_points, mt5_price_deviation_limit, mt5_require_nonzero_volume, mt5_require_nonzero_last")
    .eq("user_id", userId)
    .maybeSingle();
  const source: B3PriceSource = (settings?.price_source as B3PriceSource) === "mt5_xp_demo"
    ? "mt5_xp_demo" : "csv";

  const guard: B3GuardSettings = {
    mode: ((settings?.mt5_guard_mode as B3GuardMode) === "protected" ? "protected" : "validation"),
    ttl_seconds: Number(settings?.mt5_tick_ttl_seconds ?? B3_DEFAULT_GUARD.ttl_seconds),
    ttl_tolerance_seconds: Number(settings?.mt5_tick_ttl_tolerance_seconds ?? B3_DEFAULT_GUARD.ttl_tolerance_seconds),
    // Sobrepõe com o limite do PERFIL DO ATIVO quando informado — um spread
    // de 15 "pontos" faz sentido pro WIN, mas em PETR4 (preço ~R$42) isso
    // desligaria a proteção de spread por completo. Fase 2 (06/08/2026).
    spread_max_points: Number(opts.spreadMaxPoints ?? settings?.mt5_spread_max_points ?? B3_DEFAULT_GUARD.spread_max_points),
    price_deviation_limit: Number(opts.priceDeviationLimit ?? settings?.mt5_price_deviation_limit ?? B3_DEFAULT_GUARD.price_deviation_limit),
    require_nonzero_volume: Boolean(settings?.mt5_require_nonzero_volume ?? B3_DEFAULT_GUARD.require_nonzero_volume),
    require_nonzero_last: Boolean(settings?.mt5_require_nonzero_last ?? B3_DEFAULT_GUARD.require_nonzero_last),
  };

  if (source === "csv") {
    return {
      ctx: buildMockB3Context(symbol, contract, base),
      source, live: false, quote_age_s: null, server: null, quote_symbol: null, tick_size: tickSize, raw: null,
      provider_name: "B3QuoteProvider", quote_source: "CSV legado", fallback_to_csv: false,
      mt5_provider_calls: 0, legacy_provider_calls: 1,
      guard, guard_evaluation: null,
    };
  }


  // Lê últimos ticks do ATIVO CORRETO alimentados pela ponte MT5 XP DEMO/PRD.
  const { data: quotes } = await supabase
    .from("b3_mt5sim_quotes")
    .select("bid, ask, last, spread, volume, server, symbol, tick_ts, received_at")
    .eq("user_id", userId)
    .in("server", Array.from(B3_MT5_ALLOWED_SERVERS))
    .eq("symbol", expectedSymbol)
    .order("tick_ts", { ascending: false })
    .limit(180);

  // Saneamento da fonte: a janela de indicadores nunca mistura ticks separados
  // por interrupção > 120s nem pregões diferentes. Mantém o limite de 180 ticks
  // e não altera fórmulas, períodos ou thresholds.
  const sample_window = buildFreshWindow((quotes as any[] | null) ?? []);
  const rows = sample_window.rows;

  if (!rows.length) {
    const info = {
      source, live: false, raw: null as B3QuoteProviderRaw | null,
      server: null as string | null, quote_symbol: null as string | null, quote_age_s: null as number | null, guard,
    };
    return {
      ctx: emptyContext(symbol, contract),
      source, live: false, quote_age_s: null, server: null, quote_symbol: null, tick_size: tickSize, raw: null,
      provider_name: "B3QuoteProvider", quote_source: "inválida", fallback_to_csv: false,
      mt5_provider_calls: 1, legacy_provider_calls: 0,
      guard, guard_evaluation: evaluateMt5Guard(info, expectedSymbol, tickSize),
      sample_window, warming_up_after_gap: sample_window.warming_up_after_gap,
    };
  }

  const latest = rows[0];
  const latestRaw = rawFromRow(latest);
  const now = new Date();
  const ageMs = now.getTime() - new Date(latest.tick_ts).getTime();
  const quoteAge = Math.max(0, Math.round(ageMs / 1000));

  const series = rows.slice().reverse(); // do mais antigo para o mais recente
  // 09/08/2026: ema9/ema21 sobre a série crua de ticks separam cerca de 1
  // minuto de mercado, então o gap entre as médias fica minúsculo e o sinal
  // ema9>=ema21 inverte a cada poucos segundos — origem das entradas em
  // lados opostos entre modos. Com indicator_timeframe='m1' os indicadores
  // passam a ser calculados sobre candles de 1 minuto.
  let m1Rows: any[] = [];
  if (indicatorTimeframe === "m1") {
    const { data: candles } = await supabase.rpc("b3_m1_candles", {
      p_user_id: userId, p_symbol: expectedSymbol, p_limit: 120,
    });
    m1Rows = ((candles as any[]) ?? []).slice().reverse();
  }
  const useM1 = indicatorTimeframe === "m1" && m1Rows.length >= 30;
  const priceOf = (r: any): number => {
    const l = Number(r.last);
    if (Number.isFinite(l) && l > 0) return l;
    const b = Number(r.bid); const a = Number(r.ask);
    if (Number.isFinite(b) && Number.isFinite(a) && b > 0 && a > 0) return (a + b) / 2;
    return Number(r.bid ?? r.ask ?? 0);
  };
  const prices = useM1
    ? m1Rows.map((c) => Number(c.candle_close)).filter((v) => Number.isFinite(v) && v > 0)
    : series.map(priceOf).filter((v) => Number.isFinite(v) && v > 0);
  const volumes = useM1
    ? m1Rows.map((c) => Number(c.volume ?? 0))
    : series.map((r) => Number(r.volume ?? 0));
  const price = priceOf(latest);
  // Modo Validação aceita tick com last zero desde que bid/ask sejam válidos.
  const bidOk = Number(latestRaw.bid) > 0;
  const askOk = Number(latestRaw.ask) > 0;
  const hasUsablePrice = Number.isFinite(price) && price > 0 && bidOk && askOk;
  if (!hasUsablePrice) {
    const info = {
      source, live: false, raw: latestRaw, server: latestRaw.server,
      quote_symbol: latestRaw.symbol, quote_age_s: quoteAge, guard,
    };
    return {
      ctx: emptyContext(symbol, contract),
      source, live: false, quote_age_s: quoteAge, server: latestRaw.server, quote_symbol: latestRaw.symbol, tick_size: tickSize, raw: latestRaw,
      provider_name: "B3QuoteProvider", quote_source: "inválida", fallback_to_csv: false,
      mt5_provider_calls: 1, legacy_provider_calls: 0,
      guard, guard_evaluation: evaluateMt5Guard(info, expectedSymbol, tickSize),
      sample_window, warming_up_after_gap: sample_window.warming_up_after_gap,
    };
  }
  const priceRounded = Math.round(price / tickSize) * tickSize;
  const open = prices[0] ?? price;
  const high = useM1
    ? Math.max(...m1Rows.map((c) => Number(c.candle_high)), price)
    : Math.max(...prices, price);
  const low = useM1
    ? Math.min(...m1Rows.map((c) => Number(c.candle_low)), price)
    : Math.min(...prices, price);
  const totalVol = volumes.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  const vwap = totalVol > 0
    ? prices.reduce((s, p, i) => s + p * Math.max(0, volumes[i]), 0) / totalVol
    : (prices.reduce((s, p) => s + p, 0) / Math.max(1, prices.length));
  const e9 = ema(prices, 9) || price;
  const e21 = ema(prices, 21) || price;
  const eFast = ema(prices, 12) || price;
  const eSlow = ema(prices, 26) || price;
  const macd = eFast - eSlow;
  const macdSignal = ema(prices.map((_, i) => (ema(prices.slice(0, i + 1), 12) - ema(prices.slice(0, i + 1), 26))), 9) || macd;
  const rsi = rsi14(prices);
  const meanPrice = prices.reduce((s, v) => s + v, 0) / Math.max(1, prices.length);
  const sd = stddev(prices);
  // Volatilidade intraday em %: desvio-padrão da série de preços / média × 100.
  // Fórmula anterior aplicava um multiplicador ×20 e saturava em 6% (bug de escala),
  // fazendo todo tick reportar "6,00%" e bloquear qualquer entrada por volatilidade.
  const volatility_pct_raw = meanPrice > 0 ? (sd / meanPrice) * 100 : 0;
  const volatility_pct = Number.isFinite(volatility_pct_raw)
    ? Math.min(10, Math.max(0, volatility_pct_raw))
    : 0;
  const volatility_debug = {
    formula: "(stddev(prices) / mean(prices)) * 100",
    samples: prices.length,
    stddev: Number.isFinite(sd) ? Number(sd.toFixed(4)) : null,
    mean_price: Number.isFinite(meanPrice) ? Number(meanPrice.toFixed(2)) : null,
    raw_pct: Number.isFinite(volatility_pct_raw) ? Number(volatility_pct_raw.toFixed(4)) : null,
    normalized_pct: Number(volatility_pct.toFixed(4)),
    cap_pct: 10,
  };
  // Saúde da janela de amostras (somente diagnóstico).
  const GAP_THRESHOLD_S = 120;
  const tsList = series
    .map((r: any) => new Date(r.tick_ts ?? r.received_at ?? 0).getTime())
    .filter((t: number) => Number.isFinite(t) && t > 0);
  let largestGapS: number | null = null;
  for (let i = 1; i < tsList.length; i++) {
    const g = (tsList[i] - tsList[i - 1]) / 1000;
    if (largestGapS == null || g > largestGapS) largestGapS = g;
  }
  const series_health = {
    samples: prices.length,
    span_minutes: tsList.length > 1 ? Number(((tsList[tsList.length - 1] - tsList[0]) / 60000).toFixed(2)) : null,
    oldest_sample_age_s: tsList.length ? Math.max(0, Math.round((now.getTime() - tsList[0]) / 1000)) : null,
    largest_gap_s: largestGapS != null ? Math.round(largestGapS) : null,
    crosses_tick_gap: largestGapS != null && largestGapS > GAP_THRESHOLD_S,
    gap_threshold_s: GAP_THRESHOLD_S,
  };

  const momentum = prices.length >= 10 ? ((price - prices[prices.length - 10]) / price) * 1000 : 0;
  const avgVol = volumes.length ? volumes.reduce((s, v) => s + v, 0) / volumes.length : 0;
  const volume_ratio = avgVol > 0 ? Number(latest.volume ?? avgVol) / avgVol : 1;
  const spread_pts = Math.max(1, Math.round(Number(latest.spread ?? (Number(latest.ask ?? 0) - Number(latest.bid ?? 0))) || 5));

  const ctx: B3Context = {
    symbol, contract_code: contract,
    price: priceRounded,
    prev_close: open,
    open, high, low,
    vwap,
    ema9: e9,
    ema21: e21,
    rsi,
    macd,
    macd_signal: macdSignal,
    volume_ratio: Number.isFinite(volume_ratio) ? volume_ratio : 1,
    volatility_pct: Number.isFinite(volatility_pct) ? volatility_pct : 1,
    momentum: Number.isFinite(momentum) ? momentum : 0,
    spread_pts,
    now,
    session_phase: saoPauloPhase(now),
  };

  const info = {
    source, live: true, raw: latestRaw, server: latest.server ?? null,
    quote_symbol: latest.symbol ?? null, quote_age_s: quoteAge, guard,
  };
  return {
    ctx,
    source,
    live: true,
    quote_age_s: quoteAge,
    server: latest.server ?? null,
    quote_symbol: latest.symbol ?? null,
    tick_size: tickSize,
    raw: latestRaw,
    provider_name: "B3QuoteProvider",
    quote_source: "MT5 XP DEMO",
    fallback_to_csv: false,
    mt5_provider_calls: 1,
    legacy_provider_calls: 0,
    guard,
    guard_evaluation: evaluateMt5Guard(info, expectedSymbol, tickSize),
    sample_window,
    warming_up_after_gap: sample_window.warming_up_after_gap,
    volatility_debug,
    series_health,
    indicator_timeframe: useM1 ? "m1" : "tick",
    indicator_samples: useM1 ? m1Rows.length : prices.length,
  };
}

export async function B3QuoteProvider(
  supabase: any,
  userId: string,
  opts: {
    symbol?: string; contract?: string; base?: number;
    expectedSymbol?: string; tickSize?: number;
    spreadMaxPoints?: number; priceDeviationLimit?: number;
    indicatorTimeframe?: "tick" | "m1";
  } = {},
): Promise<B3PriceContextResult> {
  return getB3PriceContext(supabase, userId, opts);
}
