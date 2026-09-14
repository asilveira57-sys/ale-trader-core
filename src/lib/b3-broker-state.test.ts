import { describe, expect, it } from "vitest";
import { readBrokerMagicState } from "@/lib/b3-broker-state.server";

const fake = (row: any) => ({
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
    }),
  }),
});

const now = Date.parse("2026-09-14T18:00:00.000Z");

describe("readBrokerMagicState", () => {
  it("soma contratos por magic e marca relatório fresco", async () => {
    const s = await readBrokerMagicState(fake({
      reportado_em: "2026-09-14T17:59:50.000Z",
      posicoes: [{ magic: 2507, volume: 1 }, { magic: 2507, volume: 2 }, { magic: 2504, volume: 0 }],
    }), "u", now);
    expect(s.stale).toBe(false);
    expect(s.qty_by_magic.get(2507)).toBe(3);
    expect(s.qty_by_magic.get(2504)).toBeUndefined();
  });

  it("relatório com mais de 60s é velho", async () => {
    const s = await readBrokerMagicState(fake({ reportado_em: "2026-09-14T17:58:00.000Z", posicoes: [] }), "u", now);
    expect(s.stale).toBe(true);
  });

  it("sem linha nenhuma: sem prova de nada", async () => {
    const s = await readBrokerMagicState(fake(null), "u", now);
    expect(s.reported).toBe(false);
    expect(s.stale).toBe(true);
  });
});
