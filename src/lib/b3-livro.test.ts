import { describe, it, expect } from "vitest";
import { retratadoPor, textoRegistro, type LivroRegistro } from "./b3-livro";

const base = { tipo: "achado", corpo: "x", status: "aberto", referencias: null, criado_em: "2026-10-27T10:00:00Z", atualizado_em: "" };
const a: LivroRegistro = { ...base, id: "a", data: "2026-10-27", titulo: "Guardião atrasado", retrata_id: null };
const b: LivroRegistro = { ...base, id: "b", data: "2026-10-28", titulo: "Guardião não atrasa", tipo: "retratacao", retrata_id: "a" };

describe("livro de ocorrências", () => {
  it("registro apontado por retrata_id fica marcado RETRATADO com quem retratou", () => {
    const por = retratadoPor([a, b]);
    expect(por.get("a")?.map((r) => r.id)).toEqual(["b"]);
    expect(textoRegistro(a, por, [a, b])).toContain("[RETRATADO] Guardião atrasado");
    expect(textoRegistro(b, por, [a, b])).not.toContain("[RETRATADO]");
  });
});
