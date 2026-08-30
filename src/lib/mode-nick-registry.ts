// Registro de apresentação dos apelidos dos modos, alimentado por
// useModeApelidos a partir de public.b3_mode_apelidos. Existe para que os
// módulos de cópia/exportação (texto, CSV, XLSX, PDF) usem o MESMO rótulo das
// telas sem receber o resolvedor em cada chamada.
//
// Nada aqui é identidade: a chave continua sendo `mode`.

export interface ModeNickRow {
  mode: string;
  apelido: string;
  ordem: number;
  rotulo_tecnico: string;
}

let rows: ModeNickRow[] = [];
let byMode = new Map<string, ModeNickRow>();

export function setModeNicks(next: ModeNickRow[]) {
  rows = next ?? [];
  byMode = new Map(rows.map((r) => [String(r.mode), r]));
}

const fallback = (mode: string) => {
  const s = String(mode ?? "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
};

/** Apelido em destaque. Modo fora da tabela cai no nome técnico. */
export const modeNick = (mode: string | null | undefined) =>
  byMode.get(String(mode ?? ""))?.apelido || fallback(String(mode ?? ""));

/** Rótulo técnico. */
export const modeTechLabel = (mode: string | null | undefined) =>
  byMode.get(String(mode ?? ""))?.rotulo_tecnico || fallback(String(mode ?? ""));

/** "Davi (Semi agressivo)" — para texto puro, CSV e PDF. */
export const modeFullLabel = (mode: string | null | undefined) => {
  const n = modeNick(mode);
  const t = modeTechLabel(mode);
  return t && t !== n ? `${n} (${t})` : n;
};

/** Coluna `ordem` (1..8); desconhecido vai para o fim. */
export const modeOrdem = (mode: string | null | undefined) =>
  byMode.get(String(mode ?? ""))?.ordem ?? 999;
