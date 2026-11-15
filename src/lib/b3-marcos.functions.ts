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
// Manual do sistema ("livretos" = b3_manual_sistema, número = id). Só leitura;
// RLS já restringe ao dono (is_owner). Substitui o Livro de ocorrências na tela.
export const readManual = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await (context.supabase as any).from("b3_manual_sistema")
    .select("id, area, titulo, o_que_e, armadilha, como_verificar, gravidade, descoberto_em, atualizado_em")
    .order("id", { ascending: false }).range(0, 999);
  if (error) throw new Error("Não foi possível ler o manual.");
  return (data ?? []) as { id: number; area: string; titulo: string; o_que_e: string; armadilha: string | null; como_verificar: string | null; gravidade: string; descoberto_em: string | null; atualizado_em: string }[];
});
