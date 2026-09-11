// MEDIÇÃO DIÁRIA DO FREIO DE GRUPO (08/09/2026)
//
// Desde 08/09/2026 o freio de grupo não bloqueia no simulado — ele registra.
// Para que a decisão de manter, afrouxar ou endurecer o freio seja tomada por
// número e não por opinião sobre um dia bom, o motor guarda os DOIS caminhos
// por pregão:
//
//   livre  — o que de fato aconteceu no simulado, sem freio de grupo
//   sombra — o que teria acontecido se o freio tivesse bloqueado
//
// GRANULARIDADE (11/09/2026): a medição é gravada por ROBÔ
// (symbol raiz, variant, mode) e também consolidada por GRUPO na linha com
// `mode = ''`. O card do robô lê a linha dele; a testeira do grupo lê a linha
// do grupo. Antes só existia a linha do grupo e o card mostrava a soma da
// modalidade como se fosse do robô.
//
// IDEMPOTÊNCIA (11/09/2026): a passada recalcula o DIA INTEIRO a partir de
// `b3_simulation_orders` e sobrescreve as linhas. A versão anterior somava
// todas as ordens fechadas da execução, sem recorte de dia — e como a execução
// vive semanas, `ops_livre` aparecia inflado de 5 a 15 vezes e o resultado
// vinha de dias antigos. O recorte de dia usa `entry_time` na janela BRT, o
// mesmo critério da consulta de referência da auditoria.
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

export interface GrupoSombraResultado extends GrupoSombraDia {
  /** Mesma medição, por modo (robô) do grupo. */
  por_modo: Record<string, GrupoSombraDia>;
}

const zero = (): { livre: number; sombra: number; opsL: number; opsS: number } =>
  ({ livre: 0, sombra: 0, opsL: 0, opsS: 0 });

const shape = (a: { livre: number; sombra: number; opsL: number; opsS: number }): GrupoSombraDia => ({
  resultado_livre_brl: Number(a.livre.toFixed(2)),
  resultado_sombra_brl: Number(a.sombra.toFixed(2)),
  ops_livre: a.opsL,
  ops_sombra: a.opsS,
  diferenca_brl: Number((a.sombra - a.livre).toFixed(2)),
});

/**
 * Recalcula e grava o consolidado livre/sombra do dia — por robô e por grupo.
 * Falha em silêncio no chamador: é medição, nunca caminho crítico.
 */
export async function atualizarGrupoSombraDia(
  supabase: any,
  userId: string,
  runId: string,
  symbolRoot: string,
  variant: string,
  tradeDate: string,
): Promise<GrupoSombraResultado | null> {
  // Janela do pregão em BRT (UTC−3): [dia 00:00, dia+1 00:00).
  const inicio = `${tradeDate}T03:00:00.000Z`;
  const fimMs = new Date(inicio).getTime() + 24 * 60 * 60 * 1000;
  const fim = new Date(fimMs).toISOString();

  const { data, error } = await supabase
    .from("b3_simulation_orders")
    .select("mode, net_result_brl, bloqueado_na_sombra")
    .eq("user_id", userId)
    .eq("simulation_run_id", runId)
    .eq("status", "closed")
    .not("exit_time", "is", null)
    .gte("entry_time", inicio)
    .lt("entry_time", fim)
    .limit(5000);
  if (error) throw new Error(`sombra de grupo: ${error.message}`);

  const ords = (data ?? []) as any[];
  const grupo = zero();
  const porModo = new Map<string, ReturnType<typeof zero>>();
  for (const o of ords) {
    const mode = String(o.mode ?? "");
    if (!porModo.has(mode)) porModo.set(mode, zero());
    const alvos = [grupo, porModo.get(mode)!];
    const brl = Number(o.net_result_brl ?? 0);
    for (const a of alvos) {
      a.livre += brl;
      a.opsL += 1;
      if (o.bloqueado_na_sombra !== true) {
        a.sombra += brl;
        a.opsS += 1;
      }
    }
  }

  const res: GrupoSombraResultado = {
    ...shape(grupo),
    por_modo: Object.fromEntries(Array.from(porModo.entries()).map(([m, a]) => [m, shape(a)])),
  };

  const agora = new Date().toISOString();
  const rows = [
    { mode: "", ...shape(grupo) },
    ...Array.from(porModo.entries()).map(([m, a]) => ({ mode: m, ...shape(a) })),
  ].map((r) => ({
    user_id: userId, symbol: symbolRoot, variant, trade_date: tradeDate,
    ...r, updated_at: agora,
  }));

  const { error: upErr } = await supabase.from("b3_grupo_sombra_dia").upsert(
    rows,
    { onConflict: "user_id,symbol,variant,mode,trade_date" },
  );
  if (upErr) throw new Error(`sombra de grupo (gravação): ${upErr.message}`);
  return res;
}
