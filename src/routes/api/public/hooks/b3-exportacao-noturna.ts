// Cron público: EXPORTAÇÃO NOTURNA. Dias úteis, 18:30 às 18:50 (BRT), disparada
// por public.b3_disparar_exportacao(). Depois do fechamento (17:30) e da
// curadoria (17:35), e ANTES da retenção, que passou para as 19:00.
//
// Cada passada grava só o que ainda falta, então repetir é inofensivo e as
// passadas seguintes terminam o que a primeira não couber.
//
// Parâmetros opcionais: ?force=1 regrava arquivos já existentes;
// ?dias=2026-09-17,2026-09-18 limita a dias específicos; ?max=20 muda quantos
// arquivos uma passada grava.
import { createFileRoute } from "@tanstack/react-router";

let runningSince = 0;
const LEASE_MS = 180_000;

async function executar(request: Request): Promise<Response> {
  {
    {
      const url = new URL(request.url);
      const force = url.searchParams.get("force") === "1";
      const dias = (url.searchParams.get("dias") ?? "")
        .split(",")
        .map((d) => d.trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
      const max = Number(url.searchParams.get("max") ?? "") || undefined;

      if (runningSince && Date.now() - runningSince < LEASE_MS) {
        return Response.json(
          { skipped: true, reason: "exportacao_em_execucao", idade_ms: Date.now() - runningSince },
          { status: 202 },
        );
      }
      runningSince = Date.now();
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runExportacaoNoturna } = await import("@/lib/b3-exportacao-noturna.server");
        const res = await runExportacaoNoturna(supabaseAdmin, {
          force,
          dias: dias.length ? dias : undefined,
          maxArquivos: max,
        });
        return Response.json({ at: new Date().toISOString(), ...res });
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
      } finally {
        runningSince = 0;
      }
    }
  }
}

export const Route = createFileRoute("/api/public/hooks/b3-exportacao-noturna")({
  server: {
    handlers: {
      POST: ({ request }) => executar(request),
      // Mesma execução por GET: facilita rodar à mão pelo navegador.
      GET: ({ request }) => executar(request),
    },
  },
});
