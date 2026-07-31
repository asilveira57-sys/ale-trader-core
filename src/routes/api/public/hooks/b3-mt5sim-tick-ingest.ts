// Ingest de ticks do MT5 (WINQ26) — aceita XPMT5-DEMO e XPMT5-PRD.
// Valida HMAC-SHA256 sobre o corpo cru usando B3_MT5SIM_INGEST_SECRET.
// Endpoint puro backend: nunca retorna HTML. Sempre responde JSON.
//
// PERFORMANCE (auditoria de timeout do conector):
// - O handler responde IMEDIATAMENTE após validar assinatura/payload.
// - A gravação no banco é feita em background (fila em memória, flush em lote),
//   nunca bloqueando a resposta HTTP. Nenhuma consulta ampla, nenhum comitê,
//   nenhum cálculo de estratégia acontece aqui.
// - Deduplicação por user_id + símbolo + tick_ts + preço evita processamento
//   simultâneo/duplicado do mesmo tick.
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

// ---- deduplicação em memória (por isolate) ----
const DEDUP = new Map<string, number>();
const DEDUP_TTL_MS = 60_000;
function isDuplicate(key: string): boolean {
  const now = Date.now();
  if (DEDUP.size > 500) {
    for (const [k, at] of DEDUP) if (now - at > DEDUP_TTL_MS) DEDUP.delete(k);
  }
  const prev = DEDUP.get(key);
  if (prev != null && now - prev < DEDUP_TTL_MS) return true;
  DEDUP.set(key, now);
  return false;
}

// ---- fila de gravação (flush em lote, fora do caminho da resposta) ----
type QuoteRow = Record<string, unknown>;
const QUEUE: QuoteRow[] = [];
let flushing = false;
let lastFlush = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let failStreak = 0;
let circuitUntil = 0;
const FLUSH_MIN_INTERVAL_MS = 2_000;
const QUEUE_MAX = 200;
const CIRCUIT_FAILURES = 3;
const CIRCUIT_COOLDOWN_MS = 15_000;
const ERROR_BUCKETS = new Map<string, { count: number; first: number; last: number }>();

function aggregateError(kind: string, message: string) {
  const now = Date.now();
  const current = ERROR_BUCKETS.get(kind);
  const bucket = current ?? { count: 0, first: now, last: now };
  bucket.count += 1;
  bucket.last = now;
  ERROR_BUCKETS.set(kind, bucket);
  // Um único log agregado por tipo/intervalo, nunca um log por tick.
  if (!current || now - current.first >= 60_000) {
    console.error("[tick-ingest] erro agregado", { kind, message, count: bucket.count, first: new Date(bucket.first).toISOString(), last: new Date(bucket.last).toISOString() });
    ERROR_BUCKETS.set(kind, { count: 0, first: now, last: now });
  }
}

function scheduleFlush(delay = FLUSH_MIN_INTERVAL_MS) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, delay);
}

async function flushQueue() {
  if (flushing || QUEUE.length === 0) return;
  const now = Date.now();
  if (now < circuitUntil) {
    scheduleFlush(circuitUntil - now);
    return;
  }
  if (now - lastFlush < FLUSH_MIN_INTERVAL_MS && QUEUE.length < 25) {
    scheduleFlush(FLUSH_MIN_INTERVAL_MS - (now - lastFlush));
    return;
  }
  flushing = true;
  const batch = QUEUE.splice(0, QUEUE.length);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("b3_mt5sim_quotes")
      .upsert(batch, { onConflict: "user_id,symbol,tick_ts,bid,ask,last", ignoreDuplicates: true });
    if (error) throw error;
    failStreak = 0;
  } catch (e) {
    failStreak += 1;
    // O lote mais recente volta à frente da fila, limitado para nunca criar backlog infinito.
    QUEUE.unshift(...batch.slice(-Math.max(0, QUEUE_MAX - QUEUE.length)));
    aggregateError("flush", (e as Error).message);
    if (failStreak >= CIRCUIT_FAILURES) circuitUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    scheduleFlush(Math.min(30_000, 1_000 * (2 ** Math.min(failStreak, 5))));
  } finally {
    lastFlush = Date.now();
    flushing = false;
  }
}

export const Route = createFileRoute("/api/public/hooks/b3-mt5sim-tick-ingest")({
  server: {
    handlers: {
      GET: async () =>
        json({
          ok: true,
          endpoint: "b3-mt5sim-tick-ingest",
          method: "POST",
          accepts: Array.from(ALLOWED_SERVERS),
          queued: QUEUE.length,
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
        const t0 = Date.now();
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

        const tickTs = payload.tick_ts ?? new Date().toISOString();
        const dedupKey = `${payload.user_id}|${payload.symbol}|${tickTs}|${payload.bid ?? ""}|${payload.ask ?? ""}|${payload.last ?? ""}`;
        if (isDuplicate(dedupKey)) {
          return json({ ok: true, received: true, duplicate: true, server, ms: Date.now() - t0 });
        }

        const spread =
          payload.spread ??
          (payload.bid != null && payload.ask != null ? Number(payload.ask) - Number(payload.bid) : null);

        if (QUEUE.length < QUEUE_MAX) {
          QUEUE.push({
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
            tick_ts: tickTs,
          });
        }

        // Gravação em background: não bloqueia a resposta do conector.
        // Inicia o flush sem aguardá-lo; quando ainda estiver dentro da janela,
        // flushQueue agenda somente o tempo restante. A resposta não depende do banco.
        void flushQueue();

        return json({ ok: true, received: true, server, queued: QUEUE.length, backend_ready: Date.now() >= circuitUntil, ms: Date.now() - t0 });
      },
    },
  },
});
