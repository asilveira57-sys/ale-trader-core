// Cron público: tick automático da Simulação B3 durante o pregão.
// Chamado por pg_cron. CADÊNCIA REAL MEDIDA EM PRODUÇÃO (02/09/2026): ~45 s.
// A gestão de POSIÇÃO ABERTA não depende mais só deste caminho:
// /api/public/hooks/b3-guardiao-saida confere stop/alvo/trailing em cadência
// própria e mais curta.
// A janela operacional é validada ANTES de qualquer acesso ao banco — fora dela
// retorna b3_sleeping sem I/O algum.
//
// TRAVA POR ARRENDAMENTO (04/09/2026)
// Em produção o tique ficou preso duas vezes (09:20→10:13 e 10:29→11:15+): o
// guardião respondia 200 a cada 20 s, mas toda chamada do tique voltava 202
// ("tick_em_execucao"). Diagnóstico: `running = false` vive num `finally`, e o
// `finally` NÃO roda quando a execução do worker é interrompida no meio (limite
// de tempo/CPU, isolate descartado, promessa abandonada depois do timeout de
// 5.000 ms do pg_net). A partir daí a variável em memória fica `true` para
// sempre e só publicar (reiniciar o processo) destrava.
//
// Correção: a trava deixa de ser booleana e passa a ser um ARRENDAMENTO com
// carimbo de tempo. Se a passada anterior começou há mais que LEASE_MS, esta
// assume o lugar dela e registra `b3_tick_lease_expirado`. Nenhuma passada
// travada bloqueia o motor por mais que esse prazo, mesmo sem `finally`.
//
// Além disso: teto de tempo para a passada inteira e para cada execução, e
// registro de duração SEMPRE — inclusive quando a passada falha ou estoura.
import { createFileRoute } from "@tanstack/react-router";
import { runB3SimulationTick } from "@/lib/b3-simulation.functions";
import { b3WindowState } from "@/lib/b3-window.server";

/** Início da passada em curso (0 = livre). */
let runningSince = 0;
/** O que a passada em curso estava processando — usado no log de estouro. */
let emVoo: string[] = [];
let passadaSeq = 0;

/** Prazo do arrendamento: acima disso a passada é considerada perdida. */
const LEASE_MS = 90_000;
/** Teto de tempo da passada inteira. */
const DEADLINE_MS = 40_000;
/** Teto de tempo de uma execução (run) individual. */
const RUN_DEADLINE_MS = 15_000;

class TempoEsgotado extends Error {}

function comPrazo<T>(p: Promise<T>, ms: number, rotulo: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TempoEsgotado(`${rotulo} estourou ${ms} ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

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

        const agora = Date.now();
        const leaseMs = Math.min(
          Math.max(10_000, Number(url.searchParams.get("lease_ms") ?? LEASE_MS)),
          300_000,
        );
        let leaseExpirado: { idade_ms: number; em_voo: string[] } | null = null;
        if (runningSince) {
          const idade = agora - runningSince;
          if (idade < leaseMs) {
            return Response.json(
              { skipped: true, reason: "tick_em_execucao", idade_ms: idade, em_voo: emVoo },
              { status: 202 },
            );
          }
          // Arrendamento vencido: a passada anterior não terminou e nunca vai.
          leaseExpirado = { idade_ms: idade, em_voo: [...emVoo] };
        }

        const passada = ++passadaSeq;
        runningSince = agora;
        emVoo = [];
        const inicio = Date.now();

        const results: any[] = [];
        const summary: any[] = [];
        let staleIds: string[] = [];
        let limite = 12;
        let erroFatal: string | null = null;
        let estourou = false;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const registrar = async (evento: string, severidade: string, mensagem: string, dados: any) => {
          try {
            await (supabaseAdmin as any).from("system_logs").insert({
              event_type: evento,
              source: "b3-simulation-tick",
              severity: severidade,
              message: mensagem,
              technical_data: dados,
            });
          } catch { /* log nunca deve derrubar o cron */ }
        };

        if (leaseExpirado) {
          await registrar(
            "b3_tick_lease_expirado",
            "critical",
            `Passada anterior do tique não terminou (${Math.round(leaseExpirado.idade_ms / 1000)} s sem concluir). Arrendamento vencido e assumido por uma nova passada.`,
            { ...leaseExpirado, lease_ms: leaseMs, passada },
          );
        }

        const corpo = async () => {
          // todas as runs ativas (todos os usuários)
          const { data: runs, error } = await (supabaseAdmin as any)
            .from("b3_simulation_runs")
            .select("id, user_id, status, started_at, symbol, variant")
            .eq("status", "running")
            .order("started_at", { ascending: false });
          if (error) throw new Error(`leitura de execuções ativas: ${error.message}`);

          // Só 1 run ativa por usuário POR ATIVO E VARIANTE (chave = user_id +
          // symbol + variant), para que o mesmo ativo possa rodar com
          // entry_styles distintos em paralelo sem se cancelarem.
          const latestByUserAsset = new Map<string, any>();
          const stale: string[] = [];
          for (const r of runs ?? []) {
            const key = `${r.user_id}:${r.symbol ?? "WINQ26"}:${r.variant ?? "indicador"}`;
            if (!latestByUserAsset.has(key)) latestByUserAsset.set(key, r);
            else stale.push(r.id);
          }
          if (stale.length) {
            await (supabaseAdmin as any)
              .from("b3_simulation_runs")
              .update({ status: "cancelled" })
              .in("id", stale);
          }
          staleIds = stale;

          // PARALELIZAÇÃO DO LAÇO DO TIQUE (26/08/2026)
          // A unidade paralelizada é a EXECUÇÃO (já deduplicada acima) e cada
          // execução aparece uma única vez na fila, então a gestão de posição de
          // cada robô segue com uma única passagem por tique.
          const fila = Array.from(latestByUserAsset.values());
          limite = Math.min(
            Math.max(1, Number(url.searchParams.get("concurrency") ?? 12)),
            16,
          );

          const processar = async (r: any) => {
            const rotulo = `${r.symbol ?? "?"}/${r.variant ?? "?"}#${r.id}`;
            emVoo.push(rotulo);
            const t0 = Date.now();
            try {
              const res = await comPrazo(
                runB3SimulationTick(supabaseAdmin, r.user_id, r.id, ticks),
                RUN_DEADLINE_MS,
                `execução ${rotulo}`,
              );
              results.push({ run_id: r.id, ...res });
              summary.push({ run_id: r.id, symbol: r.symbol ?? null, variant: r.variant ?? null, ok: true, elapsed_ms: Date.now() - t0 });
            } catch (e) {
              const elapsed = Date.now() - t0;
              const timeout = e instanceof TempoEsgotado;
              results.push({ run_id: r.id, error: (e as Error).message, timeout });
              summary.push({ run_id: r.id, symbol: r.symbol ?? null, variant: r.variant ?? null, ok: false, timeout, elapsed_ms: elapsed });
              await registrar(
                timeout ? "b3_run_timeout" : "b3_run_error",
                "error",
                (e as Error).message,
                {
                  run_id: r.id,
                  symbol: r.symbol ?? null,
                  variant: r.variant ?? null,
                  elapsed_ms: elapsed,
                  stack: String((e as Error).stack ?? "").slice(0, 2000),
                },
              );
            } finally {
              emVoo = emVoo.filter((x) => x !== rotulo);
            }
          };

          let proximo = 0;
          const trabalhadores = Array.from({ length: Math.min(limite, fila.length) }, async () => {
            // Cada trabalhador puxa o próximo índice da fila. Um índice nunca é
            // entregue duas vezes porque o incremento é síncrono.
            for (;;) {
              const i = proximo++;
              if (i >= fila.length) return;
              await processar(fila[i]);
            }
          });
          await Promise.all(trabalhadores);
        };

        let emVooNoEstouro: string[] = [];
        try {
          await comPrazo(corpo(), DEADLINE_MS, "passada do tique");
        } catch (e) {
          estourou = e instanceof TempoEsgotado;
          erroFatal = (e as Error).message;
          emVooNoEstouro = [...emVoo];
        } finally {
          // Liberação otimista. A segurança real é o arrendamento acima: se este
          // ponto nunca for alcançado, a próxima passada assume depois de
          // LEASE_MS em vez de o motor ficar preso até a publicação.
          runningSince = 0;
          emVoo = [];
        }

        const janela_ms = Date.now() - inicio;

        // Resumo SEMPRE, inclusive quando a passada falhou ou estourou — antes
        // só existia registro no caminho de sucesso, que é justamente quando o
        // registro não é necessário.
        await registrar(
          erroFatal ? "b3_tick_falha" : "b3_tick_summary",
          erroFatal ? (estourou ? "critical" : "error") : "info",
          erroFatal
            ? `Passada do tique ${estourou ? "estourou o teto de tempo" : "falhou"} em ${janela_ms} ms: ${erroFatal}`
            : `Tick processou ${summary.length} run(s) em ${janela_ms} ms (concorrência ${limite})`,
          {
            passada,
            runs: summary,
            stale_runs_stopped: staleIds.length,
            janela_ms,
            concorrencia: limite,
            ...(erroFatal ? { erro: erroFatal, estourou, em_voo_no_estouro: emVooNoEstouro } : {}),
            deadline_ms: DEADLINE_MS,
            run_deadline_ms: RUN_DEADLINE_MS,
            lease_ms: leaseMs,
          },
        );

        if (erroFatal) {
          return Response.json(
            { ok: false, error: erroFatal, timeout: estourou, janela_ms, runs: results.length, results },
            { status: estourou ? 504 : 500 },
          );
        }

        return Response.json({
          ok: true,
          runs: results.length,
          stale_runs_stopped: staleIds.length,
          janela_ms,
          concorrencia: limite,
          lease_takeover: leaseExpirado ?? undefined,
          at: new Date().toISOString(),
          results,
        });
      },
    },
  },
});
