import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import type { WalletTransferPreview } from './b3-wallet-transfer';

const group = z.object({symbol:z.string().min(1),variant:z.string().min(1)});
const movement = group.extend({de_mode:z.string().min(1),para_mode:z.string().min(1),valor:z.number().finite().positive(),motivo:z.string().trim().min(1)});
export const readTransferWallets = createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).inputValidator(group).handler(async ({data,context}) => {
  const r = await context.supabase.rpc('b3_carteira_transferir',{p_user_id:context.userId,p_symbol:data.symbol,p_variant:data.variant,p_previa:true});
  if(r.error) throw new Error('Não foi possível ler as carteiras desta modalidade.');
  const p=r.data as unknown as Omit<WalletTransferPreview,'snapshot'> & {snapshot?:object};
  return {...p,snapshot:p.snapshot?JSON.stringify(p.snapshot):undefined} satisfies WalletTransferPreview;
});
export const previewWalletTransfer = createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).inputValidator(movement).handler(async ({data,context}) => {
  const r = await context.supabase.rpc('b3_carteira_transferir',{p_user_id:context.userId,p_symbol:data.symbol,p_variant:data.variant,p_de_mode:data.de_mode,p_para_mode:data.para_mode,p_valor:data.valor,p_motivo:data.motivo,p_previa:true});
  if(r.error) throw new Error('Não foi possível preparar a transferência. Nenhum saldo foi movido.');
  const p=r.data as unknown as Omit<WalletTransferPreview,'snapshot'> & {snapshot?:object};
  return {...p,snapshot:p.snapshot?JSON.stringify(p.snapshot):undefined} satisfies WalletTransferPreview;
});
export const confirmWalletTransfer = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(movement.extend({snapshot:z.string().min(1)})).handler(async ({data,context}) => {
  const r = await context.supabase.rpc('b3_carteira_transferir',{p_user_id:context.userId,p_symbol:data.symbol,p_variant:data.variant,p_de_mode:data.de_mode,p_para_mode:data.para_mode,p_valor:data.valor,p_motivo:data.motivo,p_snapshot:JSON.parse(data.snapshot)});
  if(r.error) throw new Error('Transferência cancelada. Nenhum saldo foi movido. Confira os dados novamente.');
  const p=r.data as unknown as Omit<WalletTransferPreview,'snapshot'> & {snapshot?:object};
  return {...p,snapshot:p.snapshot?JSON.stringify(p.snapshot):undefined} satisfies WalletTransferPreview;
});