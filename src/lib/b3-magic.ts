// Magic number do espelhamento real (MT5). Módulo puro — nenhuma regra de
// motor aqui, apenas a numeração que separa robôs na conta real.
//
// magic = bloco do ativo + bloco da modalidade (500 em 500) + índice do modo (1..5).
// Ex.: WIN price_action semi_agressivo = 2000 + 500 + 4 = 2504.
//
// ATENÇÃO à espessura do bloco: cada ativo ocupa 1505 números (4 modalidades ×
// 500 + 5 modos), então blocos de ativo espaçados de 100 em 100 COLIDEM — WIN
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

export const REAL_MAGIC_MODE_INDEX: Record<string, number> = {
  conservador: 1, moderado: 2, equilibrado: 3, semi_agressivo: 4, agressivo: 5,
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
