// Magic number do espelhamento real (MT5). Módulo puro — nenhuma regra de
// motor aqui, apenas a numeração que separa robôs na conta real.
//
// magic = bloco do ativo + bloco da modalidade (500 em 500) + índice do modo (1..7).
// Ex.: WIN price_action semi_agressivo = 2000 + 500 + 4 = 2504.
//
// ATENÇÃO à espessura do bloco: cada ativo ocupa 1507 números (4 modalidades ×
// 500 + 7 modos), então blocos de ativo espaçados de 100 em 100 COLIDEM — WIN
// price_action (2500) cairia sobre BBDC4 indicador. Os quatro ativos originais
// mantêm os números que já estão em uso (2000..2300, teto 3805) e os seis novos
// entram acima disso, espaçados de 2000 em 2000. Dois robôs com o mesmo magic
// fechariam a posição um do outro no MT5 — o teste b3-magic.test.ts guarda isso.
//
// FALHA FECHADA: ativo ou modalidade não cadastrados aqui NÃO recebem número
// genérico — a função lança erro e o comando real não é enfileirado.

export const REAL_MAGIC_ASSET_BLOCK: Record<string, number> = {
  // originais — não mudar, há histórico de comandos com estes números
  WIN: 2000, WDO: 2100, PETR4: 2200, VALE3: 2300,
  // novos — acima do teto antigo (3805), espaçamento 2000
  ITUB4: 4000, BBDC4: 6000, BBAS3: 8000,
  BIT: 10000, ETR: 12000, SOL: 14000,
};


export const REAL_MAGIC_VARIANT_BLOCK: Record<string, number> = {
  indicador: 0, price_action: 500, mean_reversion: 1000, range: 1500,
};

// ORDEM NUMÉRICA ≠ ORDEM DE AGRESSIVIDADE — DELIBERADO (29/08/2026)
//
// `cauteloso` fica entre conservador e moderado, e `arrojado` entre
// semi_agressivo e agressivo. Encaixá-los na posição lógica (cauteloso=2)
// empurraria moderado 2→3, equilibrado 3→4, semi_agressivo 4→5: o magic 2504
// (WIN price_action semi_agressivo) deixaria de existir. Esse número tem
// dinheiro real na XP e está gravado na lista branca ROBOS_REAIS do executor,
// no VPS — fora do alcance de qualquer migração daqui.
//
// Por isso os dois modos novos entram NO FIM, com 6 e 7. Nenhum magic em uso
// muda. Mesmo espírito do bloco alto do rompimento logo abaixo: preservar a
// numeração em uso vale mais que a elegância da sequência.
export const REAL_MAGIC_MODE_INDEX: Record<string, number> = {
  conservador: 1, moderado: 2, equilibrado: 3, semi_agressivo: 4, agressivo: 5,
  cauteloso: 6, arrojado: 7,
};


// ────────────────────────────────────────────────────────────────────────────
// QUINTA MODALIDADE EM DIANTE — BLOCO ALTO SEPARADO (25/08/2026)
//
// Por que a fórmula muda aqui: o esquema acima não comporta uma quinta
// modalidade. Com modalidades em +0/+500/+1000/+1500, uma quinta em +2000
// colide com o bloco do próximo ativo: WIN (2000) + rompimento (2000) =
// 4000 = ITUB4 (4000) + indicador (0). Os cinco modos do rompimento do WIN
// cairiam exatamente em cima dos cinco do indicador do ITUB4. Magic é como o
// executor identifica o dono de uma posição na corretora — colisão significa
// fechar a posição do robô errado, e existe dinheiro real autorizado no
// magic 2504.
//
// Decisão: NENHUM magic existente muda (sem migração) e, a partir da quinta
// modalidade, a fórmula passa a ser:
//
//   magic = bloco_alto_da_modalidade + (índice_do_ativo × 100) + índice_do_modo
//
// com índice do modo começando em 0 (conservador=0 … agressivo=4) e índice do
// ativo na MESMA ordem dos blocos acima (WIN=0, WDO=1, PETR4=2, VALE3=3,
// ITUB4=4, BBDC4=5, BBAS3=6, BIT=7, ETR=8, SOL=9).
//
//   rompimento: WIN 20000-20004, WDO 20100-20104, …, SOL 20900-20904.
//
// O padrão se estende: sexta modalidade em 21000, sétima em 22000. NÃO
// "unificar" as duas fórmulas depois — a inconsistência é deliberada e é o
// que preserva os magics já em uso na corretora. O teste b3-magic.test.ts
// gera TODAS as combinações ativo × modalidade × modo e falha se houver
// qualquer repetição.
// ────────────────────────────────────────────────────────────────────────────
export const REAL_MAGIC_VARIANT_HIGH_BLOCK: Record<string, number> = {
  rompimento: 20000,
  pullback: 21000,
  vwap: 22000,
  // oitava modalidade: 23000, nona: 24000, …
};

export const REAL_MAGIC_ASSET_INDEX: Record<string, number> = {
  WIN: 0, WDO: 1, PETR4: 2, VALE3: 3, ITUB4: 4,
  BBDC4: 5, BBAS3: 6, BIT: 7, ETR: 8, SOL: 9,
};

// Mesma razão do bloco clássico: `cauteloso` e `arrojado` entram DEPOIS dos
// cinco atuais (índices 5 e 6), nunca na posição lógica de agressividade.
export const REAL_MAGIC_MODE_INDEX_V2: Record<string, number> = {
  conservador: 0, moderado: 1, equilibrado: 2, semi_agressivo: 3, agressivo: 4,
  cauteloso: 5, arrojado: 6,
};


export class MagicNumberNotRegisteredError extends Error {}

// Contratos futuros chegam com vencimento (WINQ26, BITQ26): reduz à raiz.
const rootOfSymbol = (s: string) => {
  const up = String(s ?? "").toUpperCase();
  const m = up.match(/^([A-Z]{3})[A-Z]\d{2}$/);
  return m ? m[1]! : up;
};

export function realMagicNumber(quoteSymbol: string, variant: string, mode: string): number {
  const root = rootOfSymbol(quoteSymbol);

  // Quinta modalidade em diante: bloco alto separado (ver comentário acima).
  const highBlock = REAL_MAGIC_VARIANT_HIGH_BLOCK[variant ?? "indicador"];
  if (highBlock != null) {
    const assetIndex = REAL_MAGIC_ASSET_INDEX[root];
    const modeIdx = REAL_MAGIC_MODE_INDEX_V2[mode];
    if (assetIndex == null) {
      throw new MagicNumberNotRegisteredError(
        `ativo sem índice de magic number cadastrado: ${root} (símbolo ${quoteSymbol})`,
      );
    }
    if (modeIdx == null) {
      throw new MagicNumberNotRegisteredError(`modo sem índice de magic number cadastrado: ${mode}`);
    }
    return highBlock + assetIndex * 100 + modeIdx;
  }

  const block = REAL_MAGIC_ASSET_BLOCK[root];
  const variantBlock = REAL_MAGIC_VARIANT_BLOCK[variant ?? "indicador"];
  const modeIndex = REAL_MAGIC_MODE_INDEX[mode];

  if (block == null) {
    throw new MagicNumberNotRegisteredError(
      `ativo sem bloco de magic number cadastrado: ${root} (símbolo ${quoteSymbol})`,
    );
  }
  if (variantBlock == null) {
    throw new MagicNumberNotRegisteredError(`modalidade sem bloco de magic number cadastrado: ${variant}`);
  }
  if (modeIndex == null) {
    throw new MagicNumberNotRegisteredError(`modo sem índice de magic number cadastrado: ${mode}`);
  }

  return block + variantBlock + modeIndex;
}
