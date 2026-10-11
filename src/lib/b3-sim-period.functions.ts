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

// Faixa fixa do cockpit vivo: hoje + os quatro pregões anteriores com
// movimento. É uma leitura separada para não alterar nenhuma conta do motor.
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
    const startUtc = `${addDays(today, -21)}T03:00:00.000Z`;
    const endUtc = `${addDays(today, 1)}T03:00:00.000Z`;

    const { data: runs } = await (supabase as any)
      .from("b3_simulation_runs")
      .select("id, symbol, variant")
      .eq("user_id", userId);
    const runById = new Map<string, { root: string; variant: string }>();
    for (const run of (runs ?? []) as any[]) {
      runById.set(String(run.id), {
        root: rootSymbol(String(run.symbol)),
        variant: String(run.variant ?? "indicador"),
      });
    }

    const limit = 60_000;
    const rows: any[] = [];
    let rowsTruncated = false;
    for (let from = 0; from < limit; from += 1000) {
      const pageSize = Math.min(1000, limit - from);
      const { data: page, error } = await (supabase as any)
      .from("b3_simulation_orders")
      .select("simulation_run_id, mode, net_result_brl, exit_time, freios_na_sombra")
      .eq("user_id", userId)
      .eq("status", "closed")
      .gte("exit_time", startUtc)
      .lt("exit_time", endUtc)
      .order("exit_time", { ascending: false })
      .range(from, from + pageSize - 1);
      if (error) throw new Error(`Leitura dos pregões: ${error.message}`);
      rows.push(...(page ?? []));
      if (rows.length >= limit) { rowsTruncated = true; break; }
      if (!page || page.length < pageSize) break;
    }

    const allDates = new Set<string>([today]);
    for (const row of (rows ?? []) as any[]) {
      if (row.exit_time) allDates.add(brtDate(new Date(row.exit_time)));
    }
    // Hoje + os últimos 5 pregões com movimento: o card de hoje fica visível
    // (ainda em andamento) e o total soma somente os 5 anteriores, já fechados.
    const dates = Array.from(allDates).filter((date) => date <= today).sort().reverse().slice(0, 6);
    // Em implantação nova pode ainda não haver datas gravadas. Mantém a faixa
    // estável com dias úteis anteriores, sempre explicitamente zerados.
    let cursor = today;
    while (dates.length < 6) {
      cursor = addDays(cursor, -1);
      const weekday = new Date(`${cursor}T12:00:00.000Z`).getUTCDay();
      if (weekday !== 0 && weekday !== 6 && !dates.includes(cursor)) dates.push(cursor);
    }
    dates.sort().reverse();
    const chosen = new Set(dates);
    const symbols = data.symbols?.length ? new Set(data.symbols.map((symbol) => rootSymbol(symbol))) : null;
    const variants = data.variants?.length ? new Set(data.variants) : null;
    const modes = data.modes?.length ? new Set(data.modes) : null;
    type Pair = { com_freio_brl: number; sem_freio_brl: number };
    const blank = (): Pair => ({ com_freio_brl: 0, sem_freio_brl: 0 });
    const assets = new Map<string, { days: Map<string, Pair>; variants: Map<string, Map<string, Pair>> }>();
    const ensureAsset = (root: string) => {
      const current = assets.get(root);
      if (current) return current;
      const created = { days: new Map<string, Pair>(), variants: new Map<string, Map<string, Pair>>() };
      assets.set(root, created);
      return created;
    };
    // Semeia os ativos e modalidades visíveis para que dias sem operação sejam
    // mostrados como R$ 0,00 em vez de desaparecerem da faixa.
    for (const run of runById.values()) {
      if (symbols && !symbols.has(run.root)) continue;
      if (variants && !variants.has(run.variant)) continue;
      const asset = ensureAsset(run.root);
      if (!asset.variants.has(run.variant)) asset.variants.set(run.variant, new Map<string, Pair>());
    }
    const add = (map: Map<string, Pair>, date: string, value: number, comFreio: boolean) => {
      const pair = map.get(date) ?? blank();
      pair.sem_freio_brl += value;
      if (comFreio) pair.com_freio_brl += value;
      map.set(date, pair);
    };

    for (const row of (rows ?? []) as any[]) {
      const run = runById.get(String(row.simulation_run_id));
      if (!run || !row.exit_time) continue;
      const date = brtDate(new Date(row.exit_time));
      if (!chosen.has(date)) continue;
      if (symbols && !symbols.has(run.root)) continue;
      if (variants && !variants.has(run.variant)) continue;
      if (modes && !modes.has(String(row.mode ?? ""))) continue;
      const value = Number(row.net_result_brl ?? 0);
      const comFreio = !Array.isArray(row.freios_na_sombra) || row.freios_na_sombra.length === 0;
      const asset = ensureAsset(run.root);
      add(asset.days, date, value, comFreio);
      const variantDays = asset.variants.get(run.variant) ?? new Map<string, Pair>();
      add(variantDays, date, value, comFreio);
      asset.variants.set(run.variant, variantDays);
    }

    const shapedDays = (map: Map<string, Pair>) => dates.map((date) => ({ date, ...(map.get(date) ?? blank()) }));
    return {
      dates,
      rows_limit: limit,
      rows_read: rows.length,
      rows_truncated: rowsTruncated,
      by_asset: Array.from(assets.entries()).map(([symbol, value]) => ({
        symbol,
        days: shapedDays(value.days),
        by_variant: Array.from(value.variants.entries()).map(([variant, variantDays]) => ({
          variant,
          days: shapedDays(variantDays),
        })),
      })),
    };
  });
