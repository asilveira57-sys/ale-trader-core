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
  // Ticket da POSIÇÃO na corretora: na abertura, a posição criada; no
  // fechamento, a(s) posição(ões) encerrada(s), separadas por vírgula. É isso
  // que permite ao livro parear sem adivinhar (conta hedge).
  broker_position_ticket?: string | string[] | number | null;
  filled_price?: number | null;
  error_message?: string | null;
}

const positionTicket = (v: unknown): string | null => {
  const s = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(",") : String(v ?? "").trim();
  return s ? s : null;
};

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
            broker_position_ticket: positionTicket(payload.broker_position_ticket),
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
            // Contrato de saída congelado na abertura, copiado do comando.
            stop_pts: cmd.stop_pts ?? null,
            gain_pts: cmd.gain_pts ?? null,
            stop_price: cmd.stop_price ?? null,
            target_price: cmd.target_price ?? null,
          });
          if (insErr) return json({ ok: false, error: insErr.message }, 500);
        } else {
          // action === 'close': acha a posição real aberta correspondente e fecha.
          //
          // CORRIGIDO em 04/09/2026 — CAUSA DAS 36 ÓRFÃS.
          // Antes era `.maybeSingle()`. Bastava UMA linha órfã antiga com o
          // mesmo magic (fechamento rejeitado porque o MT5 já havia fechado no
          // stop dele, por exemplo) para o SELECT devolver duas linhas e o
          // maybeSingle virar erro: a partir daí NENHUM fechamento daquele
          // magic voltava para o banco, e o defeito se multiplicava sozinho.
          // Agora pega a MAIS ANTIGA aberta (FIFO, igual ao livro do cockpit).
          const { data: abertas, error: openErr } = await (supabaseAdmin as any)
            .from("b3_live_orders")
            .select("*")
            .eq("user_id", payload.user_id)
            .eq("magic_number", cmd.magic_number)
            .eq("status", "open")
            .order("entry_time", { ascending: true })
            .limit(5);
          if (openErr) return json({ ok: false, error: openErr.message }, 500);
          const openOrder = (abertas ?? [])[0];
          if ((abertas ?? []).length > 1) {
            // Sinal de que existe órfã acumulada nesse magic: fecha a mais
            // antiga e deixa rastro para a reconciliação resolver o resto.
            try {
              await (supabaseAdmin as any).from("system_logs").insert({
                event_type: "b3_live_orders_multiplas_abertas",
                source: "b3-mt5-commands-ack",
                severity: "warning",
                message: `magic ${cmd.magic_number}: ${(abertas ?? []).length} ordens abertas no banco ao confirmar um fechamento — fechando a mais antiga.`,
                technical_data: { command_id: cmd.id, magic: cmd.magic_number, ids: (abertas ?? []).map((o: any) => o.id) },
              });
            } catch { /* log nunca derruba a confirmação */ }
          }
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
          const pointValueBrl = await resolvePointValueBrl(supabaseAdmin, String(openOrder.symbol ?? cmd.symbol));
          const grossBrl = grossPts != null ? grossPts * pointValueBrl * Number(openOrder.quantity) : null;
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
