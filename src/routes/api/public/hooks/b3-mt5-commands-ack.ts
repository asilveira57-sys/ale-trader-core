// Confirmação de execução de comando MT5 (execução real).
// Valida HMAC-SHA256 sobre o corpo cru usando B3_MT5_COMMANDS_SECRET.
//
// Regra central: b3_live_orders só é escrita AQUI, depois da confirmação
// do conector — nunca no momento em que o comando é criado ou reivindicado.
// Isso garante que o banco nunca "acha" que uma ordem foi executada sem o
// MT5 ter confirmado de verdade.
//
// CORRIGIDO em 15/08/2026: o valor do ponto era fixo em 0.2 (WIN), o que
// contabilizava o resultado do WDO 50x errado. Agora vem de
// b3_asset_profiles.tick_value_brl pelo símbolo do comando (mesma fonte
// usada por computeB3Fees).
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

const POINT_VALUE_BRL_FALLBACK = 0.2; // WIN — usado só se o perfil do ativo não existir

// Resolve o valor do ponto pelo símbolo do comando (ex.: "WINQ26" → perfil WIN).
async function resolvePointValueBrl(admin: any, symbol: string): Promise<number> {
  const root = String(symbol ?? "").toUpperCase();
  try {
    const { data } = await admin
      .from("b3_asset_profiles")
      .select("symbol, quote_symbol, tick_value_brl");
    const rows = (data ?? []) as Array<{ symbol: string; quote_symbol: string; tick_value_brl: number }>;
    const hit =
      rows.find((r) => String(r.symbol).toUpperCase() === root) ??
      rows.find((r) => String(r.quote_symbol).toUpperCase() === root) ??
      rows.find((r) => root.startsWith(String(r.quote_symbol).toUpperCase()));
    const v = Number(hit?.tick_value_brl);
    return Number.isFinite(v) && v > 0 ? v : POINT_VALUE_BRL_FALLBACK;
  } catch {
    return POINT_VALUE_BRL_FALLBACK;
  }
}

interface AckRequest {
  user_id: string;
  command_id: string;
  result: "filled" | "rejected" | "error";
  broker_ticket?: string | null;
  filled_price?: number | null;
  error_message?: string | null;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export const Route = createFileRoute("/api/public/hooks/b3-mt5-commands-ack")({
  server: {
    handlers: {
      GET: async () =>
        json({
          ok: true,
          endpoint: "b3-mt5-commands-ack",
          method: "POST",
          hint: "POST JSON {user_id, command_id, result, broker_ticket?, filled_price?, error_message?} com header x-mt5-signature.",
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
        const reject = (reason: string, status: number) =>
          json({ ok: false, rejected: true, reason }, status);

        const secret = process.env.B3_MT5_COMMANDS_SECRET;
        if (!secret) return reject("misconfigured: sem B3_MT5_COMMANDS_SECRET", 500);

        const signature = request.headers.get("x-mt5-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return reject("invalid signature", 401);

        let payload: AckRequest;
        try {
          payload = JSON.parse(body);
        } catch {
          return reject("bad json", 400);
        }
        if (!payload?.user_id || !payload?.command_id || !payload?.result) {
          return reject("missing user_id/command_id/result", 400);
        }
        if (!["filled", "rejected", "error"].includes(payload.result)) {
          return reject("result inválido", 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Só aceita confirmação de um comando que estava 'claimed' — protege
        // contra ack duplicado (idempotência) e contra confirmar um comando
        // que já expirou nesse meio-tempo.
        const { data: cmd, error: findErr } = await (supabaseAdmin as any)
          .from("b3_mt5_commands")
          .select("*")
          .eq("id", payload.command_id)
          .eq("user_id", payload.user_id)
          .eq("status", "claimed")
          .maybeSingle();

        if (findErr) return json({ ok: false, error: findErr.message }, 500);
        if (!cmd) {
          return reject("comando não encontrado, já confirmado antes, ou expirado nesse meio-tempo", 409);
        }

        const nowIso = new Date().toISOString();
        const newStatus = payload.result === "filled" ? "filled" : payload.result;

        await (supabaseAdmin as any)
          .from("b3_mt5_commands")
          .update({
            status: newStatus,
            filled_at: payload.result === "filled" ? nowIso : null,
            broker_ticket: payload.broker_ticket ?? null,
            filled_price: payload.filled_price ?? null,
            error_message: payload.error_message ?? null,
          })
          .eq("id", cmd.id);

        if (payload.result !== "filled") {
          // Rejeitado ou erro no lado do MT5: nada é escrito em b3_live_orders.
          return json({ ok: true, command_id: cmd.id, status: newStatus });
        }

        // ─────────── comando confirmado como executado: grava/atualiza b3_live_orders ───────────
        if (cmd.action === "open") {
          const { error: insErr } = await (supabaseAdmin as any).from("b3_live_orders").insert({
            user_id: payload.user_id,
            command_id: cmd.id,
            simulation_run_id: cmd.simulation_run_id,
            mode: cmd.mode,
            instance_id: cmd.instance_id,
            symbol: cmd.symbol,
            side: cmd.side,
            quantity: cmd.quantity,
            magic_number: cmd.magic_number,
            broker_ticket_entry: payload.broker_ticket ?? null,
            entry_price: payload.filled_price ?? null,
            entry_time: nowIso,
            status: "open",
          });
          if (insErr) return json({ ok: false, error: insErr.message }, 500);
        } else {
          // action === 'close': acha a posição real aberta correspondente e fecha.
          const { data: openOrder, error: openErr } = await (supabaseAdmin as any)
            .from("b3_live_orders")
            .select("*")
            .eq("user_id", payload.user_id)
            .eq("magic_number", cmd.magic_number)
            .eq("status", "open")
            .maybeSingle();
          if (openErr) return json({ ok: false, error: openErr.message }, 500);
          if (!openOrder) {
            // MT5 confirmou o fechamento, mas não achamos a ordem aberta
            // correspondente no banco — inconsistência real, não escondemos.
            return json({
              ok: false,
              error: "MT5 confirmou fechamento mas não há b3_live_orders aberta com esse magic_number — checar manualmente.",
            }, 409);
          }
          const exitPrice = Number(payload.filled_price);
          const entryPrice = Number(openOrder.entry_price);
          const dir = openOrder.side === "buy" ? 1 : -1;
          const grossPts = Number.isFinite(exitPrice) && Number.isFinite(entryPrice) ? (exitPrice - entryPrice) * dir : null;
          const grossBrl = grossPts != null ? grossPts * POINT_VALUE_BRL_WIN * Number(openOrder.quantity) : null;
          const { error: updErr } = await (supabaseAdmin as any)
            .from("b3_live_orders")
            .update({
              broker_ticket_exit: payload.broker_ticket ?? null,
              exit_price: exitPrice,
              exit_time: nowIso,
              gross_result_brl: grossBrl,
              net_result_brl: grossBrl, // taxas reais entram quando o corretor informar
              status: "closed",
            })
            .eq("id", openOrder.id);
          if (updErr) return json({ ok: false, error: updErr.message }, 500);
        }

        return json({ ok: true, command_id: cmd.id, status: "filled" });
      },
    },
  },
});
