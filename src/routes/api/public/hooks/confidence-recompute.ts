import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/confidence-recompute")({
  server: {
    handlers: {
      POST: async () => {
        const { isBinancePaused, binanceHookClient } = await import("@/lib/binance-pause.server");
        const sb = await binanceHookClient();
        if (await isBinancePaused(sb)) {
          return Response.json({ ok: true, skipped: true, reason: "binance_paused" });
        }
        const { computeConfidence } = await import("@/lib/confidence.server");
        const { evolveAgentWeights } = await import("@/lib/auto-trading.server");
        const conf = await computeConfidence(sb as any);
        const ev = await evolveAgentWeights(sb as any, 14);
        return Response.json({ ok: true, conf, evolved: ev });
      },
    },
  },
});
