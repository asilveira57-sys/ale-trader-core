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
//   • existe comando de fechamento 'filled' compatível ⇒ fecha com o preço, o
//     ticket e o horário daquele comando (resultado calculado, status 'closed');
//   • não existe ⇒ status 'unknown_state' com `exit_time` no horário do
//     relatório. Sabemos que não está aberta; não sabemos como terminou —
//     inventar resultado seria pior do que admitir o desconhecido.
//
// O QUE ESTE MÓDULO NÃO FAZ
// Não manda ordem, não fecha posição na corretora, não decide entrada nem
// saída, não toca em parâmetro de robô. É só escrita de registro financeiro.

const REPORT_FRESH_S = 120;   // relatório mais velho que isso não serve de prova
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
  return m ? m[1]! : v;
};

async function pointValues(supabase: any): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const { data } = await supabase.from("b3_asset_profiles").select("symbol, quote_symbol, tick_value_brl");
    for (const r of (data ?? []) as any[]) {
      const v = Number(r.tick_value_brl);
      if (!Number.isFinite(v) || v <= 0) continue;
      map.set(rootOf(r.symbol), v);
      map.set(rootOf(r.quote_symbol), v);
    }
  } catch { /* sem perfil, resultado fica nulo em vez de errado */ }
  return map;
}

export async function reconcileB3LiveOrders(supabase: any): Promise<ReconcileResultado> {
  const t0 = Date.now();
  const detalhes: any[] = [];
  let conciliadas = 0, desconhecidas = 0, ignoradas = 0, erros = 0;

  const { data: abertas, error } = await supabase
    .from("b3_live_orders")
    .select("*")
    .eq("status", "open");
  if (error) throw new Error(`reconciliação: falha ao ler b3_live_orders — ${error.message}`);
  const ordens = (abertas ?? []) as any[];
  if (!ordens.length) {
    return { avaliadas: 0, conciliadas: 0, desconhecidas: 0, ignoradas: 0, erros: 0, janela_ms: Date.now() - t0, detalhes };
  }

  const pv = await pointValues(supabase);
  const users = Array.from(new Set(ordens.map((o) => o.user_id)));
  const { data: estados } = await supabase
    .from("b3_mt5_account_state")
    .select("user_id, reportado_em, posicoes")
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
        if (p?.magic != null && Number(p.magic) === Number(o.magic_number)) return true;
        // Sem magic no relatório, a raiz + lado já basta para NÃO acusar órfã.
        return p?.magic == null && rootOf(p?.symbol) === rootOf(o.symbol) && String(p?.side ?? "") === String(o.side);
      });
      if (presente) { ignoradas++; continue; }

      // Órfã. Primeiro tenta achar o fechamento que o executor confirmou.
      const { data: closes } = await supabase
        .from("b3_mt5_commands")
        .select("id, filled_at, filled_price, broker_ticket, magic_number")
        .eq("user_id", o.user_id)
        .eq("env", "real")
        .eq("action", "close")
        .eq("status", "filled")
        .eq("magic_number", o.magic_number)
        .gte("filled_at", o.entry_time ?? new Date(0).toISOString())
        .order("filled_at", { ascending: true })
        .limit(1);
      const cmd = (closes ?? [])[0] as any;

      const point = pv.get(rootOf(o.symbol)) ?? null;
      if (cmd && Number(cmd.filled_price) > 0) {
        const exitPrice = Number(cmd.filled_price);
        const entryPrice = Number(o.entry_price);
        const dir = o.side === "buy" ? 1 : -1;
        const pts = Number.isFinite(entryPrice) ? (exitPrice - entryPrice) * dir : null;
        const brl = pts != null && point != null ? pts * point * Number(o.quantity || 1) : null;
        const { error: updErr } = await supabase.from("b3_live_orders").update({
          exit_price: exitPrice,
          exit_time: cmd.filled_at,
          broker_ticket_exit: cmd.broker_ticket ?? null,
          gross_result_brl: brl,
          net_result_brl: brl,
          status: "closed",
        }).eq("id", o.id).eq("status", "open");
        if (updErr) throw new Error(updErr.message);
        conciliadas++;
        detalhes.push({ id: o.id, magic: o.magic_number, via: "comando_de_fechamento", exit_price: exitPrice, result_brl: brl });
      } else {
        // Fechou na corretora sem comando confirmado (stop/alvo do MT5, zeragem
        // da mesa). Não há preço de saída confiável: registra o desconhecido.
        const { error: updErr } = await supabase.from("b3_live_orders").update({
          exit_time: estado.reportado_em,
          status: "unknown_state",
        }).eq("id", o.id).eq("status", "open");
        if (updErr) throw new Error(updErr.message);
        desconhecidas++;
        detalhes.push({ id: o.id, magic: o.magic_number, via: "ausente_no_mt5", exit_time: estado.reportado_em });
      }
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
        severity: desconhecidas || erros ? "warning" : "info",
        message: `Reconciliação real: ${ordens.length} aberta(s) no banco — ${conciliadas} conciliada(s) por comando, ${desconhecidas} marcada(s) como estado desconhecido, ${ignoradas} confirmada(s)/sem prova, ${erros} erro(s).`,
        technical_data: res,
      });
    } catch { /* log nunca derruba a reconciliação */ }
  }

  return res;
}
