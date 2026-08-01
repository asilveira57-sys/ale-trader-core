import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/weekly-report")({
  server: {
    handlers: {
      POST: async () => {
        const { isBinancePaused, binanceHookClient } = await import("@/lib/binance-pause.server");
        const sb = await binanceHookClient();
        if (await isBinancePaused(sb)) {
          return Response.json({ ok: true, skipped: true, reason: "binance_paused" });
        }
        const start = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
        const { generateWeeklyReport } = await import("@/lib/reports.server");
        const r = await generateWeeklyReport(sb as any, start);
        return Response.json({ ok: true, id: r?.id });
      },
    },
  },
});
