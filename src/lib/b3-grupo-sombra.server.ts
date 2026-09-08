// MEDIÇÃO DIÁRIA DO FREIO DE GRUPO (08/09/2026)
//
// Desde 08/09/2026 o freio de grupo não bloqueia no simulado — ele registra.
// Para que a decisão de manter, afrouxar ou endurecer o freio seja tomada por
// número e não por opinião sobre um dia bom, o motor guarda os DOIS caminhos
// por grupo (symbol raiz, variant) e por pregão:
//
//   livre  — o que de fato aconteceu no simulado, sem freio de grupo
//   sombra — o que teria acontecido se o freio tivesse bloqueado
//
// Nenhuma simulação nova é necessária: a ordem já nasce com
// `bloqueado_na_sombra`, gravado na abertura. Quem estava travado naquele
// instante entra no livre e sai do sombra.
//
// `diferenca_brl = sombra - livre`: positiva significa que o freio teria
// ajudado; negativa, que teria atrapalhado.
//
// Este arquivo NÃO decide nada. Não toca em `decideB3Grupo`, em stop, alvo,
// trailing, zeragem, freio de pico ou disjuntor.

export interface GrupoSombraDia {
  resultado_livre_brl: number;
  resultado_sombra_brl: number;
  ops_livre: number;
  ops_sombra: number;
  diferenca_brl: number;
}

/**
 * Recalcula e grava o consolidado livre/sombra do dia para um grupo.
 * Falha em silêncio no chamador: é medição, nunca caminho crítico.
 */
export async function atualizarGrupoSombraDia(
  supabase: any,
  userId: string,
  runId: string,
  symbolRoot: string,
  variant: string,
  tradeDate: string,
): Promise<GrupoSombraDia | null> {
  const { data, error } = await supabase
    .from("b3_simulation_orders")
    .select("net_result_brl, bloqueado_na_sombra, exit_time")
    .eq("user_id", userId)
    .eq("simulation_run_id", runId)
    .eq("status", "closed")
    .not("exit_time", "is", null)
    .limit(5000);
  if (error) throw new Error(`sombra de grupo: ${error.message}`);

  const ords = (data ?? []) as any[];
  let livre = 0, sombra = 0, opsLivre = 0, opsSombra = 0;
  for (const o of ords) {
    const brl = Number(o.net_result_brl ?? 0);
    livre += brl;
    opsLivre += 1;
    if (o.bloqueado_na_sombra !== true) {
      sombra += brl;
      opsSombra += 1;
    }
  }

  const res: GrupoSombraDia = {
    resultado_livre_brl: Number(livre.toFixed(2)),
    resultado_sombra_brl: Number(sombra.toFixed(2)),
    ops_livre: opsLivre,
    ops_sombra: opsSombra,
    diferenca_brl: Number((sombra - livre).toFixed(2)),
  };

  const { error: upErr } = await supabase.from("b3_grupo_sombra_dia").upsert(
    {
      user_id: userId, symbol: symbolRoot, variant, trade_date: tradeDate,
      ...res, updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,symbol,variant,trade_date" },
  );
  if (upErr) throw new Error(`sombra de grupo (gravação): ${upErr.message}`);
  return res;
}
