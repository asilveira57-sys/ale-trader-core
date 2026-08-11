// Cron público: tick automático da Simulação B3 durante o pregão.
// Chamado por pg_cron a cada minuto. A janela operacional é validada ANTES de
// qualquer acesso ao banco — fora dela retorna b3_sleeping sem I/O algum.
import { createFileRoute } from "@tanstack/react-router";
import { runB3SimulationTick } from "@/lib/b3-simulation.functions";
import { b3WindowState } from "@/lib/b3-window.server";

let running = false;

export const Route = createFileRoute("/api/public/hooks/b3-simulation-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "1";
        const ticks = Math.min(Math.max(1, Number(url.searchParams.get("ticks") ?? 1)), 5);

        // Validação de horário ANTES de tocar no banco.
        const win = b3WindowState();
        if (!force && !win.open) {
          return Response.json({
            skipped: true,
            reason: "b3_sleeping",
            window_reason: win.reason,
            brt_time: win.brt_time,
            window: win.window,
          });
        }

        if (running) {
          return Response.json({ skipped: true, reason: "tick_em_execucao" }, { status: 202 });
        }
        running = true;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // todas as runs ativas (todos os usuários)
          const { data: runs, error } = await (supabaseAdmin as any)
            .from("b3_simulation_runs")
            .select("id, user_id, status, started_at, symbol, variant")
            .eq("status", "running")
            .order("started_at", { ascending: false });
          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }

          // Só 1 run ativa por usuário POR ATIVO (chave = user_id + symbol).
          // Antes era só por user_id, o que parava automaticamente qualquer
          // segunda run — impedindo rodar WIN e WDO ao mesmo tempo de
          // propósito. Continua protegendo contra o problema original (runs
          // órfãs esquecidas do MESMO ativo), mas agora deixa ativos
          // diferentes coexistirem.
          const latestByUserAsset = new Map<string, any>();
          const staleIds: string[] = [];
          for (const r of runs ?? []) {
            const key = `${r.user_id}:${r.symbol ?? "WINQ26"}`;
            if (!latestByUserAsset.has(key)) latestByUserAsset.set(key, r);
            else staleIds.push(r.id);
          }
          if (staleIds.length) {
            await (supabaseAdmin as any)
              .from("b3_simulation_runs")
              .update({ status: "cancelled" })
              .in("id", staleIds);
          }

          const results: any[] = [];
          for (const r of latestByUserAsset.values()) {
            try {
              const res = await runB3SimulationTick(supabaseAdmin, r.user_id, r.id, ticks);
              results.push({ run_id: r.id, ...res });
            } catch (e) {
              results.push({ run_id: r.id, error: (e as Error).message });
            }
          }
          return Response.json({
            ok: true,
            runs: results.length,
            stale_runs_stopped: staleIds.length,
            at: new Date().toISOString(),
            results,
          });
        } finally {
          running = false;
        }
      },
    },
  },
});
