import { describe, it, expect } from "vitest";
import { capacityBase, derivedPeakFloor, disjuntorInput, disjuntorTotals, sessionDates, disjuntorBadgeText, type DisjuntorRow } from "./b3-disjuntor-view";
describe("disjuntor WIN somente leitura", () => {
  const capacity = Array.from({ length: 48 }, (_,i) => ({ symbol: "WIN", variant: `v${Math.floor(i/8)}`, mode: String(i%8), max_contracts: 1, margin_per_contract_brl: 155 }));
  it("capacidade WIN 48 robôs = 7440 e teto 25% = 1860", () => { expect(capacityBase(capacity)).toBe(7440); expect(capacityBase(capacity)*.25).toBe(1860); });
  it("modalidade 8 robôs = 1240 e teto 25% = 310", () => { expect(capacityBase(capacity.slice(0,8))).toBe(1240); expect(capacityBase(capacity.slice(0,8))*.25).toBe(310); });
  it("capital informado vence a capacidade", () => { expect(capacityBase(capacity,4030)).toBe(4030); });
  it("10/11 total usa chamada própria +1457, não a soma das modalidades -6696", () => {
    const row = { dia: "2026-11-10", nivel: "total", perda_pct: .25, ordens_no_dia: 150, ordens_antes: 14, ordens_evitadas: 136, resultado_sem_disjuntor_brl: 9658, resultado_com_disjuntor_brl: 1457, diferenca_brl: -8201 } as DisjuntorRow;
    const modalities = [-6546,2450,-380,640,-2860].map(n => ({ ...row, nivel: "modalidade" as const, resultado_com_disjuntor_brl: n }));
    expect(disjuntorTotals([row, { ...row, nivel: "ativo" }, ...modalities])[0]?.com).toBe(1457);
    expect(disjuntorTotals(modalities)).toEqual([]);
    expect(disjuntorTotals([row])[0]?.sem).toBe(9658);
  });
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
    const row = { nivel: "total", dia: "2026-10-23", ordens_no_dia: 153, ordens_antes: 10, ordens_evitadas: 143, resultado_com_disjuntor_brl: -1068, resultado_sem_disjuntor_brl: -3436, diferenca_brl: 2368, perda_pct: .25 } as DisjuntorRow;
    const result = disjuntorTotals([row, { ...row, dia: "2026-10-26" }, { ...row, perda_pct: .4, resultado_com_disjuntor_brl: -1672 }]);
    expect(result[0]?.com).toBe(-2136); expect(result[0]?.sem).toBe(-6872); expect(result[0]?.pregoes).toBe(2); expect(result[1]?.com).toBe(-1672);
  });
  it("não disparou preserva os dois resultados e diferença zero", () => {
    const row = { nivel: "total", dia: "2026-11-09", perda_pct: .25, ordens_no_dia: 153, ordens_antes: 153, ordens_evitadas: 0, resultado_com_disjuntor_brl: 308, resultado_sem_disjuntor_brl: 308, diferenca_brl: 0 } as DisjuntorRow;
    const total = disjuntorTotals([row])[0];
    expect(total?.com).toBe(308); expect(total?.sem).toBe(308); expect(total?.diferenca).toBe(0);
  });
  it("recusa somar duas chamadas do mesmo dia e limiar", () => {
    const row = { nivel: "total", dia: "2026-11-10", perda_pct: .25, ordens_no_dia: 184, resultado_com_disjuntor_brl: 1457 } as DisjuntorRow;
    expect(() => disjuntorTotals([row, row])).toThrow("Mais de um cenário TOTAL");
  });
});
