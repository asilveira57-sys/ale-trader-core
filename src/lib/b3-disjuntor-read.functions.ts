// Somente leitura. Nenhum comando real ou simulado é emitido aqui.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { disjuntorInput, sessionDates, capacityBase, capacityFormula, type CapacityRobot, type DisjuntorRow } from "./b3-disjuntor-view";

export const getDisjuntorOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const [runs, last] = await Promise.all([
      sb.rpc("b3_disjuntor_capacidade", { p_user_id: context.userId, p_symbols: ["WIN"], p_variants: null }),
      sb.from("b3_simulation_orders").select("exit_time").eq("user_id", context.userId).ilike("symbol", "WIN%").eq("status", "closed").not("exit_time", "is", null).order("exit_time", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (runs.error || last.error) throw new Error("Não foi possível carregar os pregões WIN.");
    const latest = last.data?.exit_time;
    return { variants: [...new Set<string>((runs.data ?? []).map((r: any) => String(r.variant ?? "indicador")))].sort(), lastDay: latest ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(latest)) : null };
  });

export const readDisjuntorScenarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => disjuntorInput.parse(input))
  .handler(async ({ data, context }) => {
    const dates = sessionDates(data.start, data.end);
    const { syncPeakFloorFromGlobalStop } = await import("./b3-real-stop.server");
    const floor = await syncPeakFloorFromGlobalStop(context.supabase, context.userId);
    const { data: capacity, error: capacityError } = await (context.supabase as any).rpc("b3_disjuntor_capacidade", { p_user_id: context.userId, p_symbols: ["WIN"], p_variants: data.variants });
    if (capacityError) throw new Error("Não foi possível ler a capacidade dos robôs.");
    const robots = (capacity ?? []) as CapacityRobot[];
    capacityBase(robots, data.capital);
    const variants = data.variants ?? [...new Set(robots.map(r => r.variant))].sort();
    const levels: { nivel: "total" | "ativo" | "modalidade"; variant?: string; symbols: string[] | null }[] = [
      { nivel: "total", symbols: null }, { nivel: "ativo", symbols: ["WIN"] },
      ...variants.map(variant => ({ nivel: "modalidade" as const, variant, symbols: ["WIN"] })),
    ];
    const jobs = dates.flatMap(day => levels.map(level => ({ day, ...level })));
    const rows: DisjuntorRow[] = [];
    // Small batches avoid serial latency without flooding the data service.
    for (let i = 0; i < jobs.length; i += 3) {
      const batches = await Promise.all(jobs.slice(i, i + 3).map(async ({ day, variant, nivel, symbols }) => {
        const { data: result, error } = await (context.supabase as any).rpc("b3_disjuntor_simulado", {
          p_user_id: context.userId, p_dia: day, p_perdas_pct: data.losses.map((n) => n / 100),
          p_capital_base: data.capital, p_symbols: symbols, p_variants: variant ? [variant] : null, p_com_freio: true,
          p_piso_pico_brl: floor.peak_min_brl,
        });
        if (error) { console.error("[disjuntor-leitura]", day, error.message); throw new Error(`Não foi possível consultar o disjuntor em ${day}.`); }
        return (result ?? []).map((r: DisjuntorRow) => ({ ...r, variant, nivel, symbol: nivel === "total" ? undefined : "WIN", conta_base: nivel === "modalidade" ? capacityFormula(robots.filter(c => c.variant === variant), data.capital) : `${r.base_origem}: ${r.capital_base_brl}` })) as DisjuntorRow[];
      }));
      rows.push(...batches.flat());
    }
    return { rows, floor: { pct: floor.pct, stop_global_brl: floor.global_stop_brl, piso_brl: floor.peak_min_brl } };
  });