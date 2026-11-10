import { realApuracao } from "./b3-real-apuracao";

export async function readRealApuracao(supabase: any, userId: string, start: string, end: string) {
  const rows: any[] = [];
  const cap = 20000;
  for (let offset = 0; offset < cap; offset += 1000) {
    const { data, error } = await supabase.from("b3_live_orders").select("*")
      .eq("user_id", userId)
      .in("status", ["open", "closed", "fechada_pela_corretora", "divergente_corretora", "irreconciliavel", "unknown_state"])
      .or(`and(exit_time.gte.${start},exit_time.lt.${end}),and(exit_time.is.null,entry_time.gte.${start},entry_time.lt.${end})`)
      .order("id").range(offset, offset + 999);
    if (error) throw new Error(`Apuração real indisponível: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return { rows, ...realApuracao(rows), rows_truncated: false };
  }
  return { rows, ...realApuracao(rows), result_unknown: true, rows_truncated: true };
}