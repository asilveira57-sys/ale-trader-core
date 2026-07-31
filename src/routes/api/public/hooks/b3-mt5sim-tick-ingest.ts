// Ingest de ticks do MT5 (WINQ26) — aceita XPMT5-DEMO e XPMT5-PRD.
// Valida HMAC-SHA256 sobre o corpo cru usando B3_MT5SIM_INGEST_SECRET.
// Endpoint puro backend: nunca retorna HTML. Sempre responde JSON.
//
// CAUSA RAIZ CORRIGIDA (tick 200 OK mas cotação congelada):
// a gravação era disparada com `void flushQueue()` DEPOIS de montar a resposta.
// No runtime serverless o isolate é encerrado assim que a resposta é devolvida:
// tudo que estava pendente (import dinâmico + upsert + setTimeout de retry) era
// cancelado silenciosamente. Resultado: HTTP 200 com `received:true`, `queued:0`
// e nenhuma linha em b3_mt5sim_quotes.
//
// Agora a persistência é AGUARDADA dentro da requisição, com corte de tempo
// (PERSIST_BUDGET_MS) para nunca estourar o read timeout do conector, e o lote
// que não deu tempo fica na fila para ser gravado na PRÓXIMA requisição
// (também aguardada). Nenhum setTimeout, nenhum trabalho pós-resposta.
//
// A resposta diferencia explicitamente received / queued / persisted / rejected.
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
// Só evita reprocessar o MESMO tick (mesmo timestamp e mesmos preços).
// Preço repetido com timestamp novo continua sendo gravado — a idade do tick
// depende do horário da cotação, não da variação de preço.
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

// ---- fila de gravação (drenada dentro da própria requisição) ----
type QuoteRow = Record<string, unknown>;
const QUEUE: QuoteRow[] = [];
const QUEUE_MAX = 200;
const PERSIST_BUDGET_MS = 2_500; // bem abaixo do read timeout do conector
const BATCH_MAX = 50;

// ---- diagnóstico (memória do isolate, custo zero de I/O) ----
const DIAG = {
  last_trace_id: null as string | null,
  last_received_at: null as string | null,
  last_persisted_at: null as string | null,
  last_persisted_tick_ts: null as string | null,
  last_rejected_at: null as string | null,
  last_reject_reason: null as string | null,
  last_error: null as string | null,
  received_count: 0,
  persisted_count: 0,
  rejected_count: 0,
  duplicate_count: 0,
  timeout_count: 0,
};

function traceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Grava a fila. Aguardado pela requisição; nunca excede o orçamento de tempo. */
async function persistQueue(budgetMs = PERSIST_BUDGET_MS): Promise<{
  persisted: number;
  ok: boolean;
  error?: string;
  timed_out?: boolean;
}> {
  if (QUEUE.length === 0) return { persisted: 0, ok: true };
  const batch = QUEUE.splice(0, BATCH_MAX);
  try {
    const work = (async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await (supabaseAdmin as any)
        .from("b3_mt5sim_quotes")
        .upsert(batch, { onConflict: "user_id,symbol,tick_ts,bid,ask,last", ignoreDuplicates: true });
      if (error) throw error;
    })();
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("persist timeout")), budgetMs),
    );
    await Promise.race([work, timeout]);
    DIAG.persisted_count += batch.length;
    DIAG.last_persisted_at = new Date().toISOString();
    DIAG.last_persisted_tick_ts = String(batch[batch.length - 1]?.tick_ts ?? "");
    DIAG.last_error = null;
    return { persisted: batch.length, ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    const timedOut = msg.includes("persist timeout");
    if (timedOut) DIAG.timeout_count += 1;
    DIAG.last_error = msg;
    // Nada de descarte silencioso: o lote volta para a fila (limitada).
    const room = Math.max(0, QUEUE_MAX - QUEUE.length);
    QUEUE.unshift(...batch.slice(-room));
    console.error("[tick-ingest] falha ao persistir", { msg, requeued: Math.min(batch.length, room) });
    return { persisted: 0, ok: false, error: msg, timed_out: timedOut };
  }
}

export const Route = createFileRoute("/api/public/hooks/b3-mt5sim-tick-ingest")({
  server: {
    handlers: {
      // GET = diagnóstico do pipeline de ingestão (sem tocar no banco).
      GET: async () =>
        json({
          ok: true,
          endpoint: "b3-mt5sim-tick-ingest",
          method: "POST",
          accepts: Array.from(ALLOWED_SERVERS),
          queue_size: QUEUE.length,
          oldest_queued_tick_ts: QUEUE[0]?.tick_ts ?? null,
          worker: "inline (drenado na própria requisição)",
          diagnostics: DIAG,
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
        const trace_id = traceId();
        DIAG.last_trace_id = trace_id;
        DIAG.last_received_at = new Date().toISOString();
        DIAG.received_count += 1;

        const reject = (reason: string, status: number) => {
          DIAG.rejected_count += 1;
          DIAG.last_rejected_at = new Date().toISOString();
          DIAG.last_reject_reason = reason;
          return json(
            { ok: false, trace_id, received: true, processed: false, persisted: false, rejected: true, reason },
            status,
          );
        };

        const secret = process.env.B3_MT5SIM_INGEST_SECRET;
        if (!secret) return reject("misconfigured: sem B3_MT5SIM_INGEST_SECRET", 500);

        const signature = request.headers.get("x-mt5-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return reject("invalid signature", 401);

        let payload: TickPayload;
        try {
          payload = JSON.parse(body);
        } catch {
          return reject("bad json", 400);
        }
        if (!payload?.user_id || !payload?.symbol) return reject("missing user_id/symbol", 400);

        const server = (payload.server ?? "XPMT5-DEMO").toUpperCase();
        if (!ALLOWED_SERVERS.has(server)) return reject(`server not allowed: ${server}`, 400);

        const tickTs = payload.tick_ts ?? new Date().toISOString();
        const dedupKey = `${payload.user_id}|${payload.symbol}|${tickTs}|${payload.bid ?? ""}|${payload.ask ?? ""}|${payload.last ?? ""}`;
        if (isDuplicate(dedupKey)) {
          DIAG.duplicate_count += 1;
          return json({
            ok: true,
            trace_id,
            received: true,
            duplicate: true,
            processed: true,
            persisted: true,
            server,
            ms: Date.now() - t0,
          });
        }

        const spread =
          payload.spread ??
          (payload.bid != null && payload.ask != null ? Number(payload.ask) - Number(payload.bid) : null);

        let queued = false;
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
          queued = true;
        } else {
          DIAG.last_reject_reason = "fila cheia";
          DIAG.last_rejected_at = new Date().toISOString();
        }

        // Persistência AGUARDADA: garante que o tick chegou à fonte canônica
        // antes de responder. Se o banco estiver lento, o corte de tempo mantém
        // a resposta rápida e o lote permanece na fila para a próxima chamada.
        const res = await persistQueue(PERSIST_BUDGET_MS);

        return json({
          ok: true,
          trace_id,
          received: true,
          queued,
          processed: res.ok && res.persisted > 0,
          persisted: res.ok && res.persisted > 0,
          persisted_rows: res.persisted,
          rejected: false,
          queue_size: QUEUE.length,
          server,
          tick_ts: tickTs,
          error: res.error ?? null,
          timed_out: res.timed_out ?? false,
          ms: Date.now() - t0,
        });
      },
    },
  },
});
