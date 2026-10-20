import { describe, expect, it } from "vitest";
import { brakeNotActivated, totalBlocked, cockpitBrakeEffect } from "./b3-cockpit-brake";

describe("cockpit brake source and activation", () => {
  it("uses marked-order counts, not equal monetary pairs, to determine activation", () => {
    expect(brakeNotActivated(0)).toBe(true);
    expect(brakeNotActivated(2)).toBe(false);
    expect(brakeNotActivated(null)).toBe(false);
    const day = { date: "2026-10-19", com_freio_brl: -690, sem_freio_brl: -690, ordens: 10, barrados: 2 };
    const effect = cockpitBrakeEffect([{ symbol: "WIN", days: [day], by_variant: [] }], [day.date]);
    expect(effect.days[0].efeito).toBe(0);
    expect(brakeNotActivated(effect.days[0].barrados)).toBe(false);
  });
  it("keeps the total not activated only when all five days have zero marked orders", () => {
    expect(totalBlocked(Array.from({ length: 5 }, () => ({ barrados: 0 })))).toBe(0);
    expect(totalBlocked([{ barrados: 0 }, { barrados: 1 }])).toBe(1);
    expect(totalBlocked([{ barrados: 0 }, { barrados: null }])).toBeNull();
  });
  it("subtracts the RPC pairs exactly: WIN faixa 19/10 saves 1260", () => {
    const day = { date: "2026-10-19", com_freio_brl: -1038, sem_freio_brl: -2298, ordens: 59, barrados: 26 };
    const r = cockpitBrakeEffect([{ symbol: "WIN", days: [day], by_variant: [{ variant: "range", days: [day] }] }], [day.date]);
    expect(r.days[0].efeito).toBe(1260);
    expect(r.days[0].ordens).toBe(59);
    expect(r.top[0].salvou).toBe(1260);
  });
  it("sums the four corrected aggregate effects to 14089", () => {
    const values = [6031, 2533, 6649, -1124];
    const dates = ["2026-10-19", "2026-10-16", "2026-10-15", "2026-10-14"];
    const days = dates.map((date, i) => ({ date, com_freio_brl: values[i], sem_freio_brl: 0, ordens: 1, barrados: 1 }));
    expect(cockpitBrakeEffect([{ symbol: "ALL", days, by_variant: [] }], dates).saldo).toBe(14089);
  });
});