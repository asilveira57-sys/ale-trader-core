// Health check leve para o conector MT5 medir disponibilidade e latência.
// Sem consultas ao banco por padrão (resposta em poucos ms).
// ?db=1 faz um ping mínimo e limitado (HEAD count) para checar o banco.
import { createFileRoute } from "@tanstack/react-router";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export const Route = createFileRoute("/api/public/hooks/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const t0 = Date.now();
        const url = new URL(request.url);
        let db: { ok: boolean; ms: number; error?: string } | undefined;

        if (url.searchParams.get("db") === "1") {
          const d0 = Date.now();
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const timeout = new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error("db timeout")), 2_000),
            );
            await Promise.race([
              (supabaseAdmin as any)
                .from("b3_mt5sim_quotes")
                .select("id", { head: true, count: "exact" })
                .limit(1),
              timeout,
            ]);
            db = { ok: true, ms: Date.now() - d0 };
          } catch (e) {
            db = { ok: false, ms: Date.now() - d0, error: (e as Error).message };
          }
        }

        return new Response(
          JSON.stringify({ ok: true, service: "b3-mt5-bridge", at: new Date().toISOString(), ms: Date.now() - t0, db }),
          { status: 200, headers: JSON_HEADERS },
        );
      },
      HEAD: async () => new Response(null, { status: 204 }),
    },
  },
});
