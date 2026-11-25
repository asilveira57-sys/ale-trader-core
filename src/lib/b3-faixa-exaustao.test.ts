import { describe, expect, it } from "vitest";
import { eficienciaContraOperacao } from "./b3-faixa-exaustao";

const agora = Date.parse("2026-11-24T14:00:30Z");
const vela = (minAtras: number, o: number, h: number, l: number, c: number) => ({
  minute_ts: new Date(Date.parse("2026-11-24T14:00:00Z") - minAtras * 60_000).toISOString(),
  candle_open: o, candle_high: h, candle_low: l, candle_close: c,
});

describe("chegada forte à borda da faixa", () => {
  // subida limpa de 100 para 200 em 10 velas
  const subida = Array.from({ length: 10 }, (_, i) => vela(10 - i, 100 + i * 10, 110 + i * 10, 100 + i * 10, 110 + i * 10));

  it("venda depois de subida forte = contra perto de +1", () => {
    const r = eficienciaContraOperacao(subida, "sell", 60, agora);
    expect(r.velas).toBe(10);
    expect(r.eficiencia).toBeCloseTo(1, 5);
  });

  it("compra depois da mesma subida = negativo", () => {
    expect(eficienciaContraOperacao(subida, "buy", 60, agora).eficiencia).toBeCloseTo(-1, 5);
  });

  it("ignora a vela do minuto atual e as de fora da janela", () => {
    const comAtual = [...subida, vela(0, 500, 900, 50, 50), vela(120, 0, 10000, 0, 9000)];
    expect(eficienciaContraOperacao(comAtual, "sell", 60, agora).eficiencia).toBeCloseTo(1, 5);
  });

  it("vai e volta no meio = perto de zero", () => {
    const zigue = [vela(4, 100, 150, 100, 150), vela(3, 150, 150, 100, 100), vela(2, 100, 150, 100, 150), vela(1, 150, 150, 100, 101), vela(5, 101, 150, 100, 100)];
    const r = eficienciaContraOperacao(zigue, "sell", 60, agora);
    expect(Math.abs(r.eficiencia ?? 9)).toBeLessThan(0.05);
  });

  it("menos de 5 velas não mede", () => {
    expect(eficienciaContraOperacao(subida.slice(0, 4), "sell", 60, agora)).toEqual({ eficiencia: null, velas: 4 });
  });
});
