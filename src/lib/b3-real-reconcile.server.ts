import { brokerExit } from "./b3-real-apuracao";

// Reconciliação de b3_live_orders com a verdade da corretora.
//
// POR QUE EXISTE (04/09/2026)
// Havia 36 ordens reais com `exit_time` nulo entre 27/08 e 03/09, uma delas
// "aberta" há 26 horas somando +R$ 404 de lucro imaginário, enquanto o MT5
// reportava zero posições. A execução funciona; o que falhava era o CAMINHO DE
// RETORNO da saída:
//   1) quando o MT5 fecha a posição por conta dele (stop/alvo na corretora,
//      zeragem da mesa), o comando de fechamento do app volta 'rejected'
//      ("nenhuma posicao aberta ... para fechar") e nada escreve a saída;
//   2) a partir da primeira órfã, o ack de fechamento daquele magic passava a
//      encontrar DUAS linhas abertas e falhava para sempre (corrigido no
//      endpoint de ack, mas o passado precisa ser resolvido de todo jeito).
//
// O QUE ESTE MÓDULO FAZ
// Compara as ordens 'open' do banco com `b3_mt5_account_state.posicoes` (o que
// o executor leu do MT5). Quem está aberta no banco e NÃO existe na corretora é
// órfã e é resolvida:
//   • negócio integral reportado com ticket exato ⇒ encerra com evidência;
//   • sem negócio correspondente ⇒ sem apuração, sem preço/horário inventado.
// Ordens anteriores ao primeiro pregão desta entrega permanecem intocadas.
//
// O QUE ESTE MÓDULO NÃO FAZ
// Não manda ordem, não fecha posição na corretora, não decide entrada nem
// saída, não toca em parâmetro de robô. É só escrita de registro financeiro.

const REPORT_FRESH_S = 90;   // relatório mais velho que isso não serve de prova
const MIN_AGE_S = 60;         // ordem recém-aberta não é julgada (corrida com o executor)

export interface ReconcileResultado {
  avaliadas: number;
  conciliadas: number;
  desconhecidas: number;
  ignoradas: number;
  erros: number;
  janela_ms: number;
  detalhes: any[];
}

const rootOf = (s: string | null | undefined) => {
  const v = String(s ?? "").toUpperCase();
  const m = v.match(/^([A-Z]{3})[FGHJKMNQUVXZ]\d{2}$/);
  return m?.[1] ?? v;
};

export async function reconcileB3LiveOrders(supabase: any): Promise<ReconcileResultado> {
  const t0 = Date.now();
  const detalhes: any[] = [];
  let conciliadas = 0, desconhecidas = 0, ignoradas = 0, erros = 0;

  const { data: abertas, error } = await supabase
    .from("b3_live_orders")
    .select("*")
    .in("status", ["open", "divergente_corretora"])
    .gte("entry_time", "2026-11-11T03:00:00.000Z");
  if (error) throw new Error(`reconciliação: falha ao ler b3_live_orders — ${error.message}`);
  const ordens = (abertas ?? []) as any[];
  if (!ordens.length) {
    return { avaliadas: 0, conciliadas: 0, desconhecidas: 0, ignoradas: 0, erros: 0, janela_ms: Date.now() - t0, detalhes };
  }

  const users = Array.from(new Set(ordens.map((o) => o.user_id)));
  const { data: estados } = await supabase
    .from("b3_mt5_account_state")
    .select("user_id, reportado_em, posicoes, fechamentos")
    .in("user_id", users);
  const estadoByUser = new Map<string, any>(((estados ?? []) as any[]).map((e) => [e.user_id, e]));

  const now = Date.now();

  for (const o of ordens) {
    try {
      const estado = estadoByUser.get(o.user_id);
      const reportedAt = estado?.reportado_em ? new Date(estado.reportado_em).getTime() : null;
      // Sem relatório fresco não há prova de ausência — não julga nada.
      if (!reportedAt || (now - reportedAt) / 1000 > REPORT_FRESH_S) { ignoradas++; continue; }

      const entryMs = o.entry_time ? new Date(o.entry_time).getTime() : null;
      if (entryMs != null && reportedAt - entryMs < MIN_AGE_S * 1000) { ignoradas++; continue; }

      const posicoes = (estado?.posicoes ?? []) as any[];
      const presente = posicoes.some((p) => {
        if (Math.abs(Number(p?.volume ?? 0)) <= 0) return false;
        if (p?.ticket != null && o.broker_ticket_entry != null) return String(p.ticket) === String(o.broker_ticket_entry);
        if (p?.magic != null && Number(p.magic) === Number(o.magic_number)) return true;
        // Sem magic no relatório, a raiz + lado já basta para NÃO acusar órfã.
        return p?.magic == null && rootOf(p?.symbol) === rootOf(o.symbol) && String(p?.side ?? "") === String(o.side);
      });
      if (presente) { ignoradas++; continue; }
      // No housekeeping writes: only a reported disappearance may close a row.

      // Verdade da corretora: negócio de saída reportado pelo executor.
      const fechs = Array.isArray(estado?.fechamentos) ? (estado.fechamentos as any[]) : null;
      if (fechs) {
        const f = brokerExit(o, fechs);
        if (f) {
          const { error: updErr } = await supabase.from("b3_live_orders").update({
            exit_price: Number(f.preco), exit_time: f.fechado_em,
            net_result_brl: Number(f.resultado_brl),
            status: "closed", fechamento_corretora: { ...f, quem_fechou: "corretora" },
          }).eq("id", o.id).eq("status", o.status);
          if (updErr) throw new Error(updErr.message);
          conciliadas++;
          detalhes.push({ id: o.id, magic: o.magic_number, ticket: o.broker_ticket_entry, via: "fechamento_da_corretora", motivo: f.motivo ?? null, exit_price: Number(f.preco), result_brl: Number(f.resultado_brl), fechado_em: f.fechado_em });
          continue;
        }
      }

        // Fechou na corretora sem comando nosso e sem `fechamentos` que case:
        // NÃO se chuta preço nem resultado (nem pelo stop teórico).
        if (o.status === "divergente_corretora") { ignoradas++; continue; }
        const { error: updErr } = await supabase.from("b3_live_orders").update({
          status: "divergente_corretora",
        }).eq("id", o.id).eq("status", o.status);
        if (updErr) throw new Error(updErr.message);
        desconhecidas++;
        detalhes.push({ id: o.id, magic: o.magic_number, ticket: o.broker_ticket_entry, via: fechs ? "sem_fechamento_correspondente" : "fechamentos_ausentes", exit_time: estado.reportado_em });
    } catch (e) {
      erros++;
      detalhes.push({ id: o.id, error: (e as Error).message.slice(0, 200) });
    }
  }

  const res: ReconcileResultado = {
    avaliadas: ordens.length, conciliadas, desconhecidas, ignoradas, erros,
    janela_ms: Date.now() - t0, detalhes,
  };

  // Só registra quando houve resolução ou erro: passada limpa não polui o log.
  if (conciliadas || desconhecidas || erros) {
    try {
      await supabase.from("system_logs").insert({
        event_type: "b3_live_orders_reconciliacao",
        source: "b3-guardiao-saida",
        severity: "warning",
        message: `Reconciliação real pela posição: ${ordens.length} aberta(s) no livro — ${conciliadas} fechada(s) com dados da corretora/comando, ${desconhecidas} divergente(s) sem resultado, ${ignoradas} confirmada(s)/sem prova, ${erros} erro(s).`,
        technical_data: res,
      });
    } catch { /* log nunca derruba a reconciliação */ }
  }

  return res;
}
