// Binance Exit Audit — Cérebro de Auditoria Pós-Trade.
// Calcula recovery real via klines Binance, persiste em binance_audit_learning,
// classifica saídas e produz Early Exit Score / Quality Score dinâmicos.
// Somente módulo Binance. Não toca em tabelas b3_* / win_* / futures_b3_*.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LossSell = {
  source: "real_positions" | "automated_trades" | "simulated_orders";
  id: string;
  pair: string;
  side: "buy" | "sell";
  asset: string;
  opened_at: string;
  closed_at: string;
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  exit_reason: string | null;
  // Preços favoráveis pós-saída (high p/ LONG, low p/ SHORT).
  price_1h: number | null;
  price_4h: number | null;
  price_12h: number | null;
  price_24h: number | null;
  // Recovery % (positivo = mercado evoluiu a favor de manter a posição).
  recovery_1h: number | null;
  recovery_4h: number | null;
  recovery_12h: number | null;
  recovery_24h: number | null;
  recovery_max: number | null;
  recovered_1h: boolean;
  recovered_4h: boolean;
  recovered_12h: boolean;
  recovered_24h: boolean;
  drop_pct: number;
  classification: string; // ver CLASSES
  diagnosis: string;       // diagnóstico humano
  premature: boolean;
  avoidable: boolean;
  score: number; // 0–100 por trade
  candles_available: boolean;
  votes: Array<{ agent: string; vote: string; confidence: number }>;
  decision: {
    final_decision: string | null;
    score: number | null;
    consensus: number | null;
    justification: string | null;
  } | null;
};

export type AuditReport = {
  generated_at: string;
  total_closed: number;
  total_losses: number;
  audited: number;
  pending: number;
  processed_this_run: number;
  has_more: boolean;
  recovery_rate_1h: number;
  recovery_rate_4h: number;
  recovery_rate_12h: number;
  recovery_rate_24h: number;
  avg_recovery_1h: number;
  avg_recovery_4h: number;
  avg_recovery_12h: number;
  avg_recovery_24h: number;
  early_exit_score: number;
  premature_count: number;
  correct_count: number;
  avoidable_loss_usdt: number;
  unavoidable_loss_usdt: number;
  avoidable_stops: number;
  unavoidable_stops: number;
  perfect_pct: number;
  early_pct: number;
  quality_score: number;
  by_classification: Record<string, number>;
  quality: { label: "Excelente" | "Boa" | "Regular" | "Ruim" | "Crítica"; color: string; threshold_pct: number };
  alert: string | null;
  suggestions: string[];
  losses: LossSell[];
};

const BINANCE_BASE = "https://api.binance.com";
const PREMATURE_THRESHOLD_PCT = 5;        // recovery >=5% => prematura
const VERY_EARLY_THRESHOLD_PCT = 10;      // recovery >=10% => muito antecipada
const PERFECT_THRESHOLD_PCT = 0.5;        // recovery max <=0.5% => quase topo

type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

/** Busca klines 5m cobrindo 24h após exitMs; retorna [] em falha. */
async function fetchPostExitKlines(symbol: string, exitMs: number): Promise<Kline[]> {
  try {
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=5m&startTime=${exitMs}&endTime=${exitMs + 24 * 3600_000}&limit=300`;
    const r = await fetch(url);
    if (!r.ok) return [];
    return (await r.json()) as Kline[];
  } catch {
    return [];
  }
}

/** Maior high (LONG) ou menor low (SHORT) dentro de N horas após exitMs. */
function extremeInWindow(klines: Kline[], exitMs: number, hours: number, side: "buy" | "sell"): number | null {
  const cutoff = exitMs + hours * 3600_000;
  let extreme: number | null = null;
  for (const k of klines) {
    const openTime = Number(k[0]);
    if (openTime > cutoff) break;
    const high = Number(k[2]);
    const low = Number(k[3]);
    if (side === "buy") {
      if (extreme === null || high > extreme) extreme = high;
    } else {
      if (extreme === null || low < extreme) extreme = low;
    }
  }
  return extreme;
}

/** Recovery % a favor de manter posição: LONG ganha se subiu; SHORT ganha se caiu. */
function recoveryPct(side: "buy" | "sell", exit: number, favorable: number | null): number | null {
  if (favorable === null || !Number.isFinite(favorable) || exit <= 0) return null;
  const diff = side === "buy" ? favorable - exit : exit - favorable;
  return (diff / exit) * 100;
}

type Classification =
  | "Venda perfeita" | "Venda correta" | "Venda antecipada" | "Venda muito antecipada"
  | "Stop inevitável" | "Stop evitável" | "Realização precoce" | "Pullback"
  | "Reversão confirmada" | "Continuação de tendência" | "Saída emocional"
  | "Correção saudável" | "Mercado lateral" | "Alta volatilidade" | "Ruído"
  | "Sem dados";

function classify(opts: {
  side: "buy" | "sell";
  pnl_pct: number;
  rec_max: number | null;       // melhor recovery em 24h (a favor de manter)
  rec_1h: number | null;
  rec_24h: number | null;
  candles: boolean;
}): { classification: Classification; diagnosis: string; avoidable: boolean; premature: boolean; score: number } {
  if (!opts.candles || opts.rec_max === null) {
    return { classification: "Sem dados", diagnosis: "Sem candles pós-saída disponíveis ainda.", avoidable: false, premature: false, score: 50 };
  }
  const rec = opts.rec_max;
  const lossAbs = Math.abs(opts.pnl_pct);

  // Mercado seguiu na direção da saída (rec negativo): stop foi correto.
  if (rec <= 0) {
    if (lossAbs >= 3) {
      return { classification: "Stop inevitável", diagnosis: "Mercado continuou contra a posição; stop protegeu de perda maior.", avoidable: false, premature: false, score: 75 };
    }
    return { classification: "Continuação de tendência", diagnosis: "Tendência contrária persistiu; saída foi consistente.", avoidable: false, premature: false, score: 70 };
  }

  // Recovery dentro do ruído.
  if (rec <= PERFECT_THRESHOLD_PCT) {
    return { classification: "Venda perfeita", diagnosis: "Saída praticamente no melhor preço disponível.", avoidable: false, premature: false, score: 95 };
  }

  if (rec < 2) {
    return { classification: "Venda correta", diagnosis: "Pequeno movimento favorável residual, sem prejuízo relevante.", avoidable: false, premature: false, score: 82 };
  }

  if (rec < PREMATURE_THRESHOLD_PCT) {
    // 2% a 5% — área cinza
    if (lossAbs < 1) {
      return { classification: "Realização precoce", diagnosis: "Encerramento com pouco fôlego; mercado andou mais a favor.", avoidable: true, premature: false, score: 55 };
    }
    return { classification: "Pullback", diagnosis: "Pequeno repique após saída; movimento dentro do esperado.", avoidable: false, premature: false, score: 65 };
  }

  if (rec < VERY_EARLY_THRESHOLD_PCT) {
    // 5% a 10% — prematura
    const avoidable = lossAbs < 5; // stop pequeno e mercado voltou: evitável
    return {
      classification: avoidable ? "Stop evitável" : "Venda antecipada",
      diagnosis: `Mercado andou +${rec.toFixed(1)}% a favor após a saída — recovery acima do limite (${PREMATURE_THRESHOLD_PCT}%).`,
      avoidable,
      premature: true,
      score: avoidable ? 25 : 30,
    };
  }

  // >=10% — muito antecipada / saída emocional
  if (opts.rec_1h !== null && opts.rec_1h >= PREMATURE_THRESHOLD_PCT) {
    return {
      classification: "Saída emocional",
      diagnosis: `Reversão violenta em menos de 1h (+${opts.rec_1h.toFixed(1)}%); saída provavelmente reativa.`,
      avoidable: true,
      premature: true,
      score: 8,
    };
  }
  return {
    classification: "Venda muito antecipada",
    diagnosis: `Recovery de +${rec.toFixed(1)}% em até 24h — perda totalmente evitável.`,
    avoidable: true,
    premature: true,
    score: 10,
  };
}

function qualityFromScore(score: number) {
  if (score >= 80) return { label: "Excelente" as const, color: "text-emerald-400", threshold_pct: score };
  if (score >= 65) return { label: "Boa" as const, color: "text-green-400", threshold_pct: score };
  if (score >= 50) return { label: "Regular" as const, color: "text-yellow-400", threshold_pct: score };
  if (score >= 35) return { label: "Ruim" as const, color: "text-orange-400", threshold_pct: score };
  return { label: "Crítica" as const, color: "text-red-500", threshold_pct: score };
}

type CachedRow = {
  source: string; trade_id: string;
  high_1h: number | null; low_1h: number | null;
  high_4h: number | null; low_4h: number | null;
  high_12h: number | null; low_12h: number | null;
  high_24h: number | null; low_24h: number | null;
  recovery_1h: number | null; recovery_4h: number | null;
  recovery_12h: number | null; recovery_24h: number | null;
  recovery_max: number | null;
  classification: string | null; diagnosis: string | null;
  avoidable: boolean | null; premature: boolean | null;
  score: number | null; candles_available: boolean | null;
};

export const auditBinanceExits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batchSize?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Limite de trades a processar (klines) por chamada — UI repete até has_more=false.
    const batchSize = Math.min(Math.max(data.batchSize ?? 600, 50), 1500);

    const PAGE = 1000;
    async function paginate<R>(builder: (from: number, to: number) => any): Promise<R[]> {
      const out: R[] = [];
      let from = 0;
      while (true) {
        const to = from + PAGE - 1;
        const { data: rows } = await builder(from, to);
        if (!rows || rows.length === 0) break;
        out.push(...(rows as R[]));
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return out;
    }

    // ===== Coleta vendas em prejuízo =====
    const [realPosRows, autoTradesRows, simOrdersRows] = await Promise.all([
      paginate<any>((f, t) => supabase
        .from("real_positions")
        .select("id, pair, opened_at, closed_at, entry_price, exit_price, pnl, pnl_pct, exit_reason, request_id, side")
        .eq("status", "closed").lt("pnl", 0)
        .order("closed_at", { ascending: false }).range(f, t)),
      paginate<any>((f, t) => supabase
        .from("automated_trades")
        .select("id, asset_id, opened_at, closed_at, entry_price, exit_price, pnl, pnl_pct, exit_reason, request_id, side")
        .eq("status", "closed").lt("pnl", 0)
        .order("closed_at", { ascending: false }).range(f, t)),
      paginate<any>((f, t) => supabase
        .from("simulated_orders")
        .select("id, pair, side, created_at, closed_at, entry_price, closed_price, realized_pnl, net_pnl")
        .eq("status", "closed").or("net_pnl.lt.0,realized_pnl.lt.0")
        .order("closed_at", { ascending: false }).range(f, t)),
    ]);

    const [realClosed, autoClosed, simClosed] = await Promise.all([
      supabase.from("real_positions").select("id", { count: "exact", head: true }).eq("status", "closed"),
      supabase.from("automated_trades").select("id", { count: "exact", head: true }).eq("status", "closed"),
      supabase.from("simulated_orders").select("id", { count: "exact", head: true }).eq("status", "closed"),
    ]);
    const totalClosed = (realClosed.count ?? 0) + (autoClosed.count ?? 0) + (simClosed.count ?? 0);

    // Asset map p/ automated_trades
    const assetIds = (autoTradesRows ?? []).map((t) => t.asset_id).filter(Boolean) as string[];
    const assetMap = new Map<string, string>();
    if (assetIds.length) {
      const { data: assets } = await supabase.from("monitored_assets").select("id, pair").in("id", assetIds);
      for (const a of (assets ?? []) as Array<{ id: string; pair: string }>) assetMap.set(a.id, a.pair);
    }

    // ===== Monta lista base de perdas =====
    const losses: LossSell[] = [];
    const baseEmpty: Omit<LossSell, "source" | "id" | "pair" | "side" | "asset" | "opened_at" | "closed_at" | "entry_price" | "exit_price" | "pnl" | "pnl_pct" | "exit_reason" | "drop_pct"> = {
      price_1h: null, price_4h: null, price_12h: null, price_24h: null,
      recovery_1h: null, recovery_4h: null, recovery_12h: null, recovery_24h: null, recovery_max: null,
      recovered_1h: false, recovered_4h: false, recovered_12h: false, recovered_24h: false,
      classification: "Sem dados", diagnosis: "Aguardando análise.",
      premature: false, avoidable: false, score: 50, candles_available: false,
      votes: [], decision: null,
    };
    for (const p of realPosRows ?? []) {
      const side: "buy" | "sell" = ((p.side as string) ?? "buy") === "sell" ? "sell" : "buy";
      losses.push({
        ...baseEmpty,
        source: "real_positions", id: p.id, pair: p.pair, side,
        asset: (p.pair as string).replace("USDT", ""),
        opened_at: p.opened_at, closed_at: p.closed_at,
        entry_price: Number(p.entry_price), exit_price: Number(p.exit_price),
        pnl: Number(p.pnl), pnl_pct: Number(p.pnl_pct),
        exit_reason: (p.exit_reason as string | null) ?? null,
        drop_pct: ((Number(p.exit_price) - Number(p.entry_price)) / Number(p.entry_price)) * 100,
        ...({ __requestId: p.request_id ?? null } as any),
      });
    }
    for (const t of autoTradesRows ?? []) {
      const symbol = (t.asset_id && assetMap.get(t.asset_id)) || "";
      if (!symbol) continue;
      const side: "buy" | "sell" = ((t.side as string) ?? "buy") === "sell" ? "sell" : "buy";
      losses.push({
        ...baseEmpty,
        source: "automated_trades", id: t.id, pair: symbol, side,
        asset: symbol.replace("USDT", ""),
        opened_at: t.opened_at, closed_at: t.closed_at,
        entry_price: Number(t.entry_price), exit_price: Number(t.exit_price),
        pnl: Number(t.pnl), pnl_pct: Number(t.pnl_pct),
        exit_reason: (t.exit_reason as string | null) ?? null,
        drop_pct: ((Number(t.exit_price) - Number(t.entry_price)) / Number(t.entry_price)) * 100,
        ...({ __requestId: t.request_id ?? null } as any),
      });
    }
    for (const s of simOrdersRows ?? []) {
      const entry = Number(s.entry_price);
      const exit = Number(s.closed_price);
      if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0) continue;
      const side: "buy" | "sell" = (s.side as string) === "sell" ? "sell" : "buy";
      const pnl = Number(s.net_pnl ?? s.realized_pnl ?? 0);
      const drop_pct = ((exit - entry) / entry) * 100;
      const pnl_pct = side === "buy" ? drop_pct : -drop_pct;
      losses.push({
        ...baseEmpty,
        source: "simulated_orders", id: s.id, pair: s.pair, side,
        asset: (s.pair as string).replace("USDT", ""),
        opened_at: s.created_at, closed_at: s.closed_at,
        entry_price: entry, exit_price: exit,
        pnl, pnl_pct,
        exit_reason: null,
        drop_pct,
        ...({ __requestId: null } as any),
      });
    }

    // ===== Carrega cache (binance_audit_learning) =====
    const cacheMap = new Map<string, CachedRow>(); // key = `${source}:${trade_id}`
    if (losses.length) {
      const tradeIds = losses.map((l) => l.id);
      // paginar IN(...) p/ evitar URL gigante
      const CHUNK = 500;
      for (let i = 0; i < tradeIds.length; i += CHUNK) {
        const chunk = tradeIds.slice(i, i + CHUNK);
        const { data: rows } = await supabase
          .from("binance_audit_learning")
          .select("source,trade_id,high_1h,low_1h,high_4h,low_4h,high_12h,low_12h,high_24h,low_24h,recovery_1h,recovery_4h,recovery_12h,recovery_24h,recovery_max,classification,diagnosis,avoidable,premature,score,candles_available")
          .in("trade_id", chunk);
        for (const r of (rows ?? []) as CachedRow[]) {
          cacheMap.set(`${r.source}:${r.trade_id}`, r);
        }
      }
    }

    // Aplica cache às perdas
    for (const l of losses) {
      const c = cacheMap.get(`${l.source}:${l.id}`);
      if (!c) continue;
      const favKey = (n: number | null, side: "buy" | "sell", h: "1h" | "4h" | "12h" | "24h") => {
        const high = (c as any)[`high_${h}`] as number | null;
        const low = (c as any)[`low_${h}`] as number | null;
        return side === "buy" ? high : low;
      };
      l.price_1h = favKey(null, l.side, "1h");
      l.price_4h = favKey(null, l.side, "4h");
      l.price_12h = favKey(null, l.side, "12h");
      l.price_24h = favKey(null, l.side, "24h");
      l.recovery_1h = c.recovery_1h;
      l.recovery_4h = c.recovery_4h;
      l.recovery_12h = c.recovery_12h;
      l.recovery_24h = c.recovery_24h;
      l.recovery_max = c.recovery_max;
      l.recovered_1h = (c.recovery_1h ?? 0) > 0;
      l.recovered_4h = (c.recovery_4h ?? 0) > 0;
      l.recovered_12h = (c.recovery_12h ?? 0) > 0;
      l.recovered_24h = (c.recovery_24h ?? 0) > 0;
      l.classification = c.classification ?? "Sem dados";
      l.diagnosis = c.diagnosis ?? "";
      l.avoidable = !!c.avoidable;
      l.premature = !!c.premature;
      l.score = Number(c.score ?? 50);
      l.candles_available = !!c.candles_available;
    }

    // ===== Processa perdas sem cache (com janela mínima de 1h disponível) =====
    const nowMs = Date.now();
    const pendingAll = losses.filter((l) => {
      if (cacheMap.has(`${l.source}:${l.id}`)) return false;
      const t = new Date(l.closed_at).getTime();
      return Number.isFinite(t) && t + 3600_000 <= nowMs;
    });
    const toProcess = pendingAll.slice(0, batchSize);

    let processedThisRun = 0;
    const CONCURRENCY = 20;
    type UpsertRow = {
      source: string; trade_id: string; symbol: string; side: string;
      exit_time: string; exit_price: number; entry_price: number;
      pnl: number | null; pnl_pct: number | null;
      high_1h: number | null; low_1h: number | null;
      high_4h: number | null; low_4h: number | null;
      high_12h: number | null; low_12h: number | null;
      high_24h: number | null; low_24h: number | null;
      recovery_1h: number | null; recovery_4h: number | null;
      recovery_12h: number | null; recovery_24h: number | null;
      recovery_max: number | null;
      classification: string; diagnosis: string;
      avoidable: boolean; premature: boolean; score: number;
      candles_available: boolean;
    };
    const upserts: UpsertRow[] = [];

    for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
      const batch = toProcess.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (l) => {
        const exitMs = new Date(l.closed_at).getTime();
        const klines = await fetchPostExitKlines(l.pair, exitMs);
        const candlesAvail = klines.length > 0;

        const high_1h = candlesAvail ? extremeInWindow(klines, exitMs, 1, "buy") : null;
        const low_1h  = candlesAvail ? extremeInWindow(klines, exitMs, 1, "sell") : null;
        const high_4h = candlesAvail ? extremeInWindow(klines, exitMs, 4, "buy") : null;
        const low_4h  = candlesAvail ? extremeInWindow(klines, exitMs, 4, "sell") : null;
        const high_12h = candlesAvail && (exitMs + 12 * 3600_000 <= nowMs) ? extremeInWindow(klines, exitMs, 12, "buy") : null;
        const low_12h  = candlesAvail && (exitMs + 12 * 3600_000 <= nowMs) ? extremeInWindow(klines, exitMs, 12, "sell") : null;
        const high_24h = candlesAvail && (exitMs + 24 * 3600_000 <= nowMs) ? extremeInWindow(klines, exitMs, 24, "buy") : null;
        const low_24h  = candlesAvail && (exitMs + 24 * 3600_000 <= nowMs) ? extremeInWindow(klines, exitMs, 24, "sell") : null;

        const fav = (h: number | null, lo: number | null) => l.side === "buy" ? h : lo;
        const rec_1h = recoveryPct(l.side, l.exit_price, fav(high_1h, low_1h));
        const rec_4h = recoveryPct(l.side, l.exit_price, fav(high_4h, low_4h));
        const rec_12h = recoveryPct(l.side, l.exit_price, fav(high_12h, low_12h));
        const rec_24h = recoveryPct(l.side, l.exit_price, fav(high_24h, low_24h));
        const rec_values = [rec_1h, rec_4h, rec_12h, rec_24h].filter((v): v is number => v !== null);
        const rec_max = rec_values.length ? Math.max(...rec_values) : null;

        const cls = classify({
          side: l.side, pnl_pct: l.pnl_pct, rec_max, rec_1h, rec_24h,
          candles: candlesAvail,
        });

        // aplica em memória
        l.price_1h = fav(high_1h, low_1h);
        l.price_4h = fav(high_4h, low_4h);
        l.price_12h = fav(high_12h, low_12h);
        l.price_24h = fav(high_24h, low_24h);
        l.recovery_1h = rec_1h; l.recovery_4h = rec_4h;
        l.recovery_12h = rec_12h; l.recovery_24h = rec_24h;
        l.recovery_max = rec_max;
        l.recovered_1h = (rec_1h ?? 0) > 0;
        l.recovered_4h = (rec_4h ?? 0) > 0;
        l.recovered_12h = (rec_12h ?? 0) > 0;
        l.recovered_24h = (rec_24h ?? 0) > 0;
        l.classification = cls.classification;
        l.diagnosis = cls.diagnosis;
        l.avoidable = cls.avoidable;
        l.premature = cls.premature;
        l.score = cls.score;
        l.candles_available = candlesAvail;
        processedThisRun++;

        upserts.push({
          source: l.source, trade_id: l.id, symbol: l.pair, side: l.side,
          exit_time: l.closed_at, exit_price: l.exit_price, entry_price: l.entry_price,
          pnl: l.pnl, pnl_pct: l.pnl_pct,
          high_1h, low_1h, high_4h, low_4h, high_12h, low_12h, high_24h, low_24h,
          recovery_1h: rec_1h, recovery_4h: rec_4h, recovery_12h: rec_12h, recovery_24h: rec_24h,
          recovery_max: rec_max,
          classification: cls.classification, diagnosis: cls.diagnosis,
          avoidable: cls.avoidable, premature: cls.premature, score: cls.score,
          candles_available: candlesAvail,
        });
      }));
    }

    // Persiste em lote
    if (upserts.length) {
      // Service role para gravar (RLS permite só SELECT a authenticated).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const CHUNK = 200;
      for (let i = 0; i < upserts.length; i += CHUNK) {
        await supabaseAdmin
          .from("binance_audit_learning")
          .upsert(upserts.slice(i, i + CHUNK), { onConflict: "source,trade_id" });
      }
    }

    // ===== Métricas =====
    const total = losses.length;
    const audited = losses.filter((l) => l.candles_available).length;
    const pending = pendingAll.length - processedThisRun;
    const hasMore = pending > 0;

    const recovered = (key: "recovered_1h" | "recovered_4h" | "recovered_12h" | "recovered_24h") =>
      losses.filter((l) => l[key]).length;
    const rate = (n: number) => (audited ? (n / audited) * 100 : 0);
    const recovery_rate_1h = rate(recovered("recovered_1h"));
    const recovery_rate_4h = rate(recovered("recovered_4h"));
    const recovery_rate_12h = rate(recovered("recovered_12h"));
    const recovery_rate_24h = rate(recovered("recovered_24h"));

    const avg = (key: "recovery_1h" | "recovery_4h" | "recovery_12h" | "recovery_24h") => {
      const vals = losses.map((l) => l[key]).filter((v): v is number => v !== null);
      if (!vals.length) return 0;
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    };
    const avg_recovery_1h = avg("recovery_1h");
    const avg_recovery_4h = avg("recovery_4h");
    const avg_recovery_12h = avg("recovery_12h");
    const avg_recovery_24h = avg("recovery_24h");

    const premature_count = losses.filter((l) => l.premature).length;
    const correct_count = audited - premature_count;
    const early_exit_score = audited ? (premature_count / audited) * 100 : 0;
    const avoidable_loss_usdt = losses.filter((l) => l.avoidable).reduce((s, l) => s + Math.abs(l.pnl), 0);
    const unavoidable_loss_usdt = losses.filter((l) => l.candles_available && !l.avoidable).reduce((s, l) => s + Math.abs(l.pnl), 0);
    const avoidable_stops = losses.filter((l) => l.classification === "Stop evitável").length;
    const unavoidable_stops = losses.filter((l) => l.classification === "Stop inevitável").length;
    const perfect_pct = audited ? (losses.filter((l) => l.classification === "Venda perfeita").length / audited) * 100 : 0;
    const early_pct = audited ? (losses.filter((l) => l.classification === "Venda antecipada" || l.classification === "Venda muito antecipada").length / audited) * 100 : 0;

    // Quality Score = média dos scores individuais (apenas auditados)
    const quality_score = audited
      ? losses.filter((l) => l.candles_available).reduce((s, l) => s + l.score, 0) / audited
      : 50;

    const by_classification: Record<string, number> = {};
    for (const l of losses) by_classification[l.classification] = (by_classification[l.classification] ?? 0) + 1;

    const quality = qualityFromScore(quality_score);

    const suggestions: string[] = [];
    let alert: string | null = null;
    if (early_exit_score > 30) {
      alert = "Comitê Binance está vendendo prematuramente em mais de 30% dos casos.";
      suggestions.push(
        "Aumentar consenso mínimo para vendas (ex.: 6+ votos vendedores).",
        "Adicionar cooldown após queda brusca antes de nova venda.",
        "Exigir confirmação de reversão (média curta < média longa por N candles).",
        "Filtro ATR para reduzir vendas em volatilidade momentânea.",
      );
    } else if (avoidable_stops > unavoidable_stops && audited > 20) {
      alert = "Stops evitáveis superam inevitáveis — revisar largura do stop.";
      suggestions.push("Ampliar distância do stop loss em ativos voláteis.", "Aplicar trailing stop dinâmico baseado em ATR.");
    }

    // limpa marker interno
    for (const l of losses) delete (l as any).__requestId;

    const report: AuditReport = {
      generated_at: new Date().toISOString(),
      total_closed: totalClosed,
      total_losses: total,
      audited,
      pending,
      processed_this_run: processedThisRun,
      has_more: hasMore,
      recovery_rate_1h, recovery_rate_4h, recovery_rate_12h, recovery_rate_24h,
      avg_recovery_1h, avg_recovery_4h, avg_recovery_12h, avg_recovery_24h,
      early_exit_score, premature_count, correct_count,
      avoidable_loss_usdt, unavoidable_loss_usdt,
      avoidable_stops, unavoidable_stops,
      perfect_pct, early_pct,
      quality_score,
      by_classification,
      quality,
      alert,
      suggestions,
      losses,
    };
    return report;
  });
