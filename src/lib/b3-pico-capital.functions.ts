// Somente leitura. Pico em três cenários e capital em risco vêm prontos do banco
// (migration 0031); o TypeScript só repassa as linhas, sem recalcular nada.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { resolvePeriod } from "./b3-period";

const recorte = { symbols: z.array(z.string()).nullish(), variants: z.array(z.string()).nullish(), modes: z.array(z.string()).nullish() };

export type PeakScenarioRow = { trade_date: string; raiz: string; variant: string; cenario: "sem freio" | "com freio" | "com disjuntor"; pico_brl: number | null; hora_do_pico_brt: string | null; fechamento_brl: number | null; devolveu_brl: number | null; ordens: number | null; disparou: string | null };
export type CapitalRiskRow = { nivel: "total" | "ativo" | "modalidade"; raiz: string | null; variant: string | null; robos: number; contratos_por_robo: number | null; contratos: number; margem_por_contrato_brl: number | null; capital_em_risco_brl: number; capital_com_folga_brl: number; conta: string };

export const readPeakScenarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ preset: z.string().nullish(), start: z.string().nullish(), end: z.string().nullish(), ...recorte }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const period = resolvePeriod(data);
    const { data: rows, error } = await (context.supabase as any).rpc("b3_pico_tres_cenarios_dia", {
      p_user_id: context.userId, p_inicio: period.start, p_fim: period.end,
      p_symbols: data.symbols ?? null, p_variants: data.variants ?? null, p_modes: data.modes ?? null,
    });
    if (error) throw new Error("Não foi possível ler o pico nos três cenários.");
    return { rows: (rows ?? []) as PeakScenarioRow[] };
  });

export const readCapitalRisk = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object(recorte).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any).rpc("b3_capital_em_risco", {
      p_user_id: context.userId, p_symbols: data.symbols ?? null, p_variants: data.variants ?? null, p_modes: data.modes ?? null,
    });
    if (error) throw new Error("Não foi possível ler o capital em risco.");
    return { rows: (rows ?? []) as CapitalRiskRow[] };
  });
