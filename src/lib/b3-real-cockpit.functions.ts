// Cockpit Real — leitura consolidada da operação com dinheiro real e os dois
// botões de parada. Arquivo separado de propósito: NADA aqui participa do
// motor de simulação (runB3SimulationTick), do comitê ou dos classificadores.
//
// Só três coisas são escritas por este módulo:
//   1) b3_prd_authorizations.enabled = false  (parar novas entradas)
//   2) b3_mt5_commands  action='close'        (zerar posição real)
//   3) system_logs                            (rastro das duas ações)
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MINUTE = 60_000;

// Janela do pregão B3 em minutos de BRT — usada só para dizer se "nenhum
// comando nas últimas horas" é um problema ou o mercado estar fechado.
const PREGAO_START_MIN = 9 * 60;
const PREGAO_END_MIN = 17 * 60 + 30;

function saoPauloMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function saoPauloDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const dd = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${dd}`;
}

function isPregaoOpen(now: Date): boolean {
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" })
    .format(now);
  if (dow === "Sat" || dow === "Sun") return false;
  const min = saoPauloMinutes(now);
  return min >= PREGAO_START_MIN && min <= PREGAO_END_MIN;
}

const rootSymbol = (symbol: string) => {
  const s = String(symbol ?? "").toUpperCase();
  const m = s.match(/^([A-Z]{3})[A-Z]\d{2}$/);
  return m ? m[1] : s;
};

const minuteKey = (iso: string | null | undefined) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
  }).format(new Date(t));
};

// Perfis de ativo: valor do ponto e tick, para traduzir pontos em reais na tela.
async function loadAssetProfiles(supabase: any) {
  const { data } = await supabase.from("b3_asset_profiles")
    .select("symbol, quote_symbol, tick_size, tick_value_brl");
  const rows = (data ?? []) as Array<{ symbol: string; quote_symbol: string; tick_size: number; tick_value_brl: number }>;
  return (symbol: string) => {
    const root = rootSymbol(symbol);
    const hit = rows.find((r) => String(r.symbol).toUpperCase() === root)
      ?? rows.find((r) => rootSymbol(String(r.quote_symbol)) === root);
    return {
      quote_symbol: hit?.quote_symbol ?? symbol,
      tick_size: Number(hit?.tick_size ?? 5),
      tick_value_brl: Number(hit?.tick_value_brl ?? 0.2),
    };
  };
}

// ─────────────────────────── leitura da tela ───────────────────────────
export const getB3RealCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const nowMs = now.getTime();
    const sessionDate = saoPauloDate(now);
    const dayStartUtc = `${sessionDate}T03:00:00.000Z`; // BRT = UTC-3, sem horário de verão
    const pregaoOpen = isPregaoOpen(now);

    const [
      { data: lastCommands },
      { data: openLive },
      { data: closedLive },
      { data: tset },
      { data: auths },
    ] = await Promise.all([
      supabase.from("b3_mt5_commands")
        .select("id, action, side, symbol, quantity, mode, variant, status, error_message, created_at, filled_at, filled_price, magic_number")
        .eq("user_id", userId).eq("env", "real")
        .order("created_at", { ascending: false }).limit(40),
      supabase.from("b3_live_orders")
        .select("id, symbol, side, quantity, entry_price, entry_time, mode, variant, magic_number, status")
        .eq("user_id", userId).eq("status", "open")
        .order("entry_time", { ascending: true }),
      supabase.from("b3_live_orders")
        .select("id, symbol, side, quantity, entry_price, entry_time, exit_price, exit_time, net_result_brl, mode, variant")
        .eq("user_id", userId).eq("status", "closed")
        .gte("exit_time", dayStartUtc),
      supabase.from("b3_trading_settings")
        .select("capital_disponivel_brl, environment").eq("user_id", userId).maybeSingle(),
      supabase.from("b3_prd_authorizations")
        .select("symbol, variant, mode, enabled, max_qty, max_daily_loss_brl, authorized_at, revoked_at")
        .eq("user_id", userId).order("symbol").order("variant").order("mode"),
    ]);

    const profileFor = await loadAssetProfiles(supabase);

    // ── 1. Estado do executor, inferido do comportamento observado ──
    const commands = (lastCommands ?? []) as any[];
    const lastFilled = commands.find((c) => c.status === "filled");
    const lastDryRun = commands.find((c) => /DRY_RUN/i.test(String(c.error_message ?? "")));
    const lastAny = commands[0] ?? null;
    const lastAnyAgeMs = lastAny ? nowMs - new Date(lastAny.created_at).getTime() : null;

    let executorState: "real_ativo" | "modo_teste" | "sem_sinal" | "sem_comando";
    let executorRef: any = null;
    if (lastFilled && lastDryRun) {
      // O mais recente dos dois manda: o executor pode ter sido religado ou desligado.
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

    // ── cotação viva por ativo (para preço atual e latência do tick) ──
    const symbols = Array.from(new Set([
      ...(openLive ?? []).map((o: any) => o.symbol),
      ...(auths ?? []).filter((a: any) => a.enabled).map((a: any) => a.symbol),
    ].map((s) => rootSymbol(String(s ?? "")))));

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

    // ── 2. Posição real aberta ──
    const positions = (openLive ?? []).map((o: any) => {
      const root = rootSymbol(String(o.symbol));
      const p = profileFor(root);
      const quote = quoteByRoot[root] ?? { price: null, tick_ts: null, age_s: null };
      const dir = o.side === "buy" ? 1 : -1;
      const entry = Number(o.entry_price);
      const live = quote.price;
      const pts = live != null && Number.isFinite(entry) ? (live - entry) * dir : null;
      const brl = pts != null ? pts * p.tick_value_brl * Number(o.quantity ?? 0) : null;
      return {
        id: o.id, symbol: o.symbol, root, quote_symbol: p.quote_symbol,
        tick_size: p.tick_size, tick_value_brl: p.tick_value_brl,
        side: o.side, quantity: Number(o.quantity ?? 0), entry_price: entry,
        entry_time: o.entry_time ?? null, mode: o.mode, variant: o.variant ?? "indicador",
        magic_number: Number(o.magic_number ?? 0),
        live_price: live, quote_tick_ts: quote.tick_ts, quote_age_s: quote.age_s,
        unrealized_pts: pts, unrealized_brl: brl,
      };
    });

    // ── 3. Resultado real de hoje ──
    const realizedBrl = (closedLive ?? []).reduce((acc: number, o: any) => acc + Number(o.net_result_brl ?? 0), 0);
    const unrealizedBrl = positions.reduce((acc, p) => acc + (p.unrealized_brl ?? 0), 0);
    const capital = Number(tset?.capital_disponivel_brl ?? 0) || null;
    const pct = (v: number) => (capital && capital > 0 ? v / capital : null);
    const today = {
      realized_brl: realizedBrl,
      unrealized_brl: unrealizedBrl,
      total_brl: realizedBrl + unrealizedBrl,
      realized_pct: pct(realizedBrl),
      unrealized_pct: pct(unrealizedBrl),
      total_pct: pct(realizedBrl + unrealizedBrl),
      capital_brl: capital,
      closed_count: (closedLive ?? []).length,
      environment: (tset?.environment ?? "simulation") as string,
    };

    // ── 5. Espelhamento: real x gêmeo simulado, por robô autorizado ──
    const authorized = (auths ?? []).filter((a: any) => a.enabled === true) as any[];
    const mirror: any[] = [];
    if (authorized.length) {
      const rootsAuth = Array.from(new Set(authorized.map((a) => rootSymbol(String(a.symbol)))));
      const { data: runs } = await supabase.from("b3_simulation_runs")
        .select("id, symbol, variant, status")
        .eq("user_id", userId).eq("status", "running");
      const runList = (runs ?? []) as any[];

      const runIds = runList
        .filter((r) => rootsAuth.includes(rootSymbol(String(r.symbol))))
        .map((r) => r.id);

      let simOrders: any[] = [];
      if (runIds.length) {
        const { data: sim } = await supabase.from("b3_simulation_orders")
          .select("simulation_run_id, mode, side, quantity, entry_price, entry_time, exit_price, exit_time, net_result_brl, status, created_at")
          .eq("user_id", userId).in("simulation_run_id", runIds)
          .or(`entry_time.gte.${dayStartUtc},status.eq.open`)
          .order("entry_time", { ascending: true });
        simOrders = (sim ?? []) as any[];
      }
      const runById: Record<string, any> = {};
      for (const r of runList) runById[r.id] = r;

      const liveAll = [
        ...positions.map((p) => ({ ...p, status: "open", exit_price: null, exit_time: null, net_result_brl: null })),
        ...((closedLive ?? []) as any[]).map((o) => ({
          ...o, root: rootSymbol(String(o.symbol)), status: "closed",
          entry_price: Number(o.entry_price), quantity: Number(o.quantity ?? 0),
          variant: o.variant ?? "indicador",
        })),
      ];

      for (const a of authorized) {
        const root = rootSymbol(String(a.symbol));
        const p = profileFor(root);
        const realTrades = liveAll
          .filter((o: any) => o.root === root && o.mode === a.mode && (o.variant ?? "indicador") === a.variant)
          .map((o: any) => ({
            side: o.side, quantity: Number(o.quantity ?? 0), entry_price: Number(o.entry_price),
            entry_time: o.entry_time, entry_minute: minuteKey(o.entry_time),
            exit_price: o.exit_price == null ? null : Number(o.exit_price),
            exit_time: o.exit_time ?? null, status: o.status,
            net_result_brl: o.net_result_brl == null ? null : Number(o.net_result_brl),
          }));

        const simTrades = simOrders
          .filter((o: any) => {
            const run = runById[o.simulation_run_id];
            if (!run) return false;
            return rootSymbol(String(run.symbol)) === root
              && o.mode === a.mode
              && (run.variant ?? "indicador") === a.variant;
          })
          .map((o: any) => ({
            side: o.side, quantity: Number(o.quantity ?? 0), entry_price: Number(o.entry_price),
            entry_time: o.entry_time ?? o.created_at, entry_minute: minuteKey(o.entry_time ?? o.created_at),
            exit_price: o.exit_price == null ? null : Number(o.exit_price),
            exit_time: o.exit_time ?? null, status: o.status,
            net_result_brl: o.net_result_brl == null ? null : Number(o.net_result_brl),
          }));

        // Pareamento por proximidade de minuto (tolerância de 2 minutos):
        // o que precisa bater é minuto, lado e preço — o resultado em reais
        // NÃO bate, porque o real usa max_qty da autorização e o simulado usa
        // a quantidade cheia do modo.
        const usedSim = new Set<number>();
        const pairs = realTrades.map((r) => {
          let bestIdx = -1; let bestDiff = Infinity;
          simTrades.forEach((s, i) => {
            if (usedSim.has(i)) return;
            const dt = Math.abs(new Date(s.entry_time).getTime() - new Date(r.entry_time).getTime());
            if (dt <= 2 * MINUTE && dt < bestDiff) { bestDiff = dt; bestIdx = i; }
          });
          const s = bestIdx >= 0 ? simTrades[bestIdx] : null;
          if (bestIdx >= 0) usedSim.add(bestIdx);
          return {
            real: r, sim: s,
            same_minute: s ? r.entry_minute === s.entry_minute : false,
            minute_diff_s: s ? Math.round(Math.abs(new Date(s.entry_time).getTime() - new Date(r.entry_time).getTime()) / 1000) : null,
            same_side: s ? r.side === s.side : false,
            price_diff_pts: s && Number.isFinite(s.entry_price) ? Number((r.entry_price - s.entry_price).toFixed(4)) : null,
          };
        });
        const orphanSim = simTrades.filter((_, i) => !usedSim.has(i));

        mirror.push({
          symbol: root, variant: a.variant, mode: a.mode,
          max_qty: Number(a.max_qty ?? 1), tick_size: p.tick_size,
          real_count: realTrades.length, sim_count: simTrades.length,
          pairs, orphan_sim: orphanSim,
          real_brl: realTrades.reduce((acc, r) => acc + (r.net_result_brl ?? 0), 0),
          sim_brl: simTrades.reduce((acc, s) => acc + (s.net_result_brl ?? 0), 0),
        });
      }
    }

    // ── 6. Avisos da última hora — só o que aconteceu de fato ──
    const alerts: any[] = [];
    const hourAgo = nowMs - 60 * MINUTE;
    for (const c of commands) {
      const at = new Date(c.created_at).getTime();
      if (at < hourAgo) continue;
      if (c.status === "rejected" || c.status === "error") {
        if (/DRY_RUN/i.test(String(c.error_message ?? ""))) continue; // dry-run é estado, não falha
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
    }

    // Falha de auditoria de execução gravada pelo motor/hook (última hora).
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

    // Cotação parada: condição do agora, calculada na hora — apaga sozinha
    // quando o tick volta a chegar (não é evento gravado).
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
      executor,
      positions,
      today,
      authorizations: (auths ?? []).map((a: any) => ({
        symbol: a.symbol, variant: a.variant, mode: a.mode,
        enabled: a.enabled === true, max_qty: Number(a.max_qty ?? 1),
        max_daily_loss_brl: a.max_daily_loss_brl == null ? null : Number(a.max_daily_loss_brl),
      })),
      enabled_count: (auths ?? []).filter((a: any) => a.enabled === true).length,
      mirror,
      alerts: alerts.slice(0, 12),
    };
  });

// ─────────────────── botão A: parar novas entradas ───────────────────
// Sem senha, de propósito: parada de emergência não pode ter atrito.
// Só desliga autorização de conta REAL. A simulação não é tocada e a posição
// real aberta continua sendo gerida (stop, alvo e zeragem seguem valendo).
export const stopRealNewEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ motivo: z.string().max(300).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();

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
        message: `Novas entradas reais desligadas pelo painel (${disabled.length} autorizações).`,
        technical_data: { motivo: data.motivo ?? null, autorizacoes: disabled } as any,
      });
    } catch { /* log é best-effort; o bloqueio já aconteceu */ }

    return { ok: true as const, disabled: disabled.length, rows: disabled };
  });

// ─────────────────── botão B: zerar posição agora ───────────────────
// Enfileira 'close' a mercado para cada posição real aberta e, em seguida,
// desliga as autorizações. Exige confirmação na tela (não senha).
export const closeRealPositionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ confirm: z.literal(true) }).parse(input))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: open, error: openErr } = await supabase.from("b3_live_orders")
      .select("id, symbol, side, quantity, mode, variant, magic_number, simulation_run_id")
      .eq("user_id", userId).eq("status", "open");
    if (openErr) throw openErr;

    const positions = (open ?? []) as any[];
    if (!positions.length) {
      return { ok: false as const, queued: 0, disabled: 0, reason: "sem posição real aberta para zerar" };
    }

    const stamp = Date.now();
    const commands = positions.map((o) => ({
      user_id: userId,
      env: "real",
      simulation_run_id: o.simulation_run_id ?? null,
      mode: o.mode,
      variant: o.variant ?? "indicador",
      action: "close",
      // Fechar é a ponta contrária da posição aberta.
      side: o.side === "buy" ? "sell" : "buy",
      symbol: o.symbol,
      quantity: Number(o.quantity ?? 1),
      magic_number: Number(o.magic_number ?? 0),
      idempotency_key: `panic_close:${o.id}:${stamp}`,
      requested_by: "user_close_all",
      // A validade padrão é de 10 s; pelo celular vale dar folga para o
      // executor reivindicar o comando na próxima volta do loop.
      expires_at: new Date(stamp + 120_000).toISOString(),
    }));

    const { error: insErr } = await (supabase as any).from("b3_mt5_commands").insert(commands);
    if (insErr) throw insErr;

    const now = new Date().toISOString();
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
        technical_data: { comandos: commands.map((c) => ({ symbol: c.symbol, side: c.side, quantity: c.quantity, magic_number: c.magic_number })), autorizacoes_desligadas: rows ?? [] } as any,
      });
    } catch { /* best-effort */ }

    return { ok: true as const, queued: commands.length, disabled: (rows ?? []).length };
  });
