import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertOwner(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "owner" });
  if (!data) throw new Error("Forbidden: somente o proprietário");
}

// ---- Strategic Memory ----

export const searchStrategicMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().min(1), kind: z.string().optional(), asset_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).optional() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { searchMemory } = await import("./intelligence.server");
    const rows = await searchMemory(data.query, { kind: data.kind, asset_id: data.asset_id, limit: data.limit });
    return rows as any;
  });

export const listStrategicMemory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ kind: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    let q = supabase.from("strategic_memory").select("id, kind, title, content, asset_id, created_at, metadata").order("created_at", { ascending: false }).limit(data.limit ?? 50);
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows as any;
  });

// ---- Recommendations ----

export const listRecommendations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ status: z.string().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    let q = supabase.from("learning_recommendations").select("*").order("created_at", { ascending: false }).limit(100);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows as any;
  });

export const decideRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected", "applied"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { error } = await supabase
      .from("learning_recommendations")
      .update({ status: data.decision, decided_by: userId, decided_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generateRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { generateRecommendationsFromHistory } = await import("./intelligence.server");
    const ids = await generateRecommendationsFromHistory();
    return { created: ids } as any;
  });

// ---- Rankings & Seasonal ----

export const listAgentRankings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ period: z.enum(["30d", "90d", "180d", "365d"]).default("30d") }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: rows, error } = await supabase
      .from("agent_rankings")
      .select("*")
      .eq("period", data.period)
      .order("score", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.agent_id).filter(Boolean)));
    let nameById: Record<string, string> = {};
    if (ids.length) {
      const { data: ags } = await supabase.from("agents").select("id, name").in("id", ids);
      nameById = Object.fromEntries((ags ?? []).map((a: any) => [a.id, a.name]));
    }
    return (rows ?? []).map((r: any) => ({ ...r, agents: { name: nameById[r.agent_id] ?? null } })) as any;
  });

export const recomputeRankings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ period: z.enum(["30d", "90d", "180d", "365d"]).default("30d") }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { recomputeAgentRankings } = await import("./intelligence.server");
    const rows = await recomputeAgentRankings(data.period);
    return rows as any;
  });

export const listSeasonal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data, error } = await supabase.from("seasonal_performance").select("*").order("computed_at", { ascending: false }).limit(40);
    if (error) throw new Error(error.message);
    return data as any;
  });

export const recomputeSeasonal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { recomputeSeasonalPerformance } = await import("./intelligence.server");
    const rows = await recomputeSeasonalPerformance();
    return rows as any;
  });

// ---- Regimes & Radar ----

export const listRegimes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data, error } = await supabase
      .from("market_regimes")
      .select("*")
      .order("detected_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data as any;
  });

export const listRadar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data, error } = await supabase
      .from("opportunity_radar")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data as any;
  });

export const recomputeRadar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { recomputeOpportunityRadar } = await import("./intelligence.server");
    const rows = await recomputeOpportunityRadar();
    return rows as any;
  });

// ---- Laboratory ----

export const listLabs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data, error } = await supabase.from("strategy_laboratory").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data as any;
  });

export const createLab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ name: z.string().min(1), description: z.string().optional(), config: z.record(z.unknown()).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: row, error } = await supabase
      .from("strategy_laboratory")
      .insert({ name: data.name, description: data.description ?? null, config: data.config ?? {} })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as any;
  });

export const runSimulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ labId: z.string().uuid(), params: z.record(z.unknown()).default({}) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { simulateStrategy } = await import("./intelligence.server");
    const sim = await simulateStrategy(data.labId, data.params);
    return sim as any;
  });

export const listSimulations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ labId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: rows, error } = await supabase
      .from("strategy_simulations")
      .select("*")
      .eq("lab_id", data.labId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows as any;
  });

// ---- Intelligence Reports & Post-trade ----

export const listIntelligenceReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ kind: z.string().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    let q = supabase.from("intelligence_reports").select("*").order("created_at", { ascending: false }).limit(100);
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows as any;
  });

export const generatePostTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ automatedTradeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { generatePostTradeReport } = await import("./intelligence.server");
    const reportId = await generatePostTradeReport(data.automatedTradeId);
    return { reportId };
  });

// ---- Knowledge Library ----

export const listKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data, error } = await supabase
      .from("knowledge_library")
      .select("id, source_type, title, author, url, classification, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data as any;
  });

export const addKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      source_type: z.enum(["video", "book", "pdf", "article", "report"]),
      title: z.string().min(1),
      author: z.string().optional(),
      url: z.string().url().optional(),
      content: z.string().optional(),
      classification: z.record(z.unknown()).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    let embedding: number[] | null = null;
    if (data.content) {
      try {
        const { embed } = await import("./ai-gateway.server");
        const v = await embed(data.content.slice(0, 6000));
        embedding = v[0] ?? null;
      } catch (e) {
        console.warn("knowledge embed failed", e);
      }
    }
    const { data: row, error } = await supabase
      .from("knowledge_library")
      .insert({
        source_type: data.source_type,
        title: data.title,
        author: data.author ?? null,
        url: data.url ?? null,
        content: data.content ?? null,
        classification: data.classification ?? {},
        embedding: embedding as any,
      })
      .select("id, title")
      .single();
    if (error) throw new Error(error.message);
    return row as any;
  });
