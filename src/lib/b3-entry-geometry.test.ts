import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Exercise the actual opening instrumentation without importing or executing
// the trading engine (which would require a live account and market context).
const source = readFileSync(new URL("./b3-simulation.functions.ts", import.meta.url), "utf8");
const start = source.indexOf("const instrumentation: any = {");
const end = source.indexOf("let insertedOrder:", start);
if (start < 0 || end < 0) throw new Error("Opening instrumentation not found");
const openingInstrumentation = new Function(
  "setupInfo", "cfg", "decision", "votes", "numOrNull",
  source.slice(start, end).replace("const instrumentation: any", "const instrumentation")
    .replace(/const g: any/g, "const g")
    .replace(/\(setupInfo as any\)/g, "setupInfo")
    .replace(/\(decision as any\)/g, "decision")
    .replace(/\(v: any\)/g, "(v)") + "return instrumentation;",
);

function evidence(details: unknown, style = "range") {
  return openingInstrumentation(
    { name: "valid_setup", details }, { entry_style: style }, {}, [],
    (value: unknown) => value == null || Number.isNaN(Number(value)) ? null : Number(value),
  );
}

describe("Geometry evidence on order opening", () => {
  it.each(["range", "repique", "vwap", "indicador", "mean_reversion", "rompimento", "price_action"])(
    "preserves the entire current details object for %s", (style) => {
      const details = {
        range_size_pts: 220, position_in_range: 0, soft_hits: 3,
        future_classifier_field: { reason: "recuo confirmado", values: [1, null, 0] },
      };
      expect(evidence(details, style).entrada_geometria).toBe(details);
      expect(evidence(details, style).entrada_geometria).toEqual(details);
    },
  );

  it.each([undefined, null])("stores NULL when details is %s", (details) => {
    expect(evidence(details).entrada_geometria).toBeNull();
  });

  it("keeps existing typed price action geometry alongside full details", () => {
    const details = { geo: { eficiencia_direcional: 0.4, posicao_na_faixa: 0.35, amplitude_pts: 220, velas: 20, veredito: "confirmado" }, stop_ref_origem: "estrutura" };
    expect(evidence(details, "price_action")).toMatchObject({
      entrada_geometria: details,
      geo_eficiencia_direcional: 0.4, geo_posicao_na_faixa: 0.35,
      geo_amplitude_pts: 220, geo_velas: 20, geo_veredito: "confirmado",
    });
    expect(evidence(details, "range").geo_eficiencia_direcional).toBeNull();
  });
});