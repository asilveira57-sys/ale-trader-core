// MEDIÇÃO DIÁRIA DOS FREIOS EM SOMBRA (08/09/2026 · ampliada em 15/09/2026)
//
// Desde 08/09/2026 o freio de grupo não bloqueia no simulado — ele registra.
// Desde 15/09/2026 o mesmo vale para os outros três freios de RESULTADO:
// freio de pico, proteção pós-meta e stop diário por robô. No real todos
// continuam bloqueando de verdade.
//
// Para que a decisão de manter, afrouxar ou endurecer cada freio seja tomada
// por número e não por opinião sobre um dia bom, o motor guarda os DOIS
// caminhos por pregão:
//
//   livre  — o que de fato aconteceu no simulado, sem nenhum freio
//   sombra — o que teria acontecido se os freios tivessem bloqueado
//
// ATRIBUIÇÃO POR FREIO (15/09/2026): com quatro freios em sombra, um número
// agregado mistura tudo e não permite julgar um freio contra o outro. A ordem
// nasce com `freios_na_sombra` (vetor: 'grupo', 'pico', 'pos_meta',
// 'stop_diario'), e aqui se calcula, por freio, o resultado que existiria se
// APENAS aquele freio estivesse ativo. `bloqueado_na_sombra` continua sendo
// "algum freio barraria" e alimenta a medição agregada, como antes.
//
// GRANULARIDADE (11/09/2026): a medição é gravada por ROBÔ
// (symbol raiz, variant, mode) e também consolidada por GRUPO na linha com
// `mode = ''`. O card do robô lê a linha dele; a testeira do grupo lê a linha
// do grupo.
//
// IDEMPOTÊNCIA (11/09/2026): a passada recalcula o DIA INTEIRO a partir de
// `b3_simulation_orders` e sobrescreve as linhas. O recorte de dia usa
// `entry_time` na janela BRT, o mesmo critério da consulta de referência da
// auditoria.
//
// `diferenca_brl = sombra - livre`: positiva significa que o freio teria
// ajudado; negativa, que teria atrapalhado.
//
// Este arquivo NÃO decide nada. Não toca em `decideB3Grupo`, na proteção
// diária, em stop, alvo, trailing, zeragem, freio de pico ou disjuntor.

export interface GrupoSombraFreio {
  resultado_sombra_brl: number;
  ops_sombra: number;
  /** Quantas entradas do dia este freio teria barrado. */
  ops_barradas: number;
  diferenca_brl: number;
}

export interface GrupoSombraDia {
  resultado_livre_brl: number;
  resultado_sombra_brl: number;
  ops_livre: number;
  ops_sombra: number;
  diferenca_brl: number;
  /** Mesma medição isolando cada freio. Só freios que apareceram no dia. */
  por_freio: Record<string, GrupoSombraFreio>;
}

export interface GrupoSombraResultado extends GrupoSombraDia {
  /** Mesma medição, por modo (robô) do grupo. */
  por_modo: Record<string, GrupoSombraDia>;
}

type Acc = {
  livre: number; sombra: number; opsL: number; opsS: number;
  /** freio -> { resultado sem aquele freio, ops sem aquele freio, ops barradas } */
  freios: Map<string, { brl: number; ops: number; barradas: number }>;
};

const zero = (): Acc => ({ livre: 0, sombra: 0, opsL: 0, opsS: 0, freios: new Map() });

const r2 = (v: number) => Number(v.toFixed(2));

const shape = (a: Acc): GrupoSombraDia => ({
  resultado_livre_brl: r2(a.livre),
  resultado_sombra_brl: r2(a.sombra),
  ops_livre: a.opsL,
  ops_sombra: a.opsS,
  diferenca_brl: r2(a.sombra - a.livre),
  por_freio: Object.fromEntries(
    Array.from(a.freios.entries()).map(([f, v]) => [f, {
      resultado_sombra_brl: r2(v.brl),
      ops_sombra: v.ops,
      ops_barradas: v.barradas,
      diferenca_brl: r2(v.brl - a.livre),
    } satisfies GrupoSombraFreio]),
  ),
});

// FREQUÊNCIA (15/09/2026): a consolidação é um ACUMULADO do pregão — muda
// devagar e precisão de segundos não serve para nada, nem na tela nem na
// decisão. Chamada a cada passada do tique, ela reescrevia as mesmas ~230
// linhas 70 mil vezes: I/O e vacuum sem informação nova, o pior padrão de
// custo de banco. Agora vale no máximo UMA gravação por minuto por grupo/dia.
// A virada do dia troca a chave do cache (logo consolida na hora) e a zeragem
// de fim de pregão chama com `force` para não perder o último trecho.
const ULTIMA_CONSOLIDACAO_MS = 60_000;
const ultimaPorGrupo = new Map<string, { at: number; res: GrupoSombraResultado }>();

/**
 * Recalcula e grava o consolidado livre/sombra do dia — por robô, por grupo e
 * por freio. Falha em silêncio no chamador: é medição, nunca caminho crítico.
 *
 * `opts.force` ignora o intervalo mínimo (fim de pregão, fechamento manual).
 */
export async function atualizarGrupoSombraDia(
  supabase: any,
  userId: string,
  runId: string,
  symbolRoot: string,
  variant: string,
  tradeDate: string,
  opts: { force?: boolean } = {},
): Promise<GrupoSombraResultado | null> {
  const chave = `${userId}|${runId}|${symbolRoot}|${variant}|${tradeDate}`;
  const anterior = ultimaPorGrupo.get(chave);
  if (!opts.force && anterior && Date.now() - anterior.at < ULTIMA_CONSOLIDACAO_MS) {
    // Nada é gravado: devolve a última medição para a tela e o log seguirem iguais.
    return anterior.res;
  }

  // Janela do pregão em BRT (UTC−3): [dia 00:00, dia+1 00:00).
  const inicio = `${tradeDate}T03:00:00.000Z`;
  const fimMs = new Date(inicio).getTime() + 24 * 60 * 60 * 1000;
  const fim = new Date(fimMs).toISOString();

  const { data, error } = await supabase
    .from("b3_simulation_orders")
    .select("mode, net_result_brl, bloqueado_na_sombra, freios_na_sombra")
    .eq("user_id", userId)
    .eq("simulation_run_id", runId)
    .eq("status", "closed")
    .not("exit_time", "is", null)
    .gte("entry_time", inicio)
    .lt("entry_time", fim)
    .limit(5000);
  if (error) throw new Error(`sombra de grupo: ${error.message}`);

  const ords = (data ?? []) as any[];
  // Freios que apareceram no dia: só eles ganham linha, para não inventar
  // medição de freio que nunca agiu.
  const freiosDoDia = new Set<string>();
  for (const o of ords) {
    for (const f of (Array.isArray(o.freios_na_sombra) ? o.freios_na_sombra : [])) {
      if (f) freiosDoDia.add(String(f));
    }
  }

  const grupo = zero();
  const porModo = new Map<string, Acc>();
  for (const o of ords) {
    const mode = String(o.mode ?? "");
    if (!porModo.has(mode)) porModo.set(mode, zero());
    const alvos = [grupo, porModo.get(mode)!];
    const brl = Number(o.net_result_brl ?? 0);
    const freios = new Set<string>(
      (Array.isArray(o.freios_na_sombra) ? o.freios_na_sombra : []).map((f: any) => String(f)),
    );
    for (const a of alvos) {
      a.livre += brl;
      a.opsL += 1;
      if (o.bloqueado_na_sombra !== true) {
        a.sombra += brl;
        a.opsS += 1;
      }
      // Por freio: a ordem entra no resultado daquele freio quando ELE não a
      // teria barrado. Barrada por dois freios ao mesmo tempo → sai dos dois.
      for (const f of freiosDoDia) {
        if (!a.freios.has(f)) a.freios.set(f, { brl: 0, ops: 0, barradas: 0 });
        const acc = a.freios.get(f)!;
        if (freios.has(f)) acc.barradas += 1;
        else { acc.brl += brl; acc.ops += 1; }
      }
    }
  }

  const res: GrupoSombraResultado = {
    ...shape(grupo),
    por_modo: Object.fromEntries(Array.from(porModo.entries()).map(([m, a]) => [m, shape(a)])),
  };

  const agora = new Date().toISOString();
  const linha = (mode: string, a: Acc) => {
    const { por_freio, ...resto } = shape(a);
    return { mode, ...resto, sombra_por_freio: por_freio };
  };
  const rows = [
    linha("", grupo),
    ...Array.from(porModo.entries()).map(([m, a]) => linha(m, a)),
  ].map((r) => ({
    user_id: userId, symbol: symbolRoot, variant, trade_date: tradeDate,
    ...r, updated_at: agora,
  }));

  // Medição idêntica à última gravada não vira UPDATE: linha nova no Postgres
  // custa I/O e vacuum mesmo quando nenhum valor muda.
  const igual = anterior && JSON.stringify(anterior.res) === JSON.stringify(res);
  if (!igual) {
    const { error: upErr } = await supabase.from("b3_grupo_sombra_dia").upsert(
      rows,
      { onConflict: "user_id,symbol,variant,mode,trade_date" },
    );
    if (upErr) throw new Error(`sombra de grupo (gravação): ${upErr.message}`);
  }
  ultimaPorGrupo.set(chave, { at: Date.now(), res });
  // O cache é por processo e só guarda o dia corrente de cada grupo.
  if (ultimaPorGrupo.size > 200) {
    for (const k of Array.from(ultimaPorGrupo.keys()).slice(0, 100)) ultimaPorGrupo.delete(k);
  }
  return res;
}
