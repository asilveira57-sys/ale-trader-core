export interface TransferWallet {
  mode: string; saldo: number; contratos: number; estado: string;
  resultado_proprio: number; transferencias_liquidas: number;
  maximo_doavel: number; atualizada_em: string;
}
export interface WalletTransferPreview {
  ok: boolean; error?: string; maximo_permitido?: number;
  symbol: string; variant: string; rows: TransferWallet[];
  capital_antes: number; capital_depois: number;
  contratos_antes: number; contratos_depois?: number; reduz_contratos?: boolean;
  de_mode?: string; para_mode?: string; valor?: number; motivo?: string;
  de_saldo_antes?: number; de_saldo_depois?: number;
  para_saldo_antes?: number; para_saldo_depois?: number;
  de_contratos_antes?: number; de_contratos_depois?: number;
  para_contratos_antes?: number; para_contratos_depois?: number;
  snapshot?: string; confirmada?: boolean; id?: string;
}
export const transferMoney = (v: number | undefined) => v == null ? 'sem registro' : Number(v).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
export function transferPreviewText(p: WalletTransferPreview, label: (m:string)=>string) {
  return [
    `${p.symbol} · ${p.variant} — transferência entre robôs da mesma modalidade`,
    `Valor: ${transferMoney(p.valor)}`, `Motivo: ${p.motivo ?? 'sem registro'}`,
    'Robô\tSaldo agora\tSaldo depois\tContratos agora\tContratos depois',
    `${label(p.de_mode ?? '')} (origem)\t${transferMoney(p.de_saldo_antes)}\t${transferMoney(p.de_saldo_depois)}\t${p.de_contratos_antes ?? 'sem registro'}\t${p.de_contratos_depois ?? 'sem registro'}`,
    `${label(p.para_mode ?? '')} (destino)\t${transferMoney(p.para_saldo_antes)}\t${transferMoney(p.para_saldo_depois)}\t${p.para_contratos_antes ?? 'sem registro'}\t${p.para_contratos_depois ?? 'sem registro'}`,
    `Contratos da modalidade: ${p.contratos_antes} → ${p.contratos_depois ?? 'sem registro'}`,
    `Capital da modalidade: ${transferMoney(p.capital_antes)} → ${transferMoney(p.capital_depois)} (não muda; soma zero)`,
    ...(p.reduz_contratos ? [`esta transferência reduz os contratos da modalidade de ${p.contratos_antes} para ${p.contratos_depois}`] : []),
  ].join('\n');
}