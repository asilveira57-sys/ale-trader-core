// Leitura da tabela b3_diagnostico_dia — preenchida pelo cron das 17:35.
// Somente leitura: nenhuma escrita, nenhum motor, nenhum comitê aqui.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface DiagnosticoInput {
  trade_date?: string | null;
}

export const getB3DiagnosticoDia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: DiagnosticoInput | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;

    // Pregões disponíveis (mais recente primeiro) para alimentar o seletor.
    const { data: dias, error: dErr } = await supabase
      .from("b3_diagnostico_dia")
      .select("trade_date")
      .order("trade_date", { ascending: false })
      .limit(2000);
    if (dErr) throw dErr;

    const datas: string[] = [];
    for (const r of dias ?? []) {
      const d = String(r.trade_date);
      if (!datas.includes(d)) datas.push(d);
    }

    const alvo = data.trade_date && datas.includes(data.trade_date) ? data.trade_date : datas[0] ?? null;
    if (!alvo) return { datas, trade_date: null, rows: [] as any[], gerado_em: null as string | null };

    const { data: rows, error: rErr } = await supabase
      .from("b3_diagnostico_dia")
      .select("*")
      .eq("trade_date", alvo)
      .order("resultado_brl", { ascending: false });
    if (rErr) throw rErr;

    return {
      datas,
      trade_date: alvo,
      rows: (rows ?? []) as any[],
      gerado_em: (rows ?? [])[0]?.gerado_em ?? null,
    };
  });
