// Binance REAL — HARD-BLOCKED endpoints + double approval guard.
// Only callable from server-side handlers AFTER a manual approval exists.
import crypto from "crypto";

const REAL_BASE = "https://api.binance.com";

const FORBIDDEN_PATHS = [
  "/sapi/v1/capital/withdraw",
  "/sapi/v1/margin",
  "/sapi/v1/futures",
  "/fapi/",
  "/dapi/",
  "/sapi/v1/asset/transfer",
];

// Hard constant — flipping this requires a code change, not a config toggle.
export const ALLOW_AUTO_PRODUCTION = false;

export function isRealConfigured(): boolean {
  return !!(process.env.BINANCE_REAL_API_KEY && process.env.BINANCE_REAL_API_SECRET);
}

function sign(query: string): string {
  return crypto.createHmac("sha256", process.env.BINANCE_REAL_API_SECRET!).update(query).digest("hex");
}

function guardPath(path: string) {
  for (const f of FORBIDDEN_PATHS) {
    if (path.startsWith(f)) throw new Error(`Endpoint Binance proibido nesta fase: ${path}`);
  }
}

async function signedRequest(path: string, method: "GET" | "POST" | "DELETE", params: Record<string, string | number>, approvedRequestId?: string) {
  if (!isRealConfigured()) throw new Error("Binance REAL não configurada. Configure BINANCE_REAL_API_KEY e BINANCE_REAL_API_SECRET.");
  if (method !== "GET" && !approvedRequestId) throw new Error("Operação real exige request_id aprovado.");
  guardPath(path);
  const qs = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    timestamp: String(Date.now()),
    recvWindow: "5000",
  }).toString();
  const sig = sign(qs);
  const url = `${REAL_BASE}${path}?${qs}&signature=${sig}`;
  const res = await fetch(url, { method, headers: { "X-MBX-APIKEY": process.env.BINANCE_REAL_API_KEY! } });
  const body = await res.text();
  let json: any;
  try { json = JSON.parse(body); } catch { json = { raw: body }; }
  if (!res.ok) throw new Error(`Binance REAL ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

export async function placeRealOrder(p: {
  symbol: string; side: "BUY" | "SELL"; type?: "MARKET" | "LIMIT";
  quantity: number; price?: number; approvedRequestId: string;
}) {
  if (ALLOW_AUTO_PRODUCTION) throw new Error("Auto production bloqueado por trava de código.");
  const params: Record<string, string | number> = {
    symbol: p.symbol, side: p.side, type: p.type ?? "MARKET", quantity: p.quantity,
  };
  if (p.type === "LIMIT" && p.price) { params.price = p.price; params.timeInForce = "GTC"; }
  return signedRequest("/api/v3/order", "POST", params, p.approvedRequestId);
}

// Phase 7 — order path used by the autonomous engine. Bypasses ALLOW_AUTO_PRODUCTION
// because safety is now enforced by governance_settings (kill switch, eligibility, supervisor).
export async function placeAutoRealOrder(p: {
  symbol: string; side: "BUY" | "SELL"; type?: "MARKET" | "LIMIT";
  quantity: number; price?: number; approvedRequestId: string;
}) {
  // Inline governance/kill-switch guard. Read settings lazily to avoid module cycles.
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: gov } = await sb.from("governance_settings").select("*").limit(1).maybeSingle();
  if (!gov) throw new Error("governance_settings ausente");
  if (gov.kill_switch_active) throw new Error("Kill switch ativo — execução automática bloqueada");
  if (!gov.automation_enabled) throw new Error("Automação desabilitada");
  if (!gov.supervisor_enabled) throw new Error("Supervisor desabilitado");

  const params: Record<string, string | number> = {
    symbol: p.symbol, side: p.side, type: p.type ?? "MARKET", quantity: p.quantity,
  };
  if (p.type === "LIMIT" && p.price) { params.price = p.price; params.timeInForce = "GTC"; }
  return signedRequest("/api/v3/order", "POST", params, p.approvedRequestId);
}

export async function cancelRealOrder(symbol: string, orderId: number, approvedRequestId: string) {
  return signedRequest("/api/v3/order", "DELETE", { symbol, orderId }, approvedRequestId);
}

export async function getRealAccount() {
  return signedRequest("/api/v3/account", "GET", {});
}

export async function getRealOpenOrders(symbol?: string) {
  return signedRequest("/api/v3/openOrders", "GET", symbol ? { symbol } : {});
}

// Best-effort permission probe — returns capability flags from /api/v3/account.
export async function checkApiPermissions(): Promise<{
  configured: boolean; canTrade?: boolean; canWithdraw?: boolean; canDeposit?: boolean; error?: string;
}> {
  if (!isRealConfigured()) return { configured: false };
  try {
    const acc = await getRealAccount();
    return {
      configured: true,
      canTrade: !!acc.canTrade,
      canWithdraw: !!acc.canWithdraw,
      canDeposit: !!acc.canDeposit,
    };
  } catch (err) {
    return { configured: true, error: (err as Error).message };
  }
}
