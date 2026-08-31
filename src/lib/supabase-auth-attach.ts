// Anexa o bearer token nas chamadas de serverFn.
// Diferente do attacher gerado, aqui o token é renovado quando está a menos de
// 60 s do vencimento (ou já vencido), evitando o "Unauthorized: Invalid token"
// quando o refresh automático do supabase-js falha por timeout de rede.
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

const SKEW_S = 60;

// Na primeira renderização o storage brokered do preview pode ainda não ter
// devolvido a sessão. Sem token o serverFn responde "Unauthorized: No
// authorization header provided" e a tela fica preta. Então esperamos um
// pouco pela hidratação da sessão antes de desistir.
async function resolveToken(): Promise<string | undefined> {
  for (let tentativa = 0; tentativa < 6; tentativa += 1) {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (session) {
      const expiresAt = session.expires_at ?? 0;
      const stale = expiresAt - Math.floor(Date.now() / 1000) < SKEW_S;
      if (stale) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        return refreshed.session?.access_token ?? session.access_token;
      }
      return session.access_token;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

export const attachSupabaseAuthFresh = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    let token: string | undefined;
    try {
      token = await resolveToken();
    } catch {
      token = undefined;
    }
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);

