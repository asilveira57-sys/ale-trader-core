// Presentation reads only; never changes orders, financial rules or RPC bodies.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { rootSymbol } from "./b3-format";
import type { BrakeEvidence, ExposureEvidence } from "./b3-cockpit-labels";

export const getCockpitLabelEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ symbols: z.array(z.string()).nullish(), variants: z.array(z.string()).nullish(), modes: z.array(z.string()).nullish() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const args = { p_user_id: context.userId, p_dias: 6, p_symbols: data.symbols?.length ? data.symbols.map(rootSymbol) : null, p_variants: data.variants?.length ? data.variants : null };
    const sb = context.supabase as any;
    const [brake, exposure] = await Promise.all([
      sb.rpc("b3_efeito_freio_dia", args),
      sb.rpc("b3_pico_exposicao_dia", { ...args, p_folga: 1.30 }),
    ]);
    if (brake.error || exposure.error) throw new Error("Não foi possível ler as evidências do freio e da exposição");
    // Catalog joins can repeat a mode's row for SC aliases: preserve one identity.
    const byKey = new Map<string, BrakeEvidence>();
    for (const r of brake.data ?? []) {
      if (data.modes?.length && (r.mode === "(modalidade)" || !data.modes.includes(r.mode))) continue;
      const row = { ...r, trade_date: String(r.trade_date).slice(0, 10) } as BrakeEvidence;
      const key = `${row.trade_date}|${row.raiz}|${row.variant}|${row.mode}`;
      const previous = byKey.get(key);
      if (!previous || (row.variant.endsWith("_sc") === row.apelido.endsWith(" SC"))) byKey.set(key, row);
    }
    return { brake: [...byKey.values()], exposure: (exposure.data ?? []) as ExposureEvidence[], exposure_modes_ignored: !!data.modes?.length };
  });