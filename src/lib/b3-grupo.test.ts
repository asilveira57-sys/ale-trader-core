import { describe, it, expect } from "vitest";
import { decideB3Grupo, type B3GrupoLimites } from "./b3-grupo.server";

const L: B3GrupoLimites = {
  teto_brl: 620, nivel1_pct: 50, nivel2_pct: 100, nivel3_pct: 150, nivel4_pct: 200,
  fator_contratos: 0.5, histerese_pct: 25, dwell_minutos: 15, ativo: true,
};
const t0 = "2026-10-26T16:18:00.000Z";
const est = (nivel: number, travados: string[]) => ({
  resultado_brl: -1300, pior_do_dia_brl: -3662, nivel_atual: nivel, multiplicador: 0.5,
  ultima_mudanca_ts: t0, robos_travados: travados,
});

describe("freio de grupo desce de nível", () => {
  it("nível 4 com grupo positivo volta a 0, destrava todos e restaura multiplicador após 15 min", () => {
    const d = decideB3Grupo({ limites: L, estado: est(4, ["a", "b"]), resultadoPorModo: { a: 1000, b: 1147 },
      R: 2147, nowIso: "2026-10-26T16:33:00.000Z" });
    expect(d.nivel).toBe(0);
    expect(d.multiplicador).toBe(1);
    expect(d.robos_travados).toEqual([]);
    expect(d.changed).toBe(true);
  });
  it("respeita o dwell de 15 min", () => {
    const d = decideB3Grupo({ limites: L, estado: est(4, ["a"]), resultadoPorModo: { a: 2147 },
      R: 2147, nowIso: "2026-10-26T16:32:00.000Z" });
    expect(d.nivel).toBe(4);
  });
  it("histerese: de 4 só desce quando R ≥ −200%+25% do teto (−1.085)", () => {
    const base = { limites: L, estado: est(4, ["a"]), resultadoPorModo: { a: -1100 }, nowIso: "2026-10-26T17:00:00.000Z" };
    expect(decideB3Grupo({ ...base, R: -1100 }).nivel).toBe(4);
    const d = decideB3Grupo({ ...base, resultadoPorModo: { a: -1000 }, R: -1000 });
    expect(d.nivel).toBe(3);
    expect(d.robos_travados).toEqual(["a"]);
  });
  it("ao descer para 2/3 só ficam travados os robôs ainda negativos", () => {
    const d = decideB3Grupo({ limites: L, estado: est(4, ["a", "b"]), resultadoPorModo: { a: -900, b: 100 },
      R: -800, nowIso: "2026-10-26T17:00:00.000Z" });
    expect(d.nivel).toBe(2);
    expect(d.robos_travados).toEqual(["a"]);
  });
});
