import { describe, it, expect } from "vitest";
import { derivedPeakFloor, disjuntorInput, disjuntorTotals, sessionDates, disjuntorBadgeText, type DisjuntorRow } from "./b3-disjuntor-view";
describe("disjuntor WIN somente leitura", () => {
  it("capital vazio é nulo e perda padrão é 25%", () => {
    const input = disjuntorInput.parse({ start: "2026-10-23", end: "2026-10-23" });
    expect(input.capital).toBeNull(); expect(input.losses).toEqual([25]); expect(input.variants).toBeNull();
  });
  it("permite os seis limiares pedidos, incluindo 100%", () => {
    expect(disjuntorInput.parse({ start: "2026-10-23", end: "2026-10-23", losses: [15,25,40,50,75,100] }).losses).toEqual([15,25,40,50,75,100]);
  });
  it("piso acompanha stop global sem alterar 0,5", () => {
    expect(derivedPeakFloor(0.5, 192)).toEqual({ pct: 0.5, peak_min_brl: 96 });
    expect(derivedPeakFloor(0.5, 384)).toEqual({ pct: 0.5, peak_min_brl: 192 });
  });
  it("intervalo gera dias separados e exclui fim de semana", () => {
    expect(sessionDates("2026-10-23", "2026-10-26")).toEqual(["2026-10-23", "2026-10-26"]);
  });
  it("total mantém cenários separados, nunca soma limiares", () => {
    const row = { ordens_no_dia: 153, ordens_antes: 10, ordens_evitadas: 143, resultado_com_disjuntor_brl: -1068, resultado_sem_disjuntor_brl: -3436, diferenca_brl: 2368, perda_pct: .25 } as DisjuntorRow;
    const result = disjuntorTotals([row, { ...row }, { ...row, perda_pct: .4, resultado_com_disjuntor_brl: -1672 }]);
    expect(result[0]?.com).toBe(-2136); expect(result[0]?.sem).toBe(-6872); expect(result[0]?.pregoes).toBe(2); expect(result[1]?.com).toBe(-1672);
  });
  it("não disparou não é apresentado como armado", () => {
    expect(disjuntorBadgeText({ ordens_no_dia: 153, disparou: "não disparou" } as DisjuntorRow)).toBe("disjuntor não teria armado");
  });
});