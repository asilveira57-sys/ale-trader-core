import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---- Helpers --------------------------------------------------------------

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
  severity: "debug" | "info" | "warning" | "error" | "critical" = "info",
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

// Deterministic pseudo-random for mock data (so values stay stable per minute)
function mockPrice(pair: string) {
  const base: Record<string, number> = {
    BTCUSDT: 67000,
    ETHUSDT: 3500,
    SOLUSDT: 165,
    XRPUSDT: 0.58,
    BNBUSDT: 605,
  };
  const seed = (Date.now() / 60000) | 0;
  let h = 0;
  for (const c of pair + seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  const noise = ((h % 1000) / 1000 - 0.5) * 0.04; // ±2%
  return (base[pair] ?? 100) * (1 + noise);
}

function mockBalance() {
  return [
    { asset: "USDT", free: 12500.42, locked: 0 },
    { asset: "BTC", free: 0.215, locked: 0 },
    { asset: "ETH", free: 3.42, locked: 0 },
    { asset: "SOL", free: 45.1, locked: 0 },
  ];
}

// ---- Server Functions -----------------------------------------------------

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);

    const [settings, binance, assets, alerts, logs] = await Promise.all([
      supabase.from("robot_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("binance_connection_status").select("*").eq("id", 1).maybeSingle(),
      supabase.from("monitored_assets").select("*").eq("active", true).order("pair"),
      supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(10),
      supabase.from("system_logs").select("*").order("created_at", { ascending: false }).limit(10),
    ]);

    const balances = mockBalance();
    const usdtTotal = balances.reduce((sum, b) => {
      if (b.asset === "USDT") return sum + b.free;
      const price = mockPrice(b.asset + "USDT");
      return sum + b.free * price;
    }, 0);

    const tickers = (assets.data ?? []).map((a: any) => {
      const price = mockPrice(a.pair);
      const change = (((Date.now() / 60000) | 0) % 7) - 3;
      return { pair: a.pair, name: a.name, price, change_percent_24h: change + Math.random() * 2 - 1 };
    });

    return {
      settings: settings.data,
      binance: binance.data,
      assets: assets.data ?? [],
      alerts: alerts.data ?? [],
      logs: logs.data ?? [],
      balances,
      total_balance_usdt: usdtTotal,
      tickers,
      lovable_ai_ok: !!process.env.LOVABLE_API_KEY,
    };
  });

export const setRobotStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ status: z.enum(["active", "paused"]) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { error } = await supabase.from("robot_settings").update({ status: data.status }).eq("id", 1);
    if (error) throw new Error(error.message);
    await log(
      supabase,
      "Sistema",
      "robot",
      data.status === "active" ? "Robô reativado pelo proprietário" : "Robô pausado pelo proprietário",
      data.status === "active" ? "info" : "warning",
    );
    await supabase.from("alerts").insert({
      type: data.status === "active" ? "robot_resumed" : "robot_paused",
      message: data.status === "active" ? "Robô reativado" : "Robô pausado",
      severity: data.status === "active" ? "info" : "warning",
    });
    return { ok: true };
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        collect_frequency_seconds: z.number().int().min(10).max(3600).optional(),
        rate_limit_per_minute: z.number().int().min(1).max(1200).optional(),
        active_timeframes: z.array(z.string()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { error } = await supabase.from("robot_settings").update(data).eq("id", 1);
    if (error) throw new Error(error.message);
    await log(supabase, "Sistema", "settings", "Configurações atualizadas", "info", data);
    return { ok: true };
  });

export const listAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data, error } = await supabase.from("monitored_assets").select("*").order("pair");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(60),
        pair: z.string().min(3).max(20).regex(/^[A-Z0-9]+$/),
        active: z.boolean(),
        timeframes: z.array(z.string()).min(1),
        notes: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    if (data.id) {
      const { error } = await supabase
        .from("monitored_assets")
        .update({
          name: data.name,
          pair: data.pair,
          active: data.active,
          timeframes: data.timeframes,
          notes: data.notes ?? null,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("monitored_assets").insert({
        name: data.name,
        pair: data.pair,
        active: data.active,
        timeframes: data.timeframes,
        notes: data.notes ?? null,
      });
      if (error) throw new Error(error.message);
    }
    await log(supabase, "Sistema", "assets", `Ativo salvo: ${data.pair}`, "info");
    return { ok: true };
  });

export const deleteAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { error } = await supabase.from("monitored_assets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const [agents, votes] = await Promise.all([
      supabase.from("agents").select("*").order("name"),
      supabase.from("agent_votes").select("*").order("voted_at", { ascending: false }).limit(50),
    ]);
    return { agents: agents.data ?? [], votes: votes.data ?? [] };
  });

export const toggleAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { error } = await supabase.from("agents").update({ active: data.active }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data, error } = await supabase
      .from("alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data, error } = await supabase
      .from("system_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---- Binance reader (mock for now; safe when keys are absent) ------------

export const collectMarket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);

    const { data: settings } = await supabase.from("robot_settings").select("*").eq("id", 1).maybeSingle();
    if (settings?.status === "paused") {
      await log(supabase, "Coleta", "binance", "Coleta ignorada: robô pausado", "info");
      return { skipped: true };
    }

    const { data: assets } = await supabase
      .from("monitored_assets")
      .select("*")
      .eq("active", true);

    const useMock = settings?.binance_mock_mode ?? true;
    const snapshots: any[] = [];
    for (const a of assets ?? []) {
      const price = useMock ? mockPrice(a.pair) : mockPrice(a.pair); // real path stub
      const change = (Math.random() - 0.5) * 8;
      snapshots.push({
        pair: a.pair,
        price,
        change_percent_24h: change,
        volume_24h: 1_000_000 * (1 + Math.random()),
        high_24h: price * 1.02,
        low_24h: price * 0.98,
      });

      // simple alert rule
      if (Math.abs(change) > 5) {
        await supabase.from("alerts").insert({
          type: change > 0 ? "forte_alta" : "forte_queda",
          pair: a.pair,
          message: `${a.pair}: variação ${change.toFixed(2)}% em 24h (mock)`,
          severity: "warning",
        });
      }
    }
    if (snapshots.length) await supabase.from("market_snapshots").insert(snapshots);

    await supabase
      .from("binance_connection_status")
      .update({
        connected: true,
        last_check: new Date().toISOString(),
        account_type: useMock ? "MOCK" : "SPOT",
        permissions: ["READ"],
        last_error: null,
      })
      .eq("id", 1);

    await log(
      supabase,
      "API Binance",
      "binance",
      `Coleta concluída: ${snapshots.length} ativos (modo ${useMock ? "mock" : "live-read"})`,
      "info",
    );

    return { collected: snapshots.length, mock: useMock };
  });

// ============================================================================
// Phase 2 — Committee, simulated wallet & orders
// ============================================================================

export const runCommittee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        asset_id: z.string().uuid().optional(),
        pair: z.string().min(3).max(20).optional(),
        timeframe: z.string().default("1h"),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { runAllAgents, buildDecision, buildMockContext } = await import("./committee.server");

    // load asset
    const { data: asset } = data.asset_id
      ? await supabase.from("monitored_assets").select("*").eq("id", data.asset_id).maybeSingle()
      : await supabase.from("monitored_assets").select("*").eq("pair", data.pair).maybeSingle();
    if (!asset) throw new Error("Ativo não encontrado");

    const [{ data: settings }, { data: agents }, { data: wallet }] = await Promise.all([
      supabase.from("committee_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("agents").select("*"),
      supabase.from("simulated_wallet").select("*").eq("id", 1).maybeSingle(),
    ]);

    const weights: Record<string, number> = {};
    const active: Record<string, boolean> = {};
    for (const a of agents ?? []) {
      weights[a.name] = Number(a.weight ?? 1);
      active[a.name] = a.active !== false;
    }

    const price = mockPrice(asset.pair);
    const ctx = buildMockContext(asset.pair, data.timeframe, price);
    const votes = runAllAgents(ctx, {
      weights,
      active,
      maxPositionValue: Number(settings?.max_position_value ?? 1000),
      walletBalance: Number(wallet?.current_balance ?? 10000),
    });

    // Expert agents (Phase 3): RAG-based voting from each expert's memory
    const expertAgents = (agents ?? []).filter((a: any) => a.kind === "expert" && a.active !== false && a.expert_id);
    const expertKnowledgeRefs: Record<string, string[]> = {};
    if (expertAgents.length > 0) {
      try {
        const { embed } = await import("./ai-gateway.server");
        const { expertVote } = await import("./experts.server");
        const queryText = `Pair ${ctx.pair} timeframe ${ctx.timeframe} | RSI ${ctx.rsi?.toFixed(1)} | MACD ${ctx.macd?.toFixed(3)} | preço ${ctx.price?.toFixed(2)} | var24h ${(ctx as any).change_24h?.toFixed(2)}% | volume ${(ctx as any).volume_24h?.toFixed(0)}`;
        const [queryVec] = await embed(queryText);

        for (const a of expertAgents) {
          try {
            const { data: chunks } = await supabase.rpc("match_expert_chunks", {
              p_expert_id: a.expert_id,
              p_query_embedding: queryVec as any,
              p_match_count: 5,
            });
            const { data: strat } = await supabase
              .from("expert_strategy")
              .select("*")
              .eq("expert_id", a.expert_id)
              .maybeSingle();
            const ev = await expertVote({
              expertName: a.name,
              strategy: strat ?? null,
              context: ctx as any,
              chunks: (chunks ?? []).map((c: any) => ({ content: c.content, similarity: Number(c.similarity ?? 0) })),
            });
            votes.push({
              agent: a.name,
              vote: ev.vote,
              confidence: ev.confidence,
              justification: ev.justification,
              data_used: { source: "expert_rag", chunks: (chunks ?? []).length },
              perceived_risk: ev.perceived_risk,
              has_veto: !!ev.has_veto,
              veto_reason: ev.veto_reason,
            } as any);
            expertKnowledgeRefs[a.name] = (chunks ?? []).map((c: any) => c.id as string);
          } catch (err) {
            await log(supabase, "Comitê", "expert", `Falha no agente ${a.name}: ${(err as Error).message}`, "warning");
          }
        }
      } catch (err) {
        await log(supabase, "Comitê", "expert", `Falha ao executar agentes especialistas: ${(err as Error).message}`, "warning");
      }
    }

    const decision = buildDecision(
      votes,
      weights,
      {
        min_favor_votes: Number(settings?.min_favor_votes ?? 6),
        min_confidence: Number(settings?.min_confidence ?? 70),
        min_score: Number(settings?.min_score ?? 61),
        default_stop_pct: Number(settings?.default_stop_pct ?? 3),
        default_target_pct: Number(settings?.default_target_pct ?? 6),
        max_position_value: Number(settings?.max_position_value ?? 1000),
      },
      ctx.data_quality,
    );

    // persist decision
    const { data: decRow, error: decErr } = await supabase
      .from("committee_decisions")
      .insert({
        asset_id: asset.id,
        pair: asset.pair,
        timeframe: data.timeframe,
        final_decision: decision.final_decision,
        score: decision.score,
        classification: decision.classification,
        avg_confidence: decision.avg_confidence,
        votes_buy: decision.votes_buy,
        votes_sell: decision.votes_sell,
        votes_hold: decision.votes_hold,
        votes_wait: decision.votes_wait,
        risk_approved: decision.risk_approved,
        euphoria_vetoed: decision.euphoria_vetoed,
        data_quality: decision.data_quality,
        consolidated_justification: decision.consolidated_justification,
        context: ctx as any,
      })
      .select()
      .single();
    if (decErr) throw new Error(decErr.message);

    // persist votes
    const agentByName: Record<string, string> = {};
    for (const a of agents ?? []) agentByName[a.name] = a.id;
    const voteRows = votes
      .filter((v) => agentByName[v.agent])
      .map((v) => ({
        agent_id: agentByName[v.agent],
        pair: asset.pair,
        vote: v.vote,
        confidence: v.confidence,
        justification: v.justification,
        decision_id: decRow.id,
        data_used: v.data_used as any,
        perceived_risk: v.perceived_risk,
        has_veto: v.has_veto,
        veto_reason: v.veto_reason ?? null,
        knowledge_refs: (expertKnowledgeRefs[v.agent] ?? []) as any,
      }));
    if (voteRows.length) await supabase.from("agent_votes").insert(voteRows);

    await log(
      supabase,
      "Comitê",
      "committee",
      `Decisão ${decision.final_decision} para ${asset.pair} (score ${decision.score.toFixed(0)})`,
      decision.final_decision === "blocked" ? "warning" : "info",
      { decision_id: decRow.id, votes: votes.length },
    );

    // simulated order if approved
    if (decision.final_decision === "buy_approved" || decision.final_decision === "sell_approved") {
      const side = decision.final_decision === "buy_approved" ? "buy" : "sell";
      const maxValue = Number(settings?.max_position_value ?? 1000);
      const qty = maxValue / price;
      const stopPct = Number(settings?.default_stop_pct ?? 3) / 100;
      const targetPct = Number(settings?.default_target_pct ?? 6) / 100;
      const stop = side === "buy" ? price * (1 - stopPct) : price * (1 + stopPct);
      const target = side === "buy" ? price * (1 + targetPct) : price * (1 - targetPct);

      await supabase.from("simulated_orders").insert({
        decision_id: decRow.id,
        pair: asset.pair,
        side,
        quantity: qty,
        entry_price: price,
        stop_price: stop,
        target_price: target,
        score: decision.score,
        agents_favor: side === "buy" ? decision.votes_buy : decision.votes_sell,
        agents_against: side === "buy" ? decision.votes_sell : decision.votes_buy,
        justification: decision.consolidated_justification,
        status: "open",
      });

      // upsert position
      const { data: pos } = await supabase
        .from("simulated_positions")
        .select("*")
        .eq("pair", asset.pair)
        .maybeSingle();
      if (side === "buy") {
        if (pos) {
          const newQty = Number(pos.quantity) + qty;
          const newAvg = (Number(pos.avg_price) * Number(pos.quantity) + price * qty) / newQty;
          await supabase
            .from("simulated_positions")
            .update({ quantity: newQty, avg_price: newAvg })
            .eq("id", pos.id);
        } else {
          await supabase
            .from("simulated_positions")
            .insert({ pair: asset.pair, quantity: qty, avg_price: price });
        }
      } else if (pos) {
        const newQty = Math.max(0, Number(pos.quantity) - qty);
        await supabase
          .from("simulated_positions")
          .update({ quantity: newQty, unrealized_pnl: (price - Number(pos.avg_price)) * newQty })
          .eq("id", pos.id);
      }

      // wallet debit/credit (simulated)
      if (wallet) {
        const delta = side === "buy" ? -maxValue : maxValue;
        await supabase
          .from("simulated_wallet")
          .update({ current_balance: Number(wallet.current_balance) + delta })
          .eq("id", 1);
      }

      await log(
        supabase,
        "Simulação",
        "orders",
        `Ordem simulada ${side.toUpperCase()} ${asset.pair} @ ${price.toFixed(2)} (qty ${qty.toFixed(6)})`,
        "info",
      );
    }

    return { decision_id: decRow.id as string, decision: decision as any, votes: votes as any };
  });

export const runCommitteeAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: assets } = await supabase
      .from("monitored_assets")
      .select("id, pair")
      .eq("active", true);
    let ok = 0;
    for (const a of assets ?? []) {
      try {
        await (runCommittee as any)({ data: { asset_id: a.id, timeframe: "1h" } });
        ok++;
      } catch (e) {
        await log(supabase, "Comitê", "committee", `Falha ao analisar ${a.pair}: ${(e as Error).message}`, "error");
      }
    }
    return { ok, total: assets?.length ?? 0 };
  });

export const getCommitteeDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const [{ data: decisions }, { data: wallet }, { data: positions }, { data: orders }] = await Promise.all([
      supabase.from("committee_decisions").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("simulated_wallet").select("*").eq("id", 1).maybeSingle(),
      supabase.from("simulated_positions").select("*").order("updated_at", { ascending: false }),
      supabase.from("simulated_orders").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    const latestByPair: Record<string, any> = {};
    for (const d of decisions ?? []) {
      if (!latestByPair[d.pair]) latestByPair[d.pair] = d;
    }
    const ranking = Object.values(latestByPair).sort((a: any, b: any) => Number(b.score) - Number(a.score));
    // equity history: cumulative running balance using latest 50 decisions
    return {
      decisions: decisions ?? [],
      latest_by_pair: latestByPair,
      ranking,
      wallet,
      positions: positions ?? [],
      orders: orders ?? [],
    };
  });

export const getAssetAnalysis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ asset_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: asset } = await supabase
      .from("monitored_assets")
      .select("*")
      .eq("id", data.asset_id)
      .maybeSingle();
    if (!asset) throw new Error("Ativo não encontrado");
    const [{ data: decision }, { data: orders }, { data: alerts }] = await Promise.all([
      supabase
        .from("committee_decisions")
        .select("*")
        .eq("pair", asset.pair)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("simulated_orders")
        .select("*")
        .eq("pair", asset.pair)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("alerts")
        .select("*")
        .eq("pair", asset.pair)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    let votes: any[] = [];
    if (decision) {
      const { data: v } = await supabase
        .from("agent_votes")
        .select("*, agents(name, profile, weight, veto_power)")
        .eq("decision_id", decision.id);
      votes = v ?? [];
    }
    return { asset, decision, votes, orders: orders ?? [], alerts: alerts ?? [], price: mockPrice(asset.pair) };
  });

export const closeSimulatedOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ order_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: order } = await supabase
      .from("simulated_orders")
      .select("*")
      .eq("id", data.order_id)
      .maybeSingle();
    if (!order) throw new Error("Ordem não encontrada");
    if (order.status !== "open") throw new Error("Ordem já fechada");
    const closedPrice = mockPrice(order.pair);
    const pnl =
      order.side === "buy"
        ? (closedPrice - Number(order.entry_price)) * Number(order.quantity)
        : (Number(order.entry_price) - closedPrice) * Number(order.quantity);
    await supabase
      .from("simulated_orders")
      .update({
        status: "closed",
        closed_price: closedPrice,
        realized_pnl: pnl,
        closed_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    const { data: wallet } = await supabase.from("simulated_wallet").select("*").eq("id", 1).maybeSingle();
    if (wallet) {
      const refund = order.side === "buy" ? Number(order.entry_price) * Number(order.quantity) + pnl : 0;
      await supabase
        .from("simulated_wallet")
        .update({ current_balance: Number(wallet.current_balance) + refund })
        .eq("id", 1);
    }
    await log(supabase, "Simulação", "orders", `Ordem ${order.pair} fechada @ ${closedPrice.toFixed(2)} · PnL ${pnl.toFixed(2)}`, "info");

    // Phase 3: update reputation of all agents that voted on this decision
    if (order.decision_id) {
      const win = pnl > 0;
      const favorVote = order.side === "buy" ? "buy" : "sell";
      const { data: vts } = await supabase
        .from("agent_votes")
        .select("agent_id, vote, has_veto")
        .eq("decision_id", order.decision_id);
      for (const v of vts ?? []) {
        const wasFavor = v.vote === favorVote;
        const wasAgainst = (v.vote === "sell" && favorVote === "buy") || (v.vote === "buy" && favorVote === "sell") || v.has_veto;
        let delta = 0;
        let outcome: "win" | "loss" | "neutral" = "neutral";
        if (wasFavor) {
          delta = win ? 2 : -2;
          outcome = win ? "win" : "loss";
        } else if (wasAgainst) {
          delta = win ? -1 : 1.5;
          outcome = win ? "loss" : "win";
        } else {
          delta = win ? 0.2 : -0.2;
        }
        const { data: rep } = await supabase.from("agent_reputation").select("*").eq("agent_id", v.agent_id).maybeSingle();
        const prevScore = Number(rep?.score ?? 50);
        const prevWeight = Number(rep?.weight_current ?? 1);
        const newScore = Math.max(0, Math.min(100, prevScore + delta));
        const newWeight = Math.max(0.5, Math.min(2, 0.5 + (newScore / 100) * 1.5));
        if (rep) {
          await supabase
            .from("agent_reputation")
            .update({
              score: newScore,
              weight_current: newWeight,
              hits: Number(rep.hits ?? 0) + (outcome === "win" ? 1 : 0),
              misses: Number(rep.misses ?? 0) + (outcome === "loss" ? 1 : 0),
              profit_simulated: Number(rep.profit_simulated ?? 0) + (wasFavor ? Number(pnl) : 0),
            })
            .eq("id", rep.id);
        } else {
          await supabase.from("agent_reputation").insert({
            agent_id: v.agent_id,
            score: newScore,
            weight_current: newWeight,
            hits: outcome === "win" ? 1 : 0,
            misses: outcome === "loss" ? 1 : 0,
            profit_simulated: wasFavor ? Number(pnl) : 0,
          });
        }
        // mirror weight onto agents table so committee uses it next run
        await supabase.from("agents").update({ weight: newWeight }).eq("id", v.agent_id);
        await supabase.from("agent_evolution_log").insert({
          agent_id: v.agent_id,
          decision_id: order.decision_id,
          vote: v.vote,
          outcome,
          pnl,
          reputation_delta: delta,
          weight_before: prevWeight,
          weight_after: newWeight,
        });
      }
    }

    return { ok: true, pnl };
  });

export const resetSimulatedWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ initial_balance: z.number().min(100).max(10_000_000) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    await supabase
      .from("simulated_wallet")
      .update({ initial_balance: data.initial_balance, current_balance: data.initial_balance, equity: data.initial_balance })
      .eq("id", 1);
    await supabase.from("simulated_positions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("simulated_orders").update({ status: "cancelled" }).eq("status", "open");
    await log(supabase, "Simulação", "wallet", `Carteira simulada reiniciada com saldo ${data.initial_balance}`, "warning");
    return { ok: true };
  });

export const liquidateSimulatedWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ slippage_pct: z.number().min(0).max(10).default(0.5) }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const slip = 1 - data.slippage_pct / 100;
    const now = new Date().toISOString();

    // 1) Pause robot FIRST to block any new buys from the auto-cycle while we liquidate
    await supabase.from("robot_settings").update({ status: "paused" }).eq("id", 1);

    // 2) Fetch open orders AFTER pause so we capture anything the bot just opened
    const { data: openOrders } = await supabase
      .from("simulated_orders")
      .select("*")
      .eq("status", "open");

    let cancelled = 0;
    let sold = 0;
    let proceeds = 0;
    let totalPnl = 0;

    for (const o of openOrders ?? []) {
      // Pending sell orders: just cancel — they don't hold capital
      if (o.side === "sell") {
        await supabase.from("simulated_orders").update({ status: "cancelled", closed_at: now }).eq("id", o.id);
        cancelled++;
        continue;
      }
      // Open buys = open long position — liquidate at market - slippage
      const marketPrice = mockPrice(o.pair);
      const exitPrice = marketPrice * slip;
      const qty = Number(o.quantity);
      const entry = Number(o.entry_price);
      const pnl = (exitPrice - entry) * qty;
      const refund = entry * qty + pnl; // = exitPrice * qty
      await supabase
        .from("simulated_orders")
        .update({ status: "closed", closed_price: exitPrice, realized_pnl: pnl, closed_at: now })
        .eq("id", o.id);
      proceeds += refund;
      totalPnl += pnl;
      sold++;
    }

    // Update wallet cash
    if (proceeds !== 0) {
      const { data: wallet } = await supabase.from("simulated_wallet").select("*").eq("id", 1).maybeSingle();
      if (wallet) {
        const newBalance = Number(wallet.current_balance) + proceeds;
        await supabase
          .from("simulated_wallet")
          .update({ current_balance: newBalance, equity: newBalance })
          .eq("id", 1);
      }
    }

    // Zero out tracked positions
    await supabase
      .from("simulated_positions")
      .update({ quantity: 0, unrealized_pnl: 0 })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    // Robot was paused at the start of the handler; emit an alert now.
    await supabase.from("alerts").insert({
      type: "robot_paused",
      message: "Robô pausado após liquidação total",
      severity: "warning",
    });

    await log(
      supabase,
      "Simulação",
      "wallet",
      `Liquidação total: ${sold} posições vendidas (slippage ${data.slippage_pct}%), ${cancelled} ordens canceladas, PnL ${totalPnl.toFixed(2)}, caixa +${proceeds.toFixed(2)}. Robô pausado.`,
      "warning",
    );

    return { ok: true, sold, cancelled, proceeds, pnl: totalPnl, paused: true };
  });

export const getCommitteeSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data } = await supabase.from("committee_settings").select("*").eq("id", 1).maybeSingle();
    return data;
  });

export const updateCommitteeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        min_favor_votes: z.number().int().min(1).max(10).optional(),
        min_confidence: z.number().min(0).max(100).optional(),
        min_score: z.number().min(0).max(100).optional(),
        max_position_value: z.number().min(10).max(10_000_000).optional(),
        default_stop_pct: z.number().min(0.1).max(50).optional(),
        default_target_pct: z.number().min(0.1).max(100).optional(),
        timeframes: z.array(z.string()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    await supabase.from("committee_settings").update(data).eq("id", 1);
    await log(supabase, "Sistema", "settings", "Configurações do comitê atualizadas", "info", data);
    return { ok: true };
  });

export const updateAgentConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), active: z.boolean().optional(), weight: z.number().min(0).max(10).optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const patch: any = {};
    if (data.active !== undefined) patch.active = data.active;
    if (data.weight !== undefined) patch.weight = data.weight;
    await supabase.from("agents").update(patch).eq("id", data.id);
    return { ok: true };
  });

// ---- Tickers by timeframe (real Binance public klines) ------------------
const TF_MAP: Record<string, { interval: string; limit: number; label: string }> = {
  "15m": { interval: "15m", limit: 2, label: "15min" },
  "1h":  { interval: "1h",  limit: 2, label: "1h" },
  "4h":  { interval: "4h",  limit: 2, label: "4h" },
  "24h": { interval: "1d",  limit: 2, label: "24h" },
  "7d":  { interval: "1d",  limit: 8, label: "7d" },
  "30d": { interval: "1d",  limit: 31, label: "30d" },
};

// Multiple public mirrors — Cloudflare Workers often hit geo/CDN blocks on a
// single host, so try several until one responds.
const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://api-gcp.binance.com",
  "https://api.binance.us",
];
async function fetchKlines(symbol: string, interval: string, limit: number): Promise<any[][]> {
  let lastErr: any = null;
  for (const host of BINANCE_HOSTS) {
    try {
      const url = `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) { lastErr = new Error(`${host} HTTP ${res.status}`); continue; }
      const rows = (await res.json()) as any[][];
      if (!Array.isArray(rows) || rows.length === 0) { lastErr = new Error(`${host} empty`); continue; }
      return rows;
    } catch (e: any) { lastErr = e; }
  }
  throw lastErr ?? new Error("all binance hosts failed");
}

export const getTickersByTimeframe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ timeframe: z.enum(["15m", "1h", "4h", "24h", "7d", "30d"]).default("24h") }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const tf = TF_MAP[data.timeframe];

    const { data: assets } = await supabase
      .from("monitored_assets")
      .select("pair,name")
      .eq("active", true)
      .order("pair");

    const tickers = await Promise.all(
    (assets ?? []).map(async (a: any) => {
        try {
          const rows = await fetchKlines(a.pair, tf.interval, tf.limit);
          const firstOpen = Number(rows[0][1]);
          const lastClose = Number(rows[rows.length - 1][4]);
          const change = ((lastClose - firstOpen) / firstOpen) * 100;
          return { pair: a.pair, name: a.name, price: lastClose, change_percent: change, timeframe: data.timeframe, ok: true as const };
        } catch (e: any) {
          return { pair: a.pair, name: a.name, price: 0, change_percent: 0, timeframe: data.timeframe, ok: false as const, error: String(e?.message ?? e) };
        }
      }),
    );

    return { timeframe: data.timeframe, label: tf.label, tickers, fetched_at: new Date().toISOString() };
  });

// ---- Klines for a single pair (line chart) -----------------------------
const CHART_TF_MAP: Record<string, { interval: string; limit: number; label: string }> = {
  "15m": { interval: "1m",  limit: 15, label: "15min" },
  "1h":  { interval: "5m",  limit: 12, label: "1h" },
  "4h":  { interval: "15m", limit: 16, label: "4h" },
  "24h": { interval: "1h",  limit: 24, label: "24h" },
  "7d":  { interval: "4h",  limit: 42, label: "7d" },
  "30d": { interval: "1d",  limit: 30, label: "30d" },
};

export const getPairKlines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      pair: z.string().min(3),
      timeframe: z.enum(["15m", "1h", "4h", "24h", "7d", "30d"]).default("24h"),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const tf = CHART_TF_MAP[data.timeframe];
    try {
      const rows = await fetchKlines(data.pair, tf.interval, tf.limit);
      const points = rows.map((r) => ({ t: Number(r[0]), price: Number(r[4]) }));
      return { ok: true as const, pair: data.pair, timeframe: data.timeframe, label: tf.label, points, fetched_at: new Date().toISOString() };
    } catch (e: any) {
      return { ok: false as const, pair: data.pair, timeframe: data.timeframe, label: tf.label, points: [], error: String(e?.message ?? e), fetched_at: new Date().toISOString() };
    }
  });
