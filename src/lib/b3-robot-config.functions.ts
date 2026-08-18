// Server functions da tela de configuração por robô.
// Somente configuração — nenhuma regra do motor mora aqui.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rootSymbol } from "./b3-format";
import {
  B3_ROBOT_MODES,
  averageDailyRangePts,
  buildNotesHistory,
  diffChanges,
  parseNotesHistory,
  sanitizeRobotPatch,
} from "./b3-robot-config.server";

type Scope = "this" | "all_modes" | "all_variants";

export const getB3RobotConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const db = supabase as any;

    const { data: run } = await db.from("b3_simulation_runs")
      .select("id, symbol, variant").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (!run) throw new Error("Robô não encontrado");
    const root = rootSymbol(run.symbol);

    const [{ data: asset }, { data: runs }] = await Promise.all([
      db.from("b3_asset_profiles").select("symbol, quote_symbol, display_name, tick_size, tick_value_brl")
        .eq("symbol", run.symbol).maybeSingle(),
      db.from("b3_simulation_runs").select("id, symbol, variant")
        .eq("user_id", userId).eq("status", "running"),
    ]);

    const runIds = (runs ?? []).map((r: any) => r.id);
    const { data: allSettings } = await db.from("b3_simulation_mode_settings")
      .select("*").eq("user_id", userId).in("simulation_run_id", runIds.length ? runIds : [data.run_id]);

    const settings = (allSettings ?? []).find(
      (s: any) => s.simulation_run_id === data.run_id && s.mode === data.mode,
    ) ?? null;
    if (!settings) throw new Error("Configuração do robô não encontrada");

    const runById: Record<string, any> = {};
    for (const r of runs ?? []) runById[r.id] = r;

    // R:R dos outros modos do mesmo ativo (qualquer modalidade).
    const siblings = (allSettings ?? [])
      .filter((s: any) => {
        const r = runById[s.simulation_run_id];
        return r && rootSymbol(r.symbol) === root
          && !(s.simulation_run_id === data.run_id && s.mode === data.mode);
      })
      .map((s: any) => ({
        run_id: s.simulation_run_id,
        mode: s.mode,
        variant: runById[s.simulation_run_id]?.variant ?? "indicador",
        stop_pts: Number(s.stop_pts ?? 0),
        gain_pts: Number(s.gain_pts ?? 0),
        rr: Number(s.stop_pts) > 0 ? Number(s.gain_pts) / Number(s.stop_pts) : null,
      }));

    const range = await averageDailyRangePts(db, userId, run.symbol, 5);

    // Lista para "copiar de outro robô" e para os alvos da edição em lote.
    const robots = (runs ?? []).flatMap((r: any) =>
      B3_ROBOT_MODES.map((m) => ({
        run_id: r.id, symbol: r.symbol, root: rootSymbol(r.symbol),
        variant: r.variant ?? "indicador", mode: m,
        exists: (allSettings ?? []).some((s: any) => s.simulation_run_id === r.id && s.mode === m),
      })).filter((x) => x.exists),
    );

    return {
      run: { id: run.id, symbol: run.symbol, root, variant: run.variant ?? "indicador" },
      mode: data.mode,
      settings,
      asset: {
        symbol: run.symbol,
        quote_symbol: asset?.quote_symbol ?? root,
        display_name: asset?.display_name ?? root,
        tick_size: Number(asset?.tick_size ?? 5),
        tick_value_brl: Number(asset?.tick_value_brl ?? 0.2),
      },
      siblings,
      avg_range_pts: range.avg_range_pts,
      range_days: range.days,
      notes_history: parseNotesHistory(settings.notes),
      robots,
    };
  });

export const saveB3RobotConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: string; patch: Record<string, any>; scope?: Scope }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const db = supabase as any;
    const scope: Scope = data.scope ?? "this";
    const patch = sanitizeRobotPatch(data.patch ?? {});
    if (!Object.keys(patch).length) return { ok: true, applied: [] as any[] };

    const { data: run } = await db.from("b3_simulation_runs")
      .select("id, symbol, variant").eq("id", data.run_id).eq("user_id", userId).maybeSingle();
    if (!run) throw new Error("Robô não encontrado");
    const root = rootSymbol(run.symbol);

    const { data: runs } = await db.from("b3_simulation_runs")
      .select("id, symbol, variant").eq("user_id", userId).eq("status", "running");
    const sameAsset = (runs ?? []).filter((r: any) => rootSymbol(r.symbol) === root);

    let targets: Array<{ run_id: string; mode: string; symbol: string; variant: string }> = [];
    if (scope === "this") {
      targets = [{ run_id: run.id, mode: data.mode, symbol: run.symbol, variant: run.variant ?? "indicador" }];
    } else if (scope === "all_modes") {
      targets = B3_ROBOT_MODES.map((m) => ({
        run_id: run.id, mode: m, symbol: run.symbol, variant: run.variant ?? "indicador",
      }));
    } else {
      targets = sameAsset.map((r: any) => ({
        run_id: r.id, mode: data.mode, symbol: r.symbol, variant: r.variant ?? "indicador",
      }));
    }

    const runIds = Array.from(new Set(targets.map((t) => t.run_id)));
    const { data: rows } = await db.from("b3_simulation_mode_settings")
      .select("*").eq("user_id", userId).in("simulation_run_id", runIds);

    const applied: any[] = [];
    for (const t of targets) {
      const current = (rows ?? []).find(
        (s: any) => s.simulation_run_id === t.run_id && s.mode === t.mode,
      );
      if (!current) continue;
      const changes = diffChanges(current, patch);
      if (!changes.length) continue;
      const notes = buildNotesHistory(current.notes, changes);
      const { error } = await db.from("b3_simulation_mode_settings")
        .update({ ...patch, notes })
        .eq("simulation_run_id", t.run_id).eq("mode", t.mode).eq("user_id", userId);
      if (error) throw error;
      applied.push({ ...t, changes: changes.length });
    }
    return { ok: true, applied };
  });
