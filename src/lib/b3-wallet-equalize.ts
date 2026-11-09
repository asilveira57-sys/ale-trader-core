import type { TransferWallet } from './b3-wallet-transfer';
import { transferMoney } from './b3-wallet-transfer';
export interface EqualizeRow extends TransferWallet {
  teto: number; saldo_depois: number; contratos_depois: number; transferencias_depois: number;
}
export interface EqualizePreview {
  ok: boolean; error?: string; symbol: string; variant: string; n: number;
  rows: EqualizeRow[]; capital_antes: number; capital_depois: number;
  contratos_antes: number; contratos_depois: number; reduz_contratos: boolean;
  motivo: string; snapshot?: string; confirmada?: boolean;
}
export function equalizeText(p: EqualizePreview, label: (mode: string) => string): string {
  return [
    `${p.symbol} · ${p.variant} — igualar modalidade · carteira atual`,
    `Motivo: ${p.motivo ?? 'sem registro'}`, `Robôs com saldo após igualar: ${p.n}`,
    'Robô\tSaldo agora\tSaldo depois\tContratos agora\tContratos depois\tResultado próprio (inalterado)\tTransferências agora\tTransferências depois\tTeto\tEstado atual\tAtualizada em',
    ...p.rows.map(r => [label(r.mode), transferMoney(r.saldo), transferMoney(r.saldo_depois), r.contratos, r.contratos_depois, transferMoney(r.resultado_proprio), transferMoney(r.transferencias_liquidas), transferMoney(r.transferencias_depois), r.teto, r.estado, r.atualizada_em ?? 'sem registro'].join('\t')),
    `Capital da modalidade: ${transferMoney(p.capital_antes)} → ${transferMoney(p.capital_depois)} (não muda; soma zero)`,
    `Contratos da modalidade: ${p.contratos_antes} → ${p.contratos_depois}`,
    ...(p.reduz_contratos ? ['Esta equalização reduz o total de contratos da modalidade.'] : []),
  ].join('\n');
}