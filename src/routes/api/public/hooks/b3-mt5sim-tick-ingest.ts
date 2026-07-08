// Ingest de ticks do MT5 (WINQ26) — HMAC-SHA256 sobre o corpo cru.
// O puller local (Python, ao lado do MT5 XP) posta ticks aqui a cada 1s.
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

export const Route = createFileRoute("/api/public/hooks/b3-mt5sim-tick-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.B3_MT5SIM_INGEST_SECRET;
        if (!secret) return new Response("misconfigured", { status: 500 });

        const signature = request.headers.get("x-mt5-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("invalid signature", { status: 401 });
        }

        let payload: TickPayload;
        try { payload = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
        if (!payload?.user_id || !payload?.symbol) return new Response("missing user_id/symbol", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const spread = payload.spread ?? (payload.bid != null && payload.ask != null ? Number(payload.ask) - Number(payload.bid) : null);
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
          server: payload.server ?? "XPMT5-PRD",
          account_masked: payload.account_masked ?? null,
          tick_ts: payload.tick_ts ?? new Date().toISOString(),
        });
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
