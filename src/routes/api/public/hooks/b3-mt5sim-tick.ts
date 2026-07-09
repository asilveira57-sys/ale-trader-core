// Cron público: tick da Simulação Local MT5 XP. Uma execução por minuto.
// Para cada run ativa, roda um tick do motor de simulação.
import { createFileRoute } from "@tanstack/react-router";
import { runMt5SimTick } from "@/lib/b3-mt5sim.server";

export const Route = createFileRoute("/api/public/hooks/b3-mt5sim-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "1";
        const { data: runs, error } = await (supabaseAdmin as any).from("b3_mt5sim_runs").select("id, user_id").eq("status", "running");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        const results: any[] = [];
        for (const r of (runs as any[]) ?? []) {
          try {
            const { data: settings } = await (supabaseAdmin as any).from("b3_mt5sim_settings").select("engine").eq("user_id", r.user_id).maybeSingle();
            const engine = settings?.engine ?? "legacy_b3";
            if (engine === "legacy_b3") {
              const { runLegacyMt5Tick } = await import("@/lib/b3-legacy-mt5-adapter.server");
              const res = await runLegacyMt5Tick(supabaseAdmin as any, r.user_id, { force });
              results.push({ run_id: r.id, engine, ...res });
            } else {
              const res = await runMt5SimTick(supabaseAdmin as any, r.user_id, { force });
              results.push({ run_id: r.id, engine, ...res });
            }
          } catch (e) {
            results.push({ run_id: r.id, error: (e as Error).message });
          }
        }
        return Response.json({ ok: true, runs: results.length, at: new Date().toISOString(), results });
      },
    },
  },
});
