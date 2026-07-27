import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Acesso restrito" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: AuthPage,
});

const ALLOWED_EMAIL = "asilveira57@gmail.com";
const RETRYABLE_AUTH_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504]);

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAuthStatus(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : undefined;
  }
  return undefined;
}

function isRetryableAuthError(error: unknown) {
  const status = getAuthStatus(error);
  if (status != null && RETRYABLE_AUTH_STATUSES.has(status)) return true;
  const message = error instanceof Error ? error.message : "";
  return /timeout|network|fetch|temporar/i.test(message);
}

async function signInWithRetry(email: string, password: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return;
    lastError = error;
    if (!isRetryableAuthError(error)) break;
    await wait(1_200);
  }
  throw lastError instanceof Error ? lastError : new Error("Falha de autenticação");
}

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (data.user?.email?.toLowerCase() === ALLOWED_EMAIL) {
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      if (error) supabase.auth.signOut({ scope: "local" });
    });
    return () => { cancelled = true; };
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const normalized = email.trim().toLowerCase();
      if (normalized !== ALLOWED_EMAIL) {
        throw new Error("Acesso restrito.");
      }
      await supabase.auth.signOut({ scope: "local" });
      await signInWithRetry(normalized, password);
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || data.user?.email?.toLowerCase() !== ALLOWED_EMAIL) {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error("Não foi possível validar a sessão. Tente novamente.");
      }
      navigate({ to: "/dashboard", replace: true });
    } catch (err: any) {
      const status = getAuthStatus(err);
      if (status === 504 || isRetryableAuthError(err)) {
        toast.error("Autenticação demorou para responder. Tente entrar novamente em alguns segundos.");
      } else {
        toast.error(err.message ?? "Falha de autenticação");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="panel w-full max-w-md p-8">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center size-10 rounded-md bg-primary/15 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Acesso restrito</h1>
            <p className="text-xs text-muted-foreground">Painel privado</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Aguarde..." : "Entrar"}
          </Button>
        </form>
      </div>
    </main>
  );
}
