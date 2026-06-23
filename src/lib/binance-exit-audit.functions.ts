// Binance Exit Audit — EXCLUSIVO módulo Binance. Não toca em tabelas b3_*, win_*, futures_b3_*.
// Apenas leitura + cálculos. Não cria/edita ordens nem altera estratégia.
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
  // recovery
  price_1h: number | null;
  price_4h: number | null;
  price_12h: number | null;
  price_24h: number | null;
  recovered_1h: boolean;
  recovered_4h: boolean;
  recovered_12h: boolean;
  recovered_24h: boolean;
  // classification: queda do entry até o exit
  drop_pct: number;
  classification: "RUIDO" | "CORRECAO" | "REALIZACAO" | "REVERSAO";
  premature: boolean; // recuperou em <=24h
  // contexto comitê
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
  recovery_rate_1h: number;
  recovery_rate_4h: number;
  recovery_rate_12h: number;
  recovery_rate_24h: number;
  early_exit_score: number; // % de perdas que recuperaram em até 24h
  premature_count: number;
  correct_count: number;
  avoidable_loss_usdt: number;
  unavoidable_loss_usdt: number;
  by_classification: Record<string, number>;
  quality: { label: "Excelente" | "Boa" | "Regular" | "Ruim" | "Crítica"; color: string; threshold_pct: number };
  alert: string | null;
  suggestions: string[];
  losses: LossSell[];
};

const BINANCE_BASE = "https://api.binance.com";

async function fetchKlinePrice(symbol: string, atMs: number): Promise<number | null> {
  // Pega kline 1m que contém o timestamp pedido; retorna close.
  try {
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&startTime=${atMs}&limit=2`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = (await r.json()) as unknown[][];
    if (!data?.length) return null;
    const close = Number((data[0] as (string | number)[])[4]);
    return Number.isFinite(close) ? close : null;
  } catch {
    return null;
  }
}

function classify(dropPct: number): LossSell["classification"] {
  const d = Math.abs(dropPct);
  if (d < 3) return "RUIDO";
  if (d < 8) return "CORRECAO";
  if (d < 15) return "REALIZACAO";
  return "REVERSAO";
}

function qualityFromPrematureRate(rate: number) {
  if (rate < 15) return { label: "Excelente" as const, color: "text-emerald-400", threshold_pct: rate };
  if (rate < 25) return { label: "Boa" as const, color: "text-green-400", threshold_pct: rate };
  if (rate < 40) return { label: "Regular" as const, color: "text-yellow-400", threshold_pct: rate };
  if (rate < 60) return { label: "Ruim" as const, color: "text-orange-400", threshold_pct: rate };
  return { label: "Crítica" as const, color: "text-red-500", threshold_pct: rate };
}

export const auditBinanceExits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const limit = Math.min(Math.max(data.limit ?? 50, 1), 200);

    // ===== Coleta vendas em prejuízo do módulo Binance =====
    const [realPos, autoTrades] = await Promise.all([
      supabase
        .from("real_positions")
        .select("id, pair, opened_at, closed_at, entry_price, exit_price, pnl, pnl_pct, exit_reason, request_id, side")
        .eq("status", "closed")
        .lt("pnl", 0)
        .order("closed_at", { ascending: false })
        .limit(limit),
      supabase
        .from("automated_trades")
        .select("id, asset_id, opened_at, closed_at, entry_price, exit_price, pnl, pnl_pct, exit_reason, request_id, side, score, consensus")
        .eq("status", "closed")
        .lt("pnl", 0)
        .order("closed_at", { ascending: false })
        .limit(limit),
    ]);

    // total closed (Binance) para denominador
    const [realClosed, autoClosed] = await Promise.all([
      supabase.from("real_positions").select("id", { count: "exact", head: true }).eq("status", "closed"),
      supabase.from("automated_trades").select("id", { count: "exact", head: true }).eq("status", "closed"),
    ]);
    const totalClosed = (realClosed.count ?? 0) + (autoClosed.count ?? 0);

    // mapa asset_id -> pair (para automated_trades)
    const assetIds = (autoTrades.data ?? []).map((t) => t.asset_id).filter(Boolean) as string[];
    const assetMap = new Map<string, string>();
    if (assetIds.length) {
      const { data: assets } = await supabase
        .from("monitored_assets")
        .select("id, pair")
        .in("id", assetIds);
      for (const a of (assets ?? []) as Array<{ id: string; pair: string }>) assetMap.set(a.id, a.pair);
    }

    const losses: LossSell[] = [];

    for (const p of realPos.data ?? []) {
      losses.push({
        source: "real_positions",
        id: p.id as string,
        pair: p.pair as string,
        asset: (p.pair as string).replace("USDT", ""),
        opened_at: p.opened_at as string,
        closed_at: p.closed_at as string,
        entry_price: Number(p.entry_price),
        exit_price: Number(p.exit_price),
        pnl: Number(p.pnl),
        pnl_pct: Number(p.pnl_pct),
        exit_reason: (p.exit_reason as string | null) ?? null,
        price_1h: null, price_4h: null, price_12h: null, price_24h: null,
        recovered_1h: false, recovered_4h: false, recovered_12h: false, recovered_24h: false,
        drop_pct: ((Number(p.exit_price) - Number(p.entry_price)) / Number(p.entry_price)) * 100,
        classification: "RUIDO",
        premature: false,
        votes: [],
        decision: null,
        // requestId guardado fora do tipo
        ...({ __requestId: p.request_id as string | null } as Record<string, unknown>),
      });
    }
    for (const t of autoTrades.data ?? []) {
      const symbol = (t.asset_id && assetMap.get(t.asset_id as string)) || "";
      if (!symbol) continue;
      losses.push({
        source: "automated_trades",
        id: t.id as string,
        pair: symbol,
        asset: symbol.replace("USDT", ""),
        opened_at: t.opened_at as string,
        closed_at: t.closed_at as string,
        entry_price: Number(t.entry_price),
        exit_price: Number(t.exit_price),
        pnl: Number(t.pnl),
        pnl_pct: Number(t.pnl_pct),
        exit_reason: (t.exit_reason as string | null) ?? null,
        price_1h: null, price_4h: null, price_12h: null, price_24h: null,
        recovered_1h: false, recovered_4h: false, recovered_12h: false, recovered_24h: false,
        drop_pct: ((Number(t.exit_price) - Number(t.entry_price)) / Number(t.entry_price)) * 100,
        classification: "RUIDO",
        premature: false,
        votes: [],
        decision: null,
        ...({ __requestId: t.request_id as string | null } as Record<string, unknown>),
      });
    }

    // ===== Enriquecimento: comitê (decisão + votos) por request_id =====
    const requestIds = losses
      .map((l) => (l as unknown as { __requestId: string | null }).__requestId)
      .filter((v): v is string => !!v);
    if (requestIds.length) {
      const { data: reqs } = await supabase
        .from("real_trade_requests")
        .select("id, decision_id, score, votes_for, votes_against, justification")
        .in("id", requestIds);
      const reqMap = new Map<string, { decision_id: string | null; score: number | null; consensus: number | null; justification: string | null; final_decision: string | null }>();
      for (const r of (reqs ?? []) as Array<{ id: string; decision_id: string | null; score: number | null; votes_for: number | null; votes_against: number | null; justification: string | null }>) {
        const vf = r.votes_for ?? 0;
        const va = r.votes_against ?? 0;
        const totalV = vf + va;
        reqMap.set(r.id, {
          decision_id: r.decision_id,
          score: r.score,
          consensus: totalV ? (vf / totalV) * 100 : null,
          justification: r.justification,
          final_decision: null,
        });
      }
      const decisionIds = Array.from(reqMap.values()).map((v) => v.decision_id).filter((v): v is string => !!v);
      const votesMap = new Map<string, Array<{ agent: string; vote: string; confidence: number }>>();
      if (decisionIds.length) {
        const { data: votes } = await supabase
          .from("agent_votes")
          .select("decision_id, vote, confidence, agents(name)")
          .in("decision_id", decisionIds);
        for (const v of votes ?? []) {
          const did = (v as { decision_id: string }).decision_id;
          const arr = votesMap.get(did) ?? [];
          arr.push({
            agent: ((v as { agents: { name: string } | null }).agents?.name) ?? "agente",
            vote: (v as { vote: string }).vote,
            confidence: Number((v as { confidence: number }).confidence ?? 0),
          });
          votesMap.set(did, arr);
        }
      }
      for (const l of losses) {
        const rid = (l as unknown as { __requestId: string | null }).__requestId;
        if (!rid) continue;
        const r = reqMap.get(rid);
        if (!r) continue;
        l.decision = {
          final_decision: r.final_decision,
          score: r.score,
          consensus: r.consensus,
          justification: r.justification,
        };
        if (r.decision_id) l.votes = votesMap.get(r.decision_id) ?? [];
      }
    }

    // ===== Recovery prices via Binance public klines =====
    for (const l of losses) {
      const t = new Date(l.closed_at).getTime();
      const offsets: Array<[keyof Pick<LossSell, "price_1h" | "price_4h" | "price_12h" | "price_24h">, number]> = [
        ["price_1h", 1], ["price_4h", 4], ["price_12h", 12], ["price_24h", 24],
      ];
      const results = await Promise.all(offsets.map(([, h]) => fetchKlinePrice(l.pair, t + h * 3600_000)));
      results.forEach((price, i) => {
        const key = offsets[i][0];
        l[key] = price;
      });
      // long = preço futuro > exit é "melhor" (teria sido melhor não vender)
      // short = preço futuro < exit é "melhor"; mas neste audit consideramos a posição comprada (Binance spot/long).
      const isBetter = (p: number | null) => (p !== null && p > l.exit_price);
      l.recovered_1h = isBetter(l.price_1h);
      l.recovered_4h = isBetter(l.price_4h);
      l.recovered_12h = isBetter(l.price_12h);
      l.recovered_24h = isBetter(l.price_24h);
      l.classification = classify(l.drop_pct);
      l.premature = l.recovered_1h || l.recovered_4h || l.recovered_12h || l.recovered_24h;
    }

    // limpa marker interno
    for (const l of losses) delete (l as unknown as { __requestId?: unknown }).__requestId;

    const total = losses.length;
    const rate = (n: number) => (total ? (n / total) * 100 : 0);
    const recovery_rate_1h = rate(losses.filter((l) => l.recovered_1h).length);
    const recovery_rate_4h = rate(losses.filter((l) => l.recovered_4h).length);
    const recovery_rate_12h = rate(losses.filter((l) => l.recovered_12h).length);
    const recovery_rate_24h = rate(losses.filter((l) => l.recovered_24h).length);
    const premature_count = losses.filter((l) => l.premature).length;
    const correct_count = total - premature_count;
    const early_exit_score = rate(premature_count);
    const avoidable_loss_usdt = losses.filter((l) => l.premature).reduce((s, l) => s + Math.abs(l.pnl), 0);
    const unavoidable_loss_usdt = losses.filter((l) => !l.premature).reduce((s, l) => s + Math.abs(l.pnl), 0);
    const by_classification: Record<string, number> = { RUIDO: 0, CORRECAO: 0, REALIZACAO: 0, REVERSAO: 0 };
    for (const l of losses) by_classification[l.classification]++;

    const quality = qualityFromPrematureRate(early_exit_score);

    const suggestions: string[] = [];
    let alert: string | null = null;
    if (recovery_rate_24h > 40) {
      alert = "O comitê Binance pode estar realizando prejuízos prematuramente.";
      suggestions.push(
        "Aumentar exigência de consenso para venda (ex.: 6+ votos vendedores).",
        "Criar Recovery Agent para identificar quedas temporárias.",
        "Adicionar cooldown após queda brusca antes de permitir nova venda.",
        "Exigir confirmação de reversão de tendência (média curta < média longa por N candles).",
        "Reduzir vendas disparadas por volatilidade momentânea (filtro ATR).",
      );
    }

    const report: AuditReport = {
      generated_at: new Date().toISOString(),
      total_closed: totalClosed,
      total_losses: total,
      recovery_rate_1h,
      recovery_rate_4h,
      recovery_rate_12h,
      recovery_rate_24h,
      early_exit_score,
      premature_count,
      correct_count,
      avoidable_loss_usdt,
      unavoidable_loss_usdt,
      by_classification,
      quality,
      alert,
      suggestions,
      losses,
    };
    return report;
  });
