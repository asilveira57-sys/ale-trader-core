// Anexa o bearer token nas chamadas de serverFn.
// Diferente do attacher gerado, aqui o token é renovado quando está a menos de
// 60 s do vencimento (ou já vencido), evitando o "Unauthorized: Invalid token"
// quando o refresh automático do supabase-js falha por timeout de rede.
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

const SKEW_S = 60;

export const attachSupabaseAuthFresh = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    let token: string | undefined;
    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      const expiresAt = session?.expires_at ?? 0;
      const stale = !session || expiresAt - Math.floor(Date.now() / 1000) < SKEW_S;
      if (session && stale) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token ?? session.access_token;
      } else {
        token = session?.access_token;
      }
    } catch {
      token = undefined;
    }
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
