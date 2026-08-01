import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/pipeline-tick")({
  server: {
    handlers: {
      POST: async () => {
        const { isBinancePaused, binanceHookClient } = await import("@/lib/binance-pause.server");
        const sb = await binanceHookClient();
        if (await isBinancePaused(sb)) {
          return Response.json({ ok: true, skipped: true, reason: "binance_paused" });
        }
        const { runPipelineTick } = await import("@/lib/pipeline-runner.server");
        try {
          const result = await runPipelineTick(sb);
          return Response.json({ ok: true, at: new Date().toISOString(), result });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
