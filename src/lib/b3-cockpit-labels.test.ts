import { describe, it, expect } from "vitest";
import { allConfirmed, exposureForAsset, groupBrake, type BrakeEvidence } from "./b3-cockpit-labels";
const row = (blocked: number): BrakeEvidence => ({ trade_date: "2026-10-20", raiz: "WIN", variant: "indicador", mode: "moderado", apelido: "Bernardo", com_freio_brl: -50, sem_freio_brl: -50, efeito_brl: 0, freio_acionado: blocked > 0, ordens: 5, ordens_barradas: blocked, frase: "" });
describe("presentation evidence rules", () => {
  it("activation remains true with identical monetary results and a marked order", () => {
    expect(groupBrake([row(1)], "2026-10-20", "WIN")?.blocked).toBe(1);
    expect(groupBrake([row(0)], "2026-10-20", "WIN")?.blocked).toBe(0);
  });
  it("all confirmations uses entry counts, not monetary equality", () => {
    expect(allConfirmed({ entradas: 3, confirmadas: 3 })).toBe(true);
    expect(allConfirmed({ entradas: 3, confirmadas: 2 })).toBe(false);
    expect(allConfirmed({ entradas: 0, confirmadas: 0 })).toBe(false);
  });
  it("WIN exposure uses the asset row with 34 contracts and 6851, never modality peaks", () => {
    const base = { trade_date: "2026-10-20", raiz: "WIN", cenario: "sem freio", pico_margem_brl: 5270, pico_margem_com_folga_brl: 6851, pico_contratos: 34, hora_do_pico_brt: "11:05:24" };
    const result = exposureForAsset([{ ...base, variant: "(ativo)" }, { ...base, variant: "range", pico_contratos: 100 }], base.trade_date, "WIN", base.cenario);
    expect(result?.pico_contratos).toBe(34);
    expect(result?.pico_margem_com_folga_brl).toBe(6851);
    expect(result?.hora_do_pico_brt).toBe("11:05:24");
  });
});