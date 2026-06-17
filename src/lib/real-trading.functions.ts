import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertOwner(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "owner" });
  if (error || !data) throw new Error("Forbidden: somente o proprietário");
}

export const getApprovalDeskState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { buildChecklist } = await import("./real-trading.server");
    const [{ data: pending }, { data: recent }, { data: settings }, { data: limits }, { data: cb }, checklist] = await Promise.all([
      supabase.from("real_trade_requests").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("real_trade_requests").select("*").neq("status", "pending").order("created_at", { ascending: false }).limit(20),
      supabase.from("robot_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("real_risk_limits").select("*").eq("id", 1).maybeSingle(),
      supabase.from("real_circuit_breaker_events").select("*").is("closed_at", null).order("opened_at", { ascending: false }).limit(1).maybeSingle(),
      buildChecklist(supabase),
    ]);
    return { pending: pending ?? [], recent: recent ?? [], settings, limits, circuit_breaker: cb, checklist };
  });

export const getRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const [{ data: req }, { data: reports }, { data: approvals }] = await Promise.all([
      supabase.from("real_trade_requests").select("*").eq("id", data.id).maybeSingle(),
      supabase.from("audit_reports").select("*").eq("request_id", data.id).order("created_at"),
      supabase.from("real_trade_approvals").select("*").eq("request_id", data.id).order("created_at"),
    ]);
    return { request: req, reports: reports ?? [], approvals: approvals ?? [] };
  });

export const approveRealRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), confirm: z.literal("CONFIRMO") }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { buildChecklist, executeApprovedRequest } = await import("./real-trading.server");
    const cl = await buildChecklist(supabase);
    if (!cl.passed) {
      const failed = cl.items.filter((i) => !i.ok).map((i) => i.label).join(", ");
      throw new Error(`Checklist falhou: ${failed}`);
    }
    await supabase.from("real_trade_requests").update({ status: "approved" }).eq("id", data.id).eq("status", "pending");
    await supabase.from("real_trade_approvals").insert({ request_id: data.id, approver_user_id: userId, action: "approve" });
    await supabase.from("approval_logs").insert({ request_id: data.id, user_id: userId, action: "approve", payload: { confirm: data.confirm } });
    const result = await executeApprovedRequest(supabase, data.id);
    return { ok: true, order_id: result.order?.id, position_id: result.position?.id };
  });

export const rejectRealRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), note: z.string().max(500).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    await supabase.from("real_trade_requests").update({ status: "rejected" }).eq("id", data.id).eq("status", "pending");
    await supabase.from("real_trade_approvals").insert({ request_id: data.id, approver_user_id: userId, action: "reject", note: data.note ?? null });
    await supabase.from("approval_logs").insert({ request_id: data.id, user_id: userId, action: "reject", payload: { note: data.note } });
    return { ok: true };
  });

export const pauseRealRobot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    await supabase.from("robot_settings").update({ real_robot_paused: true }).eq("id", 1);
    await supabase.from("approval_logs").insert({ user_id: userId, action: "pause_robot" });
    await supabase.from("alerts").insert({ type: "real_paused", severity: "warning", message: "⏸️ Robô real pausado pelo proprietário" });
    return { ok: true };
  });

export const resumeRealRobot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    await supabase.from("robot_settings").update({ real_robot_paused: false }).eq("id", 1);
    await supabase.from("approval_logs").insert({ user_id: userId, action: "resume_robot" });
    return { ok: true };
  });

export const resetRealBreaker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    await supabase.from("real_circuit_breaker_events").update({ closed_at: new Date().toISOString(), closed_by: userId }).is("closed_at", null);
    await supabase.from("robot_settings").update({ real_robot_paused: false }).eq("id", 1);
    return { ok: true };
  });

export const createDemoRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    pair: z.string().min(3).max(20),
    side: z.enum(["buy", "sell"]),
    qty: z.number().positive(),
    price: z.number().positive(),
    stop: z.number().positive(),
    take: z.number().positive(),
    score: z.number().min(0).max(100),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const risk = Math.abs((data.price - data.stop) * data.qty);
    const expected = Math.abs((data.take - data.price) * data.qty);
    const { data: req } = await supabase.from("real_trade_requests").insert({
      pair: data.pair, side: data.side,
      suggested_qty: data.qty, suggested_price: data.price,
      stop_loss: data.stop, take_profit: data.take,
      risk_amount: risk, score: data.score,
      votes_for: 6, votes_against: 1, vetoes: [],
      justification: "Pedido manual gerado para validação da Mesa de Aprovação.",
      worst_case: -risk, expected_result: expected,
      checklist: {},
    }).select().single();
    if (req) {
      const { generatePreAudit } = await import("./audit.server");
      try { await generatePreAudit(supabase, req.id); } catch { /* ignore */ }
    }
    return req;
  });

export const closeRealPositionManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ position_id: z.string().uuid(), confirm: z.literal("CONFIRMO") }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: pos } = await supabase.from("real_positions").select("*").eq("id", data.position_id).maybeSingle();
    if (!pos || pos.status !== "open") throw new Error("Posição inválida");
    const { getPublicTicker } = await import("./binance-testnet.server");
    const tk = await getPublicTicker(pos.pair);
    const price = tk?.price ?? Number(pos.last_price ?? pos.entry_price);
    const dir = pos.side === "buy" ? 1 : -1;
    const pnl = (price - Number(pos.entry_price)) * Number(pos.qty) * dir;
    const pnlPct = ((price - Number(pos.entry_price)) / Number(pos.entry_price)) * 100 * dir;
    await supabase.from("real_positions").update({
      status: "closed", exit_price: price, exit_reason: "manual",
      pnl, pnl_pct: pnlPct, closed_at: new Date().toISOString(), last_price: price,
    }).eq("id", data.position_id);
    const { generatePostAudit } = await import("./audit.server");
    try { await generatePostAudit(supabase, data.position_id); } catch { /* ignore */ }
    return { ok: true, pnl, pnl_pct: pnlPct };
  });

export const updateRealRiskLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    max_per_trade: z.number().min(0).optional(),
    max_pct_portfolio: z.number().min(0).max(100).optional(),
    daily_loss_limit: z.number().min(0).optional(),
    weekly_loss_limit: z.number().min(0).optional(),
    monthly_loss_limit: z.number().min(0).optional(),
    max_trades_per_day: z.number().int().min(1).max(100).optional(),
    max_open_positions: z.number().int().min(1).max(50).optional(),
    loss_streak_limit: z.number().int().min(1).max(50).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    await supabase.from("real_risk_limits").update(data).eq("id", 1);
    return { ok: true };
  });

export const getRealDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const now = Date.now();
    const dayAgo = new Date(now - 86400_000).toISOString();
    const weekAgo = new Date(now - 7 * 86400_000).toISOString();
    const monthAgo = new Date(now - 30 * 86400_000).toISOString();
    const [{ data: open }, { data: pendingOrders }, { data: dayClosed }, { data: weekClosed }, { data: monthClosed }, { data: alerts }, { data: reports }, { data: cb }, { data: limits }, { data: settings }] = await Promise.all([
      supabase.from("real_positions").select("*").eq("status", "open").order("opened_at", { ascending: false }),
      supabase.from("real_trade_requests").select("*").eq("status", "pending"),
      supabase.from("real_positions").select("pnl").eq("status", "closed").gte("closed_at", dayAgo),
      supabase.from("real_positions").select("pnl").eq("status", "closed").gte("closed_at", weekAgo),
      supabase.from("real_positions").select("pnl").eq("status", "closed").gte("closed_at", monthAgo),
      supabase.from("alerts").select("*").in("severity", ["warning", "critical"]).order("created_at", { ascending: false }).limit(10),
      supabase.from("audit_reports").select("*").order("created_at", { ascending: false }).limit(10),
      supabase.from("real_circuit_breaker_events").select("*").is("closed_at", null).order("opened_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("real_risk_limits").select("*").eq("id", 1).maybeSingle(),
      supabase.from("robot_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    const sum = (rows: any[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.pnl ?? 0), 0);
    return {
      open_positions: open ?? [],
      pending_requests: pendingOrders ?? [],
      pnl_day: sum(dayClosed), pnl_week: sum(weekClosed), pnl_month: sum(monthClosed),
      alerts: alerts ?? [], recent_audits: reports ?? [],
      circuit_breaker: cb, limits, settings,
    };
  });

export const listAuditReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data } = await supabase.from("audit_reports").select("*").order("created_at", { ascending: false }).limit(100);
    return data ?? [];
  });

export const getAuditReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const [{ data: report }, { data: events }] = await Promise.all([
      supabase.from("audit_reports").select("*").eq("id", data.id).maybeSingle(),
      supabase.from("audit_events").select("*").order("created_at"),
    ]);
    return { report, events: events ?? [] };
  });
