import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Fonte ÚNICA dos apelidos dos modos: public.b3_mode_apelidos.
// Apelido é rótulo de tela. A chave continua sendo `mode`
// ('conservador', 'semi_agressivo', ...) em magic, autorizações, comandos e
// em todo o histórico. Nada aqui participa de decisão do motor.
export const listModeApelidos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("b3_mode_apelidos")
      .select("mode, apelido, ordem, rotulo_tecnico, observacao")
      .order("ordem", { ascending: true });

    if (error) throw error;
    return { rows: data ?? [] };
  });
