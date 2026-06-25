// FASE — Relatório diário e diagnóstico de stops B3
// Métricas por período (hoje / acumulado / personalizado) + eventos de bloqueio
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Mode = "conservador" | "moderado" | "equilibrado" | "semi_agressivo" | "agressivo";
const MODES: Mode[] = ["conservador", "moderado", "equilibrado", "semi_agressivo", "agressivo"];

function startOfTodayBrtISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  // 00:00 BRT (UTC-3) = 03:00 UTC
  return `${parts}T03:00:00.000Z`;
}

interface ReportInput {
  run_id: string;
  period: "today" | "all" | "custom";
  from?: string; // ISO
  to?: string;   // ISO
}

export const getB3SimulationReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: ReportInput) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run, error: rErr } = await (supabase as any).from("b3_simulation_runs")
      .select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (rErr) throw rErr;
    if (!run) throw new Error("Run não encontrada");

    let fromISO: string | null = null;
    let toISO: string | null = null;
    if (data.period === "today") { fromISO = startOfTodayBrtISO(); }
    else if (data.period === "custom") { fromISO = data.from ?? null; toISO = data.to ?? null; }

    const { data: modes } = await (supabase as any).from("b3_simulation_modes")
      .select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId);

    // Ordens fechadas no período
    let q = (supabase as any).from("b3_simulation_orders")
      .select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId).eq("status", "closed");
    if (fromISO) q = q.gte("exit_time", fromISO);
    if (toISO) q = q.lte("exit_time", toISO);
    const { data: orders } = await q.order("exit_time", { ascending: true }).limit(10000);

    // Votos do comitê no período (aprovados/rejeitados a partir dos snapshots)
    let qv = (supabase as any).from("b3_simulation_agent_votes")
      .select("created_at, mode, market_data_snapshot")
      .eq("simulation_run_id", data.run_id).eq("user_id", userId);
    if (fromISO) qv = qv.gte("created_at", fromISO);
    if (toISO) qv = qv.lte("created_at", toISO);
    const { data: votes } = await qv.limit(20000);

    // Bloqueios no período
    let qb = (supabase as any).from("b3_simulation_block_events")
      .select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId);
    if (fromISO) qb = qb.gte("occurred_at", fromISO);
    if (toISO) qb = qb.lte("occurred_at", toISO);
    const { data: blockEvents } = await qb.order("occurred_at", { ascending: false }).limit(2000);

    // Último evento (de qualquer período) por modo — para o painel "Stops e Bloqueios"
    const { data: lastEventsRaw } = await (supabase as any).from("b3_simulation_block_events")
      .select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId)
      .order("occurred_at", { ascending: false }).limit(200);
    const lastByMode: Record<string, any> = {};
    for (const e of lastEventsRaw ?? []) if (!lastByMode[e.mode]) lastByMode[e.mode] = e;

    // Métricas por modo no período selecionado
    const metricsByMode: Record<string, any> = {};
    for (const mode of MODES) {
      const mRow = (modes ?? []).find((x: any) => x.mode === mode);
      const ordsAll = (orders ?? []).filter((o: any) => o.mode === mode);
      const ords = ordsAll;
      const total = ords.length;
      const wins = ords.filter((o: any) => Number(o.net_result_brl) > 0).length;
      const losses = ords.filter((o: any) => Number(o.net_result_brl) < 0).length;
      const liquido = ords.reduce((s: number, o: any) => s + Number(o.net_result_brl ?? 0), 0);
      const taxas = ords.reduce((s: number, o: any) => s + Number(o.fees ?? 0), 0);
      const pontos = ords.reduce((s: number, o: any) => s + Number(o.gross_result_points ?? 0), 0);
      const maxGain = ords.reduce((m: number, o: any) => Math.max(m, Number(o.net_result_brl ?? 0)), 0);
      const maxLoss = ords.reduce((m: number, o: any) => Math.min(m, Number(o.net_result_brl ?? 0)), 0);

      // saldo inicial do período = current_balance - liquido (estimativa baseada nos fechamentos no período)
      const saldoFinal = Number(mRow?.current_balance ?? Number(mRow?.initial_balance ?? 0));
      const saldoInicialPeriodo = data.period === "all"
        ? Number(mRow?.initial_balance ?? 0)
        : saldoFinal - liquido;

      // Drawdown máximo no período (curva acumulada)
      let acc = 0, peak = 0, dd = 0;
      for (const o of ords) {
        acc += Number(o.net_result_brl ?? 0);
        if (acc > peak) peak = acc;
        const cur = peak - acc;
        if (cur > dd) dd = cur;
      }

      // comitê no período
      let approvals = 0, rejections = 0, riskBlocks = 0;
      for (const v of votes ?? []) {
        if (v.mode !== mode) continue;
        const dec = (v.market_data_snapshot as any)?.decision;
        if (dec === "approved") approvals++;
        else if (dec === "rejected") rejections++;
        else if (dec === "blocked") riskBlocks++;
      }
      // Cada decisão gera N votos (1 por agente). Dividir pela média de agentes (~8)
      const AGENTS = 8;
      approvals = Math.round(approvals / AGENTS);
      rejections = Math.round(rejections / AGENTS);
      riskBlocks = Math.round(riskBlocks / AGENTS);

      const blocksThisPeriod = (blockEvents ?? []).filter((b: any) => b.mode === mode).length;

      metricsByMode[mode] = {
        mode,
        current_status: mRow?.current_status ?? "operando",
        status_reason: mRow?.status_reason ?? null,
        status_changed_at: mRow?.status_changed_at ?? null,
        last_trigger: mRow?.last_trigger ?? null,
        saldo_inicial_periodo: saldoInicialPeriodo,
        saldo_final_periodo: saldoFinal,
        pnl_periodo: liquido,
        taxas,
        pontos_liquidos: pontos,
        trades: total,
        vitorias: wins,
        perdas: losses,
        taxa_acerto: total > 0 ? (wins / total) * 100 : 0,
        maior_ganho: maxGain,
        maior_perda: maxLoss,
        drawdown_maximo: dd,
        comite_aprovou: approvals,
        comite_rejeitou: rejections,
        bloqueios_risco: blocksThisPeriod,
        // legado / cumulativo
        cumulative: {
          initial_balance: Number(mRow?.initial_balance ?? 0),
          current_balance: saldoFinal,
          realized_pnl: Number(mRow?.realized_pnl ?? 0),
          total_trades: Number(mRow?.total_trades ?? 0),
          winning_trades: Number(mRow?.winning_trades ?? 0),
          losing_trades: Number(mRow?.losing_trades ?? 0),
          max_drawdown: Number(mRow?.max_drawdown ?? 0),
          committee_approvals: Number(mRow?.committee_approvals ?? 0),
          committee_rejections: Number(mRow?.committee_rejections ?? 0),
          risk_blocks: Number(mRow?.risk_blocks ?? 0),
        },
        ultimo_evento: lastByMode[mode] ?? null,
      };
    }

    return {
      run,
      period: data.period,
      from: fromISO,
      to: toISO,
      modes: MODES.map((m) => metricsByMode[m]),
      block_events: blockEvents ?? [],
    };
  });

export const listB3BlockEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; limit?: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows } = await (supabase as any).from("b3_simulation_block_events")
      .select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId)
      .order("occurred_at", { ascending: false }).limit(Math.min(2000, data.limit ?? 500));
    return rows ?? [];
  });
