export type ThreeReading = {
  nivel: string; symbol: string | null; variant: string | null; mode: string | null;
  sem_freio: number; com_freio: number; com_freio_disjuntor: number;
  ordens: number; ganhos: number; perdas: number; acerto_pct: number | null;
  barradas: number; frase: string; saiu_no_alvo: number; saiu_no_stop: number; saiu_no_meio: number;
  pico_lucro?: number | null; pico_data?: string; pico_hora?: string;
  disparos?: { dia: string; motivo: string; hora: string | null; ordens_antes: number; ordens_no_dia: number }[];
};
export function readingFor(rows: ThreeReading[], symbol: string, variant?: string, mode?: string) {
  return rows.find(r => r.symbol === symbol && r.nivel === (mode ? "robo" : variant ? "modalidade" : "ativo") && (!variant || r.variant === variant) && (!mode || r.mode === mode));
}
export const readingText = (r?: ThreeReading) => r
  ? Object.entries(r).map(([key, value]) => `${key}: ${value == null ? "sem registro" : typeof value === "object" ? JSON.stringify(value) : value}`).join("\n")
  : "sem registro";