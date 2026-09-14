// Leitura HISTÓRICA do simulado por período (Cockpit simulado).
//
// Só leitura: nada aqui participa do motor, do comitê, dos classificadores,
// dos freios ou do espelhamento real. Serve para responder "quanto rendeu o
// robô X entre as datas Y e Z" sem sair para o SQL.
//
// Fonte: b3_simulation_orders (status='closed') na janela BRT do período; a
// modalidade vem da execução (b3_simulation_runs.variant), porque a ordem não
// guarda variante própria.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { brtDate, periodRowLimit, resolvePeriod } from "@/lib/b3-period";
import { rootSymbol } from "@/lib/b3-format";

export const getB3SimPeriodSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      preset: z.string().nullish(),
      start: z.string().nullish(),
      end: z.string().nullish(),
      symbols: z.array(z.string()).nullish(),
      variants: z.array(z.string()).nullish(),
      modes: z.array(z.string()).nullish(),
    }).partial().parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const period = resolvePeriod(data, now);
    // O simulado tem muito mais linhas que o real: teto proporcional ao período,
    // e aviso na tela se ele for atingido — número truncado nunca pode parecer
    // completo.
    const limit = periodRowLimit(period.days, 3000, 4000, 60_000);

    const { data: runs } = await (supabase as any)
      .from("b3_simulation_runs")
      .select("id, symbol, variant")
      .eq("user_id", userId);
    const runById = new Map<string, { root: string; variant: string }>();
    for (const r of (runs ?? []) as any[]) {
      runById.set(String(r.id), {
        root: rootSymbol(String(r.symbol)),
        variant: String(r.variant ?? "indicador"),
      });
    }

    const { data: rows } = await (supabase as any)
      .from("b3_simulation_orders")
      .select("simulation_run_id, mode, side, quantity, net_result_brl, entry_time, exit_time, close_reason, bloqueado_na_sombra")
      .eq("user_id", userId)
      .eq("status", "closed")
      .gte("exit_time", period.start_utc)
      .lt("exit_time", period.end_utc)
      .order("exit_time", { ascending: true })
      .limit(limit);

    const symbols = data?.symbols?.length ? new Set(data.symbols.map((s) => rootSymbol(s))) : null;
    const variants = data?.variants?.length ? new Set(data.variants) : null;
    const modes = data?.modes?.length ? new Set(data.modes) : null;

    type Agg = {
      key: string; symbol: string; variant: string; mode: string;
      resultado_brl: number; ops: number; ganhos: number; perdas: number; sombra_brl: number; sombra_ops: number;
    };
    const byRobot = new Map<string, Agg>();
    const byDay = new Map<string, { date: string; realized_brl: number; trades: number; wins: number; losses: number; sem_preco: number }>();
    let total = 0;
    let ops = 0;

    for (const o of (rows ?? []) as any[]) {
      const run = runById.get(String(o.simulation_run_id));
      if (!run) continue;
      const mode = String(o.mode ?? "");
      if (symbols && !symbols.has(run.root)) continue;
      if (variants && !variants.has(run.variant)) continue;
      if (modes && !modes.has(mode)) continue;

      const brl = o.net_result_brl == null ? null : Number(o.net_result_brl);
      const day = brtDate(new Date(o.exit_time));
      const d = byDay.get(day) ?? { date: day, realized_brl: 0, trades: 0, wins: 0, losses: 0, sem_preco: 0 };
      d.trades += 1;
      if (brl == null) d.sem_preco += 1;
      else {
        d.realized_brl += brl;
        if (brl > 0) d.wins += 1; else if (brl < 0) d.losses += 1;
      }
      byDay.set(day, d);

      const key = `${run.root}|${run.variant}|${mode}`;
      const a = byRobot.get(key) ?? {
        key, symbol: run.root, variant: run.variant, mode,
        resultado_brl: 0, ops: 0, ganhos: 0, perdas: 0, sombra_brl: 0, sombra_ops: 0,
      };
      a.ops += 1;
      if (brl != null) {
        a.resultado_brl += brl;
        if (brl > 0) a.ganhos += 1; else if (brl < 0) a.perdas += 1;
        total += brl;
        // Resultado SOMBRA: o que existiria se o freio de grupo tivesse barrado
        // a entrada marcada como sombra. Financeiro total fica separado.
        if (o.bloqueado_na_sombra !== true) a.sombra_brl += brl;
      }
      if (o.bloqueado_na_sombra === true) a.sombra_ops += 1;
      byRobot.set(key, a);
      ops += 1;
    }

    const robots = Array.from(byRobot.values()).sort((a, b) => a.resultado_brl - b.resultado_brl);
    const dias = Array.from(byDay.values()).sort((a, b) => (a.date < b.date ? 1 : -1));

    return {
      server_time: now.toISOString(),
      period: {
        preset: period.preset, start: period.start, end: period.end, days: period.days,
        single_day: period.single_day, includes_today: period.includes_today,
        label: period.label, historical: !period.includes_today,
      },
      rows_limit: limit,
      rows_truncated: (rows ?? []).length >= limit,
      no_movement: ops === 0,
      total_brl: total,
      ops,
      ganhos: robots.reduce((s, r) => s + r.ganhos, 0),
      perdas: robots.reduce((s, r) => s + r.perdas, 0),
      by_day: dias,
      robots,
    };
  });
