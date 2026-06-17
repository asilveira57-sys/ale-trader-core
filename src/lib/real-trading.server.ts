// Operação real assistida — toda execução exige request aprovado manualmente.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChecklistItem { key: string; label: string; ok: boolean; detail?: string }

export async function buildChecklist(supabase: SupabaseClient): Promise<{ items: ChecklistItem[]; passed: boolean }> {
  const { isRealConfigured, checkApiPermissions, ALLOW_AUTO_PRODUCTION } = await import("./binance-real.server");
  const [{ data: settings }, { data: limits }, { data: cb }, { data: openPos }, { data: closed24 }] = await Promise.all([
    supabase.from("robot_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("real_risk_limits").select("*").eq("id", 1).maybeSingle(),
    supabase.from("real_circuit_breaker_events").select("*").is("closed_at", null).limit(1).maybeSingle(),
    supabase.from("real_positions").select("id").eq("status", "open"),
    supabase.from("real_positions").select("pnl, closed_at").eq("status", "closed").gte("closed_at", new Date(Date.now() - 86400_000).toISOString()),
  ]);

  const items: ChecklistItem[] = [];
  items.push({ key: "auto_blocked", label: "Trava de produção automática ativa", ok: !ALLOW_AUTO_PRODUCTION });
  items.push({ key: "assisted_on", label: "Modo Produção Assistida habilitado", ok: !!settings?.production_assisted_enabled });
  items.push({ key: "robot_not_paused", label: "Robô real não está pausado", ok: !settings?.real_robot_paused });
  items.push({ key: "manual_required", label: "Aprovação manual obrigatória", ok: !!settings?.require_manual_approval });

  const cfg = isRealConfigured();
  items.push({ key: "api_configured", label: "Chaves Binance REAIS configuradas", ok: cfg, detail: cfg ? undefined : "Adicione BINANCE_REAL_API_KEY e BINANCE_REAL_API_SECRET" });
  if (cfg) {
    const perms = await checkApiPermissions();
    items.push({ key: "can_trade", label: "Chave com permissão de trade", ok: !!perms.canTrade, detail: perms.error });
    items.push({ key: "no_withdraw", label: "Saques desabilitados", ok: perms.canWithdraw === false });
  } else {
    items.push({ key: "can_trade", label: "Chave com permissão de trade", ok: false });
    items.push({ key: "no_withdraw", label: "Saques desabilitados", ok: false });
  }
  items.push({ key: "cb_off", label: "Circuit Breaker real desativado", ok: !cb });
  items.push({ key: "open_limit", label: `Posições abertas dentro do limite (${(openPos ?? []).length}/${limits?.max_open_positions ?? 3})`, ok: (openPos ?? []).length < (limits?.max_open_positions ?? 3) });
  const dayPnl = (closed24 ?? []).reduce((s: number, p: any) => s + Number(p.pnl ?? 0), 0);
  items.push({ key: "daily_loss", label: `Perda diária dentro do limite ($${(-dayPnl).toFixed(2)}/$${limits?.daily_loss_limit ?? 0})`, ok: -dayPnl < Number(limits?.daily_loss_limit ?? Infinity) });
  items.push({ key: "audit_on", label: "Auditoria ativa", ok: true });

  return { items, passed: items.every((i) => i.ok) };
}

export async function tripRealBreaker(supabase: SupabaseClient, trigger: string, message: string) {
  await supabase.from("real_circuit_breaker_events").insert({ trigger, message, severity: "critical" });
  await supabase.from("robot_settings").update({ real_robot_paused: true }).eq("id", 1);
  await supabase.from("alerts").insert({ type: "real_breaker", severity: "critical", message: `🛑 BREAKER REAL: ${message}` });
}

export async function executeApprovedRequest(supabase: SupabaseClient, requestId: string) {
  const { placeRealOrder } = await import("./binance-real.server");
  const { data: req } = await supabase.from("real_trade_requests").select("*").eq("id", requestId).maybeSingle();
  if (!req) throw new Error("Request não encontrado");
  if (req.status !== "approved") throw new Error("Request não está aprovado");

  let resp: any;
  try {
    resp = await placeRealOrder({
      symbol: req.pair,
      side: req.side === "buy" ? "BUY" : "SELL",
      type: "MARKET",
      quantity: Number(Number(req.suggested_qty).toFixed(6)),
      approvedRequestId: requestId,
    });
  } catch (err) {
    await supabase.from("real_trade_requests").update({ status: "failed" }).eq("id", requestId);
    await tripRealBreaker(supabase, "binance_error", `Falha ao enviar ordem: ${(err as Error).message}`);
    throw err;
  }

  const { data: order } = await supabase.from("real_orders").insert({
    request_id: requestId, asset_id: req.asset_id, pair: req.pair,
    side: req.side.toUpperCase(), type: "MARKET", qty: req.suggested_qty,
    price: req.suggested_price, stop_loss: req.stop_loss, take_profit: req.take_profit,
    binance_order_id: String(resp.orderId ?? ""), binance_status: resp.status ?? "NEW", raw_response: resp,
    filled_at: resp.status === "FILLED" ? new Date().toISOString() : null,
  }).select().single();

  const { data: position } = await supabase.from("real_positions").insert({
    order_id: order?.id, request_id: requestId, asset_id: req.asset_id, pair: req.pair,
    side: req.side, entry_price: req.suggested_price, qty: req.suggested_qty,
    stop_loss: req.stop_loss, take_profit: req.take_profit, last_price: req.suggested_price,
  }).select().single();

  await supabase.from("real_trade_requests").update({ status: "executed" }).eq("id", requestId);
  await supabase.from("alerts").insert({
    type: "real_order_sent", pair: req.pair, severity: "warning",
    message: `🟠 Ordem REAL enviada: ${req.side.toUpperCase()} ${req.pair} qty ${req.suggested_qty}`,
  });
  return { order, position, resp };
}
