// Daily / Weekly reports via Lovable AI Gateway.
import type { SupabaseClient } from "@supabase/supabase-js";
import { chat } from "./ai-gateway.server";

export async function generateDailyReport(supabase: SupabaseClient, dateISO: string) {
  const start = new Date(dateISO + "T00:00:00Z").toISOString();
  const end = new Date(new Date(dateISO).getTime() + 86400_000).toISOString();
  const [{ data: auto }, { data: real }, { data: alerts }] = await Promise.all([
    supabase.from("automated_trades").select("*").gte("opened_at", start).lt("opened_at", end),
    supabase.from("real_positions").select("*").gte("opened_at", start).lt("opened_at", end),
    supabase.from("alerts").select("*").gte("created_at", start).lt("created_at", end).in("severity", ["warning", "critical"]),
  ]);
  const all = [...(auto ?? []), ...(real ?? [])];
  const wins = all.filter((t: any) => Number(t.pnl ?? 0) > 0).length;
  const losses = all.filter((t: any) => Number(t.pnl ?? 0) < 0).length;
  const netPnl = all.reduce((s: number, t: any) => s + Number(t.pnl ?? 0), 0);

  let content = `Sem dados de IA disponíveis.`;
  let recommendations = "Manter monitoramento.";
  try {
    content = await chat({
      user: `Gere um relatório diário em PT-BR (markdown, ≤500 palavras) para o dia ${dateISO}. Dados:\n- Operações: ${all.length}\n- Acertos: ${wins}\n- Erros: ${losses}\n- Lucro líquido: ${netPnl.toFixed(2)}\n- Alertas críticos: ${(alerts ?? []).length}\nInclua resumo, análise de desempenho e recomendações práticas.`,
      maxTokens: 800,
    });
    recommendations = content.split(/recomenda/i)[1]?.slice(0, 600) ?? recommendations;
  } catch { /* ignore */ }

  const { data: report } = await supabase.from("daily_reports").insert({
    report_date: dateISO, total_trades: all.length, wins, losses,
    drawdown: 0, net_pnl: netPnl, alerts: alerts ?? [],
    recommendations, content,
  }).select().single();
  return report;
}

export async function generateWeeklyReport(supabase: SupabaseClient, weekStartISO: string) {
  const start = new Date(weekStartISO).toISOString();
  const end = new Date(new Date(weekStartISO).getTime() + 7 * 86400_000).toISOString();
  const [{ data: auto }, { data: real }, { data: agents }] = await Promise.all([
    supabase.from("automated_trades").select("*").gte("opened_at", start).lt("opened_at", end),
    supabase.from("real_positions").select("*").gte("opened_at", start).lt("opened_at", end),
    supabase.from("agent_reputation").select("agent_id, score, hits, misses").order("score", { ascending: false }).limit(10),
  ]);
  const all = [...(auto ?? []), ...(real ?? [])];
  const byAsset: Record<string, number> = {};
  for (const t of all as any[]) {
    const k = t.pair || t.asset_id || "?";
    byAsset[k] = (byAsset[k] ?? 0) + Number(t.pnl ?? 0);
  }
  const sorted = Object.entries(byAsset).sort((a, b) => b[1] - a[1]);
  const topAssets = sorted.slice(0, 5).map(([k, v]) => ({ key: k, pnl: v }));
  const problemAssets = sorted.slice(-5).filter(([, v]) => v < 0).map(([k, v]) => ({ key: k, pnl: v }));
  const performance = {
    trades: all.length,
    net_pnl: all.reduce((s: number, t: any) => s + Number(t.pnl ?? 0), 0),
    wins: all.filter((t: any) => Number(t.pnl) > 0).length,
    losses: all.filter((t: any) => Number(t.pnl) < 0).length,
  };

  let content = "Relatório indisponível.";
  let suggestions = "";
  try {
    content = await chat({
      user: `Gere um relatório semanal em PT-BR (markdown, ≤700 palavras). Semana iniciada em ${weekStartISO}.\nPerformance: ${JSON.stringify(performance)}\nTop ativos: ${JSON.stringify(topAssets)}\nAtivos problemáticos: ${JSON.stringify(problemAssets)}\nRanking de agentes: ${JSON.stringify(agents ?? [])}\nInclua análise consolidada, ranking dos agentes e ajustes sugeridos.`,
      maxTokens: 1200,
    });
    suggestions = content.split(/ajustes/i)[1]?.slice(0, 800) ?? "";
  } catch { /* ignore */ }

  const { data: report } = await supabase.from("weekly_reports").insert({
    week_start: weekStartISO,
    week_end: new Date(new Date(weekStartISO).getTime() + 6 * 86400_000).toISOString().slice(0, 10),
    performance, agent_ranking: agents ?? [], top_assets: topAssets, problem_assets: problemAssets,
    suggested_adjustments: suggestions, content,
  }).select().single();
  return report;
}
