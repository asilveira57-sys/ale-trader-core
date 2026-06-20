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

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      if (data.session.user.email?.toLowerCase() === ALLOWED_EMAIL) {
        navigate({ to: "/dashboard", replace: true });
      } else {
        supabase.auth.signOut();
      }
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const normalized = email.trim().toLowerCase();
      if (normalized !== ALLOWED_EMAIL) {
        throw new Error("Acesso restrito.");
      }
      const { error } = await supabase.auth.signInWithPassword({ email: normalized, password });
      if (error) throw error;
      navigate({ to: "/dashboard", replace: true });
    } catch (err: any) {
      toast.error(err.message ?? "Falha de autenticação");
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
