import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rootSymbol } from "./b3-format";
import type { RobotWallet } from "./b3-wallet-view";

export const readRobotWallets = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const sb = context.supabase as any;
  const [wallets, profiles, settings] = await Promise.all([
    sb.from("b3_carteira_robo").select("symbol,variant,mode,saldo_inicial_brl,saldo_atual_brl,resultado_proprio_brl,recebido_de_transferencias_brl,contratos_atuais,estado,criada_em,atualizada_em").eq("user_id",context.userId).order("symbol").order("variant").order("mode").range(0,999),
    sb.from("b3_asset_profiles").select("symbol,margin_per_contract_brl"),
    sb.from("b3_simulation_mode_settings").select("mode,max_contracts,b3_simulation_runs!inner(symbol,variant,status,started_at)").eq("user_id",context.userId).eq("b3_simulation_runs.status","running").range(0,999),
  ]);
  if (wallets.error || profiles.error || settings.error) throw new Error("Não foi possível ler as carteiras dos robôs.");
  if (wallets.data?.length === 1000 || settings.data?.length === 1000) throw new Error("Leitura das carteiras atingiu o limite; atualize o recorte antes de usar os totais.");
  const cfg = new Map<string, { symbol: string; max: number; date: string }>();
  for (const s of settings.data ?? []) {
    const r = s.b3_simulation_runs;
    if (!r) continue;
    const key = `${rootSymbol(r.symbol)}|${r.variant ?? "indicador"}|${s.mode}`;
    const prev = cfg.get(key);
    if (!prev || r.started_at > prev.date) cfg.set(key,{ symbol: r.symbol, max: Number(s.max_contracts), date: r.started_at });
  }
  const margins = new Map<string,number>();
  const rows: RobotWallet[] = (wallets.data ?? []).map((w: any) => {
    const c = cfg.get(`${w.symbol}|${w.variant}|${w.mode}`);
    const p = (profiles.data ?? []).find((a: any) => a.symbol === c?.symbol) ?? (profiles.data ?? []).find((a: any) => rootSymbol(a.symbol) === w.symbol);
    const margin = p?.margin_per_contract_brl == null ? null : Number(p.margin_per_contract_brl);
    if (margin != null) margins.set(w.symbol,margin);
    return { ...w, saldo_atual_brl: Number(w.saldo_atual_brl), margin, max_contracts: c?.max ?? null };
  });
  return { rows, margins: Object.fromEntries(margins) };
});