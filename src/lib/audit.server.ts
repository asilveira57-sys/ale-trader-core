// Auditoria automática: pre / during / post + classificação.
import type { SupabaseClient } from "@supabase/supabase-js";
import { chat } from "./ai-gateway.server";

async function safeChat(system: string, user: string): Promise<string> {
  try {
    return await chat({ system, user, model: "google/gemini-3-flash-preview", maxTokens: 800 });
  } catch (err) {
    return `(IA indisponível: ${(err as Error).message})`;
  }
}

export async function generatePreAudit(supabase: SupabaseClient, requestId: string) {
  const { data: req } = await supabase.from("real_trade_requests").select("*").eq("id", requestId).maybeSingle();
  if (!req) throw new Error("Request não encontrado");
  const { data: votes } = req.decision_id
    ? await supabase.from("agent_votes").select("*, agents(name)").eq("decision_id", req.decision_id)
    : { data: [] };

  const summary = await safeChat(
    "Você é o Auditor do AleTrader AI. Escreva em português claro, sem jargão.",
    `Auditoria PRÉ-OPERAÇÃO:
Ativo: ${req.pair}
Lado: ${req.side}
Qtd: ${req.suggested_qty}
Preço estimado: ${req.suggested_price}
Stop: ${req.stop_loss}
Alvo: ${req.take_profit}
Risco $: ${req.risk_amount}
Score: ${req.score}
Votos a favor: ${req.votes_for}  contra: ${req.votes_against}
Vetos: ${JSON.stringify(req.vetoes)}
Justificativa: ${req.justification ?? ""}
Votos detalhados: ${JSON.stringify((votes ?? []).map((v: any) => ({ agente: v.agents?.name, voto: v.vote, conf: v.confidence })))}

Escreva 6 seções curtas:
1) Por que essa operação foi sugerida
2) Dados que sustentam a decisão
3) Agentes que concordaram / discordaram
4) Papel do Agente de Risco e do Anti-Euforia
5) Motivo do stop e do alvo
6) O que invalidaria a operação`,
  );

  const { data: report } = await supabase.from("audit_reports").insert({
    request_id: requestId, phase: "pre", summary,
    content: { votes, request: req },
  }).select().single();

  await supabase.from("trade_explanations").insert({
    request_id: requestId, generated_by: "gemini-3-flash", content: summary,
  });
  return report;
}

export async function generateDuringAudit(supabase: SupabaseClient, positionId: string, currentPrice: number) {
  const { data: pos } = await supabase.from("real_positions").select("*").eq("id", positionId).maybeSingle();
  if (!pos) return null;
  const distStop = ((currentPrice - Number(pos.stop_loss)) / currentPrice) * 100;
  const distTake = ((Number(pos.take_profit) - currentPrice) / currentPrice) * 100;
  await supabase.from("audit_events").insert({
    request_id: pos.request_id, position_id: positionId, kind: "snapshot",
    message: `Preço ${currentPrice.toFixed(2)} | dist stop ${distStop.toFixed(2)}% | dist alvo ${distTake.toFixed(2)}%`,
    data: { price: currentPrice, dist_stop_pct: distStop, dist_take_pct: distTake },
  });
}

export function classifyTrade(p: {
  pnl: number; pnl_pct: number; respectedStop: boolean; exit_reason: string;
}): "excellent" | "good" | "neutral" | "bad" | "critical" {
  if (!p.respectedStop && p.pnl < 0) return "critical";
  if (p.pnl_pct >= 5) return "excellent";
  if (p.pnl_pct > 0) return "good";
  if (Math.abs(p.pnl_pct) < 0.5) return "neutral";
  if (p.pnl_pct > -3) return "bad";
  return "critical";
}

export async function generatePostAudit(supabase: SupabaseClient, positionId: string) {
  const { data: pos } = await supabase.from("real_positions").select("*").eq("id", positionId).maybeSingle();
  if (!pos) throw new Error("Posição não encontrada");
  const respected = pos.exit_reason !== "ignored_stop";
  const classification = classifyTrade({
    pnl: Number(pos.pnl ?? 0),
    pnl_pct: Number(pos.pnl_pct ?? 0),
    respectedStop: respected,
    exit_reason: pos.exit_reason ?? "",
  });

  const summary = await safeChat(
    "Você é o Auditor do AleTrader AI. Escreva em português claro, técnico mas acessível.",
    `Auditoria PÓS-OPERAÇÃO:
Ativo: ${pos.pair}  Lado: ${pos.side}
Entrada: ${pos.entry_price}  Saída: ${pos.exit_price}
PnL: ${pos.pnl} (${pos.pnl_pct}%)
Motivo da saída: ${pos.exit_reason}
Classificação automática: ${classification}

Escreva:
1) Resultado financeiro e percentual
2) Motivo da saída (stop, alvo, manual?)
3) O que o sistema aprendeu
4) Ajustes sugeridos para próximas operações`,
  );

  const { data: report } = await supabase.from("audit_reports").insert({
    request_id: pos.request_id, position_id: positionId, phase: "post",
    summary, classification, content: { position: pos },
  }).select().single();
  return report;
}
