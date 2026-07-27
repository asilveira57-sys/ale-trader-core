import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, Coins, Bot, Bell, ScrollText, Settings, LogOut, Activity, Users, Wallet, Receipt, BookOpen, Trophy, Brain, FlaskConical, Radio, ListChecks, ShieldAlert, BarChart3, ShieldCheck, FileText, Gauge, PowerOff, Eye, AlertTriangle, FileBarChart, Lightbulb, Database, Radar, Calendar, BookMarked, Sparkles, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

const AUTH_RECOVERY_RETRY_MS = 1_500;
const AUTH_RECOVERY_ATTEMPTS = 3;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthErrorMessage(message: string) {
  return /unauthorized|no authorization header|invalid token|jwt/i.test(message);
}

function isDefinitiveSessionError(message: string) {
  return /refresh token.*not found|invalid refresh token|token.*revoked|session.*not found|user from sub claim in jwt does not exist/i.test(message);
}

async function recoverSession() {
  for (let attempt = 0; attempt < AUTH_RECOVERY_ATTEMPTS; attempt += 1) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { recovered: false, definitive: true };

    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (!refreshErr && refreshed.session) return { recovered: true, definitive: false };

    const message = refreshErr?.message ?? "";
    if (isDefinitiveSessionError(message)) return { recovered: false, definitive: true };

    await wait(AUTH_RECOVERY_RETRY_MS);
  }

  return { recovered: false, definitive: false };
}

async function getUserWithTransientTolerance() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw redirect({ to: "/auth" });

  const { data, error } = await supabase.auth.getUser();
  if (data.user) return { user: data.user };

  const message = error?.message ?? "";
  if (isDefinitiveSessionError(message)) throw redirect({ to: "/auth" });

  // If Lovable Cloud auth has a transient /user timeout, keep the protected
  // route mounted. ServerFns still validate the bearer token on each call.
  return { user: sessionData.session.user };
}

function AuthErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"recovering" | "retrying" | "failed">("recovering");
  const isAuthError = isAuthErrorMessage(error?.message ?? "");

  useEffect(() => {
    if (!isAuthError) return;
    let cancelled = false;
    (async () => {
      try {
        const recovery = await recoverSession();
        if (!cancelled && recovery.recovered) {
          await qc.cancelQueries();
          await router.invalidate();
          reset();
          qc.invalidateQueries();
          return;
        }
        if (!cancelled && !recovery.definitive) {
          setStatus("retrying");
          await wait(AUTH_RECOVERY_RETRY_MS);
          await router.invalidate();
          reset();
          qc.invalidateQueries();
          return;
        }
      } catch {
        if (!cancelled) setStatus("retrying");
        await wait(AUTH_RECOVERY_RETRY_MS);
        if (!cancelled) {
          await router.invalidate();
          reset();
          qc.invalidateQueries();
        }
        return;
      }
      if (cancelled) return;
      await qc.cancelQueries();
      qc.clear();
      await supabase.auth.signOut();
      setStatus("failed");
      navigate({ to: "/auth", replace: true });
    })();
    return () => { cancelled = true; };
  }, [isAuthError, navigate, qc, router, reset]);

  if (isAuthError) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {status === "recovering" ? "Restaurando sessão…" : status === "retrying" ? "Reconectando sem sair da tela…" : "Sessão expirada. Redirecionando…"}
      </div>
    );
  }
  throw error;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: getUserWithTransientTolerance,
  component: AuthedLayout,
  errorComponent: AuthErrorBoundary,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/war-room", label: "Sala de Guerra", icon: Radio },
  { to: "/operations", label: "Operações", icon: ListChecks },
  { to: "/metrics", label: "Métricas", icon: BarChart3 },
  { to: "/risk", label: "Risco", icon: ShieldAlert },
  { to: "/committee", label: "Comitê", icon: Users },
  { to: "/council", label: "Conselho", icon: Brain },
  { to: "/library", label: "Biblioteca", icon: BookOpen },
  { to: "/ranking", label: "Ranking", icon: Trophy },
  { to: "/wallet", label: "Binance — Carteira", icon: Wallet },
  { to: "/orders", label: "Binance — Ordens", icon: Receipt },
  { to: "/binance-audit", label: "Binance — Auditoria Saídas", icon: FileSearch },
  { to: "/b3", label: "B3 Day Trade (WIN)", icon: BarChart3 },
  { to: "/b3-mt5sim", label: "Simulação MT5 XP", icon: Activity },
  { to: "/backtest", label: "Laboratório", icon: FlaskConical },
  { to: "/assets", label: "Ativos", icon: Coins },
  { to: "/agents", label: "Agentes", icon: Bot },
  { to: "/alerts", label: "Alertas", icon: Bell },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/pipeline-diagnostics", label: "Diagnóstico Pipeline", icon: Activity },
  { to: "/settings", label: "Configurações", icon: Settings },
] as const;

const AUTO_NAV = [
  { to: "/auto-dashboard", label: "Painel Automático", icon: Bot },
  { to: "/governance", label: "Governança", icon: Gauge },
  { to: "/supervisor", label: "Supervisor", icon: Eye },
  { to: "/incidents", label: "Incidentes", icon: AlertTriangle },
  { to: "/reports", label: "Relatórios", icon: FileBarChart },
  { to: "/kill-switch", label: "Kill Switch", icon: PowerOff },
] as const;

const REAL_NAV = [
  { to: "/real-dashboard", label: "Painel Real", icon: Gauge },
  { to: "/approval-desk", label: "Mesa de Aprovação", icon: ShieldCheck },
  { to: "/audit", label: "Auditoria", icon: FileText },
  { to: "/real-risk", label: "Limites Reais", icon: ShieldAlert },
] as const;

const INTEL_NAV = [
  { to: "/intelligence", label: "Centro de Inteligência", icon: Sparkles },
  { to: "/recommendations", label: "Recomendações", icon: Lightbulb },
  { to: "/strategic-memory", label: "Memória Estratégica", icon: Database },
  { to: "/strategy-lab", label: "Laboratório", icon: FlaskConical },
  { to: "/regimes", label: "Regimes", icon: Brain },
  { to: "/radar", label: "Radar", icon: Radar },
  { to: "/seasons", label: "Temporadas", icon: Calendar },
  { to: "/agent-rankings", label: "Conselho Evolutivo", icon: Trophy },
  { to: "/knowledge", label: "Conhecimento", icon: BookMarked },
  { to: "/post-trade", label: "Pós-Operação", icon: FileBarChart },
] as const;


function AuthedLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="grid place-items-center size-8 rounded-md bg-primary/15 text-primary">
              <Activity className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">AleTrader AI</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Painel privado</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to);
            return (
              <Link key={to} to={to} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`}>
                <Icon className="size-4" />
                <span>{label}</span>
              </Link>
            );
          })}
          <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-emerald-400/80">Automação</div>
          {AUTO_NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to);
            return (
              <Link key={to} to={to} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-emerald-500/15 text-emerald-200" : "text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-200"}`}>
                <Icon className="size-4" />
                <span>{label}</span>
              </Link>
            );
          })}
          <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-orange-400/80">Operação Real</div>
          {REAL_NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to);
            return (
              <Link key={to} to={to} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-orange-500/15 text-orange-200" : "text-muted-foreground hover:bg-orange-500/10 hover:text-orange-200"}`}>
                <Icon className="size-4" />
                <span>{label}</span>
              </Link>
            );
          })}
          <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-purple-400/80">Inteligência</div>
          {INTEL_NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to);
            return (
              <Link key={to} to={to} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-purple-500/15 text-purple-200" : "text-muted-foreground hover:bg-purple-500/10 hover:text-purple-200"}`}>
                <Icon className="size-4" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={signOut}>
            <LogOut className="size-4" /> Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
