import { expect, it } from "vitest";
import { readingFor, type ThreeReading } from "./b3-three-readings";
it("keeps the three independent SQL results unchanged, including opposite signs", () => {
  const rows = [{ nivel: "modalidade", symbol: "WIN", variant: "rompimento", mode: null, sem_freio: 3397, com_freio: -484, com_freio_disjuntor: 1513 }] as ThreeReading[];
  expect(readingFor(rows, "WIN", "rompimento")).toEqual(rows[0]);
  expect(readingFor(rows, "WIN", "rompimento")?.com_freio).toBe(-484);
  expect(readingFor(rows, "WIN", "rompimento")?.com_freio_disjuntor).toBe(1513);
});