import { modeFullLabel, modeTechLabel } from "./mode-nick-registry";

export interface BrakeEvidence {
  trade_date: string; raiz: string; variant: string; mode: string; apelido: string;
  com_freio_brl: number; sem_freio_brl: number; efeito_brl: number;
  freio_acionado: boolean; ordens: number; ordens_barradas: number; frase: string;
}
export interface ExposureEvidence {
  trade_date: string; raiz: string; variant: string; cenario: string;
  pico_contratos: number; pico_margem_brl: number; pico_margem_com_folga_brl: number;
  hora_do_pico_brt: string | null;
}
export const robotLabel = (mode: string, variant?: string, nick?: string) => {
  const full = modeFullLabel(mode);
  const technical = modeTechLabel(mode);
  const name = nick ? `${nick} (${technical})` : full.includes(" (") ? full : `${full} (${technical})`;
  return variant?.endsWith("_sc") && !name.includes(" SC")
    ? name.replace(/ \(/, " SC (") : name;
};
export const allConfirmed = (conf: { entradas?: number; confirmadas?: number } | null | undefined) =>
  Number(conf?.entradas ?? 0) > 0 && Number(conf?.entradas) === Number(conf?.confirmadas);
export const SHADOW_EXPLANATION = "No simulado a entrada barrada entra mesmo assim (sombra). Por isso o realizado é o 'sem freio'. O 'com freio' é a hipótese: o que teria sido se o freio barrasse de verdade, como acontece na conta real.";
// Only aggregate display wording; per-robot/modality wording is the RPC's frase.
export function aggregateBrakePhrase(com: number, sem: number, blocked: number | null) {
  if (blocked == null) return "sem registro";
  if (blocked === 0) return "não acionado";
  const value = Math.abs(com - sem).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return com > sem ? `o freio reduziu o prejuízo em ${value}` : com < sem ? `o freio custou ${value}` : "acionado, sem efeito no resultado";
}
export function groupBrake(rows: BrakeEvidence[], date: string, root?: string, variant?: string) {
  const list = rows.filter((r) => r.trade_date === date && r.mode !== "(modalidade)" && (!root || r.raiz === root) && (!variant || r.variant === variant));
  if (!list.length) return null;
  const blocked = list.reduce((s, r) => s + Number(r.ordens_barradas), 0);
  const com = list.reduce((s, r) => s + Number(r.com_freio_brl), 0);
  const sem = list.reduce((s, r) => s + Number(r.sem_freio_brl), 0);
  const rollup = root && variant ? rows.find((r) => r.trade_date === date && r.raiz === root && r.variant === variant && r.mode === "(modalidade)") : null;
  return { blocked, com, sem, frase: rollup?.frase ?? aggregateBrakePhrase(com, sem, blocked) };
}
export const exposureForAsset = (rows: ExposureEvidence[], date: string, root: string, scenario: string) =>
  rows.find((r) => r.trade_date === date && r.raiz === root && r.variant === "(ativo)" && r.cenario === scenario);