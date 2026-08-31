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

const EARLY_ASSET_RECOVERY = String.raw`
(() => {
  const key = "aletrader:failed-asset";
  const recover = (asset) => {
    if (!asset || !asset.includes("/assets/")) return;
    if (sessionStorage.getItem(key) === asset) return;
    sessionStorage.setItem(key, asset);
    const url = new URL(location.href);
    url.searchParams.set("_asset_recovery", Date.now().toString());
    location.replace(url.toString());
  };
  addEventListener("error", (event) => {
    const target = event.target;
    if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
      recover(target.src || target.href || "");
    }
  }, true);
  addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    const asset = event.payload && (event.payload.url || event.payload.src);
    recover(asset || "/assets/preload");
  });
})();
`;

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
  const canReloadNow = () => {
    const last = Number(sessionStorage.getItem(GLOBAL_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(GLOBAL_RELOAD_KEY, String(Date.now()));
    return true;
  };
  // Erro sem mensagem ("Uncaught undefined") com tela branca costuma ser chunk
  // obsoleto após deploy. Em vez de recarregar às cegas (o que derrubava o
  // painel no meio do pregão), confirmamos se o asset em uso ainda existe.
  // Tela branca sem erro legível: se o bundle sumiu (deploy novo), recarrega.
  // Se o bundle está no ar, o erro é real — e aí NÃO recarregamos em loop:
  // mostramos um aviso clicável, porque tela preta muda no meio do pregão é pior.
  const showBlankScreenFallback = () => {
    if (document.getElementById("aletrader-blank-fallback")) return;
    const text = (document.body?.innerText ?? "").trim();
    if (text.length > 0) return; // a tela ainda mostra algo: não atrapalhar
    const box = document.createElement("div");
    box.id = "aletrader-blank-fallback";
    box.setAttribute(
      "style",
      "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;gap:12px;" +
        "align-items:center;justify-content:center;padding:24px;text-align:center;" +
        "font-family:system-ui,sans-serif;background:#0b0f16;color:#e6edf7",
    );
    box.innerHTML =
      '<p style="font-weight:800;font-size:18px;margin:0">A tela travou ao carregar</p>' +
      '<p style="margin:0;font-size:13px;opacity:.75;max-width:34rem">' +
      "Nenhuma operação foi afetada: o motor e o executor rodam no servidor. Recarregue para voltar ao painel." +
      "</p>" +
      '<button id="aletrader-blank-reload" style="margin-top:4px;padding:10px 18px;border-radius:10px;' +
      'border:0;background:#e11d48;color:#fff;font-weight:800;cursor:pointer">Recarregar o painel</button>';
    document.body.appendChild(box);
    document.getElementById("aletrader-blank-reload")?.addEventListener("click", hardReload);
  };

  const reloadIfStaleDeploy = async () => {
    try {
      const srcs = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))
        .map((s) => s.getAttribute("src") ?? "")
        .filter((s) => s.includes("/assets/"));
      if (!srcs.length) return;
      const alive = await Promise.all(
        srcs.map((src) =>
          fetch(src, { method: "HEAD", cache: "no-store" })
            .then((r) => r.ok)
            .catch(() => false),
        ),
      );
      if (alive.every(Boolean)) {
        // Bundle íntegro. Se a tela ficou realmente em branco, tenta UMA recarga
        // com cache-bust (index.html pode estar velho no cache do browser);
        // se já recarregou há pouco, mostra a saída manual.
        setTimeout(() => {
          const blank = (document.body?.innerText ?? "").trim().length === 0;
          if (!blank) return;
          if (canReloadNow()) hardReload();
          else showBlankScreenFallback();
        }, 400);
        return;
      }
      if (canReloadNow()) hardReload();

    } catch {
      /* silencioso */
    }
  };

  const maybeReload = (value: unknown) => {
    try {
      const msg = String((value as any)?.message ?? value ?? "");
      const isModuleFail =
        /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Failed to fetch dynamically|error loading|Unexpected token '<'|MIME type/i.test(msg);
      if (!isModuleFail) {
        if (!msg || msg === "undefined") void reloadIfStaleDeploy();
        return;
      }
      if (canReloadNow()) hardReload();
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
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Cockpit Real" },
      { name: "format-detection", content: "telephone=no" },
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
      <head>
        <script dangerouslySetInnerHTML={{ __html: EARLY_ASSET_RECOVERY }} />
        <HeadContent />
      </head>
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
