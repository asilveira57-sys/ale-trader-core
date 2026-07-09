// Fonte de cotação do módulo B3 Day Trade (WIN).
// Mantém o motor legado inalterado — apenas troca a origem do preço:
//   - 'csv'          → buildMockB3Context (comportamento original, base 130000).
//   - 'mt5_xp_demo'  → constrói B3Context a partir dos ticks reais recebidos
//                      pela ponte MT5 XP DEMO (tabela b3_mt5sim_quotes).
// A saída é o MESMO B3Context: os robôs, comitê, ranking, bloqueios e
// estatísticas continuam idênticos. Só o número que entra muda.

import { buildMockB3Context, type B3Context } from "./b3-committee.server";

export type B3PriceSource = "csv" | "mt5_xp_demo";

const TICK = 5;

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
  raw: { bid: number | null; ask: number | null; last: number | null; spread: number | null } | null;
}

/**
 * Constrói o B3Context de acordo com a fonte configurada em b3_trading_settings.price_source.
 * Se MT5 estiver selecionado mas não houver tick disponível, cai automaticamente
 * em buildMockB3Context (evita travar o motor). O flag `live` indica a origem real.
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
    };
  }

  // Lê os últimos ticks do WINQ26 alimentados pela ponte MT5.
  const { data: quotes } = await supabase
    .from("b3_mt5sim_quotes")
    .select("bid, ask, last, spread, volume, server, symbol, tick_ts, received_at")
    .eq("user_id", userId)
    .order("tick_ts", { ascending: false })
    .limit(180);

  const rows = (quotes as any[] | null) ?? [];
  if (!rows.length) {
    // Sem ticks — não bloqueia o motor: retorna mock e sinaliza live=false.
    return {
      ctx: buildMockB3Context(symbol, contract, base),
      source, live: false, quote_age_s: null, server: null, quote_symbol: null, raw: null,
    };
  }

  const latest = rows[0];
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
    raw: {
      bid: latest.bid != null ? Number(latest.bid) : null,
      ask: latest.ask != null ? Number(latest.ask) : null,
      last: latest.last != null ? Number(latest.last) : null,
      spread: latest.spread != null ? Number(latest.spread) : null,
    },
  };
}
