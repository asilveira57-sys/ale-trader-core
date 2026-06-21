// Binance-only wallet audit & reconciliation. ISOLATED from B3.
// Read-only audits + opt-in rebuild. No B3 code is imported or modified.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CRYPTO_PAIRS_SUFFIX = "USDT"; // simple filter to keep audit scoped to Binance pairs

function isCryptoPair(pair: string | null | undefined) {
  return !!pair && pair.endsWith(CRYPTO_PAIRS_SUFFIX);
}

// Reuses the same mock price function as the pipeline so equity comparison stays consistent.
function mockPrice(pair: string) {
  const base: Record<string, number> = {
    BTCUSDT: 67000, ETHUSDT: 3500, SOLUSDT: 165, XRPUSDT: 0.58, BNBUSDT: 605, ADAUSDT: 100,
  };
  const seed = (Date.now() / 60000) | 0;
  let h = 0;
  for (const c of pair + seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  const noise = ((h % 1000) / 1000 - 0.5) * 0.04;
  return (base[pair] ?? 100) * (1 + noise);
}

// ---------- FASE 1: Parâmetros de exposição ----------
export const auditBinanceExposureParams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [{ data: rs }, { data: cs }, { data: wallet }, { data: assets }] = await Promise.all([
      sb.from("robot_settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("committee_settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("simulated_wallet").select("*").eq("id", 1).maybeSingle(),
      sb.from("monitored_assets").select("pair, active").eq("active", true),
    ]);

    const balance = Number(wallet?.current_balance ?? 0);
    const maxPos = Number(cs?.max_position_value ?? 1000);
    // hard-coded cap in pipeline-runner: min(max_position_value, current_balance * 0.10)
    const perTradeCap = Math.min(maxPos, balance * 0.10);
    const activeCount = (assets ?? []).length;
    const theoreticalMaxExposurePct = balance > 0
      ? Math.min(100, (perTradeCap * activeCount / balance) * 100)
      : 0;

    const rows = [
      { parameter: "robot_settings.status", current_value: rs?.status, impact_on_exposure: "Quando 'paused', o pipeline NÃO coleta, NÃO vota e NÃO executa.", module_source: "robot_settings" },
      { parameter: "robot_settings.mode", current_value: rs?.mode, impact_on_exposure: "'read' só lê; 'live' executa ordens simuladas.", module_source: "robot_settings" },
      { parameter: "robot_settings.binance_mock_mode", current_value: rs?.binance_mock_mode, impact_on_exposure: "true = preços mock (não bate com mercado real).", module_source: "robot_settings" },
      { parameter: "committee_settings.max_position_value", current_value: maxPos, impact_on_exposure: "Teto bruto por ordem.", module_source: "committee_settings" },
      { parameter: "pipeline-runner.executeSimulated.cap_pct", current_value: 0.10, impact_on_exposure: "HARD-CODED: cada compra usa no máximo 10% do saldo. Suspeito #1 da exposição em ~15%.", module_source: "src/lib/pipeline-runner.server.ts" },
      { parameter: "per_trade_effective_cap_usdt", current_value: perTradeCap, impact_on_exposure: "Valor real máximo por trade (min entre max_position_value e 10% do saldo).", module_source: "computed" },
      { parameter: "committee_settings.min_favor_votes", current_value: cs?.min_favor_votes, impact_on_exposure: "Filtro de aprovação — mais alto = menos trades.", module_source: "committee_settings" },
      { parameter: "committee_settings.min_confidence", current_value: cs?.min_confidence, impact_on_exposure: "Confiança mínima do comitê.", module_source: "committee_settings" },
      { parameter: "committee_settings.min_score", current_value: cs?.min_score, impact_on_exposure: "Score mínimo para buy/sell_approved.", module_source: "committee_settings" },
      { parameter: "committee_settings.default_stop_pct", current_value: cs?.default_stop_pct, impact_on_exposure: "Stop default; mais largo prende capital por mais tempo.", module_source: "committee_settings" },
      { parameter: "committee_settings.default_target_pct", current_value: cs?.default_target_pct, impact_on_exposure: "Alvo default.", module_source: "committee_settings" },
      { parameter: "monitored_assets.active.count", current_value: activeCount, impact_on_exposure: `Ativos elegíveis por ciclo. Exposição máx teórica ≈ ${theoreticalMaxExposurePct.toFixed(1)}%.`, module_source: "monitored_assets" },
      { parameter: "simulated_wallet.current_balance", current_value: balance, impact_on_exposure: "Base do cálculo de 10% por trade.", module_source: "simulated_wallet" },
    ];
    return { params: rows, theoreticalMaxExposurePct, perTradeCap, activeCount };
  });

// ---------- FASE 2: Decisões últimas 72h ----------
export const auditBinanceDecisions72h = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();

    const { data: decisions } = await sb
      .from("committee_decisions")
      .select("id, pair, final_decision, score, avg_confidence, consolidated_justification, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);

    const cryptoDecisions = (decisions ?? []).filter((d) => isCryptoPair(d.pair));

    const { data: orders } = await sb
      .from("simulated_orders")
      .select("id, decision_id, pair, side, quantity, entry_price, status, created_at")
      .gte("created_at", since);

    const ordersByDecision = new Map<string, any[]>();
    for (const o of orders ?? []) {
      const key = o.decision_id ?? "";
      if (!ordersByDecision.has(key)) ordersByDecision.set(key, []);
      ordersByDecision.get(key)!.push(o);
    }

    const { data: cs } = await sb.from("committee_settings").select("max_position_value").eq("id", 1).maybeSingle();
    const { data: wallet } = await sb.from("simulated_wallet").select("current_balance").eq("id", 1).maybeSingle();
    const balance = Number(wallet?.current_balance ?? 0);
    const maxPos = Number(cs?.max_position_value ?? 1000);
    const cap = Math.min(maxPos, balance * 0.10);

    const rows = cryptoDecisions.map((d) => {
      const matched = ordersByDecision.get(d.id) ?? [];
      const order = matched[0];
      const requested = cap;
      const approved = order ? Number(order.quantity) * Number(order.entry_price) : 0;
      let reason = "Decisão registrada";
      if (d.final_decision === "buy_approved" && !order) reason = "Aprovado mas SEM ORDEM (capital parado)";
      else if (d.final_decision === "sell_approved" && !order) reason = "Sell aprovado mas sem posição comprada";
      else if (order) reason = `Ordem ${order.side} ${order.status}`;
      else reason = `Decisão ${d.final_decision} (sem execução esperada)`;

      return {
        symbol: d.pair,
        decision_type: d.final_decision,
        requested_capital: requested,
        approved_capital: approved,
        committee_score: d.score,
        council_score: null,
        risk_score: d.avg_confidence,
        reason,
        created_at: d.created_at,
        decision_id: d.id,
      };
    });

    const stuck = rows.filter((r) => r.reason.startsWith("Aprovado mas SEM ORDEM"));
    return {
      total: rows.length,
      stuck_count: stuck.length,
      stuck_capital_estimate: stuck.length * cap,
      rows: rows.slice(0, 300),
    };
  });

// ---------- FASE 3 + 4 + 6: Recalculo + divergências + validação matemática ----------
export const recalculateBinancePortfolioState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [{ data: wallet }, { data: positions }, { data: orders }] = await Promise.all([
      sb.from("simulated_wallet").select("*").eq("id", 1).maybeSingle(),
      sb.from("simulated_positions").select("*"),
      sb.from("simulated_orders").select("*").order("created_at", { ascending: true }),
    ]);

    const cryptoOrders = (orders ?? []).filter((o) => isCryptoPair(o.pair));
    const cryptoPositions = (positions ?? []).filter((p) => isCryptoPair(p.pair));
    const initial = Number(wallet?.initial_balance ?? 10000);

    let cashSpentOnBuys = 0;
    let cashFromSells = 0;
    let realizedPnL = 0;
    for (const o of cryptoOrders) {
      const qty = Number(o.quantity);
      const entry = Number(o.entry_price);
      if (o.side === "buy") {
        cashSpentOnBuys += qty * entry;
      } else if (o.side === "sell") {
        cashFromSells += qty * entry;
        if (o.realized_pnl != null) realizedPnL += Number(o.realized_pnl);
      }
      if (o.status === "closed" && o.side === "buy" && o.realized_pnl != null) {
        realizedPnL += Number(o.realized_pnl);
      }
    }

    // Replay BUY/SELL FIFO-ish to recompute open positions from raw orders
    const replayPositions: Record<string, { qty: number; cost: number }> = {};
    for (const o of cryptoOrders) {
      const p = (replayPositions[o.pair] ??= { qty: 0, cost: 0 });
      const qty = Number(o.quantity);
      const price = Number(o.entry_price);
      if (o.side === "buy") {
        if (o.status !== "closed") {
          p.qty += qty;
          p.cost += qty * price;
        }
      } else if (o.side === "sell") {
        p.qty = Math.max(0, p.qty - qty);
        if (p.qty === 0) p.cost = 0;
      }
    }

    let marketValueOpen = 0;
    let unrealizedPnL = 0;
    const positionRebuild = Object.entries(replayPositions)
      .filter(([, v]) => v.qty > 0)
      .map(([pair, v]) => {
        const price = mockPrice(pair);
        const mv = v.qty * price;
        const avg = v.cost / v.qty;
        const upnl = (price - avg) * v.qty;
        marketValueOpen += mv;
        unrealizedPnL += upnl;
        return { pair, qty: v.qty, avg_price: avg, mark_price: price, market_value: mv, unrealized_pnl: upnl };
      });

    const calculatedCash = initial - cashSpentOnBuys + cashFromSells;
    const calculatedEquity = calculatedCash + marketValueOpen;

    const currentBalance = Number(wallet?.current_balance ?? 0);
    const currentEquity = Number(wallet?.equity ?? 0);
    const cashDiff = calculatedCash - currentBalance;
    const equityDiff = calculatedEquity - currentEquity;

    // Math invariant: initial + realized + unrealized = equity (no fees modeled yet → tolerance 0.01)
    const invariantLhs = initial + realizedPnL + unrealizedPnL;
    const invariantDiff = invariantLhs - calculatedEquity;
    const invariantOk = Math.abs(invariantDiff) <= 0.01;

    // Position comparison (DB vs replay)
    const dbPosMap = new Map(cryptoPositions.map((p) => [p.pair, Number(p.quantity)]));
    const replayPosMap = new Map(positionRebuild.map((p) => [p.pair, p.qty]));
    const positionDivergences: any[] = [];
    const allPairs = new Set([...dbPosMap.keys(), ...replayPosMap.keys()]);
    for (const pair of allPairs) {
      const db = dbPosMap.get(pair) ?? 0;
      const rp = replayPosMap.get(pair) ?? 0;
      if (Math.abs(db - rp) > 1e-6) {
        positionDivergences.push({ pair, db_qty: db, replay_qty: rp, diff: db - rp });
      }
    }

    // Persist findings (best-effort; ignore failures)
    const findings: any[] = [];
    if (Math.abs(cashDiff) > 0.01) {
      findings.push({ divergence_type: "cash_mismatch", amount: cashDiff, root_cause: "Saldo em DB difere do replay de ordens", details: { calculatedCash, currentBalance } });
    }
    if (Math.abs(equityDiff) > 0.01) {
      findings.push({ divergence_type: "equity_mismatch", amount: equityDiff, root_cause: "Equity em DB difere do recalculo", details: { calculatedEquity, currentEquity } });
    }
    if (!invariantOk) {
      findings.push({ divergence_type: "math_invariant_broken", amount: invariantDiff, root_cause: "initial + realized + unrealized ≠ equity calculado", details: { initial, realizedPnL, unrealizedPnL, calculatedEquity } });
    }
    for (const pd of positionDivergences) {
      findings.push({ divergence_type: "position_qty_mismatch", affected_symbol: pd.pair, amount: pd.diff, root_cause: "qty em simulated_positions difere do replay", details: pd });
    }
    if (findings.length) {
      await sb.from("binance_wallet_reconciliation_audit").insert(findings);
    }

    const exposurePct = calculatedEquity > 0 ? (marketValueOpen / calculatedEquity) * 100 : 0;

    return {
      initial_balance: initial,
      cash_spent_on_buys: cashSpentOnBuys,
      cash_from_sells: cashFromSells,
      calculated_cash: calculatedCash,
      current_balance_in_db: currentBalance,
      cash_diff: cashDiff,
      market_value_open: marketValueOpen,
      calculated_equity: calculatedEquity,
      current_equity_in_db: currentEquity,
      equity_diff: equityDiff,
      realized_pnl: realizedPnL,
      unrealized_pnl: unrealizedPnL,
      invariant_ok: invariantOk,
      invariant_diff: invariantDiff,
      exposure_pct: exposurePct,
      positions_replay: positionRebuild,
      position_divergences: positionDivergences,
      findings_persisted: findings.length,
    };
  });

// ---------- FASE 5: Rebuild explícito ----------
export const rebuildBinanceWalletFromTrades = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { confirm: string }) => d)
  .handler(async ({ data, context }) => {
    if (data.confirm !== "RECONSTRUIR") throw new Error("Confirmação inválida. Envie confirm='RECONSTRUIR'.");
    const sb = context.supabase;

    const { data: wallet } = await sb.from("simulated_wallet").select("*").eq("id", 1).maybeSingle();
    const { data: orders } = await sb.from("simulated_orders").select("*").order("created_at", { ascending: true });
    const initial = Number(wallet?.initial_balance ?? 10000);
    const cryptoOrders = (orders ?? []).filter((o) => isCryptoPair(o.pair));

    let cash = initial;
    const pos: Record<string, { qty: number; cost: number }> = {};
    for (const o of cryptoOrders) {
      const qty = Number(o.quantity);
      const price = Number(o.entry_price);
      const p = (pos[o.pair] ??= { qty: 0, cost: 0 });
      if (o.side === "buy") {
        if (o.status !== "closed") {
          cash -= qty * price;
          p.qty += qty;
          p.cost += qty * price;
        }
      } else if (o.side === "sell") {
        cash += qty * Number(o.closed_price ?? o.entry_price);
        p.qty = Math.max(0, p.qty - qty);
        if (p.qty === 0) p.cost = 0;
      }
    }

    let mv = 0;
    const upserts: any[] = [];
    for (const [pair, v] of Object.entries(pos)) {
      const price = mockPrice(pair);
      const avg = v.qty > 0 ? v.cost / v.qty : 0;
      const upnl = v.qty > 0 ? (price - avg) * v.qty : 0;
      mv += v.qty * price;
      upserts.push({ pair, quantity: v.qty, avg_price: avg, unrealized_pnl: upnl });
    }
    // Wipe ONLY crypto positions, preserve orders
    const cryptoPairs = upserts.map((u) => u.pair);
    if (cryptoPairs.length) {
      await sb.from("simulated_positions").delete().in("pair", cryptoPairs);
      await sb.from("simulated_positions").insert(upserts);
    }
    await sb.from("simulated_wallet").update({ current_balance: cash, equity: cash + mv }).eq("id", 1);

    return { rebuilt: true, cash, equity: cash + mv, positions: upserts.length };
  });

// ---------- Lista de divergências registradas ----------
export const listBinanceReconciliationAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("binance_wallet_reconciliation_audit")
      .select("*")
      .order("detected_at", { ascending: false })
      .limit(100);
    return { rows: data ?? [] };
  });
