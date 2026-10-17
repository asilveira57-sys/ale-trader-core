import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, LayoutGrid, Coins, Bot, Bell, ScrollText, Settings, LogOut, Activity, Users, Wallet, Receipt, BookOpen, Trophy, Brain, FlaskConical, Radio, ListChecks, ShieldAlert, BarChart3, ShieldCheck, FileText, Gauge, PowerOff, Eye, AlertTriangle, FileBarChart, Lightbulb, Database, Radar, Calendar, BookMarked, Sparkles, FileSearch, Smartphone, Menu, Stethoscope, Table2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { RouteErrorFallback } from "@/components/RouteErrorFallback";


const AUTH_RECOVERY_RETRY_MS = 1_500;
const AUTH_RECOVERY_ATTEMPTS = 3;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthErrorMessage(message: string) {
  return /unauthorized|no authorization header|invalid token|jwt/i.test(message);
}

function isDefinitiveSessionError(message: string) {
  return /refresh token.*not found|invalid refresh token|invalid token|invalid jwt|jwt.*invalid|token.*revoked|session.*not found|user from sub claim in jwt does not exist/i.test(message);
}

// Timeout de infraestrutura (504/upstream) nunca deve derrubar a sessão local.
function isTransientAuthError(message: string) {
  return /timeout|upstream|network|fetch|temporar|502|503|504/i.test(message);
}

async function recoverSession() {
  let transient = false;
  for (let attempt = 0; attempt < AUTH_RECOVERY_ATTEMPTS; attempt += 1) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { recovered: false, definitive: true, transient };

    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (!refreshErr && refreshed.session) return { recovered: true, definitive: false, transient: false };

    const message = refreshErr?.message ?? "";
    if (isDefinitiveSessionError(message)) return { recovered: false, definitive: true, transient: false };
    if (isTransientAuthError(message)) transient = true;

    // backoff progressivo: 1.5s → 3s → 6s
    await wait(AUTH_RECOVERY_RETRY_MS * Math.pow(2, attempt));
  }

  return { recovered: false, definitive: false, transient };
}


// Guarda a rota onde a pessoa estava para que o login volte para lá, e não para
// o Dashboard. Perder a tela no meio do pregão é problema operacional.
export const RETURN_TO_KEY = "aletrader:return-to";
function rememberCurrentRoute() {
  try {
    if (typeof window === "undefined") return;
    const path = window.location.pathname + window.location.search;
    if (path.startsWith("/auth")) return;
    window.sessionStorage.setItem(RETURN_TO_KEY, path);
  } catch { /* modo privado */ }
}

async function getUserWithTransientTolerance() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) { rememberCurrentRoute(); throw redirect({ to: "/auth" }); }

  const { data, error } = await supabase.auth.getUser();
  if (data.user) return { user: data.user };

  const message = error?.message ?? "";
  if (isDefinitiveSessionError(message)) { rememberCurrentRoute(); throw redirect({ to: "/auth" }); }

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
          return;
        }
        if (!cancelled && (!recovery.definitive || recovery.transient)) {
          setStatus("retrying");
          await wait(AUTH_RECOVERY_RETRY_MS);
          await router.invalidate();
          reset();
          return;
        }

      } catch {
        if (!cancelled) setStatus("retrying");
        await wait(AUTH_RECOVERY_RETRY_MS);
        if (!cancelled) {
          await router.invalidate();
          reset();
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
  // Erros não relacionados a sessão (ex.: chunk obsoleto após deploy) precisam
  // cair no fallback padrão — relançar aqui produz tela branca.
  return <RouteErrorFallback error={error} reset={reset} />;

}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: getUserWithTransientTolerance,
  component: AuthedLayout,
  errorComponent: AuthErrorBoundary as any,
});

const PRINCIPAL_NAV = [
  { to: "/cockpit-real", label: "Cockpit Real (dinheiro real)", icon: Smartphone },
  { to: "/prd-autorizacoes", label: "B3 — Autorizações Reais", icon: ShieldAlert },
  { to: "/b3-cockpit", label: "Cockpit (todos os robôs)", icon: LayoutGrid },
  { to: "/b3-diagnostico", label: "Diagnóstico diário", icon: Stethoscope },
  { to: "/b3-ficha-dia", label: "Ficha do dia (por que entrou/saiu)", icon: Table2 },
  { to: "/b3-sim-disjuntor", label: "Simulação de disjuntor", icon: Table2 },
  { to: "/b3-calibracao", label: "Calibração do stop diário", icon: Stethoscope },
  { to: "/b3-proporcional", label: "Limites proporcionais", icon: Table2 },
  { to: "/b3-listas", label: "Resultado por combinação", icon: Table2 },
  { to: "/b3-extrato-real", label: "Extrato do dinheiro real", icon: Receipt },
] as const;

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
  { to: "/b3-wdo", label: "B3 Day Trade (WDO)", icon: BarChart3 },
  { to: "/b3-petr4", label: "B3 Day Trade (PETR4)", icon: BarChart3 },
  { to: "/b3-vale3", label: "B3 Day Trade (VALE3)", icon: BarChart3 },
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


// Navegação compartilhada entre a barra lateral (desktop) e a gaveta (celular).
const SIDEBAR_COLLAPSED_KEY = "aletrader:menu-recolhido";

function NavContent({ pathname, onNavigate, onSignOut, collapsed = false, onToggleCollapse }: {
  pathname: string; onNavigate?: () => void; onSignOut: () => void;
  collapsed?: boolean; onToggleCollapse?: () => void;
}) {
  const group = (
    items: readonly { to: string; label: string; icon: any }[],
    active: string,
    idle: string,
  ) =>
    items.map(({ to, label, icon: Icon }) => {
      const isActive = pathname.startsWith(to);
      return (
        <Link
          key={to}
          to={to}
          onClick={onNavigate}
          title={label}
          className={`flex items-center gap-2 rounded-md py-2 text-sm transition-colors ${collapsed ? "justify-center px-2" : "px-3"} ${isActive ? active : idle}`}
        >
          <Icon className="size-4 shrink-0" />
          {!collapsed && <span className="truncate">{label}</span>}
        </Link>
      );
    });

  return (
    <>
      <div className={`border-b border-sidebar-border py-5 ${collapsed ? "px-2" : "px-5"}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid place-items-center size-8 shrink-0 rounded-md bg-primary/15 text-primary">
              <Activity className="size-4" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight">AleTrader AI</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Painel privado</p>
              </div>
            )}
          </div>
          {onToggleCollapse && (
            <Button
              variant="ghost" size="icon"
              className={`size-7 text-muted-foreground ${collapsed ? "absolute left-1/2 top-16 -translate-x-1/2" : ""}`}
              aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
              title={collapsed ? "Expandir menu" : "Recolher menu"}
              onClick={onToggleCollapse}
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </Button>
          )}
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {!collapsed && <div className="pb-1 px-3 text-[10px] uppercase tracking-wider text-muted-foreground">Principal</div>}
        {group(PRINCIPAL_NAV, "bg-primary/15 text-primary", "text-foreground hover:bg-primary/10 hover:text-primary")}
        {!collapsed && <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-muted-foreground">Geral</div>}
        {group(NAV, "bg-accent text-accent-foreground", "text-muted-foreground hover:bg-accent/50 hover:text-foreground")}
        {!collapsed && <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-emerald-400/80">Automação</div>}
        {group(AUTO_NAV, "bg-emerald-500/15 text-emerald-200", "text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-200")}
        {!collapsed && <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-orange-400/80">Operação Real</div>}
        {group(REAL_NAV, "bg-orange-500/15 text-orange-200", "text-muted-foreground hover:bg-orange-500/10 hover:text-orange-200")}
        {!collapsed && <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-purple-400/80">Inteligência</div>}
        {group(INTEL_NAV, "bg-purple-500/15 text-purple-200", "text-muted-foreground hover:bg-purple-500/10 hover:text-purple-200")}
      </nav>
      <div className="p-3 border-t border-sidebar-border">
        <Button
          variant="ghost" size="sm" title="Sair"
          className={`w-full gap-2 text-muted-foreground ${collapsed ? "justify-center" : "justify-start"}`}
          onClick={onSignOut}
        >
          <LogOut className="size-4" /> {!collapsed && "Sair"}
        </Button>
      </div>
    </>
  );
}

function AuthedLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  // Preferência de menu recolhido — lembrada entre visitas.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"); } catch { /* modo privado */ }
  }, []);
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* modo privado */ }
      return next;
    });
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Celular: a barra lateral fixa de 240px não cabe — vira gaveta. */}
      <aside className={`relative hidden md:flex shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex-col transition-[width] ${collapsed ? "w-14" : "w-60"}`}>
        <NavContent pathname={pathname} onSignOut={signOut} collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-sidebar-border bg-background/95 px-2 py-2 backdrop-blur md:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              {/* No celular o botão preto sobre fundo preto desaparecia da tela:
                  retangular, cantos arredondados, fundo branco, letra preta. */}
              <Button aria-label="Abrir menu"
                className="h-9 w-auto rounded-md bg-white px-3 text-black hover:bg-white/90">
                <Menu className="size-5" />
              </Button>

            </SheetTrigger>
            <SheetContent side="left" className="w-[17rem] bg-sidebar p-0 text-sidebar-foreground">
              <div className="flex h-full flex-col">
                <NavContent pathname={pathname} onNavigate={() => setMenuOpen(false)} onSignOut={signOut} />
              </div>
            </SheetContent>
          </Sheet>
          <Link to="/cockpit-real" className="min-w-0 truncate text-sm font-bold tracking-tight">
            AleTrader AI
          </Link>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

