import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/confidence-recompute")({
  server: {
    handlers: {
      POST: async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
        const { computeConfidence } = await import("@/lib/confidence.server");
        const { evolveAgentWeights } = await import("@/lib/auto-trading.server");
        const conf = await computeConfidence(sb as any);
        const ev = await evolveAgentWeights(sb as any, 14);
        return Response.json({ ok: true, conf, evolved: ev });
      },
    },
  },
});
