// Binance TESTNET only. Never imports api.binance.com.
import crypto from "crypto";

const TESTNET_BASE = "https://testnet.binance.vision";
const TESTNET_PUBLIC = "https://api.binance.com"; // public market data (read-only, no key)

export function isTestnetConfigured(): boolean {
  return !!(process.env.BINANCE_TESTNET_API_KEY && process.env.BINANCE_TESTNET_API_SECRET);
}

function sign(query: string): string {
  const secret = process.env.BINANCE_TESTNET_API_SECRET!;
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function signedRequest(path: string, method: "GET" | "POST" | "DELETE", params: Record<string, string | number>) {
  if (!isTestnetConfigured()) throw new Error("Binance Testnet não configurada. Adicione BINANCE_TESTNET_API_KEY e BINANCE_TESTNET_API_SECRET.");
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), timestamp: String(Date.now()), recvWindow: "5000" }).toString();
  const sig = sign(qs);
  const url = `${TESTNET_BASE}${path}?${qs}&signature=${sig}`;
  const res = await fetch(url, { method, headers: { "X-MBX-APIKEY": process.env.BINANCE_TESTNET_API_KEY! } });
  const body = await res.text();
  let json: any;
  try { json = JSON.parse(body); } catch { json = { raw: body }; }
  if (!res.ok) throw new Error(`Binance Testnet ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

export async function placeTestnetOrder(p: { symbol: string; side: "BUY" | "SELL"; type?: "MARKET" | "LIMIT"; quantity: number; price?: number }) {
  const params: Record<string, string | number> = { symbol: p.symbol, side: p.side, type: p.type ?? "MARKET", quantity: p.quantity };
  if (p.type === "LIMIT" && p.price) { params.price = p.price; params.timeInForce = "GTC"; }
  return signedRequest("/api/v3/order", "POST", params);
}

export async function cancelTestnetOrder(symbol: string, orderId: number) {
  return signedRequest("/api/v3/order", "DELETE", { symbol, orderId });
}

export async function getTestnetAccount() {
  return signedRequest("/api/v3/account", "GET", {});
}

// Public market data (no auth). Binance public klines endpoint works without keys.
export async function getPublicTicker(symbol: string): Promise<{ price: number; change_24h: number; volume_24h: number; high: number; low: number } | null> {
  try {
    const res = await fetch(`${TESTNET_PUBLIC}/api/v3/ticker/24hr?symbol=${symbol}`);
    if (!res.ok) return null;
    const j: any = await res.json();
    return {
      price: Number(j.lastPrice),
      change_24h: Number(j.priceChangePercent),
      volume_24h: Number(j.volume),
      high: Number(j.highPrice),
      low: Number(j.lowPrice),
    };
  } catch { return null; }
}

export async function getPublicKlines(symbol: string, interval = "1h", limit = 100): Promise<Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>> {
  try {
    const res = await fetch(`${TESTNET_PUBLIC}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!res.ok) return [];
    const arr: any[] = await res.json();
    return arr.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  } catch { return []; }
}
