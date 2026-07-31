// Cron público: tick automático da Simulação B3 durante o pregão.
// Chamado por pg_cron a cada minuto. Itera todas as runs com status='running'
// e executa 1 tick. Janela de pregão validada pelo próprio tick por modo.
import { createFileRoute } from "@tanstack/react-router";
import { runB3SimulationTick } from "@/lib/b3-simulation.functions";

let running = false;

// Pregão B3: 09:00–18:00 BRT (UTC-3) → 12:00–21:00 UTC. Mantemos uma folga.
function insidePregaoUtc(d = new Date()): boolean {
  const hUtc = d.getUTCHours();
  const mUtc = d.getUTCMinutes();
  const cur = hUtc * 60 + mUtc;
  const start = 12 * 60; // 09:00 BRT
  const end = 21 * 60 + 5; // 18:05 BRT (folga p/ zeragem)
  return cur >= start && cur <= end;
}

export const Route = createFileRoute("/api/public/hooks/b3-simulation-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (running) {
          return Response.json({ skipped: true, reason: "tick_em_execucao" }, { status: 202 });
        }
        running = true;
        try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "1";
        const ticks = Math.min(Math.max(1, Number(url.searchParams.get("ticks") ?? 1)), 5);

        if (!force && !insidePregaoUtc()) {
          return Response.json({ skipped: true, reason: "fora_do_pregao", at: new Date().toISOString() });
        }

        // todas as runs ativas (todos os usuários)
        const { data: runs, error } = await (supabaseAdmin as any)
          .from("b3_simulation_runs")
          .select("id, user_id, status, started_at")
          .eq("status", "running")
          .order("started_at", { ascending: false });
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        // Runs antigas podem permanecer com status running após reinícios da tela.
        // Executar somente a mais recente de cada usuário evita multiplicar o mesmo
        // ativo sem apagar histórico nem mudar qualquer regra dos cinco robôs.
        const latestByUser = new Map<string, any>();
        for (const r of runs ?? []) if (!latestByUser.has(r.user_id)) latestByUser.set(r.user_id, r);

        const results: any[] = [];
        for (const r of latestByUser.values()) {
          try {
            const res = await runB3SimulationTick(supabaseAdmin, r.user_id, r.id, ticks);
            results.push({ run_id: r.id, ...res });
          } catch (e) {
            results.push({ run_id: r.id, error: (e as Error).message });
          }
        }
        return Response.json({ ok: true, runs: results.length, stale_runs_skipped: (runs?.length ?? 0) - results.length, at: new Date().toISOString(), results });
        } finally {
          running = false;
        }
      },
    },
  },
});
