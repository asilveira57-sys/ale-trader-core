// Cockpit Real — leitura consolidada da operação com DINHEIRO REAL.
// A verdade da execução real é `b3_mt5_commands` (env='real'): é lá que o
// executor grava broker_ticket, filled_price e filled_at. Esta tela lê dali,
// não de b3_live_orders, justamente para nunca mostrar zero havendo posição.
//
// NADA aqui participa do motor de simulação (runB3SimulationTick), do comitê
// ou dos classificadores. Este módulo escreve apenas:
//   1) b3_real_execution_state  (parar / religar o real)
//   2) b3_prd_authorizations.enabled = false (ao parar)
//   3) b3_mt5_commands action='close' (zerar posição real)
//   4) system_logs (rastro de toda ação)
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertMasterPassword } from "@/lib/prd-master-password.server";
import {
  buildRealLedger, isPregaoOpen, loadAssetProfiles, rootSymbol, saoPauloDate,
  type RealCommandRow,
} from "@/lib/b3-real-cockpit.server";

const MINUTE = 60_000;

// ─────────────────────────── leitura da tela ───────────────────────────
export const getB3RealCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const nowMs = now.getTime();
    const sessionDate = saoPauloDate(now);
    const dayStartUtc = `${sessionDate}T03:00:00.000Z`; // BRT = UTC-3, sem horário de verão
    const ledgerStartUtc = new Date(nowMs - 5 * 24 * 60 * MINUTE).toISOString();
    const pregaoOpen = isPregaoOpen(now);

    const [{ data: cmds }, { data: tset }, { data: auths }, { data: stateRow }] = await Promise.all([
      supabase.from("b3_mt5_commands")
        .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, filled_price, broker_ticket, magic_number")
        .eq("user_id", userId).eq("env", "real")
        .gte("created_at", ledgerStartUtc)
        .order("created_at", { ascending: true }).limit(2000),
      supabase.from("b3_trading_settings")
        .select("capital_disponivel_brl, environment").eq("user_id", userId).maybeSingle(),
      supabase.from("b3_prd_authorizations")
        .select("symbol, variant, mode, enabled, max_qty, max_daily_loss_brl, authorized_at, revoked_at")
        .eq("user_id", userId).order("symbol").order("variant").order("mode"),
      supabase.from("b3_real_execution_state")
        .select("real_enabled, stopped_at, stopped_reason, resumed_at, updated_at")
        .eq("user_id", userId).maybeSingle(),
    ]);

    const commands = ((cmds ?? []) as unknown as RealCommandRow[]);
    const profileFor = await loadAssetProfiles(supabase);

    // ── 1. Estado do real (o botão de parar) ──
    const realEnabled = stateRow ? (stateRow as any).real_enabled !== false : true;
    const realState = {
      real_enabled: realEnabled,
      stopped_at: (stateRow as any)?.stopped_at ?? null,
      stopped_reason: (stateRow as any)?.stopped_reason ?? null,
      resumed_at: (stateRow as any)?.resumed_at ?? null,
    };

    // ── 2. Estado do executor, inferido do que ele gravou ──
    const desc = [...commands].reverse();
    const lastFilled = desc.find((c) => c.status === "filled");
    const lastDryRun = desc.find((c) => /DRY_RUN/i.test(String(c.error_message ?? "")));
    const lastAny = desc[0] ?? null;
    const lastAnyAgeMs = lastAny ? nowMs - new Date(lastAny.created_at).getTime() : null;

    let executorState: "real_ativo" | "modo_teste" | "sem_sinal" | "sem_comando";
    let executorRef: RealCommandRow | null = null;
    if (lastFilled && lastDryRun) {
      const filledAt = new Date(lastFilled.created_at).getTime();
      const dryAt = new Date(lastDryRun.created_at).getTime();
      executorState = filledAt >= dryAt ? "real_ativo" : "modo_teste";
      executorRef = filledAt >= dryAt ? lastFilled : lastDryRun;
    } else if (lastFilled) {
      executorState = "real_ativo"; executorRef = lastFilled;
    } else if (lastDryRun) {
      executorState = "modo_teste"; executorRef = lastDryRun;
    } else if (lastAny && lastAnyAgeMs != null && lastAnyAgeMs < 3 * 60 * MINUTE) {
      executorState = "sem_sinal"; executorRef = lastAny;
    } else if (pregaoOpen) {
      executorState = "sem_sinal"; executorRef = lastAny;
    } else {
      executorState = "sem_comando"; executorRef = lastAny;
    }

    const executor = {
      state: executorState,
      pregao_open: pregaoOpen,
      last_command_at: executorRef?.created_at ?? lastAny?.created_at ?? null,
      last_command_age_s: executorRef?.created_at
        ? Math.round((nowMs - new Date(executorRef.created_at).getTime()) / 1000)
        : null,
      last_command: executorRef
        ? {
            action: executorRef.action, side: executorRef.side, symbol: executorRef.symbol,
            quantity: Number(executorRef.quantity ?? 0), status: executorRef.status,
            mode: executorRef.mode, variant: executorRef.variant,
            error_message: executorRef.error_message ?? null,
          }
        : null,
    };

    // ── 3. Livro real: posição aberta + operações encerradas, por FIFO ──
    const ledger = buildRealLedger(commands, profileFor);

    // Cotação viva (sem cache) para marcar a mercado a posição aberta.
    const symbols = Array.from(new Set([
      ...ledger.positions.map((p) => p.root),
      ...(auths ?? []).filter((a: any) => a.enabled).map((a: any) => rootSymbol(String(a.symbol))),
    ]));
    const quoteByRoot: Record<string, { price: number | null; tick_ts: string | null; age_s: number | null }> = {};
    for (const root of symbols) {
      const p = profileFor(root);
      const { data: q } = await supabase.from("b3_mt5sim_quotes")
        .select("bid, ask, last, tick_ts")
        .eq("user_id", userId).eq("symbol", p.quote_symbol)
        .order("tick_ts", { ascending: false }).limit(1);
      const row = (q ?? [])[0] as any;
      const price = row ? Number(row.last ?? row.bid ?? row.ask) : null;
      quoteByRoot[root] = {
        price: Number.isFinite(price as number) && (price as number) > 0 ? Number(price) : null,
        tick_ts: row?.tick_ts ?? null,
        age_s: row?.tick_ts ? Math.round((nowMs - new Date(row.tick_ts).getTime()) / 1000) : null,
      };
    }

    const positions = ledger.positions.map((p) => {
      const quote = quoteByRoot[p.root] ?? { price: null, tick_ts: null, age_s: null };
      const dir = p.side === "buy" ? 1 : -1;
      const live = quote.price;
      const pts = live != null && p.entry_price != null ? (live - p.entry_price) * dir : null;
      const brl = pts != null ? pts * p.point_value_brl * p.quantity : null;
      return {
        ...p,
        live_price: live, quote_tick_ts: quote.tick_ts, quote_age_s: quote.age_s,
        unrealized_pts: pts, unrealized_brl: brl,
      };
    });

    // ── 4. Ordens reais de hoje (o que a corretora executou) ──
    const dayOrders = commands
      .filter((c) => c.created_at >= dayStartUtc)
      .map((c) => ({
        id: c.id, action: c.action, side: c.side, symbol: c.symbol, root: rootSymbol(String(c.symbol)),
        quantity: Number(c.quantity ?? 0), mode: c.mode, variant: c.variant ?? "indicador",
        magic_number: Number(c.magic_number ?? 0), status: c.status,
        filled_price: c.filled_price == null || Number(c.filled_price) <= 0 ? null : Number(c.filled_price),
        broker_ticket: c.broker_ticket ?? null,
        at: c.filled_at ?? c.created_at,
        error_message: c.error_message ?? null,
        tick_size: profileFor(rootSymbol(String(c.symbol))).tick_size,
      }))
      .reverse();

    const filledToday = dayOrders.filter((o) => o.status === "filled").length;
    const rejectedToday = dayOrders.filter((o) => o.status === "rejected" || o.status === "error").length;

    // ── 5. Resultado real do dia e saldo ──
    const tradesToday = ledger.trades.filter((t) => (t.exit_time ?? "") >= dayStartUtc);
    const realizedBrl = tradesToday.reduce((a, t) => a + (t.result_brl ?? 0), 0);
    const tradesSemPreco = tradesToday.filter((t) => t.result_brl == null).length;
    const unrealizedBrl = positions.reduce((a, p) => a + (p.unrealized_brl ?? 0), 0);
    const capital = Number((tset as any)?.capital_disponivel_brl ?? 0) || null;
    const pct = (v: number) => (capital && capital > 0 ? v / capital : null);
    const lastWin = [...tradesToday].reverse().find((t) => (t.result_brl ?? 0) > 0) ?? null;
    const lastTrade = tradesToday[tradesToday.length - 1] ?? null;

    const today = {
      realized_brl: realizedBrl,
      unrealized_brl: unrealizedBrl,
      total_brl: realizedBrl + unrealizedBrl,
      realized_pct: pct(realizedBrl),
      unrealized_pct: pct(unrealizedBrl),
      total_pct: pct(realizedBrl + unrealizedBrl),
      capital_brl: capital,
      saldo_estimado_brl: capital == null ? null : capital + realizedBrl + unrealizedBrl,
      closed_count: tradesToday.length,
      wins: tradesToday.filter((t) => (t.result_brl ?? 0) > 0).length,
      losses: tradesToday.filter((t) => (t.result_brl ?? 0) < 0).length,
      sem_preco_count: tradesSemPreco,
      filled_orders: filledToday,
      rejected_orders: rejectedToday,
      environment: ((tset as any)?.environment ?? "simulation") as string,
      last_win: lastWin,
      last_trade: lastTrade,
    };

    // ── 6. Robôs: teto do executor x ligado no banco ──
    // A lista branca ROBOS_REAIS vive na máquina do executor. A tela só
    // consegue OBSERVAR o veredito dele (comando aceito x recusado) — jamais
    // autorizar. Por isso: evidência, não permissão.
    const evidence: Record<number, { filled: number; whitelist_reject: number; last_at: string | null; last_error: string | null }> = {};
    for (const c of commands) {
      const magic = Number(c.magic_number ?? 0);
      const e = evidence[magic] ?? { filled: 0, whitelist_reject: 0, last_at: null, last_error: null };
      if (c.status === "filled") e.filled += 1;
      if (/autorizado na lista branca|whitelist|nao autorizado/i.test(String(c.error_message ?? ""))) {
        e.whitelist_reject += 1;
        e.last_error = c.error_message ?? null;
      }
      e.last_at = c.filled_at ?? c.created_at;
      evidence[magic] = e;
    }

    const robots = (auths ?? []).map((a: any) => {
      const root = rootSymbol(String(a.symbol));
      const openPos = positions.find((p) => p.root === root && p.mode === a.mode && p.variant === (a.variant ?? "indicador"));
      const magic = openPos?.magic_number
        ?? commands.find((c) => rootSymbol(String(c.symbol)) === root && c.mode === a.mode && (c.variant ?? "indicador") === (a.variant ?? "indicador"))?.magic_number
        ?? null;
      const ev = magic != null ? evidence[Number(magic)] : undefined;
      const executorStatus: "confirmado" | "recusado" | "sem_evidencia" =
        ev && ev.filled > 0 ? "confirmado" : ev && ev.whitelist_reject > 0 ? "recusado" : "sem_evidencia";
      const trades = ledger.trades.filter(
        (t) => t.root === root && t.mode === a.mode && t.variant === (a.variant ?? "indicador") && (t.exit_time ?? "") >= dayStartUtc,
      );
      return {
        symbol: root, variant: a.variant ?? "indicador", mode: a.mode,
        enabled: a.enabled === true, max_qty: Number(a.max_qty ?? 1),
        max_daily_loss_brl: a.max_daily_loss_brl == null ? null : Number(a.max_daily_loss_brl),
        magic_number: magic == null ? null : Number(magic),
        executor_status: executorStatus,
        executor_last_error: ev?.last_error ?? null,
        has_open_position: !!openPos,
        realized_brl: trades.reduce((s, t) => s + (t.result_brl ?? 0), 0),
        trades_count: trades.length,
      };
    })
      // Ordem: quem está ligado primeiro; o resto só interessa como referência.
      .sort((x, y) => Number(y.enabled) - Number(x.enabled) || x.symbol.localeCompare(y.symbol) || x.mode.localeCompare(y.mode));

    // ── 7. Avisos da última hora ──
    const alerts: any[] = [];
    const hourAgo = nowMs - 60 * MINUTE;
    if (!realEnabled) {
      alerts.push({
        kind: "real_parado", severity: "warning",
        title: "Real parado pela tela",
        detail: `Novas entradas reais bloqueadas${realState.stopped_reason ? `: ${realState.stopped_reason}` : "."} A simulação segue coletando normalmente.`,
        at: realState.stopped_at,
      });
    }
    for (const c of desc) {
      const at = new Date(c.created_at).getTime();
      if (at < hourAgo) continue;
      if (c.status === "rejected" || c.status === "error") {
        if (/DRY_RUN/i.test(String(c.error_message ?? ""))) continue;
        alerts.push({
          kind: "ordem_real_recusada", severity: "critical",
          title: `Ordem real ${c.action === "open" ? "de entrada" : "de fechamento"} recusada`,
          detail: `${String(c.side ?? "").toUpperCase()} ${c.quantity}x ${c.symbol} — ${c.error_message ?? "sem detalhe do executor"}`,
          at: c.created_at,
        });
      }
      if (c.status === "expired") {
        alerts.push({
          kind: "comando_expirado", severity: "warning",
          title: "Comando real expirou sem execução",
          detail: `${c.action} ${c.symbol} — o executor não reivindicou o comando dentro da validade.`,
          at: c.created_at,
        });
      }
      if (c.status === "filled" && (c.filled_price == null || Number(c.filled_price) <= 0)) {
        alerts.push({
          kind: "preco_executado_ausente", severity: "warning",
          title: "Execução confirmada sem preço",
          detail: `${c.action} ${c.symbol} ticket ${c.broker_ticket ?? "—"} — o executor não gravou filled_price; o resultado desta operação fica de fora da conta.`,
          at: c.filled_at ?? c.created_at,
        });
      }
    }

    const { data: logs } = await supabase.from("system_logs")
      .select("event_type, severity, message, created_at, source")
      .gte("created_at", new Date(hourAgo).toISOString())
      .in("severity", ["critical", "error", "warning"])
      .order("created_at", { ascending: false }).limit(30);
    for (const l of (logs ?? []) as any[]) {
      if (!/auditoria|execution|mt5|real|magic/i.test(`${l.event_type} ${l.source ?? ""}`)) continue;
      alerts.push({
        kind: l.event_type, severity: l.severity === "warning" ? "warning" : "critical",
        title: String(l.event_type).replace(/_/g, " "),
        detail: l.message ?? "", at: l.created_at,
      });
    }

    for (const [root, q] of Object.entries(quoteByRoot)) {
      if (!pregaoOpen) continue;
      if (q.age_s == null) {
        alerts.push({
          kind: "sem_cotacao", severity: "warning",
          title: `Sem cotação de ${root}`,
          detail: "Nenhum tick recebido do MT5 para este ativo.", at: null,
        });
      } else if (q.age_s > 30) {
        alerts.push({
          kind: "cotacao_parada", severity: q.age_s > 120 ? "critical" : "warning",
          title: `Cotação de ${root} parada há ${q.age_s}s`,
          detail: "Preço atual e resultado em aberto podem estar defasados.",
          at: q.tick_ts,
        });
      }
    }

    alerts.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

    return {
      server_time: now.toISOString(),
      session_date: sessionDate,
      real_state: realState,
      executor,
      positions,
      day_orders: dayOrders,
      trades_today: tradesToday.slice().reverse(),
      today,
      robots,
      enabled_count: robots.filter((r) => r.enabled).length,
      alerts: alerts.slice(0, 12),
    };
  });

// ─────────── botão: PARAR O REAL (sem senha, de propósito) ───────────
// Parada de emergência não pode ter atrito. Bloqueia novas entradas reais
// (o executor deixa de receber comandos 'open' na consulta que já faz) e
// desliga as autorizações. NÃO pausa a simulação. A posição aberta continua
// sendo gerida: stop, alvo e zeragem seguem valendo.
export const stopRealNewEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ motivo: z.string().max(300).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();

    const { error: stErr } = await (supabase as any)
      .from("b3_real_execution_state")
      .upsert({
        user_id: userId, real_enabled: false, stopped_at: now,
        stopped_reason: data.motivo ?? "parado pelo Cockpit Real",
        stopped_by: userId, updated_at: now,
      }, { onConflict: "user_id" });
    if (stErr) throw stErr;

    const { data: rows, error } = await (supabase as any)
      .from("b3_prd_authorizations")
      .update({ enabled: false, revoked_at: now, updated_at: now })
      .eq("user_id", userId).eq("enabled", true)
      .select("symbol, variant, mode");
    if (error) throw error;

    const disabled = (rows ?? []) as any[];
    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "parada_novas_entradas_reais",
        source: "cockpit_real",
        severity: "warning",
        message: `Real PARADO pelo painel (${disabled.length} autorizações desligadas). Simulação não afetada.`,
        technical_data: { motivo: data.motivo ?? null, autorizacoes: disabled } as any,
      });
    } catch { /* log é best-effort; o bloqueio já aconteceu */ }

    return { ok: true as const, disabled: disabled.length, rows: disabled, stopped_at: now };
  });

// ─────────── botão: RELIGAR O REAL (exige senha mestra) ───────────
// Só libera o estado. NÃO religa autorização nenhuma: cada robô volta a ser
// ligado um por um em /prd-autorizacoes, e o teto continua sendo a lista
// branca ROBOS_REAIS gravada na máquina do executor.
export const resumeRealExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ password: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMasterPassword(data.password);

    const now = new Date().toISOString();
    const { error } = await (supabase as any)
      .from("b3_real_execution_state")
      .upsert({
        user_id: userId, real_enabled: true, resumed_at: now,
        stopped_at: null, stopped_reason: null, updated_at: now,
      }, { onConflict: "user_id" });
    if (error) throw error;

    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "religamento_real",
        source: "cockpit_real",
        severity: "warning",
        message: "Real RELIGADO pelo painel com senha mestra. Nenhuma autorização de robô foi ligada automaticamente.",
      });
    } catch { /* best-effort */ }

    return { ok: true as const, resumed_at: now };
  });

// ─────────── botão: ZERAR POSIÇÃO REAL AGORA ───────────
export const closeRealPositionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ confirm: z.literal(true) }).parse(input))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const nowMs = Date.now();

    const { data: cmds, error: cmdErr } = await supabase.from("b3_mt5_commands")
      .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, filled_price, broker_ticket, magic_number, simulation_run_id")
      .eq("user_id", userId).eq("env", "real")
      .gte("created_at", new Date(nowMs - 5 * 24 * 60 * MINUTE).toISOString())
      .order("created_at", { ascending: true }).limit(2000);
    if (cmdErr) throw cmdErr;

    const profileFor = await loadAssetProfiles(supabase);
    const { positions } = buildRealLedger((cmds ?? []) as unknown as RealCommandRow[], profileFor);

    if (!positions.length) {
      return { ok: false as const, queued: 0, disabled: 0, reason: "sem posição real aberta para zerar" };
    }

    const stamp = nowMs;
    const commands = positions.map((p) => ({
      user_id: userId,
      env: "real",
      simulation_run_id: null,
      mode: p.mode,
      variant: p.variant,
      action: "close",
      // Fechar é a ponta contrária da posição aberta.
      side: p.side === "buy" ? "sell" : "buy",
      symbol: p.symbol,
      quantity: p.quantity,
      magic_number: p.magic_number,
      idempotency_key: `panic_close:${p.symbol}:${p.magic_number}:${stamp}`,
      requested_by: "user_close_all",
      // Validade folgada: pelo celular vale dar tempo do executor reivindicar.
      expires_at: new Date(stamp + 120_000).toISOString(),
    }));

    const { error: insErr } = await (supabase as any).from("b3_mt5_commands").insert(commands);
    if (insErr) throw insErr;

    const now = new Date().toISOString();
    await (supabase as any)
      .from("b3_real_execution_state")
      .upsert({
        user_id: userId, real_enabled: false, stopped_at: now,
        stopped_reason: "zeragem solicitada no Cockpit Real", stopped_by: userId, updated_at: now,
      }, { onConflict: "user_id" });

    const { data: rows } = await (supabase as any)
      .from("b3_prd_authorizations")
      .update({ enabled: false, revoked_at: now, updated_at: now })
      .eq("user_id", userId).eq("enabled", true)
      .select("symbol, variant, mode");

    try {
      await (supabase as any).from("system_logs").insert({
        event_type: "zeragem_real_pelo_painel",
        source: "cockpit_real",
        severity: "critical",
        message: `Zeragem real solicitada pelo painel: ${commands.length} comando(s) 'close' enfileirado(s).`,
        technical_data: {
          comandos: commands.map((c) => ({ symbol: c.symbol, side: c.side, quantity: c.quantity, magic_number: c.magic_number })),
          autorizacoes_desligadas: rows ?? [],
        } as any,
      });
    } catch { /* best-effort */ }

    return {
      ok: true as const,
      queued: commands.length,
      disabled: (rows ?? []).length,
      detalhe: commands.map((c) => `${String(c.side).toUpperCase()} ${c.quantity}x ${c.symbol}`),
    };
  });
