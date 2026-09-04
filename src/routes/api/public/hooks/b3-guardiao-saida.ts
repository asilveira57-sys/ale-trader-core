// Cron público: GUARDIÃO DE SAÍDA — cadência própria, só posições abertas.
//
// Separado de /api/public/hooks/b3-simulation-tick de propósito: aquele carrega
// classificadores, comitê, snapshots e busca de entrada para ~37 execuções
// (~5 s por passada). Este só confere stop/alvo/trailing/zero a zero das
// posições ABERTAS e fecha quem cruzou. Não abre posição, não fecha por
// horário, não toca em parâmetro de robô e não afrouxa a auditoria de Bid/Ask.
//
// A frequência do agendamento é decisão do operador; o endpoint não depende
// dela para estar correto — quanto mais vezes rodar, menor o atraso entre o
// toque do nível e a execução.
import { createFileRoute } from "@tanstack/react-router";
import { runB3GuardiaoSaida } from "@/lib/b3-guardiao-saida.server";
import { b3WindowState } from "@/lib/b3-window.server";

// Trava por ARRENDAMENTO, não booleana: se a passada anterior for interrompida
// no meio (limite de tempo do worker, isolate descartado), o `finally` não roda
// e uma trava booleana ficaria presa até a publicação — foi o que travou o tique
// de entradas em 04/09/2026. Aqui a passada perdida expira em LEASE_MS.
let runningSince = 0;
const LEASE_MS = 60_000;

export const Route = createFileRoute("/api/public/hooks/b3-guardiao-saida")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "1";

        // Fora da janela do pregão não existe posição para gerir — sai antes de
        // qualquer acesso ao banco.
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

        // Passada anterior ainda rodando: não empilha trabalho.
        if (running) {
          return Response.json({ skipped: true, reason: "guardiao_em_execucao" }, { status: 202 });
        }
        running = true;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const res = await runB3GuardiaoSaida(supabaseAdmin);
          return Response.json({ ok: true, at: new Date().toISOString(), ...res });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        } finally {
          running = false;
        }
      },
    },
  },
});
