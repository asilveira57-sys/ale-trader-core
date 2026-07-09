// Ingest de ticks do MT5 (WINQ26) — aceita XPMT5-DEMO e XPMT5-PRD.
// Valida HMAC-SHA256 sobre o corpo cru usando B3_MT5SIM_INGEST_SECRET.
// Endpoint puro backend: nunca retorna HTML. Sempre responde JSON.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

interface TickPayload {
  user_id: string;
  symbol: string;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  spread?: number | null;
  volume?: number | null;
  symbol_status?: string | null;
  mt5_connected?: boolean | null;
  server?: string | null;
  account_masked?: string | null;
  tick_ts?: string;
}

const ALLOWED_SERVERS = new Set(["XPMT5-DEMO", "XPMT5-PRD"]);
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export const Route = createFileRoute("/api/public/hooks/b3-mt5sim-tick-ingest")({
  server: {
    handlers: {
      GET: async () =>
        json({
          ok: true,
          endpoint: "b3-mt5sim-tick-ingest",
          method: "POST",
          accepts: Array.from(ALLOWED_SERVERS),
          hint: "POST JSON com header x-mt5-signature (HMAC-SHA256 do corpo cru usando B3_MT5SIM_INGEST_SECRET).",
        }),
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, GET, OPTIONS",
            "access-control-allow-headers": "content-type, x-mt5-signature",
          },
        }),
      POST: async ({ request }) => {
        const secret = process.env.B3_MT5SIM_INGEST_SECRET;
        if (!secret) return json({ ok: false, error: "misconfigured" }, 500);

        const signature = request.headers.get("x-mt5-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return json({ ok: false, error: "invalid signature" }, 401);
        }

        let payload: TickPayload;
        try {
          payload = JSON.parse(body);
        } catch {
          return json({ ok: false, error: "bad json" }, 400);
        }
        if (!payload?.user_id || !payload?.symbol) {
          return json({ ok: false, error: "missing user_id/symbol" }, 400);
        }

        const server = (payload.server ?? "XPMT5-DEMO").toUpperCase();
        if (!ALLOWED_SERVERS.has(server)) {
          return json(
            { ok: false, error: `server not allowed: ${server}`, allowed: Array.from(ALLOWED_SERVERS) },
            400,
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const spread =
          payload.spread ??
          (payload.bid != null && payload.ask != null ? Number(payload.ask) - Number(payload.bid) : null);
        const { error } = await (supabaseAdmin as any).from("b3_mt5sim_quotes").insert({
          user_id: payload.user_id,
          symbol: payload.symbol,
          bid: payload.bid ?? null,
          ask: payload.ask ?? null,
          last: payload.last ?? null,
          spread,
          volume: payload.volume ?? null,
          symbol_status: payload.symbol_status ?? null,
          mt5_connected: payload.mt5_connected ?? true,
          server,
          account_masked: payload.account_masked ?? null,
          tick_ts: payload.tick_ts ?? new Date().toISOString(),
        });
        if (error) return json({ ok: false, received: false, error: error.message }, 500);
        return json({ ok: true, received: true, server });
      },
    },
  },
});
