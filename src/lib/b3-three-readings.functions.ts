import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { resolvePeriod } from "./b3-period";
import type { ThreeReading } from "./b3-three-readings";
export const readThreeReadings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ preset: z.string().nullish(), start: z.string().nullish(), end: z.string().nullish(), symbols: z.array(z.string()).nullish(), variants: z.array(z.string()).nullish(), modes: z.array(z.string()).nullish() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const period = resolvePeriod(data);
    const clock = performance.now();
    const { data: result, error } = await context.supabase.rpc("b3_cockpit_tres_leituras", {
      p_user_id: context.userId, p_inicio: period.start, p_fim: period.end,
      p_symbols: data.symbols ?? undefined, p_variants: data.variants ?? undefined, p_modes: data.modes ?? undefined,
    });
    if (error) throw new Error("Não foi possível ler as três leituras do cockpit.");
    const out = result as unknown as { rows: ThreeReading[]; daily: any[] };
    const { data: colors, error: colorError } = await (context.supabase as any).rpc("b3_cores_dos_robos");
    if (colorError) throw new Error("Não foi possível ler as cores dos robôs.");
    return { ...out, colors: (colors ?? []) as any[], period, ms: Math.round(performance.now() - clock) };
  });