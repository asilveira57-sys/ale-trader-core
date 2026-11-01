import { expect, it } from "vitest";
import { marcoInput, marcosNoRecorte, type Marco } from "./b3-marcos";
it("global milestones are visible across assets while scoped milestones stay scoped", () => {
  const rows = [{ id: "a", data: "2026-10-26", escopo: "global" }, { id: "b", data: "2026-10-27", escopo: "ativo", symbol: "WDO" }] as Marco[];
  expect(marcosNoRecorte(rows, "2026-10-20", "2026-10-30", "WIN").map(r => r.id)).toEqual(["a"]);
});
it("modality milestones require an asset and a modality", () => {
  expect(marcoInput.safeParse({ data: "2026-10-27", titulo: "Mudança", descricao: "Configuração", escopo: "modalidade", symbol: "WIN", variant: null }).success).toBe(false);
});