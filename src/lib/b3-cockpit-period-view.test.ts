import { expect, it } from "vitest";
import { maximumDaily, periodCards, CLOSED_PERIOD } from "./b3-cockpit-period-view";
it("keeps robots without orders in the period", () => {
  const rows = periodCards([{ symbol: "WIN", variant: "range", mode: "conservador" }], []);
  expect(rows).toHaveLength(1); expect(rows[0].ops).toBe(0); expect(rows[0].open).toBeNull();
});
it("uses the largest daily peak with its date, never the sum", () => {
  const result = maximumDaily([{ trade_date: "2026-10-21", peak: 100 }, { trade_date: "2026-10-23", peak: 300 }], (r) => r.peak);
  expect(result).toEqual({ trade_date: "2026-10-23", peak: 300 });
});