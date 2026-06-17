import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertOwner(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: owner role required");
}

async function log(
  supabase: any,
  event_type: string,
  source: string,
  message: string,
  severity: "info" | "warning" | "error" = "info",
  technical_data?: unknown,
) {
  await supabase.from("system_logs").insert({
    event_type,
    source,
    message,
    severity,
    technical_data: technical_data ? (technical_data as any) : null,
  });
}

// ============================================================================
// Categories + experts
// ============================================================================

export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data } = await supabase.from("expert_categories").select("*").order("label");
    return data ?? [];
  });

export const listExperts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const [{ data: experts }, { data: cats }, { data: rep }] = await Promise.all([
      supabase
        .from("experts")
        .select("*, expert_categories(slug,label), expert_strategy(philosophy)")
        .order("created_at", { ascending: false }),
      supabase.from("expert_categories").select("*"),
      supabase.from("agent_reputation").select("*"),
    ]);
    const repByAgent: Record<string, any> = {};
    for (const r of rep ?? []) repByAgent[r.agent_id] = r;
    return {
      experts: (experts ?? []).map((e: any) => ({
        ...e,
        reputation: e.agent_id ? repByAgent[e.agent_id] ?? null : null,
      })),
      categories: cats ?? [],
    };
  });

export const createExpert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().min(2).max(80),
        category_id: z.string().uuid().nullable().optional(),
        photo_url: z.string().url().max(500).nullable().optional(),
        bio: z.string().max(2000).nullable().optional(),
        risk_profile: z.enum(["conservador", "moderado", "agressivo"]).default("moderado"),
        main_strategy: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: row, error } = await supabase
      .from("experts")
      .insert({
        name: data.name,
        category_id: data.category_id ?? null,
        photo_url: data.photo_url ?? null,
        bio: data.bio ?? null,
        risk_profile: data.risk_profile,
        main_strategy: data.main_strategy ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await log(supabase, "Biblioteca", "experts", `Especialista criado: ${data.name}`, "info");
    return row;
  });

export const updateExpert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        active: z.boolean().optional(),
        bio: z.string().max(2000).nullable().optional(),
        photo_url: z.string().url().max(500).nullable().optional(),
        risk_profile: z.enum(["conservador", "moderado", "agressivo"]).optional(),
        main_strategy: z.string().max(500).nullable().optional(),
        category_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { id, ...rest } = data;
    const patch: any = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) patch[k] = v;
    const { error } = await supabase.from("experts").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteExpert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: ex } = await supabase.from("experts").select("agent_id").eq("id", data.id).maybeSingle();
    if (ex?.agent_id) await supabase.from("agents").delete().eq("id", ex.agent_id);
    const { error } = await supabase.from("experts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getExpert = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const [exp, sources, strategy] = await Promise.all([
      supabase.from("experts").select("*, expert_categories(slug,label)").eq("id", data.id).maybeSingle(),
      supabase
        .from("expert_sources")
        .select("*")
        .eq("expert_id", data.id)
        .order("created_at", { ascending: false }),
      supabase.from("expert_strategy").select("*").eq("expert_id", data.id).maybeSingle(),
    ]);
    if (!exp.data) throw new Error("Especialista não encontrado");
    return { expert: exp.data, sources: sources.data ?? [], strategy: strategy.data };
  });

// ============================================================================
// Source ingestion + processing
// ============================================================================

const ALLOWED_PDF_MB = 20;

export const addTextSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        expert_id: z.string().uuid(),
        title: z.string().min(2).max(200),
        text: z.string().min(50).max(200_000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: row, error } = await supabase
      .from("expert_sources")
      .insert({
        expert_id: data.expert_id,
        kind: "text",
        title: data.title,
        raw_text: data.text,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await processSourceInternal(supabase, row.id);
    return { source_id: row.id };
  });

export const addYoutubeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        expert_id: z.string().uuid(),
        url: z.string().url(),
        title: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: row, error } = await supabase
      .from("expert_sources")
      .insert({
        expert_id: data.expert_id,
        kind: "youtube",
        url: data.url,
        title: data.title ?? data.url,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await processSourceInternal(supabase, row.id);
    return { source_id: row.id };
  });

export const addPdfSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        expert_id: z.string().uuid(),
        storage_path: z.string().min(3).max(500),
        title: z.string().min(2).max(200),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: row, error } = await supabase
      .from("expert_sources")
      .insert({
        expert_id: data.expert_id,
        kind: "pdf",
        storage_path: data.storage_path,
        title: data.title,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await processSourceInternal(supabase, row.id);
    return { source_id: row.id };
  });

export const processSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ source_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    await processSourceInternal(supabase, data.source_id);
    return { ok: true };
  });

async function processSourceInternal(supabase: any, sourceId: string) {
  const { extractPdfText, fetchYoutubeTranscript, chunkText } = await import("./experts.server");
  const { embed } = await import("./ai-gateway.server");
  await supabase.from("expert_sources").update({ status: "processing", error_msg: null }).eq("id", sourceId);
  const { data: src } = await supabase.from("expert_sources").select("*").eq("id", sourceId).maybeSingle();
  if (!src) throw new Error("Fonte não encontrada");
  try {
    let raw = src.raw_text ?? "";
    if (src.kind === "youtube") {
      const r = await fetchYoutubeTranscript(src.url);
      raw = r.text;
    } else if (src.kind === "pdf") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const dl = await supabaseAdmin.storage.from("expert-sources").download(src.storage_path);
      if (dl.error) throw new Error(`Download PDF: ${dl.error.message}`);
      const buf = new Uint8Array(await dl.data.arrayBuffer());
      raw = await extractPdfText(buf);
    }
    if (!raw || raw.length < 50) throw new Error("Conteúdo extraído vazio.");
    const chunks = chunkText(raw, 900, 150);
    if (!chunks.length) throw new Error("Sem texto utilizável para chunking.");

    // batch embed in groups of 32 to stay under provider limits
    const batchSize = 32;
    let inserted = 0;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const vectors = await embed(batch);
      const rows = batch.map((content, j) => ({
        expert_id: src.expert_id,
        source_id: src.id,
        content,
        embedding: vectors[j] as any,
        metadata: { kind: src.kind, source_title: src.title } as any,
      }));
      const { error: insErr } = await supabase.from("expert_chunks").insert(rows);
      if (insErr) throw new Error(insErr.message);
      inserted += rows.length;
    }

    await supabase
      .from("expert_sources")
      .update({
        status: "ready",
        raw_text: raw.slice(0, 200_000),
        tokens: Math.round(raw.length / 4),
        chunk_count: inserted,
      })
      .eq("id", src.id);

    await log(supabase, "Aprendizado", "experts", `Fonte processada (${src.kind}): ${inserted} chunks`, "info", {
      source_id: src.id,
    });

    // Auto-extract strategy when there is enough material
    try {
      await extractStrategyForExpertInternal(supabase, src.expert_id);
    } catch (e) {
      await log(supabase, "Aprendizado", "experts", `Falha na extração de estratégia: ${(e as Error).message}`, "warning");
    }
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await supabase.from("expert_sources").update({ status: "error", error_msg: msg.slice(0, 500) }).eq("id", sourceId);
    await log(supabase, "Aprendizado", "experts", `Erro ao processar fonte: ${msg}`, "error", { source_id: sourceId });
    throw e;
  }
}

// ============================================================================
// Strategy extraction + auto-create agent
// ============================================================================

export const extractStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ expert_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    await extractStrategyForExpertInternal(supabase, data.expert_id);
    return { ok: true };
  });

async function extractStrategyForExpertInternal(supabase: any, expertId: string) {
  const { extractStrategyFromCorpus } = await import("./experts.server");
  const { data: exp } = await supabase.from("experts").select("*").eq("id", expertId).maybeSingle();
  if (!exp) throw new Error("Especialista não encontrado");
  const { data: sources } = await supabase
    .from("expert_sources")
    .select("raw_text")
    .eq("expert_id", expertId)
    .eq("status", "ready");
  const corpus = (sources ?? []).map((s: any) => s.raw_text ?? "").join("\n\n").slice(0, 40000);
  if (corpus.length < 200) throw new Error("Corpus insuficiente para extrair estratégia.");
  const strat = await extractStrategyFromCorpus(exp.name, corpus);

  await supabase
    .from("expert_strategy")
    .upsert(
      {
        expert_id: expertId,
        philosophy: strat.philosophy,
        buy_criteria: strat.buy_criteria,
        sell_criteria: strat.sell_criteria,
        risk_criteria: strat.risk_criteria,
        confirmation_criteria: strat.confirmation_criteria,
        exclusion_criteria: strat.exclusion_criteria,
        catchphrases: (strat.catchphrases ?? []) as any,
      },
      { onConflict: "expert_id" },
    );

  // ensure agent exists
  if (!exp.agent_id) {
    const agentName = (strat.suggested_agent_name || `Agente ${exp.name}`).slice(0, 60);
    const { data: agentRow, error: agErr } = await supabase
      .from("agents")
      .insert({
        name: agentName,
        profile: strat.risk_profile ?? exp.risk_profile,
        active: true,
        weight: 1,
        veto_power: false,
        kind: "expert",
        expert_id: expertId,
      })
      .select()
      .single();
    if (agErr) throw new Error(agErr.message);
    await supabase.from("experts").update({ agent_id: agentRow.id }).eq("id", expertId);
    await supabase.from("agent_reputation").insert({ agent_id: agentRow.id, score: 50, weight_current: 1 });
    await log(supabase, "Aprendizado", "experts", `Agente criado: ${agentName}`, "info");
  }
}

// ============================================================================
// Storage signed upload URL for PDFs
// ============================================================================

export const createPdfUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        expert_id: z.string().uuid(),
        filename: z.string().min(1).max(120).regex(/^[\w\-. ]+\.pdf$/i, "Arquivo deve ser .pdf"),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const safe = data.filename.replace(/[^\w\-.]/g, "_");
    const path = `${data.expert_id}/${Date.now()}_${safe}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("expert-sources")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: signed.token, signedUrl: signed.signedUrl, maxMb: ALLOWED_PDF_MB };
  });

// ============================================================================
// Council / ranking / debate
// ============================================================================

export const getCouncil = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const [agents, votes, rep] = await Promise.all([
      supabase.from("agents").select("*").order("name"),
      supabase
        .from("agent_votes")
        .select("agent_id, vote, confidence, justification, voted_at, pair")
        .order("voted_at", { ascending: false })
        .limit(500),
      supabase.from("agent_reputation").select("*"),
    ]);
    const lastVoteByAgent: Record<string, any> = {};
    for (const v of votes.data ?? []) {
      if (!lastVoteByAgent[v.agent_id]) lastVoteByAgent[v.agent_id] = v;
    }
    const repByAgent: Record<string, any> = {};
    for (const r of rep.data ?? []) repByAgent[r.agent_id] = r;
    return {
      agents: (agents.data ?? []).map((a: any) => ({
        ...a,
        last_vote: lastVoteByAgent[a.id] ?? null,
        reputation: repByAgent[a.id] ?? null,
      })),
    };
  });

export const getRanking = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data } = await supabase
      .from("agent_reputation")
      .select("*, agents(name, kind, profile, weight, veto_power, active)")
      .order("score", { ascending: false });
    return data ?? [];
  });

export const getAgentEvolution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ agent_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: rows } = await supabase
      .from("agent_evolution_log")
      .select("*")
      .eq("agent_id", data.agent_id)
      .order("created_at", { ascending: false })
      .limit(100);
    return rows ?? [];
  });

export const generateDebate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ decision_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { generateDebateText } = await import("./experts.server");
    const [{ data: decision }, { data: votes }] = await Promise.all([
      supabase.from("committee_decisions").select("*").eq("id", data.decision_id).maybeSingle(),
      supabase
        .from("agent_votes")
        .select("vote, confidence, justification, agents(name)")
        .eq("decision_id", data.decision_id),
    ]);
    if (!decision) throw new Error("Decisão não encontrada");
    const votesPayload = (votes ?? []).map((v: any) => ({
      agent: v.agents?.name ?? "Agente",
      vote: v.vote,
      confidence: Number(v.confidence ?? 0),
      justification: v.justification ?? "",
    }));
    if (votesPayload.length < 2) throw new Error("Votos insuficientes para debate.");
    const debate = await generateDebateText({
      pair: decision.pair,
      decision: decision.final_decision,
      votes: votesPayload,
    });
    await supabase
      .from("committee_debates")
      .upsert(
        { decision_id: data.decision_id, summary: debate.summary, transcript: debate.transcript as any },
        { onConflict: "decision_id" },
      );
    await log(supabase, "Comitê", "debate", `Debate gerado para ${decision.pair}`, "info");
    return debate;
  });

export const getDebate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ decision_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: row } = await supabase
      .from("committee_debates")
      .select("*")
      .eq("decision_id", data.decision_id)
      .maybeSingle();
    return row;
  });
