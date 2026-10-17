import { describe, expect, it } from "vitest";
import { simularDisjuntor } from "./b3-sim-disjuntor";

const o = (dia: string, h: string, net: number) => ({ dia, entry: `${dia}T${h}:00Z`, exit: `${dia}T${h}:30Z`, net, contrato: null });

describe("simularDisjuntor", () => {
  const ords = [o("2026-10-01", "12:00", -300), o("2026-10-01", "13:00", 500), o("2026-10-02", "12:00", 100), o("2026-10-03", "12:00", 60)];
  it("sem disjuntor soma tudo e mediana é do dia", () => {
    const c = simularDisjuntor(ords, ["2026-10-01", "2026-10-02", "2026-10-03"], 1000, null);
    expect(c.total).toBe(360); expect(c.mediana).toBe(100);
  });
  it("25% de 1000 corta operações que entram depois do disparo", () => {
    const c = simularDisjuntor(ords, ["2026-10-01", "2026-10-02", "2026-10-03"], 1000, 0.25);
    expect(c.total).toBe(-140); expect(c.disparos).toBe(1); expect(c.impedidas).toBe(1);
  });
  it("dia fora da lista não entra", () => {
    expect(simularDisjuntor(ords, ["2026-10-02"], 1000, null).pregoes).toBe(1);
  });
});
