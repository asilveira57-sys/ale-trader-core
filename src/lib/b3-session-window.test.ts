import { expect, it } from "vitest";
import { newestSessions, sessionWindow } from "./b3-session-window";
it("uses five trading dates ending 04/11, without occupying rows with holidays", () => {
  const dates = ["2026-11-04", "2026-11-03", "2026-10-30", "2026-10-29", "2026-10-28"];
  expect(sessionWindow(dates)).toEqual({ start: "2026-10-28", end: "2026-11-04" });
  expect(newestSessions([...dates].reverse().map(dia => ({ dia }))).map(r => r.dia)).toEqual(dates);
});
it("uses the tenth session as the start without changing supplied results", () => {
  const dates = ["2026-11-04", "2026-11-03", "2026-10-30", "2026-10-29", "2026-10-28", "2026-10-27", "2026-10-26", "2026-10-23", "2026-10-22", "2026-10-21"];
  expect(sessionWindow(dates)).toEqual({ start: "2026-10-21", end: "2026-11-04" });
  const rows = [{ dia: dates[1], com_freio: -484 }, { dia: dates[0], com_freio: 123 }];
  expect(newestSessions(rows)[1]).toBe(rows[0]);
});
it("does not invent a session for an empty database response", () => {
  expect(sessionWindow([])).toBeNull();
});