import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/daily-report")({
  server: {
    handlers: {
      POST: async () => {
        const { isBinancePaused, binanceHookClient } = await import("@/lib/binance-pause.server");
        const sb = await binanceHookClient();
        if (await isBinancePaused(sb)) {
          return Response.json({ ok: true, skipped: true, reason: "binance_paused" });
        }
        const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
        const { generateDailyReport } = await import("@/lib/reports.server");
        const r = await generateDailyReport(sb as any, yesterday);
        return Response.json({ ok: true, id: r?.id });
      },
    },
  },
});
