// Anexa o bearer token nas chamadas de serverFn.
// Diferente do attacher gerado, aqui o token é renovado quando está a menos de
// 60 s do vencimento (ou já vencido), evitando o "Unauthorized: Invalid token"
// quando o refresh automático do supabase-js falha por timeout de rede.
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

const SKEW_S = 60;
const RETURN_TO_KEY = "aletrader:return-to";

// O erro que volta do serverFn nem sempre é um Error: pode chegar como objeto
// serializado ({ message }), como Response com corpo JSON ou como string. Se a
// detecção falhar, o token rejeitado é reenviado em toda chamada e a tela fica
// branca em vez de voltar para o login.
function messageOf(error: unknown): string {
  if (error == null) return "";
  if (error instanceof Error) return `${error.message} ${(error as any).cause ? messageOf((error as any).cause) : ""}`;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const o = error as Record<string, unknown>;
    const parts = [o["message"], o["error"], o["statusText"], o["body"]]
      .map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? messageOf(v) : ""))
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(error);
    } catch {
      return "";
    }
  }
  return String(error);
}

function isRejectedSession(error: unknown) {
  return /unauthorized|invalid token|invalid jwt|jwt.*invalid|token.*revoked|no authorization header/i.test(
    messageOf(error),
  );
}

async function leaveInvalidSession(): Promise<never> {
  try {
    const path = window.location.pathname + window.location.search;
    if (!path.startsWith("/auth")) window.sessionStorage.setItem(RETURN_TO_KEY, path);
  } catch {
    // Storage can be unavailable in private browsing; redirect still works.
  }

  // Local scope is intentional: an invalid token cannot complete a remote
  // sign-out, especially while auth is unavailable. Clearing it locally stops
  // every subsequent serverFn from resending the same rejected credential.
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The redirect below is the final recovery path.
  }

  window.location.replace("/auth");
  // Keep the rejected RPC from becoming an unhandled promise while navigation
  // unloads this document. This prevents the blank-screen error boundary path.
  return new Promise<never>(() => {});
}

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
        const { data: refreshed, error } = await supabase.auth.refreshSession();
        // Nunca envie novamente um JWT vencido quando a renovação falhar. Isso
        // mascarava a causa e fazia todas as serverFns responderem Invalid token.
        if (error || !refreshed.session?.access_token) return undefined;
        return refreshed.session.access_token;
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
    try {
      return await next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
    } catch (error) {
      if (isRejectedSession(error)) return leaveInvalidSession();
      throw error;
    }
  },
);

