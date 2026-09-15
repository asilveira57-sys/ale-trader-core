import { describe, it, expect, vi, afterEach } from "vitest";
import { atualizarGrupoSombraDia } from "./b3-grupo-sombra.server";

// Fake mínimo: a leitura devolve sempre as mesmas ordens do dia e a gravação
// só conta quantas vezes foi chamada.
function fakeSupabase(orders: any[]) {
  const state = { upserts: 0 };
  const leitura: any = {
    select: () => leitura, eq: () => leitura, not: () => leitura,
    gte: () => leitura, lt: () => leitura,
    limit: async () => ({ data: orders, error: null }),
  };
  const client: any = {
    from: (table: string) => table === "b3_grupo_sombra_dia"
      ? { upsert: async () => { state.upserts += 1; return { error: null }; } }
      : leitura,
  };
  return { client, state };
}

const ORDS = [
  { mode: "score", net_result_brl: 100, bloqueado_na_sombra: false },
  { mode: "score", net_result_brl: -40, bloqueado_na_sombra: true },
];

afterEach(() => vi.useRealTimers());

describe("consolidação da sombra do freio", () => {
  it("grava uma vez e pula as passadas do mesmo minuto, devolvendo os mesmos números", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T14:00:00Z"));
    const { client, state } = fakeSupabase(ORDS);

    const a = await atualizarGrupoSombraDia(client, "u1", "run-a", "WIN", "indicador", "2026-09-15");
    for (let i = 0; i < 20; i++) {
      vi.setSystemTime(new Date("2026-09-15T14:00:00Z").getTime() + (i + 1) * 2000);
      const b = await atualizarGrupoSombraDia(client, "u1", "run-a", "WIN", "indicador", "2026-09-15");
      expect(b).toEqual(a);
    }
    expect(state.upserts).toBe(1);
    expect(a?.resultado_livre_brl).toBe(60);
    expect(a?.resultado_sombra_brl).toBe(100);
    expect(a?.ops_livre).toBe(2);
    expect(a?.por_modo["score"].diferenca_brl).toBe(40);
  });

  it("a zeragem de fim de pregão força a consolidação final", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T14:00:00Z"));
    const { client, state } = fakeSupabase(ORDS);

    await atualizarGrupoSombraDia(client, "u1", "run-b", "WIN", "indicador", "2026-09-15");
    expect(state.upserts).toBe(1);
    // Mesmo segundo, mas com force: precisa gravar de novo (números mudaram).
    ORDS.push({ mode: "score", net_result_brl: 10, bloqueado_na_sombra: false });
    await atualizarGrupoSombraDia(client, "u1", "run-b", "WIN", "indicador", "2026-09-15", { force: true });
    expect(state.upserts).toBe(2);
    ORDS.pop();
  });

  it("virada do dia consolida na hora, sem esperar o intervalo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T14:00:00Z"));
    const { client, state } = fakeSupabase(ORDS);

    await atualizarGrupoSombraDia(client, "u1", "run-c", "WIN", "indicador", "2026-09-15");
    await atualizarGrupoSombraDia(client, "u1", "run-c", "WIN", "indicador", "2026-09-16");
    expect(state.upserts).toBe(2);
  });
});
