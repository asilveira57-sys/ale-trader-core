import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { reportLovableError } from "@/lib/lovable-error-reporting";

const CHUNK_RELOAD_KEY = "aletrader:chunk-reload";

function isStaleChunkError(error: unknown) {
  const msg = String((error as any)?.message ?? error ?? "");
  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Failed to fetch dynamically/i.test(
    msg,
  );
}

export function RouteErrorFallback({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter();
  const message =
    (error as any)?.message ?? (typeof error === "string" ? error : "") ?? "";

  useEffect(() => {
    // A new deploy invalidates old asset URLs; the failed dynamic import surfaces
    // here as an empty/undefined throw. Reload once to pick up the fresh bundle.
    if (typeof window !== "undefined" && (isStaleChunkError(error) || error == null)) {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
        window.location.reload();
        return;
      }
    }
    reportLovableError(error instanceof Error ? error : new Error(message || "Erro desconhecido"), {
      boundary: "route_error_fallback",
    });
  }, [error, message]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">Erro ao carregar</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {message || "Falha inesperada ao renderizar a página."}
        </p>
        <button
          onClick={() => {
            if (typeof window !== "undefined") sessionStorage.removeItem(CHUNK_RELOAD_KEY);
            router.invalidate();
            reset?.();
          }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}
