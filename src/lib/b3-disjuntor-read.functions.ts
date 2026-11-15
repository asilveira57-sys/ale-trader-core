// Somente leitura. Nenhum comando real ou simulado é emitido aqui.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { disjuntorInput, sessionDates, capacityBase, capacityFormula, ASSET_OPTIONS, type CapacityRobot, type DisjuntorRow } from "./b3-disjuntor-view";

const rootOf = (s: string) => /^[A-Z]{3}[FGHJKMNQUVXZ]\d{2}$/i.test(s) ? s.slice(0, 3).toUpperCase() : s.toUpperCase();

// Opções da tela: modalidades com robô habilitado POR ATIVO, e o último pregão com ordem.
export const getDisjuntorOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const [runs, last] = await Promise.all([
      sb.rpc("b3_disjuntor_capacidade", { p_user_id: context.userId, p_symbols: [...ASSET_OPTIONS], p_variants: null, p_modes: null }),
      sb.from("b3_simulation_orders").select("exit_time").eq("user_id", context.userId).eq("status", "closed").not("exit_time", "is", null).order("exit_time", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (runs.error || last.error) throw new Error("Não foi possível carregar os pregões.");
    const latest = last.data?.exit_time;
    const byAsset: Record<string, string[]> = {};
    for (const r of (runs.data ?? []) as any[]) {
      const a = rootOf(String(r.symbol)); const v = String(r.variant ?? "indicador");
      (byAsset[a] ??= []); if (!byAsset[a].includes(v)) byAsset[a].push(v);
    }
    Object.values(byAsset).forEach((l) => l.sort());
    const variants = [...new Set(Object.values(byAsset).flat())].sort();
    return { variants, byAsset, lastDay: latest ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(latest)) : null };
  });

// Disjuntor por ATIVO e por MODALIDADE (decisão do dono 15/11): cada ativo marcado tem o seu
// disjuntor; cada modalidade marcada é simulada como se tivesse disjuntor próprio, dentro do
// ativo. Não existe nível de robô. O TOTAL é a soma dos ativos (mesma regra do cockpit).
// Cada cenário combina um teto de perda e uma meta de ganho, em % da capacidade dos robôs.
export const readDisjuntorScenarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => disjuntorInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const dates = sessionDates(data.start, data.end);
    const { syncPeakFloorFromGlobalStop } = await import("./b3-real-stop.server");
    const floor = await syncPeakFloorFromGlobalStop(context.supabase, context.userId);
    const { data: capacity, error: capacityError } = await sb.rpc("b3_disjuntor_capacidade", { p_user_id: context.userId, p_symbols: data.symbols, p_variants: data.variants, p_modes: null });
    if (capacityError) throw new Error("Não foi possível ler a capacidade dos robôs.");
    const robots = (capacity ?? []) as CapacityRobot[];
    capacityBase(robots, data.capital);
    const levels: { nivel: "ativo" | "modalidade"; symbol: string; variant?: string }[] = [];
    for (const symbol of data.symbols) {
      levels.push({ nivel: "ativo", symbol });
      const vs = [...new Set(robots.filter((r) => rootOf(r.symbol) === symbol).map((r) => r.variant))].sort();
      for (const variant of vs) levels.push({ nivel: "modalidade", symbol, variant });
    }
    const jobs = dates.flatMap((day) => data.gains.flatMap((gain) => levels.map((level) => ({ day, gain, ...level }))));
    const rows: DisjuntorRow[] = [];
    for (let i = 0; i < jobs.length; i += 4) {
      const batches = await Promise.all(jobs.slice(i, i + 4).map(async ({ day, gain, nivel, symbol, variant }) => {
        const { data: result, error } = await sb.rpc("b3_disjuntor_simulado", {
          p_user_id: context.userId, p_dia: day, p_perdas_pct: data.losses.map((n) => n / 100),
          p_capital_base: data.capital, p_ganho_pct: gain / 100, p_symbols: [symbol], p_variants: variant ? [variant] : data.variants, p_modes: null, p_com_freio: true,
          // Sem override: o banco usa peak_min_pct_of_global x limite de perda do cenário (migration 0029).
          p_piso_pico_brl: null,
        });
        if (error) { console.error("[disjuntor-leitura]", day, error.message); throw new Error(`Não foi possível consultar o disjuntor em ${day}.`); }
        return (result ?? []).map((r: DisjuntorRow) => ({ ...r, variant, nivel, symbol, ganho_pct: gain / 100,
          conta_base: data.capital != null ? `informado: ${data.capital}` : capacityFormula(robots.filter((c) => rootOf(c.symbol) === symbol && (!variant || c.variant === variant)), null) })) as DisjuntorRow[];
      }));
      rows.push(...batches.flat());
    }
    // TOTAL = soma dos ativos, por pregão e cenário.
    const totals = new Map<string, DisjuntorRow>();
    for (const r of rows.filter((x) => x.nivel === "ativo")) {
      const k = `${r.dia}|${r.perda_pct}|${r.ganho_pct}`;
      const t = totals.get(k);
      if (!t) { totals.set(k, { ...r, nivel: "total", symbol: undefined, variant: undefined, frase: `${r.symbol}: ${r.disparou}${r.hora_disparo_brt ? ` às ${r.hora_disparo_brt.slice(0, 5)}` : ""}` }); continue; }
      for (const f of ["capital_base_brl", "limite_perda_brl", "meta_ganho_brl", "resultado_com_disjuntor_brl", "resultado_sem_disjuntor_brl", "diferenca_brl", "ordens_antes", "ordens_evitadas", "ordens_no_dia"] as const) (t as any)[f] = Number((t as any)[f]) + Number((r as any)[f]);
      t.disparou = "soma dos ativos"; t.hora_disparo_brt = null; t.frase = `${t.frase} · ${r.symbol}: ${r.disparou}${r.hora_disparo_brt ? ` às ${r.hora_disparo_brt.slice(0, 5)}` : ""}`;
    }
    if (data.symbols.length === 1) for (const t of totals.values()) { const a = rows.find((x) => x.nivel === "ativo" && x.dia === t.dia && x.perda_pct === t.perda_pct && x.ganho_pct === t.ganho_pct); if (a) { t.disparou = a.disparou; t.hora_disparo_brt = a.hora_disparo_brt; t.frase = a.frase; } }
    rows.push(...totals.values());
    return { rows, floor: { pct: floor.pct, base: "limite de perda do cenário" as const } };
  });
