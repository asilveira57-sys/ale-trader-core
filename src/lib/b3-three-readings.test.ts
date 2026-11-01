import { expect, it } from "vitest";
import { readingFor, threeHeaders, threePeriodData, type ThreeReading } from "./b3-three-readings";
it("keeps the three independent SQL results unchanged, including opposite signs", () => {
  const rows = [{ nivel: "modalidade", symbol: "WIN", variant: "rompimento", mode: null, sem_freio: 3397, com_freio: -484, com_freio_disjuntor: 1513 }] as ThreeReading[];
  expect(readingFor(rows, "WIN", "rompimento")).toEqual(rows[0]);
  expect(readingFor(rows, "WIN", "rompimento")?.com_freio).toBe(-484);
  expect(readingFor(rows, "WIN", "rompimento")?.com_freio_disjuntor).toBe(1513);
});
it("does not reconstruct SQL asset totals from robot results", () => {
  const rows = [{ nivel: "ativo", symbol: "WIN", sem_freio: 3397, com_freio: -484, com_freio_disjuntor: 1513, ordens: 123, ganhos: 70, acerto_pct: 56.9 }] as ThreeReading[];
  expect(threeHeaders(rows)[0].com_freio_disjuntor).toBe(1513);
  expect(threeHeaders(rows)[0].ordens).toBe(123);
});