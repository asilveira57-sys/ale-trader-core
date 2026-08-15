import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MODES = ["conservador", "moderado", "equilibrado", "semi_agressivo", "agressivo"] as const;
const SYMBOLS = ["WIN", "WDO", "PETR4", "VALE3"] as const;
const VARIANTS = ["indicador", "price_action", "mean_reversion", "range"] as const;

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

    const [rows, logs] = await Promise.all([
      supabase
        .from("b3_prd_authorizations")
        .select("id, symbol, variant, mode, enabled, max_qty, max_daily_loss_brl, authorized_at, authorized_by, revoked_at, notes, updated_at")
        .eq("user_id", userId)
        .order("symbol", { ascending: true })
        .order("variant", { ascending: true })
        .order("mode", { ascending: true }),
      supabase
        .from("b3_prd_authorization_log")
        .select("id, symbol, mode, de_enabled, para_enabled, de_max_qty, para_max_qty, motivo, origem, ts")
        .eq("user_id", userId)
        .order("ts", { ascending: false })
        .limit(20),
    ]);

    if (rows.error) throw rows.error;
    if (logs.error) throw logs.error;

    const list = rows.data ?? [];
    return {
      authorizations: list,
      log: logs.data ?? [],
      enabled_count: list.filter((r: any) => r.enabled).length,
    };
  });

export const setPrdAuthorization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        symbol: z.enum(SYMBOLS),
        mode: z.enum(MODES),
        enabled: z.boolean(),
        max_qty: z.number().int().min(1).max(100),
        max_daily_loss_brl: z.number().min(0).max(1_000_000),
        password: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertMasterPassword(data.password);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await setOrigem(supabaseAdmin, "painel");

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      enabled: data.enabled,
      max_qty: data.max_qty,
      max_daily_loss_brl: data.max_daily_loss_brl,
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
      .eq("mode", data.mode)
      .select("id, symbol, mode, enabled, max_qty")
      .maybeSingle();

    if (error) throw error;
    if (!updated) throw new Error("Combinação ativo/modo não encontrada para este usuário.");

    return { ok: true as const, row: updated };
  });

export const revokeAllPrdAuthorizations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ password: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
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
    return { ok: true as const, revoked: (rows ?? []).length };
  });
