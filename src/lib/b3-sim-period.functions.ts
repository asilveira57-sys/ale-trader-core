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
import { addDays, brtDate, periodRowLimit, resolvePeriod } from "@/lib/b3-period";
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

    const rows: any[] = [];
    let rowsTruncated = false;
    for (let from = 0; from < limit; from += 1000) {
      const pageSize = Math.min(1000, limit - from);
      const { data: page, error } = await (supabase as any)
      .from("b3_simulation_orders")
      .select("simulation_run_id, mode, side, quantity, net_result_brl, entry_time, exit_time, close_reason, bloqueado_na_sombra, freios_na_sombra")
      .eq("user_id", userId)
      .eq("status", "closed")
      .gte("exit_time", period.start_utc)
      .lt("exit_time", period.end_utc)
      .order("exit_time", { ascending: true })
      .range(from, from + pageSize - 1);
      if (error) throw new Error(`Leitura do período: ${error.message}`);
      rows.push(...(page ?? []));
      if (rows.length >= limit) { rowsTruncated = true; break; }
      if (!page || page.length < pageSize) break;
    }

    const symbols = data?.symbols?.length ? new Set(data.symbols.map((s) => rootSymbol(s))) : null;
    const variants = data?.variants?.length ? new Set(data.variants) : null;
    const modes = data?.modes?.length ? new Set(data.modes) : null;

    type Agg = {
      key: string; symbol: string; variant: string; mode: string;
      resultado_brl: number; ops: number; ganhos: number; perdas: number; sombra_brl: number; sombra_ops: number;
    };
    // "Com freio" = só ordens abertas com freios_na_sombra vazio (mesma regra
    // do dia). "Sem freio" = todas as fechadas do período.
    const agregar = (soComFreio: boolean) => {
      const byRobot = new Map<string, Agg>();
      const byDay = new Map<string, { date: string; realized_brl: number; trades: number; wins: number; losses: number; sem_preco: number }>();
      let total = 0, ops = 0, lucro = 0, prejuizo = 0;
      for (const o of (rows ?? []) as any[]) {
        const run = runById.get(String(o.simulation_run_id));
        if (!run) continue;
        const mode = String(o.mode ?? "");
        if (symbols && !symbols.has(run.root)) continue;
        if (variants && !variants.has(run.variant)) continue;
        if (modes && !modes.has(mode)) continue;
        const comFreio = !Array.isArray(o.freios_na_sombra) || o.freios_na_sombra.length === 0;
        if (soComFreio && !comFreio) continue;
        const brl = o.net_result_brl == null ? null : Number(o.net_result_brl);
        const day = brtDate(new Date(o.exit_time));
        const d = byDay.get(day) ?? { date: day, realized_brl: 0, trades: 0, wins: 0, losses: 0, sem_preco: 0 };
        d.trades += 1;
        if (brl == null) d.sem_preco += 1;
        else { d.realized_brl += brl; if (brl > 0) d.wins += 1; else if (brl < 0) d.losses += 1; }
        byDay.set(day, d);
        const key = `${run.root}|${run.variant}|${mode}`;
        const a = byRobot.get(key) ?? { key, symbol: run.root, variant: run.variant, mode, resultado_brl: 0, ops: 0, ganhos: 0, perdas: 0, sombra_brl: 0, sombra_ops: 0 };
        a.ops += 1;
        if (brl != null) {
          a.resultado_brl += brl;
          if (brl > 0) { a.ganhos += 1; lucro += brl; } else if (brl < 0) { a.perdas += 1; prejuizo += brl; }
          total += brl;
          if (o.bloqueado_na_sombra !== true) a.sombra_brl += brl;
        }
        if (o.bloqueado_na_sombra === true) a.sombra_ops += 1;
        byRobot.set(key, a);
        ops += 1;
      }
      const robots = Array.from(byRobot.values()).sort((a, b) => a.resultado_brl - b.resultado_brl);
      const toBest = (r: Agg | undefined) => r ? { symbol: r.symbol, variant: r.variant, mode: r.mode, brl: Math.round(r.resultado_brl * 100) / 100 } : null;
      return {
        total_brl: total, ops,
        ganhos: robots.reduce((s, r) => s + r.ganhos, 0),
        perdas: robots.reduce((s, r) => s + r.perdas, 0),
        lucro_bruto_brl: lucro, prejuizo_bruto_brl: prejuizo,
        melhor_robo: toBest(robots[robots.length - 1]),
        pior_robo: toBest(robots[0]),
        by_day: Array.from(byDay.values()).sort((a, b) => (a.date < b.date ? 1 : -1)),
        robots,
      };
    };
    const sem = agregar(false);
    const com = agregar(true);

    return {
      server_time: now.toISOString(),
      period: {
        preset: period.preset, start: period.start, end: period.end, days: period.days,
        single_day: period.single_day, includes_today: period.includes_today,
        label: period.label, historical: !period.includes_today,
      },
      rows_limit: limit,
      rows_read: rows.length,
      rows_truncated: rowsTruncated,
      no_movement: sem.ops === 0,
      ...sem,
      com_freio: com,
      sem_freio: sem,
    };
  });

// Faixa fixa do cockpit vivo: hoje + as 5 datas anteriores com movimento.
// Desde 18/10/2026 lê a função b3_cockpit_cinco_pregoes, que já devolve as
// linhas somadas por dia × raiz × modalidade (mesma semântica: 21 dias,
// status closed, semeadura de dia zerado, "com freio" = freios_na_sombra
// vazio). O nível do ativo é a soma das modalidades dele.
export const getB3CockpitFiveSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      symbols: z.array(z.string()).nullish(),
      variants: z.array(z.string()).nullish(),
      modes: z.array(z.string()).nullish(),
    }).partial().parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const today = brtDate(new Date());
    const { data: linhas, error } = await (supabase as any).rpc("b3_cockpit_cinco_pregoes", {
      p_user_id: userId,
      p_symbols: data.symbols?.length ? data.symbols.map((s) => rootSymbol(s)) : null,
      p_variants: data.variants?.length ? data.variants : null,
      p_modes: data.modes?.length ? data.modes : null,
    });
    if (error) throw new Error(`Leitura dos pregões: ${error.message}`);
    const rows = (linhas ?? []) as any[];
    const dateSet = new Set<string>([today]);
    for (const r of rows) dateSet.add(String(r.trade_date).slice(0, 10));
    const dates = Array.from(dateSet).filter((d) => d <= today).sort().reverse().slice(0, 6);
    let cursor = today;
    while (dates.length < 6) {
      cursor = addDays(cursor, -1);
      const weekday = new Date(`${cursor}T12:00:00.000Z`).getUTCDay();
      if (weekday !== 0 && weekday !== 6 && !dates.includes(cursor)) dates.push(cursor);
    }
    dates.sort().reverse();
    // Only activation evidence is read from orders. RPC amounts stay untouched.
    const { data: countRuns, error: runsError } = await supabase.from("b3_simulation_runs")
      .select("id,symbol,variant").eq("user_id", userId);
    if (runsError) throw new Error("Não foi possível ler os grupos do freio");
    const runIndex = new Map((countRuns ?? []).map((r) => [r.id, { root: rootSymbol(r.symbol), variant: r.variant ?? "indicador" }]));
    const counts = new Map<string, number>();
    const wantedDates = new Set(dates);
    const oldest = dates[dates.length - 1];
    let countsTruncated = false;
    if (oldest) for (let from = 0; from < 60_000; from += 1000) {
      let query = supabase.from("b3_simulation_orders")
        .select("simulation_run_id,mode,exit_time").eq("user_id", userId).eq("status", "closed")
        .eq("bloqueado_na_sombra", true).gte("exit_time", `${oldest}T03:00:00.000Z`)
        .lt("exit_time", `${addDays(today, 1)}T03:00:00.000Z`).order("exit_time").order("id");
      if (data.modes?.length) query = query.in("mode", data.modes);
      const { data: page, error: countError } = await query.range(from, from + 999);
      if (countError) throw new Error("Não foi possível contar as ordens com freio");
      for (const o of page ?? []) {
        const run = runIndex.get(o.simulation_run_id);
        if (!run || !o.exit_time) continue;
        const date = brtDate(new Date(o.exit_time));
        if (!wantedDates.has(date)) continue;
        const key = `${run.root}|${run.variant}|${date}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (!page || page.length < 1000) break;
      if (from + 1000 >= 60_000) countsTruncated = true;
    }
    type Pair = { com_freio_brl: number; sem_freio_brl: number; ordens: number; barrados: number | null };
    const blank = (): Pair => ({ com_freio_brl: 0, sem_freio_brl: 0, ordens: 0, barrados: countsTruncated ? null : 0 });
    const assets = new Map<string, { days: Map<string, Pair>; variants: Map<string, Map<string, Pair>> }>();
    const add = (map: Map<string, Pair>, date: string, com: number, sem: number, n: number, blocked: number) => {
      const p = map.get(date) ?? blank();
      p.com_freio_brl += com; p.sem_freio_brl += sem; p.ordens += n;
      if (p.barrados != null) p.barrados += blocked;
      map.set(date, p);
    };
    let ordens = 0;
    for (const r of rows) {
      const root = String(r.raiz); const variant = String(r.variant ?? "indicador");
      const date = String(r.trade_date).slice(0, 10);
      const a = assets.get(root) ?? { days: new Map(), variants: new Map() };
      assets.set(root, a);
      const v = a.variants.get(variant) ?? new Map<string, Pair>();
      a.variants.set(variant, v);
      const com = Number(r.com_freio_brl ?? 0), sem = Number(r.sem_freio_brl ?? 0);
      ordens += Number(r.ordens ?? 0);
      const blocked = counts.get(`${root}|${variant}|${date}`) ?? 0;
      add(a.days, date, com, sem, Number(r.ordens ?? 0), blocked);
      add(v, date, com, sem, Number(r.ordens ?? 0), blocked);
    }
    const shapedDays = (map: Map<string, Pair>) => dates.map((date) => ({ date, ...(map.get(date) ?? blank()) }));
    return {
      dates,
      rows_limit: 0,
      rows_read: ordens,
      rows_truncated: false,
      counts_truncated: countsTruncated,
      by_asset: Array.from(assets.entries()).map(([symbol, value]) => ({
        symbol,
        days: shapedDays(value.days),
        by_variant: Array.from(value.variants.entries()).map(([variant, variantDays]) => ({ variant, days: shapedDays(variantDays) })),
      })),
    };
  });
