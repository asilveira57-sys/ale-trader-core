import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";

import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";

// Rede de segurança global: quando um import dinâmico falha ANTES dos error
// boundaries montarem (ex.: Vite re-otimizando deps no meio da sessão ou chunk
// obsoleto após deploy), o React desmonta a árvore inteira e nenhum
// errorComponent roda — resultado: tela branca com "Uncaught undefined".
// Aqui recarregamos no máximo 1x a cada 60s para buscar o bundle novo.
const GLOBAL_RELOAD_KEY = "aletrader:global-reload-at";
if (typeof window !== "undefined") {
  const hardReload = () => {
    // Recarrega com cache-bust: sem isso o browser pode reentregar o mesmo
    // index.html antigo apontando para chunks que já não existem no CDN.
    const url = new URL(window.location.href);
    url.searchParams.set("_r", String(Date.now()));
    window.location.replace(url.toString());
  };
  const maybeReload = (value: unknown) => {
    try {
      const msg = String((value as any)?.message ?? value ?? "");
      // Só recarrega diante de falha REAL de carregamento de módulo. Erro sem
      // mensagem ("Uncaught undefined") não é motivo: recarregar por isso
      // derrubava o painel no meio do pregão e fazia perder a rota.
      const isModuleFail =
        /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Failed to fetch dynamically|error loading|Unexpected token '<'|MIME type/i.test(msg);
      if (!isModuleFail) return;

      const last = Number(sessionStorage.getItem(GLOBAL_RELOAD_KEY) ?? 0);
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem(GLOBAL_RELOAD_KEY, String(Date.now()));
      hardReload();
    } catch {
      /* nunca derrubar a página por causa da rede de segurança */
    }
  };
  // Caminho oficial do Vite para falha de preload de chunk — não passa por
  // window.onerror em todos os browsers.
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    maybeReload((e as any).payload ?? "Failed to fetch dynamically imported module");
  });
  window.addEventListener("error", (e) => {
    const ev = e as ErrorEvent;
    // Falha ao carregar <script>/<link> gera um error event no elemento, sem message.
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
      maybeReload("Loading chunk failed");
      return;
    }
    maybeReload(ev.error ?? ev.message);
  }, true);
  window.addEventListener("unhandledrejection", (e) =>
    maybeReload((e as PromiseRejectionEvent).reason),
  );
}


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Página não encontrada.</p>
        <Link to="/" className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Voltar ao painel
        </Link>
      </div>
    </div>
  );
}

import { RouteErrorFallback } from "@/components/RouteErrorFallback";



export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0b0f17" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "AleTrader" },
      { title: "AleTrader AI" },
      { name: "description", content: "Painel privado de análise de criptomoedas — AleTrader AI." },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: "AleTrader AI" },
      { name: "twitter:title", content: "AleTrader AI" },
      { property: "og:description", content: "Painel privado de análise de criptomoedas — AleTrader AI." },
      { name: "twitter:description", content: "Painel privado de análise de criptomoedas — AleTrader AI." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/6d53396e-dbeb-40df-aa30-3fe91999666b/id-preview-baf66747--f533f416-8884-4026-b7fd-9692dc80c465.lovable.app-1781615035497.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/6d53396e-dbeb-40df-aa30-3fe91999666b/id-preview-baf66747--f533f416-8884-4026-b7fd-9692dc80c465.lovable.app-1781615035497.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "icon", href: "/icon-192.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: RouteErrorFallback,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
