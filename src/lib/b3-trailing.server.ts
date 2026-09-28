// Persiste o movimento do stop (trailing / zero a zero) e registra em system_logs.
import { nivelProtecao, protegeMais, type TrailCfg } from "./b3-trailing";

export async function moverStopSeNecessario(sb: any, p: {
  open: any; userId: string; peakPts: number; cfg: TrailCfg; tick: number;
  stopAtual: number | null; origem: string;
}): Promise<{ level: number; fonte: string } | null> {
  const side = p.open.side as "buy" | "sell";
  const entry = Number(p.open.entry_price);
  const alvo = nivelProtecao({ side, entry, peakPts: p.peakPts, cfg: p.cfg, tick: p.tick });
  if (!alvo || !protegeMais(side, alvo.level, p.stopAtual)) return null;
  const dir = side === "buy" ? 1 : -1;
  const melhorPreco = entry + dir * p.peakPts;
  const { error } = await sb.from("b3_simulation_orders")
    .update({ stop_price: alvo.level })
    .eq("id", p.open.id).eq("user_id", p.userId).eq("status", "open");
  if (error) return null;
  p.open.stop_price = alvo.level;
  try {
    await sb.from("system_logs").insert({
      event_type: "trailing_movido",
      source: p.origem,
      severity: "info",
      message: `Stop movido (${alvo.fonte}) ${p.stopAtual ?? "—"} → ${alvo.level} · ${p.open.mode} ${side} entrada ${entry} · melhor ${melhorPreco}`,
      technical_data: {
        user_id: p.userId,
        order_id: p.open.id, mode: p.open.mode, side, fonte: alvo.fonte,
        preco_entrada: entry, melhor_preco: melhorPreco, pico_pts: p.peakPts,
        stop_anterior: p.stopAtual, stop_novo: alvo.level,
        trailing_activation_pts: p.cfg.trailing_activation_pts, trailing_giveback_pts: p.cfg.trailing_giveback_pts,
        em: new Date().toISOString(),
      },
    });
  } catch { /* registro nunca derruba a gestão */ }
  return alvo;
}
