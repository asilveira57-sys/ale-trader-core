import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertOwner(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "owner" });
  if (!data) throw new Error("Forbidden: somente o proprietário");
}

export const getGovernanceState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { checkAutoEligibility } = await import("./auto-trading.server");
    const { getLatestConfidence } = await import("./confidence.server");
    const [{ data: gov }, elig, confidence, { data: incidents }, { data: openAuto }] = await Promise.all([
      supabase.from("governance_settings").select("*").limit(1).maybeSingle(),
      checkAutoEligibility(supabase),
      getLatestConfidence(supabase),
      supabase.from("risk_incidents").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("automated_trades").select("*").eq("status", "open").order("opened_at", { ascending: false }),
    ]);
    return { gov, elig, confidence, incidents: incidents ?? [], open_auto: openAuto ?? [] };
  });

export const updateGovernanceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    automation_enabled: z.boolean().optional(),
    automation_level: z.number().int().min(1).max(3).optional(),
    supervisor_enabled: z.boolean().optional(),
    min_confidence_score: z.number().min(0).max(100).optional(),
    min_score_for_auto: z.number().min(0).max(100).optional(),
    min_consensus_for_auto: z.number().min(0).max(1).optional(),
    min_risk_reward: z.number().min(0.5).max(10).optional(),
    max_consecutive_losses: z.number().int().min(1).max(50).optional(),
    max_daily_losses: z.number().int().min(1).max(100).optional(),
    max_weekly_losses: z.number().int().min(1).max(500).optional(),
    max_drawdown_pct: z.number().min(1).max(100).optional(),
    eligibility_min_days: z.number().int().min(1).max(365).optional(),
    eligibility_min_trades: z.number().int().min(1).max(10000).optional(),
    eligibility_min_profit_factor: z.number().min(0.1).max(10).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    if (data.automation_enabled === true) {
      const { checkAutoEligibility } = await import("./auto-trading.server");
      const elig = await checkAutoEligibility(supabase);
      if (!elig.eligible) throw new Error(`Inelegível: ${elig.failedChecks.join(", ")}`);
    }
    const { data: gov } = await supabase.from("governance_settings").select("id").limit(1).maybeSingle();
    if (!gov) throw new Error("governance_settings ausente");
    await supabase.from("governance_settings").update(data).eq("id", gov.id);
    return { ok: true };
  });

export const activateKillSwitchFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reason: z.string().min(3).max(300), confirm: z.literal("DESLIGAR") }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { activateKillSwitch } = await import("./auto-trading.server");
    await activateKillSwitch(supabase, data.reason);
    return { ok: true };
  });

export const deactivateKillSwitchFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { deactivateKillSwitch } = await import("./auto-trading.server");
    await deactivateKillSwitch(supabase);
    return { ok: true };
  });

export const recomputeConfidenceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { computeConfidence } = await import("./confidence.server");
    return await computeConfidence(supabase);
  });

export const evolveWeightsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { evolveAgentWeights } = await import("./auto-trading.server");
    return await evolveAgentWeights(supabase, 14);
  });

export const triggerAutoCycleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { runAutoCycle, monitorAutoPositions } = await import("./auto-trading.server");
    const cycle = await runAutoCycle(supabase, data.session_id);
    const mon = await monitorAutoPositions(supabase);
    return { cycle, mon };
  });

export const listIncidents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data } = await supabase.from("risk_incidents").select("*").order("created_at", { ascending: false }).limit(200);
    return data ?? [];
  });

export const listSupervisorReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data } = await supabase.from("supervisor_reviews").select("*").order("created_at", { ascending: false }).limit(100);
    return data ?? [];
  });

export const listAutomatedTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data } = await supabase.from("automated_trades").select("*").order("opened_at", { ascending: false }).limit(100);
    return data ?? [];
  });

export const listDailyReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data } = await supabase.from("daily_reports").select("*").order("report_date", { ascending: false }).limit(60);
    return data ?? [];
  });

export const listWeeklyReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data } = await supabase.from("weekly_reports").select("*").order("week_start", { ascending: false }).limit(26);
    return data ?? [];
  });

export const getReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), kind: z.enum(["daily", "weekly"]) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const table = data.kind === "daily" ? "daily_reports" : "weekly_reports";
    const { data: r } = await supabase.from(table).select("*").eq("id", data.id).maybeSingle();
    return r;
  });

export const generateDailyReportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { generateDailyReport } = await import("./reports.server");
    return await generateDailyReport(supabase, data.date);
  });

export const generateWeeklyReportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { generateWeeklyReport } = await import("./reports.server");
    return await generateWeeklyReport(supabase, data.week_start);
  });
