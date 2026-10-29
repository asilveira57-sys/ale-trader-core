export const LIVRO_TIPOS = ["achado", "retratacao", "mudanca_aplicada", "pedido_lovable", "decisao", "pendencia", "fechamento_do_dia"] as const;
export const LIVRO_STATUS = ["aberto", "confirmado", "suspeito", "retratado", "resolvido"] as const;
export type LivroRegistro = {
  id: string; data: string; tipo: string; titulo: string; corpo: string; status: string;
  retrata_id: string | null; referencias: unknown; criado_em: string; atualizado_em: string;
};

/** id retratado → registros que o retratam. Um registro é retratado se alguém aponta para ele. */
export function retratadoPor(rows: LivroRegistro[]): Map<string, LivroRegistro[]> {
  const m = new Map<string, LivroRegistro[]>();
  for (const r of rows) if (r.retrata_id) m.set(r.retrata_id, [...(m.get(r.retrata_id) ?? []), r]);
  return m;
}

export function filtrarLivro(rows: LivroRegistro[], f: { tipos: string[]; status: string; busca: string }) {
  const q = f.busca.trim().toLowerCase();
  return rows.filter((r) => (f.tipos.length === 0 || f.tipos.includes(r.tipo)) && (!f.status || r.status === f.status)
    && (!q || r.titulo.toLowerCase().includes(q) || r.corpo.toLowerCase().includes(q)));
}

export function agruparPorDia(rows: LivroRegistro[]): [string, LivroRegistro[]][] {
  const m = new Map<string, LivroRegistro[]>();
  for (const r of [...rows].sort((a, b) => b.data.localeCompare(a.data) || b.criado_em.localeCompare(a.criado_em))) m.set(r.data, [...(m.get(r.data) ?? []), r]);
  return [...m.entries()];
}

export function textoRegistro(r: LivroRegistro, por: Map<string, LivroRegistro[]>, todos: LivroRegistro[]): string {
  const quem = por.get(r.id) ?? [];
  const alvo = r.retrata_id ? todos.find((x) => x.id === r.retrata_id) : null;
  return [
    `${quem.length ? "[RETRATADO] " : ""}${r.titulo}`,
    `Data: ${r.data} · Tipo: ${r.tipo} · Status: ${r.status}`,
    quem.length ? `Retratado por: ${quem.map((q) => `${q.titulo} (${q.data})`).join("; ")}` : "Retratado por: sem registro",
    r.retrata_id ? `Retrata: ${alvo ? `${alvo.titulo} (${alvo.data})` : r.retrata_id}` : "Retrata: sem registro",
    `Referências: ${r.referencias == null ? "sem registro" : JSON.stringify(r.referencias)}`,
    "", r.corpo,
  ].join("\n");
}
