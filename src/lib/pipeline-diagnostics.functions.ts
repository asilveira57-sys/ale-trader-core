import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Status = "ok" | "warning" | "fail";

export interface StageReport {
  key: string;
  label: string;
  status: Status;
  count: number;
  last_at: string | null;
  detail: string;
  trigger: string;
}

async function assertOwner(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles").select("role")
    .eq("user_id", userId).eq("role", "owner").maybeSingle();
  if (!data) throw new Error("Forbidden: owner role required");
}

function ageMin(ts: string | null): number | null {
  if (!ts) return null;
  return (Date.now() - new Date(ts).getTime()) / 60000;
}

export const getPipelineDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);

    // Helpers — count + last timestamp per table
    async function snap(table: string, tsCol: string) {
      const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
      const { data } = await supabase.from(table).select(tsCol).order(tsCol, { ascending: false }).limit(1).maybeSingle();
      return { count: count ?? 0, last_at: (data as any)?.[tsCol] ?? null };
    }

    const [
      snapshots, candles, indicators, agents, votes, decisions, reviews, orders, sessions, intel, logs, binance,
    ] = await Promise.all([
      snap("market_snapshots", "captured_at").catch(async () => {
        // fallback if column name differs
        const { count } = await supabase.from("market_snapshots").select("*", { count: "exact", head: true });
        return { count: count ?? 0, last_at: null };
      }),
      snap("candles", "open_time"),
      snap("indicators", "computed_at"),
      (async () => {
        const { count } = await supabase.from("agents").select("*", { count: "exact", head: true }).eq("active", true);
        return { count: count ?? 0, last_at: null };
      })(),
      snap("agent_votes", "voted_at"),
      snap("committee_decisions", "created_at"),
      snap("supervisor_reviews", "created_at"),
      snap("simulated_orders", "created_at"),
      (async () => {
        const { count } = await supabase.from("trading_sessions").select("*", { count: "exact", head: true }).eq("status", "active");
        const { data } = await supabase.from("trading_sessions").select("started_at").eq("status", "active").order("started_at", { ascending: false }).limit(1).maybeSingle();
        return { count: count ?? 0, last_at: data?.started_at ?? null };
      })(),
      snap("intelligence_reports", "created_at"),
      snap("system_logs", "created_at"),
      supabase.from("binance_connection_status").select("*").eq("id", 1).maybeSingle().then((r: any) => r.data),
    ]);

    const stages: StageReport[] = [];

    // 1. Binance
    const binAge = ageMin(binance?.last_check ?? null);
    stages.push({
      key: "binance", label: "Binance (Coleta)",
      status: binance?.connected ? (binAge != null && binAge < 30 ? "ok" : "warning") : "fail",
      count: snapshots.count,
      last_at: binance?.last_check ?? null,
      detail: `Snapshots: ${snapshots.count} · modo ${binance?.account_type ?? "—"} · última verificação ${binAge != null ? binAge.toFixed(0) + " min atrás" : "—"}`,
      trigger: "collectMarket (manual via 'Coletar agora') — sem cron agendado",
    });

    // 2. Indicators
    stages.push({
      key: "indicators", label: "Indicadores",
      status: indicators.count === 0 ? "fail" : (ageMin(indicators.last_at) ?? 9999) < 60 ? "ok" : "warning",
      count: indicators.count,
      last_at: indicators.last_at,
      detail: indicators.count === 0
        ? "Nenhum indicador calculado. A coleta grava market_snapshots mas não calcula RSI/MACD/MAs nem popula candles."
        : `Último cálculo ${ageMin(indicators.last_at)?.toFixed(0)} min atrás.`,
      trigger: "Nenhum job dedicado — buildMockContext em committee.server gera valores em memória",
    });

    // 3. Agents
    stages.push({
      key: "agents", label: "Agentes",
      status: agents.count > 0 ? "ok" : "fail",
      count: agents.count, last_at: null,
      detail: `${agents.count} agentes ativos cadastrados.`,
      trigger: "Executados sob demanda dentro de runCommittee (server fn)",
    });

    // 4. Votes
    stages.push({
      key: "votes", label: "Votos",
      status: votes.count === 0 ? "fail" : (ageMin(votes.last_at) ?? 9999) < 60 ? "ok" : "warning",
      count: votes.count, last_at: votes.last_at,
      detail: votes.count === 0
        ? "Tabela agent_votes vazia — nenhum agente foi executado ainda."
        : `Último voto ${ageMin(votes.last_at)?.toFixed(0)} min atrás.`,
      trigger: "Gravados por runCommittee (somente quando chamada manualmente)",
    });

    // 5. Committee
    stages.push({
      key: "committee", label: "Comitê",
      status: decisions.count === 0 ? "fail" : (ageMin(decisions.last_at) ?? 9999) < 60 ? "ok" : "warning",
      count: decisions.count, last_at: decisions.last_at,
      detail: decisions.count === 0
        ? "Tabela committee_decisions vazia — runCommittee nunca foi disparado."
        : `Última decisão ${ageMin(decisions.last_at)?.toFixed(0)} min atrás.`,
      trigger: "runCommittee server fn — NÃO há cron agendado para executá-la automaticamente",
    });

    // 6. Supervisor
    stages.push({
      key: "supervisor", label: "Supervisor",
      status: reviews.count === 0 ? "fail" : (ageMin(reviews.last_at) ?? 9999) < 60 ? "ok" : "warning",
      count: reviews.count, last_at: reviews.last_at,
      detail: reviews.count === 0
        ? "Nenhuma revisão gravada. runSupervisor só é invocado dentro de runAutoCycle (auto-tick), que depende de committee_decisions existentes."
        : `Última revisão ${ageMin(reviews.last_at)?.toFixed(0)} min atrás.`,
      trigger: "runSupervisor — chamado por runAutoCycle via /api/public/hooks/auto-tick (cron não agendado)",
    });

    // 7. Intelligence
    stages.push({
      key: "intelligence", label: "Inteligência",
      status: intel.count === 0 ? "fail" : (ageMin(intel.last_at) ?? 9999) < 24 * 60 ? "ok" : "warning",
      count: intel.count, last_at: intel.last_at,
      detail: intel.count === 0
        ? "Nenhum intelligence_report. Depende de votos/decisões/ordens consolidadas pelo daily/weekly report."
        : `Último relatório ${ageMin(intel.last_at)?.toFixed(0)} min atrás.`,
      trigger: "/api/public/hooks/daily-report + weekly-report (cron não agendado)",
    });

    return {
      stages,
      session: { active: sessions.count, started_at: sessions.last_at },
      orders, logs,
      summary: {
        ok: stages.filter((s) => s.status === "ok").length,
        warning: stages.filter((s) => s.status === "warning").length,
        fail: stages.filter((s) => s.status === "fail").length,
      },
      verdict: stages.find((s) => s.status === "fail")
        ? `Pipeline parado em: ${stages.filter((s) => s.status === "fail").map((s) => s.label).join(", ")}.`
        : "Pipeline operacional.",
    };
  });
