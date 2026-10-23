import { describe, expect, it } from "vitest";
import { geoLinhas } from "./b3-ficha-geometria";

describe("geometria genérica da ficha", () => {
  it("mostra campo novo sem tradução pela chave original", () => {
    const l = geoLinhas({ campo_que_ainda_nao_existe: 1.23456 })!;
    expect(l).toEqual([{ chave: "campo_que_ainda_nao_existe", rotulo: "campo_que_ainda_nao_existe", valor: "1,235" }]);
  });
  it("destaca quórum no limite exato", () => {
    const l = geoLinhas({ soft_hits: 3, soft_min_hits: 3, soft_total: 4 })!;
    expect(l[0]!.valor).toBe("quórum 3 de 4, mínimo 3 — passou no limite exato");
    expect(l[0]!.destaque).toBe(true);
  });
  it("lista soft_failed e nulo vira sem geometria", () => {
    expect(geoLinhas({ soft_failed: ["candle atual não é vendedor"] })![0]!.valor).toBe("não passou: candle atual não é vendedor");
    expect(geoLinhas(null)).toBeNull();
  });
});
