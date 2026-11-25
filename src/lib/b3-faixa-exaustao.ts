// ── CHEGADA FORTE À BORDA DA FAIXA (24/11/2026, livreto 155) ────────────────
// Eficiência direcional dos últimos `janelaMin` minutos, medida no sentido
// CONTRA a operação de faixa: para venda (borda de cima) conta a subida, para
// compra (borda de baixo) conta a queda.
//   eficiência = (fechamento da última vela − abertura da primeira) / (máxima − mínima)
//   contra = eficiência × (+1 na venda, −1 na compra)
// Perto de +1: o preço chegou à borda num empurrão só (exaustão) — a faixa tem
// vantagem. Perto de 0: o preço está rodando no meio. Negativo: o preço veio do
// outro lado. Usa só velas FECHADAS (minuto anterior ao atual).

export type VelaM1 = {
  minute_ts: string;
  candle_open: number | string;
  candle_high: number | string;
  candle_low: number | string;
  candle_close: number | string;
};

export function eficienciaContraOperacao(
  velas: VelaM1[],
  lado: "buy" | "sell",
  janelaMin: number,
  agoraMs: number,
): { eficiencia: number | null; velas: number } {
  const minutoAtual = Math.floor(agoraMs / 60_000) * 60_000;
  const inicio = minutoAtual - janelaMin * 60_000;
  const dentro = (velas ?? [])
    .filter((v) => {
      const t = new Date(v.minute_ts).getTime();
      return Number.isFinite(t) && t >= inicio && t < minutoAtual;
    })
    .sort((a, b) => new Date(a.minute_ts).getTime() - new Date(b.minute_ts).getTime());
  if (dentro.length < 5) return { eficiencia: null, velas: dentro.length };
  const abertura = Number(dentro[0].candle_open);
  const fechamento = Number(dentro[dentro.length - 1].candle_close);
  const maxima = Math.max(...dentro.map((v) => Number(v.candle_high)));
  const minima = Math.min(...dentro.map((v) => Number(v.candle_low)));
  const amplitude = maxima - minima;
  if (![abertura, fechamento, maxima, minima].every(Number.isFinite) || !(amplitude > 0)) {
    return { eficiencia: null, velas: dentro.length };
  }
  const ef = (fechamento - abertura) / amplitude;
  return { eficiencia: lado === "sell" ? ef : -ef, velas: dentro.length };
}
