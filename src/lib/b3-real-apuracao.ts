// Shared real-money evidence. Null is unknown, never a scored zero.
import { SIGNED_BRL } from "./b3-format";

export function realResultText(value: number, missing: number) {
  return missing > 0 ? `${SIGNED_BRL(value)} apurado · ${missing} ordens sem apuração · RESULTADO DO DIA DESCONHECIDO` : SIGNED_BRL(value);
}

export function realApuracao(rows: { net_result_brl: unknown }[]) {
  let realized = 0, missing = 0;
  for (const r of rows) {
    if (r.net_result_brl == null || !Number.isFinite(Number(r.net_result_brl))) missing++;
    else realized += Number(r.net_result_brl);
  }
  return { realized_brl: Math.round(realized * 100) / 100, unappraised_count: missing, result_unknown: missing > 0 };
}

export function brokerExit(order: any, deals: any[]): any | null {
  // Exact position identity only: magic is reused and cannot identify a deal.
  if (order.broker_ticket_entry == null || !order.entry_time) return null;
  const matches = deals.filter((d) => d?.ticket_posicao != null &&
    String(d.ticket_posicao) === String(order.broker_ticket_entry));
  if (matches.length !== 1) return null; // partial/multiple exits need a broker aggregate
  const d = matches[0];
  const time = new Date(d.fechado_em ?? "").getTime();
  if (d.volume == null || order.quantity == null || Number(d.volume) !== Number(order.quantity)) return null;
  if (d.preco == null || !(Number(d.preco) > 0) || d.resultado_brl == null ||
    !Number.isFinite(Number(d.resultado_brl)) || !Number.isFinite(time) ||
    time < new Date(order.entry_time).getTime()) return null;
  return d;
}