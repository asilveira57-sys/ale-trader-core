// Pausa central da Binance (robot_settings.status).
// Todos os hooks automáticos consultam esta flag ANTES de qualquer
// processamento, INSERT, UPDATE, log ou chamada externa.
// Pausar Binance não pausa a B3; pausar a B3 não pausa a Binance.

export async function isBinancePaused(sb: any): Promise<boolean> {
  try {
    const { data } = await sb.from("robot_settings").select("status").eq("id", 1).maybeSingle();
    return data?.status === "paused";
  } catch {
    // Em falha de leitura, prefira não processar (evita I/O em cascata).
    return true;
  }
}

/** Cliente admin leve para os hooks públicos da Binance. */
export async function binanceHookClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
