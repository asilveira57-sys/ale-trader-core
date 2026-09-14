// A CORRETORA MANDA (14/09/2026).
//
// Onde nasce risco novo — o espelho do simulado para o real — a pergunta "este
// robô já tem posição?" NÃO pode ser respondida pelo livro derivado de
// b3_mt5_commands: comando é INTENÇÃO, não verdade. Dois incidentes provaram:
//
//  · 08–11/09: fechamentos recusados pelo executor + zeragem na mão no MetaTrader
//    deixaram 3 posições fantasma nos magics 2504 e 2505; o espelho parou de
//    abrir posição real nesses robôs por TRÊS DIAS porque o livro os achava
//    posicionados. Só destravou com correção manual no banco.
//  · 11/09: o inverso — um `close` enfileirado para uma posição que nunca abriu
//    ("nenhuma posicao aberta em WINV26 para fechar").
//
// A fonte confiável estava ao lado o tempo todo: b3_mt5_account_state.posicoes,
// que o executor reporta a cada ~6s direto do MT5. Este módulo é só leitura.
import { STALE_REPORT_S } from "@/lib/b3-real-cockpit.server";

export interface BrokerMagicState {
  // false = nunca houve relatório do executor: não há prova de nada.
  reported: boolean;
  reported_at: string | null;
  report_age_s: number | null;
  stale: boolean;
  // magic → quantidade líquida aberta na corretora (valor absoluto por magic)
  qty_by_magic: Map<number, number>;
}

export const EMPTY_BROKER_STATE: BrokerMagicState = {
  reported: false, reported_at: null, report_age_s: null, stale: true,
  qty_by_magic: new Map(),
};

// Lê o último relatório do executor e resume a posição aberta por magic.
// Nunca lança: falha de leitura devolve "sem relatório" (falha FECHADA para
// abertura, porque sem prova do estado da conta não se abre nada).
export async function readBrokerMagicState(
  supabase: any, userId: string, nowMs: number = Date.now(),
): Promise<BrokerMagicState> {
  try {
    const { data, error } = await supabase
      .from("b3_mt5_account_state")
      .select("posicoes, reportado_em")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return EMPTY_BROKER_STATE;

    const reportedAt: string | null = (data as any).reportado_em ?? null;
    const ageS = reportedAt ? Math.round((nowMs - new Date(reportedAt).getTime()) / 1000) : null;
    const qty = new Map<number, number>();
    for (const p of ((data as any).posicoes ?? []) as any[]) {
      const magic = Number(p?.magic ?? 0);
      const vol = Math.abs(Number(p?.volume ?? 0));
      if (!magic || !(vol > 0)) continue;
      qty.set(magic, (qty.get(magic) ?? 0) + vol);
    }
    return {
      reported: true,
      reported_at: reportedAt,
      report_age_s: ageS,
      stale: ageS == null ? true : ageS > STALE_REPORT_S,
      qty_by_magic: qty,
    };
  } catch {
    return EMPTY_BROKER_STATE;
  }
}
