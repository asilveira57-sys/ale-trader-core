import { describe, expect, it } from "vitest";
import { evaluateAccountPeak, DEFAULT_PEAK_GIVEBACK_PCT, DEFAULT_PEAK_MIN_BRL } from "./b3-real-account-peak.server";

// Curva real da conta em 31/08/2026 (resultado acumulado do dia, R$).
const CURVA: Array<[string, number]> = [
  ["09:41", -39],
  ["10:39", 477],
  ["10:47", 438],
  ["11:12", 258],
  ["11:23", 243],
  ["11:27", 182],
  ["12:01", 154],
  ["12:31", -7],
  ["15:04", -65],
];

function replay(pct = DEFAULT_PEAK_GIVEBACK_PCT, floor = DEFAULT_PEAK_MIN_BRL) {
  const config = { peak_giveback_pct: pct, peak_min_brl: floor };
  let peak = 0;
  let armed = false;
  let armedAt: string | null = null;
  let armedPeak = 0;
  for (const [hora, result] of CURVA) {
    const ev = evaluateAccountPeak({ peak_brl: peak, result_brl: result, config, already_armed: armed });
    peak = ev.peak_brl;
    if (ev.should_arm && !armed) { armed = true; armedAt = hora; armedPeak = peak; }
  }
  return { peak, armed, armedAt, armedPeak };
}

describe("freio de pico da conta real — curva de 31/08/2026", () => {
  it("arma às 11:12 com 35% e pico de R$ 477", () => {
    const r = replay();
    expect(r.peak).toBe(477);
    expect(r.armed).toBe(true);
    expect(r.armedAt).toBe("11:12");
    expect(r.armedPeak).toBe(477);
  });

  it("gatilho em R$ 310 (tolerância de R$ 167 sobre o pico de R$ 477)", () => {
    const ev = evaluateAccountPeak({
      peak_brl: 477, result_brl: 258,
      config: { peak_giveback_pct: 0.35, peak_min_brl: 100 },
    });
    expect(ev.allowed_giveback_brl).toBeCloseTo(166.95, 2);
    expect(ev.trigger_at_brl).toBeCloseTo(310.05, 2);
    expect(ev.given_back_brl).toBe(219);
    expect(ev.should_arm).toBe(true);
  });

  it("não arma às 10:47 (devolveu R$ 39 de R$ 167 tolerados)", () => {
    const ev = evaluateAccountPeak({
      peak_brl: 477, result_brl: 438,
      config: { peak_giveback_pct: 0.35, peak_min_brl: 100 },
    });
    expect(ev.given_back_brl).toBe(39);
    expect(ev.should_arm).toBe(false);
  });

  it("pico abaixo do piso é ruído e não arma nada", () => {
    const ev = evaluateAccountPeak({
      peak_brl: 80, result_brl: -50,
      config: { peak_giveback_pct: 0.35, peak_min_brl: 100 },
    });
    expect(ev.eligible).toBe(false);
    expect(ev.should_arm).toBe(false);
    expect(ev.trigger_at_brl).toBeNull();
  });

  it("uma vez armado, continua armado mesmo se o resultado voltar", () => {
    const ev = evaluateAccountPeak({
      peak_brl: 477, result_brl: 470,
      config: { peak_giveback_pct: 0.35, peak_min_brl: 100 },
      already_armed: true,
    });
    expect(ev.should_arm).toBe(true);
  });
});
