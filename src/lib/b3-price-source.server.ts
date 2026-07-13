// B3QuoteProvider — fonte central de cotação do módulo B3 Day Trade (WIN).
// Mantém o cérebro dos robôs inalterado e isola a origem do preço aqui.
// Regra crítica: quando a fonte selecionada é MT5 XP DEMO, nenhum fallback
// para CSV/mock/candle antigo é permitido para execução.

import { buildMockB3Context, type B3Context } from "./b3-committee.server";

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

export function isB3StrictMt5AuditRow(row: any): boolean {
  return row?.quote_source === "MT5 XP DEMO"
    && row?.provider_name === "B3QuoteProvider"
    && row?.quote_server === B3_MT5_SERVER
    && row?.quote_symbol === B3_MT5_SYMBOL
    && row?.legacy_price_detected === false
    && Number(row?.quote_bid) > 0
    && Number(row?.quote_ask) > 0
    && Number(row?.quote_last) > 0
    && Number(row?.execution_price) > 0;
}

export function assertB3StrictMt5ExecutionAudit(audit: B3QuoteExecutionAudit, functionName: string): void {
  if (!isB3StrictMt5AuditRow(audit)) {
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
  raw: B3QuoteProviderRaw | null;
  provider_name: "B3QuoteProvider";
  quote_source: B3QuoteSourceLabel;
  fallback_to_csv: boolean;
  mt5_provider_calls: number;
  legacy_provider_calls: number;
  guard: B3GuardSettings;
  guard_evaluation: B3GuardEvaluation | null;
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

export function assertFreshMt5Quote(info: B3PriceContextResult, functionName: string): void {
  const bid = info.raw?.bid ?? 0;
  const ask = info.raw?.ask ?? 0;
  const last = info.raw?.last ?? 0;
  if (info.source !== "mt5_xp_demo") throw new Error(`${functionName}: fonte selecionada não é MT5 XP DEMO`);
  if (!info.live || !info.raw) throw new Error(`${functionName}: tick MT5 XP DEMO indisponível — operação bloqueada`);
  if (info.quote_symbol !== B3_MT5_SYMBOL) throw new Error(`${functionName}: símbolo inválido (${info.quote_symbol ?? "—"}) — esperado ${B3_MT5_SYMBOL}`);
  if (info.server !== B3_MT5_SERVER) throw new Error(`${functionName}: servidor inválido (${info.server ?? "—"}) — esperado ${B3_MT5_SERVER}`);
  if (info.quote_age_s == null || info.quote_age_s > B3_MT5_TTL_SECONDS) throw new Error(`${functionName}: idade do tick ${info.quote_age_s ?? "—"}s acima do TTL — operação bloqueada`);
  if (!(bid > 0) || !(ask > 0) || !(last > 0)) throw new Error(`${functionName}: bid/ask/último inválidos — operação bloqueada`);
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
    if (Math.abs(price - last) > B3_MT5_PRICE_DEVIATION_LIMIT) {
      throw new Error(`Preço de execução incompatível com a cotação MT5 — operação bloqueada (${functionName}; provider=B3QuoteProvider; MT5=${last}; rejeitado=${price})`);
    }
    return {
      ...quoteAuditBase(info),
      execution_price: Math.round(price / TICK) * TICK,
      execution_price_origin: action === "entry"
        ? (side === "buy" ? "mt5_ask_entry" : "mt5_bid_entry")
        : (side === "buy" ? "mt5_bid_exit_mark" : "mt5_ask_exit_mark"),
      legacy_price_detected: false,
    };
  }

  const price = Math.round(Number(info.ctx.price || 0) / TICK) * TICK;
  return {
    ...quoteAuditBase(info),
    execution_price: price,
    execution_price_origin: `${functionName}:csv_context_price`,
    legacy_price_detected: true,
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
  opts: { symbol?: string; contract?: string; base?: number } = {},
): Promise<B3PriceContextResult> {
  const symbol = opts.symbol ?? "WIN";
  const contract = opts.contract ?? "WINFUT";
  const base = opts.base ?? 130000;

  const { data: settings } = await supabase
    .from("b3_trading_settings")
    .select("price_source")
    .eq("user_id", userId)
    .maybeSingle();
  const source: B3PriceSource = (settings?.price_source as B3PriceSource) === "mt5_xp_demo"
    ? "mt5_xp_demo" : "csv";

  if (source === "csv") {
    return {
      ctx: buildMockB3Context(symbol, contract, base),
      source, live: false, quote_age_s: null, server: null, quote_symbol: null, raw: null,
      provider_name: "B3QuoteProvider", quote_source: "CSV legado", fallback_to_csv: false,
      mt5_provider_calls: 0, legacy_provider_calls: 1,
    };
  }

  // Lê somente os últimos ticks WINQ26 alimentados pela ponte MT5 XP DEMO.
  const { data: quotes } = await supabase
    .from("b3_mt5sim_quotes")
    .select("bid, ask, last, spread, volume, server, symbol, tick_ts, received_at")
    .eq("user_id", userId)
    .eq("server", B3_MT5_SERVER)
    .eq("symbol", B3_MT5_SYMBOL)
    .order("tick_ts", { ascending: false })
    .limit(180);

  const rows = (quotes as any[] | null) ?? [];
  if (!rows.length) {
    return {
      ctx: emptyContext(symbol, contract),
      source, live: false, quote_age_s: null, server: null, quote_symbol: null, raw: null,
      provider_name: "B3QuoteProvider", quote_source: "inválida", fallback_to_csv: false,
      mt5_provider_calls: 1, legacy_provider_calls: 0,
    };
  }

  const latest = rows[0];
  const latestRaw = rawFromRow(latest);
  const series = rows.slice().reverse(); // do mais antigo para o mais recente
  const priceOf = (r: any): number => {
    const l = Number(r.last);
    if (Number.isFinite(l) && l > 0) return l;
    const b = Number(r.bid); const a = Number(r.ask);
    if (Number.isFinite(b) && Number.isFinite(a) && b > 0 && a > 0) return (a + b) / 2;
    return Number(r.bid ?? r.ask ?? 0);
  };
  const prices = series.map(priceOf).filter(v => Number.isFinite(v) && v > 0);
  const volumes = series.map(r => Number(r.volume ?? 0));
  const price = priceOf(latest);
  const hasValidTop = Number(latestRaw.bid) > 0 && Number(latestRaw.ask) > 0 && Number(latestRaw.last) > 0;
  if (!Number.isFinite(price) || price <= 0 || !hasValidTop) {
    return {
      ctx: emptyContext(symbol, contract),
      source, live: false, quote_age_s: null, server: latestRaw.server, quote_symbol: latestRaw.symbol, raw: latestRaw,
      provider_name: "B3QuoteProvider", quote_source: "inválida", fallback_to_csv: false,
      mt5_provider_calls: 1, legacy_provider_calls: 0,
    };
  }
  const priceRounded = Math.round(price / TICK) * TICK;
  const open = prices[0] ?? price;
  const high = Math.max(...prices, price);
  const low = Math.min(...prices, price);
  const totalVol = volumes.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  const vwap = totalVol > 0
    ? prices.reduce((s, p, i) => s + p * Math.max(0, volumes[i]), 0) / totalVol
    : (prices.reduce((s, p) => s + p, 0) / Math.max(1, prices.length));
  const e9 = ema(prices, 9) || price;
  const e21 = ema(prices, 21) || price;
  const eFast = ema(prices, 12) || price;
  const eSlow = ema(prices, 26) || price;
  const macd = eFast - eSlow;
  // MACD signal ~ EMA9 do próprio MACD; aproximação: eFast(9) da série de diferenças curtas.
  const macdSignal = ema(prices.map((_, i) => (ema(prices.slice(0, i + 1), 12) - ema(prices.slice(0, i + 1), 26))), 9) || macd;
  const rsi = rsi14(prices);
  const meanPrice = prices.reduce((s, v) => s + v, 0) / Math.max(1, prices.length);
  const sd = stddev(prices);
  const volatility_pct = meanPrice > 0 ? Math.min(6, (sd / meanPrice) * 100 * 20) : 1;
  const momentum = prices.length >= 10 ? ((price - prices[prices.length - 10]) / price) * 1000 : 0;
  const avgVol = volumes.length ? volumes.reduce((s, v) => s + v, 0) / volumes.length : 0;
  const volume_ratio = avgVol > 0 ? Number(latest.volume ?? avgVol) / avgVol : 1;
  const spread_pts = Math.max(1, Math.round(Number(latest.spread ?? (Number(latest.ask ?? 0) - Number(latest.bid ?? 0))) || 5));

  const now = new Date();
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

  const ageMs = now.getTime() - new Date(latest.tick_ts).getTime();
  return {
    ctx,
    source,
    live: true,
    quote_age_s: Math.max(0, Math.round(ageMs / 1000)),
    server: latest.server ?? null,
    quote_symbol: latest.symbol ?? null,
    raw: latestRaw,
    provider_name: "B3QuoteProvider",
    quote_source: "MT5 XP DEMO",
    fallback_to_csv: false,
    mt5_provider_calls: 1,
    legacy_provider_calls: 0,
  };
}

export async function B3QuoteProvider(
  supabase: any,
  userId: string,
  opts: { symbol?: string; contract?: string; base?: number } = {},
): Promise<B3PriceContextResult> {
  return getB3PriceContext(supabase, userId, opts);
}
