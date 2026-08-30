import { describe, expect, it } from "vitest";
import {
  computeGlobalRealStop, effectiveRealDailyLossBrl, threeStopsRealBrl, toRealBrl,
} from "./b3-real-sizing";

// Configuração real de hoje: WIN price_action, valor do ponto R$ 0,20,
// simulado a 5 contratos, real a 1 contrato.
const PV = 0.2;
const robots = (qty: number) => [
  { symbol: "WIN", variant: "price_action", mode: "moderado", enabled: true, max_qty: qty, stop_pts: 240, point_value_brl: PV },
  { symbol: "WIN", variant: "price_action", mode: "equilibrado", enabled: true, max_qty: qty, stop_pts: 280, point_value_brl: PV },
  { symbol: "WIN", variant: "price_action", mode: "semi_agressivo", enabled: true, max_qty: qty, stop_pts: 320, point_value_brl: PV },
];

describe("stop global derivado", () => {
  it("dá R$ 504 com os três robôs ligados a 1 contrato", () => {
    const g = computeGlobalRealStop(robots(1));
    expect(g.robots.map((r) => r.three_stops_brl)).toEqual([144, 168, 192]);
    expect(g.total_brl).toBe(504);
  });

  it("dobra para R$ 1.008 a 2 contratos", () => {
    expect(computeGlobalRealStop(robots(2)).total_brl).toBe(1008);
  });

  it("ignora robô desligado", () => {
    const r = robots(1);
    r[2]!.enabled = false;
    expect(computeGlobalRealStop(r).total_brl).toBe(312);
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
