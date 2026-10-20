import { describe, it, expect } from "vitest";
import { indexRealizedPeaks, peakSummary, candlePath, directionalEfficiency } from "./b3-cockpit-measurements";

describe("read-only cockpit measurements", () => {
  it("keeps the motor division identical for either side", () => {
    for (const amplitude of [1, 50, 1000]) for (const displacement of [-80, 0, 80]) {
      expect(directionalEfficiency(displacement, amplitude)).toBe(displacement / amplitude);
    }
  });
  it("takes max and mean of daily realized peaks, never a sum, asset from (ativo)", () => {
    const dates = ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19"];
    const picos = [-66, 2878, 3704, 2760, 238];
    const rows = dates.flatMap((trade_date, i) => [
      { trade_date, raiz: "WIN", variant: "(ativo)", pico_realizado_brl: picos[i], fechamento_brl: 0, devolveu_brl: 0, hora_do_pico_brt: null, ordens: 1 },
      { trade_date, raiz: "WIN", variant: "range", pico_realizado_brl: 99999, fechamento_brl: 0, devolveu_brl: 0, hora_do_pico_brt: null, ordens: 1 },
    ]);
    const idx = indexRealizedPeaks(rows, dates);
    const s = peakSummary(dates, idx.assets.WIN);
    expect(s.max).toBe(3704);
    expect(s.mean).toBeCloseTo(1902.8, 6);
    expect(s.count).toBe(5);
  });
  it("averages only existing days and never treats a missing day as zero", () => {
    expect(peakSummary(["a", "b", "c", "d", "e"], { a: 10, b: 20, c: 30, d: 40 })).toEqual({ max: 40, mean: 25, count: 4 });
    expect(peakSummary(["a"], {})).toEqual({ max: null, mean: null, count: 0 });
  });
  it("uses true M1 extrema and opening independent of display step", () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      minute_ts: new Date(Date.UTC(2026, 9, 9, 12, index)).toISOString(),
      candle_open: 100 + index, candle_high: 102 + index, candle_low: 99 + index, candle_close: 101 + index,
    }));
    for (const step of [5, 10, 15, 30, 60]) {
      const path = candlePath(rows, step);
      expect(path.amplitude).toBe(62);
      expect(path.efficiency).toBe(60 / 62);
      expect(path.points[0].price).toBe(100);
      expect(path.points.at(-1)?.price).toBe(160);
    }
  });
  it("never joins missing minutes and returns no data for missing days", () => {
    const candle = { candle_open: 100, candle_high: 110, candle_low: 90, candle_close: 105 };
    const path = candlePath([
      { ...candle, minute_ts: "2026-10-09T12:00:00Z" },
      { ...candle, minute_ts: "2026-10-09T12:10:00Z" },
    ], 30);
    expect(new Set(path.points.map((point) => point.segment)).size).toBe(2);
    expect(candlePath([], 30)).toEqual({ points: [], amplitude: null, efficiency: null, opening: null });
  });
});