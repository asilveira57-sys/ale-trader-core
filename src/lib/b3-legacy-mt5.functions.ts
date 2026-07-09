// Server functions do adaptador legado (B3 Day Trade WIN) rodando sobre MT5 XP DEMO/PRD.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runLegacyMt5Tick, LEGACY_MODES } from "./b3-legacy-mt5-adapter.server";

export const setMt5SimEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ engine: z.enum(["legacy_b3", "new_mt5"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase.from("b3_mt5sim_settings").update({ engine: data.engine }).eq("user_id", userId);
    if (error) throw error;
    return { ok: true, engine: data.engine };
  });

export const tickLegacyMt5Now = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    return runLegacyMt5Tick(supabase, userId, { force: true });
  });

export const getLegacyMt5Dashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: settings }, { data: signals }, { data: trades }, { data: openTrades }, { data: candles }] = await Promise.all([
      supabase.from("b3_mt5sim_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("b3_legacy_mt5_signals").select("*").eq("user_id", userId).order("ts", { ascending: false }).limit(60),
      supabase.from("b3_legacy_mt5_trades").select("*").eq("user_id", userId).order("opened_at", { ascending: false }).limit(80),
      supabase.from("b3_legacy_mt5_trades").select("*").eq("user_id", userId).eq("status", "open"),
      supabase.from("b3_legacy_mt5_candles").select("*").eq("user_id", userId).order("minute_ts", { ascending: false }).limit(30),
    ]);

    // Ranking por modo (dia BRT).
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const startUtcIso = `${parts}T03:00:00.000Z`;
    const stats: Record<string, { mode: string; trades: number; wins: number; losses: number; net: number; gross_pts: number; hit_rate: number }> = {};
    for (const m of LEGACY_MODES) stats[m] = { mode: m, trades: 0, wins: 0, losses: 0, net: 0, gross_pts: 0, hit_rate: 0 };
    for (const t of ((trades as any[]) ?? [])) {
      if (t.status !== "closed" || !t.closed_at || t.closed_at < startUtcIso) continue;
      const s = stats[t.mode]; if (!s) continue;
      s.trades++;
      const n = Number(t.net_brl ?? 0);
      s.net += n;
      s.gross_pts += Number(t.gross_pts ?? 0);
      if (n > 0) s.wins++; else if (n < 0) s.losses++;
    }
    for (const k of Object.keys(stats)) stats[k].hit_rate = stats[k].trades ? stats[k].wins / stats[k].trades : 0;

    return {
      settings, signals: signals ?? [], trades: trades ?? [],
      open_trades: openTrades ?? [], candles: (candles ?? []).slice().reverse(),
      ranking: Object.values(stats).sort((a, b) => b.net - a.net),
      real_orders_sent: 0,
    };
  });

// Comparativo Motor Legado x MT5 — cruza trades do legado com trades do motor novo por janela de tempo.
export const getLegacyVsMt5Comparative = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: legacy }, { data: newSim }, { data: robots }] = await Promise.all([
      supabase.from("b3_legacy_mt5_trades").select("id, mode, side, entry_price, exit_price, net_brl, gross_pts, opened_at, closed_at, close_reason, quote_server, status")
        .eq("user_id", userId).order("opened_at", { ascending: false }).limit(200),
      supabase.from("b3_mt5sim_trades").select("id, robot_id, side, price_entry_sim, price_exit_sim, net_brl, points_result, ts_entry, ts_exit, exit_reason, status")
        .eq("user_id", userId).order("ts_entry", { ascending: false }).limit(200),
      supabase.from("b3_mt5sim_robots").select("id, profile").eq("user_id", userId),
    ]);
    const profileById = new Map(((robots as any[]) ?? []).map((r) => [r.id, r.profile]));

    const rows = ((legacy as any[]) ?? []).map((l) => {
      const t = new Date(l.opened_at).getTime();
      const match = ((newSim as any[]) ?? []).find((n) => profileById.get(n.robot_id) === l.mode && Math.abs(new Date(n.ts_entry).getTime() - t) <= 60_000);
      const netLegacy = Number(l.net_brl ?? 0);
      const netNew = match ? Number(match.net_brl ?? 0) : null;
      const diff = netNew != null ? netLegacy - netNew : null;
      let motivo: string | null = null;
      if (match) {
        if (l.side !== match.side) motivo = "lado divergente";
        else if (l.close_reason !== match.exit_reason) motivo = `saída ${l.close_reason} vs ${match.exit_reason}`;
        else if (Math.abs(diff ?? 0) > 0.01) motivo = "diferença de preço/execução";
      } else motivo = "sem trade equivalente no motor novo";
      return {
        robot: l.mode, legacy_side: l.side, entry_legacy: l.entry_price, exit_legacy: l.exit_price,
        net_legacy: netLegacy, close_reason_legacy: l.close_reason,
        opened_at: l.opened_at, closed_at: l.closed_at,
        new_side: match?.side ?? null, entry_new: match?.price_entry_sim ?? null, exit_new: match?.price_exit_sim ?? null,
        net_new: netNew, close_reason_new: match?.exit_reason ?? null,
        diff, motivo,
      };
    });
    return { rows };
  });
