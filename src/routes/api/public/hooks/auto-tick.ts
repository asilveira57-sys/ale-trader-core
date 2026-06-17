import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/auto-tick")({
  server: {
    handlers: {
      POST: async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
        const { data: sessions } = await sb.from("trading_sessions").select("id, mode").eq("status", "active");
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
