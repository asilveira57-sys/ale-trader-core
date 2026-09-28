import { describe, it, expect } from "vitest";
import { nivelProtecao, protegeMais } from "./b3-trailing";
const base = { trailing_mode: "fixed", breakeven_ativa_pts: 0, breakeven_folga_pts: 0 };
describe("trailing 28/09 WINV26 price_action", () => {
  const casos = [["agressivo",288,172.8],["arrojado",290,175],["moderado",320,190],["equilibrado",335,200]] as const;
  for (const [m,a,g] of casos) it(`${m} arma e protege lucro`, () => {
    const r = nivelProtecao({ side: "buy", entry: 184595, peakPts: 340, tick: 5, cfg: { ...base, trailing_activation_pts: a, trailing_giveback_pts: g } });
    expect(r).not.toBeNull(); expect(r!.level).toBeGreaterThan(184595);
  });
  it("semi_agressivo não arma", () => {
    expect(nivelProtecao({ side: "buy", entry: 184595, peakPts: 340, tick: 5, cfg: { ...base, trailing_activation_pts: 385, trailing_giveback_pts: 230 } })).toBeNull();
  });
  it("agressivo no gatilho exato → 184.710", () => {
    expect(nivelProtecao({ side: "buy", entry: 184595, peakPts: 288, tick: 5, cfg: { ...base, trailing_activation_pts: 288, trailing_giveback_pts: 172.8 } })!.level).toBe(184710);
  });
  it("breakeven zero = desligado", () => {
    expect(nivelProtecao({ side: "buy", entry: 100, peakPts: 1000, tick: 5, cfg: { ...base, trailing_activation_pts: 0, trailing_giveback_pts: 0 } })).toBeNull();
  });
  it("venda espelhada e stop nunca volta", () => {
    const r = nivelProtecao({ side: "sell", entry: 1000, peakPts: 300, tick: 5, cfg: { ...base, trailing_activation_pts: 200, trailing_giveback_pts: 100 } });
    expect(r!.level).toBe(800);
    expect(protegeMais("sell", 850, 800)).toBe(false);
    expect(protegeMais("buy", 184700, 184710)).toBe(false);
  });
});
