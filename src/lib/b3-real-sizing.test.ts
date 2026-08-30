import { describe, expect, it } from "vitest";
import {
  brlFromMult, computeGlobalRealStop, effectiveRealDailyLossBrl, multFromBrl,
  threeStopsRealBrl, toRealBrl,
} from "./b3-real-sizing";

// Configuração real de hoje: WIN price_action, valor do ponto R$ 0,20,
// simulado a 5 contratos, real a 1 contrato.
const PV = 0.2;
// Limites manuais de hoje: Bernardo R$ 150 (3,13×), Camila R$ 160 (2,86×) e
// Davi R$ 160 (2,50×).
const robots = (qty: number, comManual = true) => [
  { symbol: "WIN", variant: "price_action", mode: "moderado", enabled: true, max_qty: qty, stop_pts: 240, point_value_brl: PV, manual_daily_loss_brl: comManual ? 150 : null },
  { symbol: "WIN", variant: "price_action", mode: "equilibrado", enabled: true, max_qty: qty, stop_pts: 280, point_value_brl: PV, manual_daily_loss_brl: comManual ? 160 : null },
  { symbol: "WIN", variant: "price_action", mode: "semi_agressivo", enabled: true, max_qty: qty, stop_pts: 320, point_value_brl: PV, manual_daily_loss_brl: comManual ? 160 : null },
];

describe("stop global derivado", () => {
  it("soma o limite EFETIVO de cada robô, não sempre 3 stops", () => {
    const g = computeGlobalRealStop(robots(1));
    expect(g.robots.map((r) => r.three_stops_brl)).toEqual([144, 168, 192]);
    // Bernardo trava nos 3 stops (144 < 150); Camila e Davi no manual (160).
    expect(g.robots.map((r) => r.effective_daily_loss_brl)).toEqual([144, 160, 160]);
    expect(g.total_brl).toBe(464);
  });

  it("sem limite manual, cai nos 3 stops de cada um: R$ 504", () => {
    expect(computeGlobalRealStop(robots(1, false)).total_brl).toBe(504);
  });

  it("ignora robô desligado", () => {
    const r = robots(1);
    r[2]!.enabled = false;
    expect(computeGlobalRealStop(r).total_brl).toBe(304);
  });
});

describe("perda diária digitada como multiplicador de stop", () => {
  it("Davi: 2,50× em 320 pts a 1 contrato dá R$ 160", () => {
    expect(brlFromMult(2.5, 320, PV, 1)).toBe(160);
  });
  it("Bernardo: R$ 150 em 240 pts equivale a 3,13×", () => {
    expect(multFromBrl(150, 240, PV, 1)).toBe(3.13);
  });
  it("Camila: R$ 160 em 280 pts equivale a 2,86×", () => {
    expect(multFromBrl(160, 280, PV, 1)).toBe(2.86);
  });
  it("multiplicador é adimensional: o mesmo 2,5 dobra em reais a 2 contratos", () => {
    expect(brlFromMult(2.5, 320, PV, 2)).toBe(320);
  });
  it("digitar 4,0 não passa do teto de 3 stops", () => {
    const digitado = brlFromMult(4, 320, PV, 1);
    expect(digitado).toBe(256);
    expect(effectiveRealDailyLossBrl(digitado, 320, PV, 1).limit_brl).toBe(192);
  });
});

describe("conversão de R$ pelo tamanho real", () => {
  it("limite de R$ 960 do semi_agressivo (5 contratos) vira R$ 192 a 1 contrato", () => {
    expect(toRealBrl(960, 5, 1)).toBe(192);
  });
  it("a 2 contratos vira R$ 384", () => {
    expect(toRealBrl(960, 5, 2)).toBe(384);
  });
});

describe("quem trava primeiro: o menor", () => {
  it("manual frouxo não afrouxa (semi_agressivo: 250 manual vs 192 de 3 stops)", () => {
    const e = effectiveRealDailyLossBrl(250, 320, PV, 1);
    expect(e.limit_brl).toBe(192);
    expect(e.origem).toBe("tres_stops");
  });
  it("manual apertado continua valendo (equilibrado: 160 manual vs 168 de 3 stops)", () => {
    const e = effectiveRealDailyLossBrl(160, 280, PV, 1);
    expect(e.limit_brl).toBe(160);
    expect(e.origem).toBe("manual");
  });
  it("moderado: 150 manual vs 144 de 3 stops → 144", () => {
    expect(effectiveRealDailyLossBrl(150, 240, PV, 1).limit_brl).toBe(144);
  });
  it("sem manual, vale só a regra dos 3 stops", () => {
    expect(effectiveRealDailyLossBrl(null, 320, PV, 1).limit_brl).toBe(threeStopsRealBrl(320, PV, 1));
  });
});
