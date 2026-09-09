// Freio escalonado por GRUPO (user_id, symbol, variant).
//
// Os cinco modos de um grupo não são cinco apostas independentes: são a mesma
// aposta no regime do ativo, repetida cinco vezes. O limite individual de perda
// só segura cada robô depois de gastar a cota inteira dele — em 24/08 isso
// custou WIN −7.815 e WDO −4.500 com doze robôs travados um a um.
//
// Este módulo é lógica pura: recebe configuração (b3_grupo_limites), estado do
// dia (b3_grupo_estado_dia) e o resultado do grupo AGORA (realizado + posição
// aberta marcada a mercado) e devolve o nível da escada e quem fica travado.
//
// REGRA INEGOCIÁVEL: travar significa bloquear ENTRADA NOVA. Stop, alvo,
// trailing e zeragem continuam rodando para toda posição aberta, sempre.
//
// ONDE ESSA REGRA VALE DE FATO (leia antes de confiar no parágrafo acima):
//
//   SIMULADO — desde 09/09/2026 vale integralmente. O travamento não bloqueia
//   entrada (ela sai marcada como sombra, ver b3-grupo-sombra.server.ts) e
//   TAMBÉM não fecha mais posição aberta: `close_reason = 'grupo_freio_lock'`
//   deixou de ser gerado no simulado. As posições terminam por stop, alvo,
//   trailing ou zeragem. Fechar no instante do travamento amputava o caminho
//   livre e enviesava `diferenca_brl` a favor da sombra.
//
//   REAL — a regra AINDA NÃO vale por inteiro: ao travar, o motor continua
//   enfileirando o fechamento das posições do grupo. Isso está EM REVISÃO e
//   será decidido com os números de b3_grupo_sombra_dia. Até lá, o real fecha.

export interface B3GrupoLimites {
  teto_brl: number;
  nivel1_pct: number;
  nivel2_pct: number;
  nivel3_pct: number;
  nivel4_pct: number;
  fator_contratos: number;
  histerese_pct: number;
  dwell_minutos: number;
  ativo: boolean;
}

export interface B3GrupoEstado {
  resultado_brl: number;
  pior_do_dia_brl: number;
  nivel_atual: number;
  multiplicador: number;
  ultima_mudanca_ts: string | null;
  robos_travados: string[];
}

export interface B3GrupoDecision {
  nivel: number;
  multiplicador: number;
  robos_travados: string[];
  resultado_brl: number;
  pior_do_dia_brl: number;
  ultima_mudanca_ts: string | null;
  changed: boolean;
  nivel_anterior: number;
  motivo: string | null;
  travados_novos: string[];
}

/** Nível que o resultado atual justifica, olhando só os degraus. */
function nivelPorResultado(R: number, l: B3GrupoLimites): number {
  const T = Math.abs(Number(l.teto_brl) || 0);
  if (T <= 0) return 0;
  const step = (pct: number) => -(Math.abs(Number(pct) || 0) / 100) * T;
  if (R <= step(l.nivel4_pct)) return 4;
  if (R <= step(l.nivel3_pct)) return 3;
  if (R <= step(l.nivel2_pct)) return 2;
  if (R <= step(l.nivel1_pct)) return 1;
  return 0;
}

const ACAO_POR_NIVEL: Record<number, string> = {
  1: "contratos pela metade",
  2: "robôs negativos travados",
  3: "robôs negativos travados (segunda rodada)",
  4: "grupo inteiro travado",
};

export function textoNivelGrupo(nivel: number, multiplicador: number): string {
  if (nivel <= 0) return "";
  if (nivel === 1) {
    const pct = Math.round(Math.max(0, Math.min(1, multiplicador)) * 100);
    return `nivel 1, contratos a ${pct}%`;
  }
  return `nivel ${nivel}, ${ACAO_POR_NIVEL[nivel] ?? "entradas bloqueadas"}`;
}

/**
 * Escada do freio de grupo.
 *
 * @param resultadoPorModo resultado do dia por modo (realizado + aberto a mercado)
 * @param R soma de resultadoPorModo (resultado do grupo agora)
 */
export function decideB3Grupo(args: {
  limites: B3GrupoLimites;
  estado: B3GrupoEstado;
  resultadoPorModo: Record<string, number>;
  R: number;
  nowIso: string;
}): B3GrupoDecision {
  const { limites: l, estado, resultadoPorModo, R, nowIso } = args;
  const T = Math.abs(Number(l.teto_brl) || 0);
  const prevNivel = Math.max(0, Math.min(4, Number(estado.nivel_atual) || 0));
  const travadosAntes = Array.isArray(estado.robos_travados) ? [...estado.robos_travados] : [];
  const pior = Math.min(Number(estado.pior_do_dia_brl ?? 0), R);

  const base: B3GrupoDecision = {
    nivel: prevNivel,
    multiplicador: prevNivel >= 1 ? clampFator(l.fator_contratos) : 1,
    robos_travados: travadosAntes,
    resultado_brl: R,
    pior_do_dia_brl: pior,
    ultima_mudanca_ts: estado.ultima_mudanca_ts ?? null,
    changed: false,
    nivel_anterior: prevNivel,
    motivo: null,
    travados_novos: [],
  };

  if (!l.ativo || T <= 0) {
    return { ...base, nivel: 0, multiplicador: 1, robos_travados: [] };
  }

  const alvo = nivelPorResultado(R, l);

  // Subida: o nível sobe de imediato, um degrau por vez não — vai direto ao
  // degrau que o resultado justifica.
  if (alvo > prevNivel) {
    const travados = [...travadosAntes];
    const negativos = Object.entries(resultadoPorModo)
      .filter(([, v]) => Number(v) < 0)
      .map(([k]) => k);
    if (alvo === 2 || alvo === 3) {
      for (const mode of negativos) if (!travados.includes(mode)) travados.push(mode);
    }
    if (alvo >= 4) {
      for (const mode of Object.keys(resultadoPorModo)) if (!travados.includes(mode)) travados.push(mode);
    }
    const novos = travados.filter((m) => !travadosAntes.includes(m));
    return {
      nivel: alvo,
      multiplicador: clampFator(l.fator_contratos),
      robos_travados: travados,
      resultado_brl: R,
      pior_do_dia_brl: pior,
      ultima_mudanca_ts: nowIso,
      changed: true,
      nivel_anterior: prevNivel,
      motivo: `Resultado do grupo ${R.toFixed(2)} BRL atingiu ${((Math.abs(R) / T) * 100).toFixed(0)}% do teto (${T.toFixed(2)} BRL) — nível ${alvo}: ${ACAO_POR_NIVEL[alvo]}.`,
      travados_novos: novos,
    };
  }

  // Descida: SOMENTE do nível 1 para 0, com histerese e dwell. Do nível 2 para
  // cima não há volta: dos 23 robô-dias que caíram mais de R$ 800 abaixo do
  // topo desde 17/08, nenhum terminou positivo.
  if (prevNivel === 1) {
    const limiteVolta = -(Math.abs(Number(l.histerese_pct) || 0) / 100) * T;
    const dwellMs = Math.max(0, Number(l.dwell_minutos) || 0) * 60_000;
    const desde = estado.ultima_mudanca_ts ? new Date(estado.ultima_mudanca_ts).getTime() : 0;
    const passou = !desde || (new Date(nowIso).getTime() - desde) >= dwellMs;
    if (R >= limiteVolta && passou) {
      return {
        nivel: 0,
        multiplicador: 1,
        robos_travados: travadosAntes,
        resultado_brl: R,
        pior_do_dia_brl: pior,
        ultima_mudanca_ts: nowIso,
        changed: true,
        nivel_anterior: prevNivel,
        motivo: `Resultado recuperou para ${R.toFixed(2)} BRL (acima de ${limiteVolta.toFixed(2)}) após ${l.dwell_minutos} min — nível 1 liberado.`,
        travados_novos: [],
      };
    }
  }

  return base;
}

function clampFator(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0.5;
  return Math.min(1, Math.max(0.05, n));
}

/** Contratos após o freio: arredonda para BAIXO, piso de 1. Nunca zero. */
export function aplicarFatorContratos(baseQty: number, multiplicador: number): number {
  const base = Math.max(1, Math.floor(Number(baseQty) || 1));
  const mul = Number(multiplicador);
  if (!Number.isFinite(mul) || mul >= 1) return base;
  return Math.max(1, Math.floor(base * Math.max(0.05, mul)));
}
