// Relatório de estado REAL vindo do executor MT5 — a única fonte de verdade
// sobre posição e saldo da corretora.
//
// Por que existe: comando não é verdade, é intenção. Derivar posição de
// "aberturas menos fechamentos" desvia toda vez que um comando expira, erra ou
// fecha quantidade diferente da pedida (netting da B3 fecha pos.volume inteiro),
// e o desvio é acumulativo. Quem fala com o MT5 é o executor; ele reporta.
//
// Autenticação: mesma do b3-mt5-commands-pending — HMAC-SHA256 do corpo cru com
// B3_MT5_COMMANDS_SECRET no header x-mt5-signature.
//
// Grava UMA linha por usuário (upsert), sobrescrevendo o estado corrente. Não
// guarda histórico de propósito: a tela precisa do agora, não do passado.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface ReportedPosition {
  symbol: string;
  side: "buy" | "sell" | null;
  volume: number | null;
  price_open: number | null;
  price_current: number | null;
  profit: number | null;
  magic_number: number | null;
  ticket: string | null;
  opened_at: string | null;
}

// Aceita os nomes em português (contrato do pedido) e os do MetaTrader, para o
// Python poder repassar o dicionário da posição quase cru.
function normalizePosition(raw: any): ReportedPosition | null {
  if (!raw || typeof raw !== "object") return null;
  const symbol = String(raw.symbol ?? raw.simbolo ?? "").toUpperCase().trim();
  if (!symbol) return null;

  const rawSide = raw.side ?? raw.lado ?? raw.type ?? raw.tipo;
  let side: "buy" | "sell" | null = null;
  if (typeof rawSide === "number") side = rawSide === 0 ? "buy" : rawSide === 1 ? "sell" : null;
  else {
    const s = String(rawSide ?? "").toLowerCase();
    if (/buy|compra|long/.test(s)) side = "buy";
    else if (/sell|venda|short/.test(s)) side = "sell";
  }

  const volume = num(raw.volume ?? raw.quantity ?? raw.quantidade ?? raw.qty);
  const openedRaw = raw.opened_at ?? raw.aberta_em ?? raw.time ?? null;
  let openedAt: string | null = null;
  if (openedRaw != null) {
    // O MT5 manda epoch em segundos; ISO também é aceito.
    const d = typeof openedRaw === "number"
      ? new Date(openedRaw < 1e12 ? openedRaw * 1000 : openedRaw)
      : new Date(String(openedRaw));
    openedAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return {
    symbol,
    side,
    volume: volume == null ? null : Math.abs(volume),
    price_open: num(raw.price_open ?? raw.preco_medio ?? raw.preco_abertura ?? raw.entry_price),
    price_current: num(raw.price_current ?? raw.preco_atual ?? raw.current_price),
    profit: num(raw.profit ?? raw.resultado ?? raw.resultado_corrente),
    magic_number: num(raw.magic_number ?? raw.magic) ?? null,
    ticket: raw.ticket == null ? null : String(raw.ticket),
    opened_at: openedAt,
  };
}

export const Route = createFileRoute("/api/public/hooks/b3-mt5-account-report")({
  server: {
    handlers: {
      GET: async () =>
        json({
          ok: true,
          endpoint: "b3-mt5-account-report",
          method: "POST",
          hint:
            "POST JSON {user_id, ts, saldo, capital_liquido, margem_livre, posicoes:[{symbol, lado, volume, preco_medio, resultado, magic}]} " +
            "com header x-mt5-signature (HMAC-SHA256 do corpo cru usando B3_MT5_COMMANDS_SECRET).",
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

        const secret = process.env['B3_MT5_COMMANDS_SECRET'];
        if (!secret) return reject("misconfigured: sem B3_MT5_COMMANDS_SECRET", 500);

        const signature = request.headers.get("x-mt5-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return reject("invalid signature", 401);

        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return reject("bad json", 400);
        }
        if (!payload?.user_id) return reject("missing user_id", 400);

        const positions = Array.isArray(payload.posicoes ?? payload.positions)
          ? (payload.posicoes ?? payload.positions).map(normalizePosition).filter(Boolean)
          : [];

        const tsRaw = payload.ts ?? payload.reported_at ?? null;
        let reportedAt = new Date().toISOString();
        if (tsRaw != null) {
          const d = typeof tsRaw === "number"
            ? new Date(tsRaw < 1e12 ? tsRaw * 1000 : tsRaw)
            : new Date(String(tsRaw));
          if (!Number.isNaN(d.getTime())) reportedAt = d.toISOString();
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await (supabaseAdmin as any)
          .from("b3_mt5_account_state")
          .upsert({
            user_id: payload.user_id,
            reported_at: reportedAt,
            balance: num(payload.saldo ?? payload.balance),
            equity: num(payload.capital_liquido ?? payload.equity),
            free_margin: num(payload.margem_livre ?? payload.free_margin ?? payload.margin_free),
            positions,
            account_login: payload.conta == null && payload.account_login == null
              ? null
              : String(payload.conta ?? payload.account_login),
            server_name: payload.servidor == null && payload.server == null
              ? null
              : String(payload.servidor ?? payload.server),
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });

        if (error) return json({ ok: false, error: error.message }, 500);

        return json({
          ok: true,
          stored_positions: positions.length,
          reported_at: reportedAt,
          server_time: new Date().toISOString(),
        });
      },
    },
  },
});
