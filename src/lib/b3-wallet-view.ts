export interface RobotWallet {
  symbol: string; variant: string; mode: string; saldo_inicial_brl: number; saldo_atual_brl: number;
  resultado_proprio_brl: number; recebido_de_transferencias_brl: number; contratos_atuais: number;
  estado: string; criada_em: string; atualizada_em: string; margin: number | null; max_contracts: number | null;
}
export function walletSteps(w: RobotWallet) {
  if (w.margin == null || !(w.margin > 0)) return null;
  const unit = w.margin * 1.30;
  const allowed = Math.max(0, Math.floor(w.saldo_atual_brl / unit));
  return { allowed, next: allowed + 1, missing: Math.max(0, Math.round(((allowed + 1) * unit - w.saldo_atual_brl) * 100) / 100), capped: w.max_contracts != null && allowed > w.max_contracts };
}
export function walletSummary(rows: RobotWallet[]) {
  return rows.reduce((s,w) => ({ capital: s.capital + Number(w.saldo_atual_brl), contracts: s.contracts + Number(w.contratos_atuais), robots: s.robots + 1, insufficient: s.insufficient + Number(w.estado === "carteira_insuficiente") }), { capital: 0, contracts: 0, robots: 0, insufficient: 0 });
}
export function walletExposure(cards: { symbol: string; open?: { side: string; quantity: number } | null }[], margins: Map<string, number>) {
  const byAsset = new Map<string, { buy: number; sell: number }>();
  for (const c of cards) {
    if (!c.open) continue;
    const root = c.symbol.replace(/[FGHJKMNQUVXZ]\d{2}$/i, "").toUpperCase();
    const g = byAsset.get(root) ?? { buy: 0, sell: 0 };
    if (c.open.side === "buy") g.buy += Number(c.open.quantity);
    else if (c.open.side === "sell") g.sell += Number(c.open.quantity);
    byAsset.set(root, g);
  }
  let gross = 0, net = 0, grossContracts = 0, netContracts = 0;
  for (const [root,g] of byAsset) {
    const margin = margins.get(root);
    if (margin == null) return null;
    gross += (g.buy + g.sell) * margin; net += Math.abs(g.buy - g.sell) * margin;
    grossContracts += g.buy + g.sell; netContracts += Math.abs(g.buy - g.sell);
  }
  return { gross, net, grossContracts, netContracts };
}