// CARTEIRA DO REAL (06/10/2026).
// Capital operacional = soma dos lançamentos declarados pelo dono em
// b3_real_carteira + resultado realizado das ordens reais fechadas DEPOIS
// do lançamento mais recente (b3_live_orders.net_result_brl com exit_time
// posterior à data de corte). O lançamento mais recente é uma fotografia do
// saldo: o resultado histórico anterior a ele já está embutido no valor
// declarado e NÃO entra na conta. Carteira vazia => capital operacional 0.
// É o ÚNICO número que o portão de abertura real usa para decidir se há
// capital. O MT5 (b3_mt5_account_state) continua sendo lido, só como conferência.
export const FOLGA_MARGEM = 1.3;

const raiz = (s: string) => String(s ?? "").toUpperCase().replace(/[FGHJKMNQUVXZ]\d{2}$/, "");

export async function lerCarteira(supabase: any, userId: string) {
  const { data: lanc, error: e1 } = await supabase.from("b3_real_carteira")
    .select("id, data, tipo, valor_brl, observacao, criado_em")
    .eq("user_id", userId).order("data", { ascending: false }).order("criado_em", { ascending: false }).limit(1000);
  if (e1) throw new Error(`carteira: ${e1.message}`);
  // Data de corte: data do lançamento mais recente. Só o resultado POSTERIOR
  // a ela conta; ordens fechadas antes ou no dia já estão embutidas no valor declarado.
  const dataCorte: string | null = lanc && lanc.length > 0 ? String(lanc[0].data) : null;
  let realizado = 0;
  let ordens = 0;
  let realizadoHistorico = 0;
  let ordensHistorico = 0;
  for (let from = 0; ; from += 1000) {
    const { data: rows, error } = await supabase.from("b3_live_orders").select("net_result_brl, exit_time")
      .eq("user_id", userId).not("exit_time", "is", null).range(from, from + 999);
    if (error) throw new Error(`ordens reais: ${error.message}`);
    for (const r of rows ?? []) {
      const v = Number(r.net_result_brl ?? 0);
      const posterior = dataCorte != null && String(r.exit_time).slice(0, 10) > dataCorte;
      if (posterior) { realizado += v; ordens++; }
      else { realizadoHistorico += v; ordensHistorico++; }
    }
    if (!rows || rows.length < 1000) break;
  }
  const declarado = (lanc ?? []).reduce((s: number, l: any) => s + Number(l.valor_brl ?? 0), 0);
  return {
    lancamentos: lanc ?? [],
    declarado_brl: Math.round(declarado * 100) / 100,
    data_corte: dataCorte,
    realizado_brl: Math.round(realizado * 100) / 100,
    ordens_fechadas: ordens,
    realizado_historico_brl: Math.round(realizadoHistorico * 100) / 100,
    ordens_fechadas_historico: ordensHistorico,
    capital_operacional_brl: Math.round((declarado + realizado) * 100) / 100,
  };
}

/** Maior margem cadastrada entre os contratos do ativo (conservador). */
export async function margemDoAtivo(supabase: any, symbol: string): Promise<number | null> {
  const { data } = await supabase.from("b3_asset_profiles").select("symbol, margin_per_contract_brl");
  const r = raiz(symbol);
  const ms = (data ?? []).filter((p: any) => raiz(p.symbol) === r).map((p: any) => Number(p.margin_per_contract_brl ?? 0)).filter((n: number) => n > 0);
  return ms.length ? Math.max(...ms) : null;
}

export function contratosSustentados(capital: number, margem: number | null) {
  if (!margem || margem <= 0) return null;
  return Math.max(0, Math.floor(capital / (margem * FOLGA_MARGEM)));
}

/** Capacidade por ativo com robô autorizado no real. */
export async function capacidadePorAtivo(supabase: any, userId: string, capital: number) {
  const { data: auths } = await supabase.from("b3_prd_authorizations").select("symbol")
    .eq("user_id", userId).eq("enabled", true).is("revoked_at", null);
  const ativos = Array.from(new Set<string>((auths ?? []).map((a: any) => raiz(a.symbol))));
  const out: Array<{ ativo: string; margem_brl: number | null; minimo_brl: number | null; contratos: number | null; insuficiente: boolean }> = [];
  for (const a of ativos) {
    const m = await margemDoAtivo(supabase, a);
    const c = contratosSustentados(capital, m);
    out.push({ ativo: a, margem_brl: m, minimo_brl: m ? Math.round(m * FOLGA_MARGEM * 100) / 100 : null, contratos: c, insuficiente: c === 0 });
  }
  return out;
}
