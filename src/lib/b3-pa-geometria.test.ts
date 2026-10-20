import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { directionalEfficiency } from "./b3-cockpit-measurements";

// Run the actual pure classifier bodies, never import or tick the trading engine.
const source = readFileSync(new URL("./b3-simulation.functions.ts", import.meta.url), "utf8");
const start = source.indexOf("  function geometriaPA(");
const end = source.indexOf("  function classifySetupMeanReversion(", start);
if (start < 0 || end < 0) throw new Error("Price action classifier not found");
const constants = source.match(/^export const (LOOKBACK_PA|PA_EFICIENCIA_MIN|PA_POSICAO_MAX_COMPRA|PA_POSICAO_MIN_VENDA) = .*$/gm);
if (constants?.length !== 4) throw new Error("Legacy geometry fallbacks missing");
const code = ts.transpile((constants.join("\n").replaceAll("export ", "")) + "\n" + source.slice(start, end), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
const { geometry, classify } = new Function("directionalEfficiency", code + "\nreturn { geometry: geometriaPA, classify: classifySetupPriceAction };")(directionalEfficiency);

function candles(efficiency = 0.4, count = 20) {
  return Array.from({ length: count }, (_, i) => ({
    minute_ts: new Date(Date.UTC(2026, 9, 19, 12, i)).toISOString(),
    candle_low: 100, candle_high: 200,
    candle_close: 150 + efficiency * 100 * i / Math.max(1, count - 1),
  }));
}
const defaults = { pa_eficiencia_min: 0.30, pa_posicao_max_compra: 0.65, pa_posicao_min_venda: 0.35, pa_geometria_ativa: true };
const nulls = Object.fromEntries(Object.keys(defaults).map(k => [k, null]));
const params = (cfg = {}, m1Candles = candles(), side = "buy", price = 150) => ({
  cfg: { stop_pts: 100, gain_pts: 200, pa_estrutura_modo: "desligado", ...cfg },
  ctxLocal: { price, open: side === "buy" ? price - 1 : price + 1 }, intendedSide: side, m1Candles,
});

// Independent reference for the three pre-change gates and their strict boundaries.
function legacyVerdict(ef: number, pos: number, side: string) {
  if (Math.abs(ef) < 0.30) return "lateral";
  if ((side === "sell" && !(ef < 0)) || (side === "buy" && !(ef > 0))) return "contra_tendencia";
  if (side === "buy" && pos > 0.65) return "esticado";
  if (side === "sell" && pos < 0.35) return "esticado";
  return "confirmado";
}

describe("Price action configurable hard geometry gates", () => {
  it("keeps 0.30 / 0.65 / 0.35 / true and the legacy verdicts with default or NULL settings", () => {
    for (const cfg of [{}, defaults, nulls]) {
      for (const side of ["buy", "sell"]) {
        for (const ef of [-0.8, -0.3, -0.299, 0, 0.299, 0.3, 0.8]) {
          for (const pos of [-0.1, 0.3499, 0.35, 0.5, 0.65, 0.6501, 1.1]) {
            const g = geometry(candles(ef), 100 + pos * 100, side, cfg);
            expect(g).toMatchObject(defaults);
            expect(g.veredito).toBe(legacyVerdict(g.eficiencia_direcional, g.posicao_na_faixa, side));
          }
        }
      }
    }
  });
  it("reads pa_eficiencia_min from config, preserving strict less-than", () => {
    expect(geometry(candles(0.4), 150, "buy", { pa_eficiencia_min: 0.5 }).veredito).toBe("lateral");
    expect(geometry(candles(0.4), 150, "buy", { pa_eficiencia_min: 0.4 }).veredito).toBe("confirmado");
  });
  it("reads pa_posicao_max_compra from config, preserving strict greater-than", () => {
    expect(geometry(candles(), 150, "buy", { pa_posicao_max_compra: 0.49 }).veredito).toBe("esticado");
    expect(geometry(candles(), 150, "buy", { pa_posicao_max_compra: 0.5 }).veredito).toBe("confirmado");
  });
  it("reads pa_posicao_min_venda from config, preserving strict less-than", () => {
    expect(geometry(candles(-0.4), 150, "sell", { pa_posicao_min_venda: 0.51 }).veredito).toBe("esticado");
    expect(geometry(candles(-0.4), 150, "sell", { pa_posicao_min_venda: 0.5 }).veredito).toBe("confirmado");
  });
  it("false bypasses only lateral, contra_tendencia and esticado for both sides", () => {
    for (const side of ["buy", "sell"]) {
      const direction = side === "buy" ? 1 : -1;
      for (const [ef, price, verdict] of [[0.1 * direction, 150, "lateral"], [-0.4 * direction, 150, "contra_tendencia"], [0.4 * direction, side === "buy" ? 180 : 120, "esticado"]] as const) {
        expect(geometry(candles(ef), price, side, defaults).veredito).toBe(verdict);
        expect(geometry(candles(ef), price, side, { pa_geometria_ativa: false }).veredito).toBe("confirmado");
      }
    }
  });
  it("false never bypasses missing or unusable candles", () => {
    for (const data of [candles(0.4, 4), candles().map(c => ({ ...c, candle_high: 100 }))]) {
      expect(geometry(data, 150, "buy", { pa_geometria_ativa: false }).veredito).toBe("sem_candles");
      expect(classify(params({ pa_geometria_ativa: false }, data)).ok).toBe(false);
    }
  });
  it("records the four effective values in details including early returns", () => {
    const custom = { pa_eficiencia_min: 0.45, pa_posicao_max_compra: 0.7, pa_posicao_min_venda: 0.2, pa_geometria_ativa: false };
    for (const cfg of [defaults, custom, nulls]) {
      for (const data of [candles(), candles(0.4, 3)]) {
        expect(classify(params(cfg, data)).details).toMatchObject(cfg === nulls ? defaults : cfg);
      }
    }
    expect(classify(params({ pa_estrutura_modo: "dow_estrito" })).details).toMatchObject(defaults);
  });
  it("false leaves structure and the soft quorum intact", () => {
    expect(classify(params({ pa_geometria_ativa: false, pa_estrutura_modo: "dow_estrito" })).ok).toBe(false);
    expect(classify(params({ pa_geometria_ativa: false, setup_min_soft_hits_pa: 4 })).ok).toBe(false);
    expect(classify(params({ pa_geometria_ativa: false })).ok).toBe(true);
  });
});