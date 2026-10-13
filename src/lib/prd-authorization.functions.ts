import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { B3_ASSETS } from "@/lib/b3-format";

const MODES = ["conservador", "cauteloso", "moderado", "equilibrado", "semi_agressivo", "arrojado", "agressivo", "enoir"] as const;
const SYMBOLS = B3_ASSETS;
const VARIANTS = ["indicador", "price_action", "mean_reversion", "range", "rompimento", "pullback", "vwap"] as const;

// Valida a senha mestra contra o hash guardado em B3_PRD_MASTER_PASSWORD_HASH.
// Formato: scrypt$<salt_hex>$<derivado_hex>. Falha FECHADA: sem env var, erro.
async function assertMasterPassword(password: string) {
  const stored = process.env["B3_PRD_MASTER_PASSWORD_HASH"];
  if (!stored || !stored.trim()) {
    throw new Error(
      "Senha mestra não configurada: a variável B3_PRD_MASTER_PASSWORD_HASH não existe. Nenhuma autorização foi alterada.",
    );
  }

  const { scrypt, timingSafeEqual } = await import("node:crypto");

  const parts = stored.trim().split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !parts[1] || !parts[2]) {
    throw new Error("Senha mestra não configurada corretamente (formato de hash inválido). Nenhuma autorização foi alterada.");
  }

  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");

  const derived: Buffer = await new Promise((resolve, reject) => {
    scrypt(password, salt, expected.length, (err, key) => (err ? reject(err) : resolve(key as Buffer)));
  });

  if (derived.length !== expected.length || !timingSafeEqual(derived, expected)) {
    throw new Error("senha mestra inválida");
  }
}

// Marca a origem para o trigger de auditoria (b3_prd_auth_registra_mudanca).
// Best-effort: se o RPC não estiver exposto, o trigger grava 'desconhecida'.
async function setOrigem(admin: any, origem: string) {
  try {
    await admin.rpc("set_config", { setting_name: "app.origem", new_value: origem, is_local: true });
  } catch {
    /* origem fica como 'desconhecida' — não bloqueia a operação */
  }
}

export const listPrdAuthorizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { loadRealSizing, globalStopFromSizing } = await import("@/lib/b3-real-stop.server");
    // CAPITAL OFICIAL = CARTEIRA, nunca o saldo do MetaTrader (13/10/2026).
    // O MT5 reporta um saldo que nao acompanha a XP; o unico numero que o
    // portao de abertura real usa e capital_operacional_brl de lerCarteira()
    // (ver b3-simulation.functions.ts, bloqueio de abertura por capital).
    // Esta tela mostrava "Saldo da conta" lendo b3_mt5_account_state, e a
    // razao "Global / saldo" saia quatro vezes menor que a verdadeira.
    const { lerCarteira } = await import("@/lib/b3-carteira.server");

    const [rows, logs, sizing, estado, cmds] = await Promise.all([
      supabase
        .from("b3_prd_authorizations")
        .select("id, symbol, variant, mode, enabled, max_qty, max_daily_loss_brl, max_daily_loss_mult, magic_number, authorized_at, authorized_by, revoked_at, notes, updated_at")
        .eq("user_id", userId)
        .order("symbol", { ascending: true })
        .order("variant", { ascending: true })
        .order("mode", { ascending: true }),
      supabase
        .from("b3_prd_authorization_log")
        .select("id, symbol, variant, mode, de_enabled, para_enabled, de_max_qty, para_max_qty, motivo, origem, sessao_id, ts")
        .eq("user_id", userId)
        .order("ts", { ascending: false })
        .limit(20),
      loadRealSizing(supabase, userId),
      supabase
        .from("b3_mt5_account_state")
        .select("saldo, capital_liquido, reportado_em")
        .eq("user_id", userId)
        .maybeSingle(),
      // Posição real aberta por magic (comandos preenchidos dos últimos 5 dias):
      // a tela avisa que a nova quantidade só vale da PRÓXIMA entrada em diante.
      supabase
        .from("b3_mt5_commands")
        .select("action, quantity, magic_number")
        .eq("user_id", userId).eq("env", "real").eq("status", "filled")
        .gte("created_at", new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    if (rows.error) throw rows.error;
    if (logs.error) throw logs.error;

    const abertoPorMagic: Record<string, number> = {};
    for (const c of ((cmds as any)?.data ?? []) as any[]) {
      const m = String(c.magic_number ?? 0);
      const q = Math.abs(Number(c.quantity ?? 0));
      abertoPorMagic[m] = (abertoPorMagic[m] ?? 0) + (c.action === "open" ? q : -q);
    }
    for (const k of Object.keys(abertoPorMagic)) {
      if (!(abertoPorMagic[k]! > 0)) delete abertoPorMagic[k];
    }

    const list = rows.data ?? [];

    // Falha da carteira NAO derruba a tela: ela degrada para nulo e a tela
    // avisa. Autorizacao real e tela de dinheiro — nao pode ficar branca.
    let carteira: Awaited<ReturnType<typeof lerCarteira>> | null = null;
    let carteiraErro: string | null = null;
    try {
      carteira = await lerCarteira(supabase, userId);
    } catch (e) {
      carteiraErro = (e as Error).message;
    }

    return {
      authorizations: list,
      log: logs.data ?? [],
      enabled_count: list.filter((r: any) => r.enabled).length,
      posicao_aberta_por_magic: abertoPorMagic,
      // MUDANÇA 2/3 — stop global DERIVADO (nunca digitado) + insumos para a tela
      // recalcular ao vivo quando o usuário mexe em max_qty ou liga/desliga.
      sizing,
      stop_global_brl: globalStopFromSizing(sizing).total_brl,
      saldo_brl: (estado.data as any)?.saldo == null ? null : Number((estado.data as any).saldo),
      capital_liquido_brl: (estado.data as any)?.capital_liquido == null ? null : Number((estado.data as any).capital_liquido),
      estado_reportado_em: (estado.data as any)?.reportado_em ?? null,
      // CAPITAL OFICIAL (carteira). saldo_brl/capital_liquido_brl acima
      // continuam servidos, mas agora SO como conferencia do MT5.
      capital_carteira_brl: carteira?.capital_operacional_brl ?? null,
      carteira_declarado_brl: carteira?.declarado_brl ?? null,
      carteira_realizado_brl: carteira?.realizado_brl ?? null,
      carteira_data_corte: carteira?.data_corte ?? null,
      carteira_erro: carteiraErro,
    };
  });

// ─────────── SESSÃO DE EDIÇÃO (15 min, uma senha só) ───────────
// A sessão libera EDIÇÃO DE PARÂMETRO (quantidade e limite de perda).
// Ligar/desligar o real continua pedindo senha sempre — fica fora disto.
// Nada é guardado no servidor: o token é assinado (HMAC) e carrega o id da
// sessão e o vencimento. Fechar a aba perde o token e encerra a sessão.
const EDIT_SESSION_MS = 15 * 60 * 1000;

async function signSession(userId: string, sessionId: string, exp: number) {
  const key = process.env["B3_PRD_MASTER_PASSWORD_HASH"];
  if (!key) throw new Error("Senha mestra não configurada. Nenhuma sessão de edição foi aberta.");
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", key).update(`${userId}.${sessionId}.${exp}`).digest("hex");
}

/** Valida o token e devolve o id da sessão; lança se inválido ou vencido. */
async function assertEditSession(userId: string, token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("sessão de edição inválida");
  const [sessionId, expStr, mac] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) throw new Error("sessão de edição expirada — destrave novamente");
  const expected = await signSession(userId, sessionId, exp);
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("sessão de edição inválida");
  return sessionId;
}

export const openPrdEditSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ password: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertMasterPassword(data.password);
    const { randomUUID } = await import("node:crypto");
    const sessionId = randomUUID();
    const exp = Date.now() + EDIT_SESSION_MS;
    const mac = await signSession(context.userId, sessionId, exp);
    return {
      ok: true as const,
      session_id: sessionId,
      token: `${sessionId}.${exp}.${mac}`,
      expires_at: new Date(exp).toISOString(),
    };
  });

/** Altera SÓ quantidade e limite de perda, com o robô ligado ou desligado.
 *  Vale da PRÓXIMA abertura em diante: posição aberta é encerrada no tamanho
 *  em que entrou (o fechamento não consulta max_qty). */
export const updatePrdAuthorizationParams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        symbol: z.enum(SYMBOLS),
        variant: z.enum(VARIANTS),
        mode: z.enum(MODES),
        max_qty: z.number().int().min(1).max(100),
        max_daily_loss_mult: z.number().min(0).max(50),
        session_token: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const sessionId = await assertEditSession(userId, data.session_token);

    const { loadRealSizing } = await import("@/lib/b3-real-stop.server");
    const { brlFromMult } = await import("@/lib/b3-real-sizing");
    const { rootSymbol } = await import("@/lib/b3-format");
    const sizing = await loadRealSizing(supabase, userId);
    const robot = sizing.find(
      (s) => s.symbol === rootSymbol(data.symbol) && s.variant === data.variant && s.mode === data.mode,
    );
    if (!robot || !(robot.stop_pts > 0) || !(robot.point_value_brl > 0)) {
      throw new Error(
        "Não foi possível ler o stop em pontos deste robô, então a perda diária em reais não pode ser derivada do multiplicador. Nada foi alterado.",
      );
    }
    const lossBrl = brlFromMult(data.max_daily_loss_mult, robot.stop_pts, robot.point_value_brl, data.max_qty);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await (supabaseAdmin as any).rpc("b3_prd_atualizar_parametros", {
      p_user_id: userId,
      p_symbol: data.symbol,
      p_variant: data.variant,
      p_mode: data.mode,
      p_max_qty: data.max_qty,
      p_max_daily_loss_brl: lossBrl,
      p_max_daily_loss_mult: data.max_daily_loss_mult,
      p_origem: "painel_sessao_edicao",
      p_sessao_id: sessionId,
    });
    if (error) throw error;
    const row = Array.isArray(updated) ? updated[0] : updated;
    if (!row) throw new Error("Combinação ativo/modalidade/modo não encontrada para este usuário.");

    // Mudar a quantidade muda o stop global derivado — e o piso do freio de
    // pico da conta é percentual dele. Recalcula agora, como no ligar/desligar.
    const { syncPeakFloorFromGlobalStop } = await import("@/lib/b3-real-stop.server");
    const piso = await syncPeakFloorFromGlobalStop(supabase, userId);

    return { ok: true as const, row, sessao_id: sessionId, piso_pico_conta: piso };
  });




export const setPrdAuthorization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        symbol: z.enum(SYMBOLS),
        variant: z.enum(VARIANTS),
        mode: z.enum(MODES),
        enabled: z.boolean(),
        max_qty: z.number().int().min(1).max(100),
        // Unidade de entrada: MULTIPLICADOR de stop (adimensional). Os reais
        // são derivados no servidor — nunca digitados.
        max_daily_loss_mult: z.number().min(0).max(50),
        password: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMasterPassword(data.password);

    // perda_diaria_brl = multiplicador × stop_pts × valor_do_ponto × max_qty.
    // As duas colunas ficam em sincronia: max_daily_loss_brl continua sendo a
    // fonte em R$ do portão de perda e do histórico; max_daily_loss_mult é a
    // unidade digitada. O stop em pontos vem do robô, não da tela.
    const { loadRealSizing } = await import("@/lib/b3-real-stop.server");
    const { brlFromMult } = await import("@/lib/b3-real-sizing");
    const { rootSymbol } = await import("@/lib/b3-format");
    const sizing = await loadRealSizing(supabase, userId);
    const robot = sizing.find(
      (s) => s.symbol === rootSymbol(data.symbol) && s.variant === data.variant && s.mode === data.mode,
    );
    if (!robot || !(robot.stop_pts > 0) || !(robot.point_value_brl > 0)) {
      throw new Error(
        "Não foi possível ler o stop em pontos deste robô, então a perda diária em reais não pode ser derivada do multiplicador. Nenhuma autorização foi alterada.",
      );
    }
    const lossBrl = brlFromMult(data.max_daily_loss_mult, robot.stop_pts, robot.point_value_brl, data.max_qty);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await setOrigem(supabaseAdmin, "painel");

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      enabled: data.enabled,
      max_qty: data.max_qty,
      max_daily_loss_mult: data.max_daily_loss_mult,
      max_daily_loss_brl: lossBrl,
      updated_at: now,
    };
    if (data.enabled) {
      patch["authorized_at"] = now;
      patch["authorized_by"] = userId;
      patch["revoked_at"] = null;
    } else {
      patch["revoked_at"] = now;
    }

    const { data: updated, error } = await supabaseAdmin
      .from("b3_prd_authorizations")
      .update(patch as never)
      .eq("user_id", userId)
      .eq("symbol", data.symbol)
      .eq("variant", data.variant)
      .eq("mode", data.mode)
      .select("id, symbol, variant, mode, enabled, max_qty, max_daily_loss_brl, max_daily_loss_mult")
      .maybeSingle();

    if (error) throw error;
    if (!updated) throw new Error("Combinação ativo/modalidade/modo não encontrada para este usuário.");

    // Ligar/desligar robô muda o STOP GLOBAL, e o piso do freio de pico da
    // CONTA é percentual dele: recalcula os R$ agora, para não ficar velho e
    // errado em silêncio. Não toca em nenhum outro parâmetro.
    const { syncPeakFloorFromGlobalStop } = await import("@/lib/b3-real-stop.server");
    const piso = await syncPeakFloorFromGlobalStop(supabase, userId);

    return { ok: true as const, row: updated, piso_pico_conta: piso };
  });

export const revokeAllPrdAuthorizations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ password: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMasterPassword(data.password);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await setOrigem(supabaseAdmin, "kill_switch");

    const now = new Date().toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("b3_prd_authorizations")
      .update({ enabled: false, revoked_at: now, updated_at: now } as never)
      .eq("user_id", userId)
      .eq("enabled", true)
      .select("id");

    if (error) throw error;

    // Sem robô ligado o stop global é zero — o piso do freio de pico acompanha.
    const { syncPeakFloorFromGlobalStop } = await import("@/lib/b3-real-stop.server");
    await syncPeakFloorFromGlobalStop(supabase, userId);

    return { ok: true as const, revoked: (rows ?? []).length };
  });
