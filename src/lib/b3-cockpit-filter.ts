// Filtro do cockpit simulado — recorte por ativo, modalidade e modo.
//
// Mora fora do módulo do motor de propósito: é regra de TELA. O servidor usa
// para que placar, testeira e cards descrevam o mesmo subconjunto; a tela usa
// para montar os controles e o aviso de "filtro ativo". Nenhuma decisão de
// entrada, comitê, classificador ou freio passa por aqui.
//
// O filtro de ativo trabalha com a RAIZ (WIN, WDO, PETR4): o contrato rola de
// vencimento e ninguém quer remarcar "WINV26" a cada rolagem.

export interface CockpitFilterInput {
  variant?: string | null;
  variants?: string[] | null;
  symbols?: string[] | null;
  modes?: string[] | null;
}

export interface CockpitFilter {
  variants: Set<string> | null;
  symbols: Set<string> | null;
  modes: Set<string> | null;
  active: boolean;
}

/** Raiz do ativo: WINV26 -> WIN, WDOU26 -> WDO, PETR4 -> PETR4. */
export function cockpitRootSymbol(symbol: string | null | undefined): string {
  const s = String(symbol ?? "").toUpperCase();
  const m = s.match(/^([A-Z]{3})[FGHJKMNQUVXZ]\d{2}$/);
  return m ? m[1] : s;
}

const clean = (arr: string[] | null | undefined): Set<string> | null => {
  if (!Array.isArray(arr)) return null;
  const vals = arr.map((v) => String(v)).filter((v) => v && v !== "all");
  // Lista vazia significa "nada selecionado" e é respeitada como tal — quem
  // desmarca todos os ativos espera ver a tela vazia, não a tela inteira.
  return new Set(vals);
};

export function buildCockpitFilter(input?: CockpitFilterInput | null): CockpitFilter {
  const legacy = input?.variant && input.variant !== "all" ? [String(input.variant)] : null;
  const variants = clean(input?.variants) ?? (legacy ? new Set(legacy) : null);
  const symbols = clean(input?.symbols);
  const modes = clean(input?.modes);
  return {
    variants, symbols, modes,
    active: !!(variants || symbols || modes),
  };
}

/** Um robô passa quando atende os três recortes ao mesmo tempo. */
export function cockpitKeep(
  f: CockpitFilter,
  symbol: string | null | undefined,
  variant: string | null | undefined,
  mode?: string | null,
): boolean {
  if (f.symbols && !f.symbols.has(cockpitRootSymbol(symbol))) return false;
  if (f.variants && !f.variants.has(String(variant ?? "indicador"))) return false;
  if (mode != null && f.modes && !f.modes.has(String(mode))) return false;
  return true;
}
