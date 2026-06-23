// Binance fee & profit-guard audit — ISOLATED from B3.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const isCrypto = (p?: string | null) => !!p && p.endsWith("USDT");

export const getBinanceFeeSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [{ data: closed }, { data: blocks }, { data: cs }] = await Promise.all([
      sb.from("simulated_orders").select("*").eq("status", "closed").order("closed_at", { ascending: false }).limit(500),
      sb.from("binance_trade_block_log").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("committee_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    const cryptoClosed = (closed ?? []).filter((o: any) => isCrypto(o.pair));

    const sells = cryptoClosed.filter((o: any) => o.side === "sell");
    const capitalMoved = sells.reduce((s: number, o: any) => s + Number(o.entry_price) * Number(o.quantity), 0);
    const grossPnl = sells.reduce((s: number, o: any) => s + Number(o.gross_pnl ?? o.realized_pnl ?? 0), 0);
    const fees = sells.reduce((s: number, o: any) => s + Number(o.total_fees ?? 0), 0);
    const netPnl = sells.reduce((s: number, o: any) => s + Number(o.net_pnl ?? o.realized_pnl ?? 0), 0);
    const roiNetSum = sells.reduce((s: number, o: any) => s + Number(o.net_roi_pct ?? 0), 0);
    const avgNetRoi = sells.length ? roiNetSum / sells.length : 0;

    // Last 100 trades alert
    const last100 = sells.slice(0, 100);
    const last100Gross = last100.reduce((s: number, o: any) => s + Math.max(0, Number(o.gross_pnl ?? 0)), 0);
    const last100Fees = last100.reduce((s: number, o: any) => s + Number(o.total_fees ?? 0), 0);
    const feeRatio = last100Gross > 0 ? last100Fees / last100Gross : 0;
    const alert = feeRatio > 0.30
      ? "Estratégia com excesso de operações de baixo retorno. Rever filtros de entrada."
      : null;

    // Block reasons grouped
    const reasonCounts: Record<string, number> = {};
    for (const b of blocks ?? []) {
      const key = String(b.reason).split("|")[0]?.trim().split("(")[0]?.trim() ?? "outro";
      reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
    }

    return {
      settings: cs,
      summary: {
        trades_closed: sells.length,
        capital_moved: capitalMoved,
        gross_pnl: grossPnl,
        total_fees: fees,
        net_pnl: netPnl,
        avg_net_roi_pct: avgNetRoi,
        blocked_count: (blocks ?? []).length,
        fee_to_gross_ratio_last100: feeRatio,
        alert,
      },
      reasons: reasonCounts,
      recent_orders: cryptoClosed.slice(0, 50),
      recent_blocks: (blocks ?? []).slice(0, 50),
    };
  });

export const updateBinanceProfitGuard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    taker_fee_pct?: number;
    min_expected_roi_pct?: number;
    min_net_profit_usd?: number;
    fee_coverage_multiplier?: number;
    per_trade_capital_pct?: number;
  }) => d)
  .handler(async ({ data, context }) => {
    const patch: Record<string, number> = {};
    for (const k of ["taker_fee_pct", "min_expected_roi_pct", "min_net_profit_usd", "fee_coverage_multiplier", "per_trade_capital_pct"] as const) {
      if (data[k] !== undefined && Number.isFinite(Number(data[k]))) patch[k] = Number(data[k]);
    }
    if (!Object.keys(patch).length) return { updated: false };
    const { error } = await context.supabase.from("committee_settings").update(patch as never).eq("id", 1);
    if (error) throw new Error(error.message);
    return { updated: true, patch };
  });
