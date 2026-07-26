// Operação Manual — WINQ26. Carteira independente dos robôs.
// Somente proteções técnicas (tick vencido, duplicidade, 1 posição aberta).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TICK_MAX_AGE_S = 5;

async function loadCtx(sb: any, userId: string) {
  const { data: settings } = await sb.from("b3_mt5sim_settings").select("*").eq("user_id", userId).maybeSingle();
  if (!settings) throw new Error("Configuração da simulação MT5 não encontrada");
  const { data: quote } = await sb
    .from("b3_mt5sim_quotes")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", settings.mt5_symbol)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ageS = quote ? (Date.now() - new Date(quote.received_at).getTime()) / 1000 : null;
  return { settings, quote, ageS };
}

function requireFreshQuote(quote: any, ageS: number | null) {
  if (!quote || ageS == null) throw new Error("Sem cotação MT5 recebida — operação bloqueada.");
  if (ageS > TICK_MAX_AGE_S) throw new Error(`Cotação MT5 vencida (${Math.round(ageS)}s) — operação bloqueada.`);
  const bid = Number(quote.bid ?? NaN);
  const ask = Number(quote.ask ?? NaN);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    throw new Error("Cotação MT5 inválida — operação bloqueada.");
  }
  return { bid, ask };
}

function computePnl(settings: any, side: "buy" | "sell", entry: number, exit: number, volume: number) {
  const pointValue = Number(settings.point_value_brl ?? 0.2);
  const fee = Number(settings.fee_per_contract_brl ?? 0);
  const pts = side === "buy" ? exit - entry : entry - exit;
  const gross = pts * pointValue * volume;
  const fees = fee * volume * 2;
  return { points: pts, gross_brl: gross, fees_brl: fees, net_brl: gross - fees };
}

async function getOpen(sb: any, userId: string) {
  const { data } = await sb
    .from("b3_mt5sim_manual_trades")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "open")
    .maybeSingle();
  return data;
}

export const getManualDeskState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { settings, quote, ageS } = await loadCtx(supabase, userId);
    const open = await getOpen(supabase, userId);
    const today = new Date().toISOString().slice(0, 10);
    const { data: closedToday } = await supabase
      .from("b3_mt5sim_manual_trades")
      .select("net_brl, ts_exit")
      .eq("user_id", userId)
      .eq("status", "closed")
      .gte("ts_exit", `${today}T00:00:00Z`);
    const realizedDay = ((closedToday as any[]) ?? []).reduce((a, r) => a + Number(r.net_brl ?? 0), 0);
    const { data: history } = await supabase
      .from("b3_mt5sim_manual_trades")
      .select("*")
      .eq("user_id", userId)
      .order("ts_entry", { ascending: false })
      .limit(30);

    const bid = quote?.bid != null ? Number(quote.bid) : null;
    const ask = quote?.ask != null ? Number(quote.ask) : null;
    const stale = ageS == null || ageS > TICK_MAX_AGE_S || bid == null || ask == null;

    let float_pts: number | null = null;
    let float_brl: number | null = null;
    let mark: number | null = null;
    if (open && !stale) {
      mark = open.side === "buy" ? bid : ask;
      if (mark != null) {
        const p = computePnl(settings, open.side, Number(open.price_entry), mark, Number(open.volume));
        float_pts = p.points;
        float_brl = p.net_brl;
      }
    }
    return {
      symbol: settings.mt5_symbol,
      point_value_brl: Number(settings.point_value_brl ?? 0.2),
      fee_per_contract_brl: Number(settings.fee_per_contract_brl ?? 0),
      quote: { bid, ask, last: quote?.last != null ? Number(quote.last) : null, spread: quote?.spread != null ? Number(quote.spread) : null, age_s: ageS },
      quote_stale: stale,
      position: open
        ? { id: open.id, side: open.side, volume: Number(open.volume), price_entry: Number(open.price_entry), ts_entry: open.ts_entry }
        : null,
      mark_price: mark,
      float_pts,
      float_brl,
      realized_day_brl: realizedDay,
      history: history ?? [],
    };
  });

const openSchema = z.object({ side: z.enum(["buy", "sell"]), volume: z.number().int().min(1).max(50) });
const invertSchema = z.object({ volume: z.number().int().min(1).max(50).optional() });

export const openManualDeskTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => openSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { settings, quote, ageS } = await loadCtx(supabase, userId);
    const { bid, ask } = requireFreshQuote(quote, ageS);
    const existing = await getOpen(supabase, userId);
    if (existing) throw new Error("Já existe uma posição manual aberta — feche ou inverta antes de abrir outra.");
    const entry = data.side === "buy" ? ask : bid; // compra no ASK, venda no BID
    const { data: row, error } = await supabase
      .from("b3_mt5sim_manual_trades")
      .insert({ user_id: userId, symbol: settings.mt5_symbol, side: data.side, volume: data.volume, price_entry: entry, status: "open", entry_reason: "manual" })
      .select()
      .single();
    if (error) {
      if ((error as any).code === "23505") throw new Error("Já existe uma posição manual aberta.");
      throw error;
    }
    return { ok: true, trade: row };
  });

async function closeOpen(sb: any, userId: string, settings: any, quote: any, ageS: number | null, reason: string) {
  const { bid, ask } = requireFreshQuote(quote, ageS);
  const open = await getOpen(sb, userId);
  if (!open) return null;
  const exit = open.side === "buy" ? bid : ask; // fecha compra no BID, fecha venda no ASK
  const p = computePnl(settings, open.side, Number(open.price_entry), exit, Number(open.volume));
  const { data: row, error } = await sb
    .from("b3_mt5sim_manual_trades")
    .update({
      status: "closed",
      price_exit: exit,
      points_result: p.points,
      gross_brl: p.gross_brl,
      fees_brl: p.fees_brl,
      net_brl: p.net_brl,
      exit_reason: reason,
      ts_exit: new Date().toISOString(),
    })
    .eq("id", open.id)
    .eq("user_id", userId)
    .eq("status", "open")
    .select()
    .single();
  if (error) throw error;
  return row;
}

export const closeManualDeskTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { settings, quote, ageS } = await loadCtx(supabase, userId);
    const closed = await closeOpen(supabase, userId, settings, quote, ageS, "manual_close");
    if (!closed) throw new Error("Sem posição manual aberta.");
    return { ok: true, closed };
  });

export const invertManualDeskTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => invertSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { settings, quote, ageS } = await loadCtx(supabase, userId);
    const { bid, ask } = requireFreshQuote(quote, ageS);
    const current = await getOpen(supabase, userId);
    if (!current) throw new Error("Sem posição manual aberta para inverter.");
    const closed = await closeOpen(supabase, userId, settings, quote, ageS, "manual_invert");
    const newSide: "buy" | "sell" = current.side === "buy" ? "sell" : "buy";
    const volume = data.volume ?? Number(current.volume);
    const entry = newSide === "buy" ? ask : bid;
    const { data: row, error } = await supabase
      .from("b3_mt5sim_manual_trades")
      .insert({
        user_id: userId,
        symbol: settings.mt5_symbol,
        side: newSide,
        volume,
        price_entry: entry,
        status: "open",
        entry_reason: "manual_invert",
        linked_trade_id: closed?.id ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, closed, opened: row };
  });
