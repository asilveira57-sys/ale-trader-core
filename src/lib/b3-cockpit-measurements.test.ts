import { describe, it, expect } from "vitest";
import { aggregateDailyPeaks, peakSummary, candlePath, directionalEfficiency } from "./b3-cockpit-measurements";

describe("read-only cockpit measurements", () => {
  it("keeps the motor division identical for either side", () => {
    for (const amplitude of [1, 50, 1000]) for (const displacement of [-80, 0, 80]) {
      expect(directionalEfficiency(displacement, amplitude)).toBe(displacement / amplitude);
    }
  });
  it("sums robots within each date before taking the daily max and mean", () => {
    const dates = ["a", "b", "c", "d", "e"];
    const rows = dates.flatMap((trade_date, index) => [
      { trade_date, symbol: "WIN", variant: "indicador", mode: "a", pico_margem_brl: index * 10 },
      { trade_date, symbol: "WIN", variant: "price_action", mode: "b", pico_margem_brl: 100 - index * 10 },
    ]);
    const result = aggregateDailyPeaks(rows);
    expect(peakSummary(dates, result.assets.WIN)).toEqual({ max: 100, mean: 100, count: 5 });
    expect(peakSummary(dates, result.variants["WIN|indicador"])).toEqual({ max: 40, mean: 20, count: 5 });
  });
  it("does not invent zero or a five-day mean for absent measurements", () => {
    expect(peakSummary(["a", "b", "c", "d", "e"], { a: 10 })).toEqual({ max: 10, mean: null, count: 1 });
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