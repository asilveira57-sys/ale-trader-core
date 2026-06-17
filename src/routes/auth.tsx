import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Acesso restrito — AleTrader AI" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ownerExists, setOwnerExists] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
    // Probe whether any owner exists (anon can't read user_roles, so we infer via signup blocking later).
    setOwnerExists(null);
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
        toast.success("Conta do proprietário criada. Faça login.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard", replace: true });
      }
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
            <h1 className="text-lg font-semibold tracking-tight">AleTrader AI</h1>
            <p className="text-xs text-muted-foreground">Painel privado — acesso restrito ao proprietário</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Aguarde..." : mode === "signin" ? "Entrar" : "Criar conta do proprietário"}
          </Button>
        </form>

        <div className="mt-6 text-xs text-muted-foreground space-y-2">
          <p>
            {mode === "signin" ? (
              <>Primeiro acesso?{" "}
                <button onClick={() => setMode("signup")} className="text-primary hover:underline">Criar conta do proprietário</button>
              </>
            ) : (
              <>Já tem conta?{" "}
                <button onClick={() => setMode("signin")} className="text-primary hover:underline">Voltar ao login</button>
              </>
            )}
          </p>
          <p className="leading-relaxed">
            Sem cadastro público. Apenas o primeiro e-mail cadastrado recebe o papel de proprietário —
            qualquer conta criada depois fica sem acesso ao painel.
          </p>
          {ownerExists === false && <p className="text-warning">Nenhum proprietário ainda — crie a primeira conta.</p>}
        </div>
      </div>
    </main>
  );
}
