// Cotação viva para o cockpit simulado (pedido do dono 19/11/2026).
// O motor grava o snapshot a cada ~45 s; a cotação do MT5 chega a cada ~1,5 s.
// Com ordem aberta, a tela lê daqui a última cotação de cada ativo a cada 2 s
// e recalcula o "se fechar agora" sem esperar o próximo tique do motor.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type LiveQuote = { symbol: string; last: number | null; bid: number | null; ask: number | null; received_at: string };

export const readLiveQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ symbols: z.array(z.string()).max(10) }).parse(i ?? { symbols: [] }))
  .handler(async ({ data, context }) => {
    const out: LiveQuote[] = [];
    await Promise.all(Array.from(new Set(data.symbols)).map(async (symbol) => {
      const { data: rows } = await (context.supabase as any).from("b3_mt5sim_quotes")
        .select("symbol, last, bid, ask, received_at")
        .eq("user_id", context.userId).eq("symbol", symbol)
        .order("received_at", { ascending: false }).limit(1);
      const r = rows?.[0];
      if (r) out.push({ symbol: r.symbol, last: r.last == null ? null : Number(r.last), bid: r.bid == null ? null : Number(r.bid), ask: r.ask == null ? null : Number(r.ask), received_at: r.received_at });
    }));
    return { quotes: out };
  });
