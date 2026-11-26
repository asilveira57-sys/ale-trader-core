// Robôs indicados (pedido do dono 25/11): ranking de todos os robôs por resultado
// por 1 contrato, só ordens que valeram (com freio), no período escolhido
// (últimos N pregões com ordem ou intervalo de datas). Junta a autorização real.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type RoboIndicado = {
  raiz: string; variant: string; mode: string; ordens: number; ganhos: number;
  resultado: number; resultado_sem_freio: number | null; dias: number; dias_positivos: number;
  pior_dia: number | null; melhor_dia: number | null; maior_queda: number;
  real: boolean; max_qty: number; max_daily_loss_mult: number | null;
};

export const readRobosIndicados = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    roots: z.array(z.string().regex(/^[A-Z0-9]{2,12}$/)).min(1).max(20),
    pregoes: z.number().int().min(1).max(250).nullable(),
    inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const [rk, auth] = await Promise.all([
      supabase.rpc("b3_robos_indicados", { p_roots: data.roots, p_pregoes: data.pregoes, p_inicio: data.inicio, p_fim: data.fim }),
      supabase.from("b3_prd_authorizations").select("symbol, variant, mode, enabled, revoked_at, max_qty, max_daily_loss_mult")
        .eq("user_id", userId).in("symbol", data.roots),
    ]);
    if (rk.error) throw new Error("Não foi possível ler o ranking: " + rk.error.message);
    if (auth.error) throw new Error("Não foi possível ler as autorizações reais");
    const byKey = new Map<string, any>();
    for (const a of (auth.data ?? []) as any[]) byKey.set(`${a.symbol}|${a.variant}|${a.mode}`, a);
    const rows = (rk.data ?? []) as any[];
    const first = rows[0];
    const robos: RoboIndicado[] = rows.map((r) => {
      const a = byKey.get(`${r.raiz}|${r.variant}|${r.mode}`);
      return {
        raiz: r.raiz, variant: r.variant, mode: r.mode, ordens: Number(r.ordens), ganhos: Number(r.ganhos),
        resultado: Number(r.resultado), resultado_sem_freio: r.resultado_sem_freio == null ? null : Number(r.resultado_sem_freio),
        dias: Number(r.dias), dias_positivos: Number(r.dias_positivos),
        pior_dia: r.pior_dia == null ? null : Number(r.pior_dia), melhor_dia: r.melhor_dia == null ? null : Number(r.melhor_dia),
        maior_queda: Number(r.maior_queda ?? 0),
        real: !!a?.enabled && !a?.revoked_at, max_qty: Number(a?.max_qty ?? 1),
        max_daily_loss_mult: a?.max_daily_loss_mult == null ? null : Number(a.max_daily_loss_mult),
      };
    }).sort((x, y) => y.resultado - x.resultado || y.dias_positivos - x.dias_positivos || x.maior_queda - y.maior_queda);
    return {
      robos,
      periodo: { pregoes: Number(first?.pregoes ?? 0), inicio: first?.inicio ?? null, fim: first?.fim ?? null },
      tem_autorizacao: robos.some((r) => byKey.has(`${r.raiz}|${r.variant}|${r.mode}`)),
    };
  });
