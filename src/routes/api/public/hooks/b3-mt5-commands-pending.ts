// Fila de comandos pro conector MT5 (execução real) — consulta + reivindicação.
// Valida HMAC-SHA256 sobre o corpo cru usando B3_MT5_COMMANDS_SECRET
// (segredo PRÓPRIO, separado do de cotação — esse canal pode mexer em
// dinheiro real, merece uma chave isolada).
//
// Fluxo: o conector chama esse endpoint em loop. Cada chamada:
//   1) expira qualquer comando 'pending'/'claimed' cujo expires_at já passou
//      (nunca fica pendurado pra sempre, e nunca executa depois de vencido);
//   2) reivindica atomicamente (UPDATE ... WHERE status='pending' RETURNING)
//      os comandos pendentes daquele usuário/ambiente, pra dois pollers
//      nunca pegarem o mesmo comando duas vezes;
//   3) devolve a lista reivindicada pro conector executar.
//
// O conector SÓ deve chamar mt5.order_send(...) para comandos que vieram
// nessa resposta (ou seja, já 'claimed' por ele) — nunca a partir de outra
// fonte — e depois DEVE confirmar via b3-mt5-commands-ack, sempre, mesmo em
// caso de erro/rejeição.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

interface PendingRequest {
  user_id: string;
  env: "demo" | "real";
  claimed_by: string; // identificador do processo conector (ex: hostname+pid)
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export const Route = createFileRoute("/api/public/hooks/b3-mt5-commands-pending")({
  server: {
    handlers: {
      GET: async () =>
        json({
          ok: true,
          endpoint: "b3-mt5-commands-pending",
          method: "POST",
          hint: "POST JSON {user_id, env, claimed_by} com header x-mt5-signature (HMAC-SHA256 do corpo cru usando B3_MT5_COMMANDS_SECRET).",
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

        let payload: PendingRequest;
        try {
          payload = JSON.parse(body);
        } catch {
          return reject("bad json", 400);
        }
        if (!payload?.user_id || !payload?.env || !payload?.claimed_by) {
          return reject("missing user_id/env/claimed_by", 400);
        }
        if (payload.env !== "demo" && payload.env !== "real") {
          return reject("env inválido", 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();

        // 1) Expira qualquer comando vencido antes de reivindicar qualquer coisa nova.
        //    Um comando 'claimed' que nunca foi confirmado (conector caiu no meio)
        //    também expira aqui — vira 'expired', nunca 'filled' por suposição.
        await (supabaseAdmin as any)
          .from("b3_mt5_commands")
          .update({ status: "expired" })
          .eq("user_id", payload.user_id)
          .eq("env", payload.env)
          .in("status", ["pending", "claimed"])
          .lt("expires_at", nowIso);

        // 2) Reivindica atomicamente os pendentes restantes.
        const { data: claimed, error } = await (supabaseAdmin as any)
          .from("b3_mt5_commands")
          .update({ status: "claimed", claimed_at: nowIso, claimed_by: payload.claimed_by })
          .eq("user_id", payload.user_id)
          .eq("env", payload.env)
          .eq("status", "pending")
          .gte("expires_at", nowIso)
          .select("*");

        if (error) return json({ ok: false, error: error.message }, 500);

        return json({
          ok: true,
          env: payload.env,
          commands: claimed ?? [],
          count: (claimed ?? []).length,
          server_time: nowIso,
        });
      },
    },
  },
});
