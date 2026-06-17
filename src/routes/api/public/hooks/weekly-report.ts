import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/weekly-report")({
  server: {
    handlers: {
      POST: async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
        const start = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
        const { generateWeeklyReport } = await import("@/lib/reports.server");
        const r = await generateWeeklyReport(sb as any, start);
        return Response.json({ ok: true, id: r?.id });
      },
    },
  },
});
