import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { marcoInput, type Marco } from "./b3-marcos";
export const readMarcos = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const rows: Marco[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await context.supabase.from("b3_marco_mudanca").select("*").eq("user_id", context.userId).order("data", { ascending: false }).order("id").range(from, from + 999);
    if (error) throw new Error("Não foi possível ler os marcos.");
    rows.push(...data); if (data.length < 1000) return rows;
  }
  throw new Error("Limite de marcos atingido; leitura incompleta.");
});
export const saveMarco = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((i: unknown) => marcoInput.parse(i)).handler(async ({ data, context }) => {
  const { id, ...payload } = data;
  const normalized = { ...payload, user_id: context.userId, symbol: data.escopo === "global" ? null : data.symbol, variant: data.escopo === "modalidade" ? data.variant : null };
  const result = id ? await context.supabase.from("b3_marco_mudanca").update(normalized).eq("id", id).eq("user_id", context.userId).select().single() : await context.supabase.from("b3_marco_mudanca").insert(normalized).select().single();
  if (result.error) throw new Error("Não foi possível salvar o marco.");
  return result.data;
});