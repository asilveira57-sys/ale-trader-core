import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listB3MacroEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("b3_macro_events")
      .select("id, name, category, block_start, block_end, severity, active, notes")
      .eq("user_id", userId)
      .order("block_start", { ascending: true })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  });

export const upsertB3MacroEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id?: string; name: string; category?: string; block_start: string; block_end: string; severity?: "low" | "medium" | "high"; active?: boolean; notes?: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const row = {
      user_id: userId,
      name: data.name,
      category: data.category ?? "macro",
      block_start: data.block_start,
      block_end: data.block_end,
      severity: data.severity ?? "high",
      active: data.active ?? true,
      notes: data.notes ?? null,
    };

    if (data.id) {
      const { error } = await supabase
        .from("b3_macro_events")
        .update(row)
        .eq("id", data.id)
        .eq("user_id", userId);
      if (error) throw error;
      return { ok: true, id: data.id };
    }

    const { data: inserted, error } = await supabase
      .from("b3_macro_events")
      .insert(row)
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, id: inserted.id };
  });

export const deleteB3MacroEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("b3_macro_events")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });