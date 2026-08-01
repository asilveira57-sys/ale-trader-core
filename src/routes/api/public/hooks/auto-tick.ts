import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/auto-tick")({
  server: {
    handlers: {
      POST: async () => {
        const { isBinancePaused, binanceHookClient } = await import("@/lib/binance-pause.server");
        const sb = await binanceHookClient();
        if (await isBinancePaused(sb)) {
          return Response.json({ ok: true, skipped: true, reason: "binance_paused" });
        }
        const { data: sessions } = await sb.from("trading_sessions").select("id, mode").eq("status", "running");
        const { runAutoCycle, monitorAutoPositions } = await import("@/lib/auto-trading.server");
        const results: any[] = [];
        for (const s of sessions ?? []) {
          try { results.push({ session: s.id, cycle: await runAutoCycle(sb as any, s.id) }); } catch (e) { results.push({ session: s.id, error: (e as Error).message }); }
        }
        const mon = await monitorAutoPositions(sb as any);
        return Response.json({ ok: true, results, mon });
      },
    },
  },
});
