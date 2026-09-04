import { expect, it } from "vitest";
import { evaluateDailyCircuit } from "@/lib/b3-real-daily-circuit.server";
const cfg = { enabled: true, gain_target_pct: 0.4, loss_cap_pct: 0.25 };
it("meta com conta limpa arma", () => {
  const e = evaluateDailyCircuit({ config: cfg, base_brl: 930, realized_brl: 399, open_positions: 0, broker_stale: false });
  expect(e.gain_target_brl).toBe(372); expect(e.loss_cap_brl).toBe(232.5); expect(e.kind).toBe("meta_ganho");
});
it("meta com posicao aberta espera", () => {
  const e = evaluateDailyCircuit({ config: cfg, base_brl: 930, realized_brl: 399, open_positions: 1, broker_stale: false });
  expect(e.should_arm).toBe(false); expect(e.gain_waiting_flat).toBe(true);
});
it("perda arma na hora mesmo com posicao aberta", () => {
  const e = evaluateDailyCircuit({ config: cfg, base_brl: 930, realized_brl: -240, open_positions: 2, broker_stale: true });
  expect(e.kind).toBe("teto_perda");
});
it("desligado nao arma", () => {
  const e = evaluateDailyCircuit({ config: { ...cfg, enabled: false }, base_brl: 930, realized_brl: -900, open_positions: 0, broker_stale: false });
  expect(e.should_arm).toBe(false);
});
