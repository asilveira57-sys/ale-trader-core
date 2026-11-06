import { canEnableAuthorization, type AuthorizationInput } from './prd-authorization-view';
import { brlFromMult, STOPS_POR_DIA } from './b3-real-sizing';
import { lerCarteira, margemDoAtivo } from './b3-carteira.server';
import { saoPauloDate } from './b3-real-cockpit.server';
import { daysSinceLedger, batchWarnings } from './prd-batch';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export async function batchPreview(supabase: SupabaseClient<Database>, userId: string, symbol: string, variant: string) {
  const [auth, inputs, wallets, carteira, margin] = await Promise.all([
    supabase.from('b3_prd_authorizations').select('id,symbol,variant,mode,enabled,max_qty,magic_number').eq('user_id',userId).eq('symbol',symbol).eq('variant',variant).order('mode'),
    supabase.rpc('b3_prd_tela_insumos'),
    supabase.from('b3_carteira_robo').select('symbol,variant,mode,estado').eq('user_id',userId).eq('symbol',symbol).eq('variant',variant),
    lerCarteira(supabase,userId), margemDoAtivo(supabase,symbol),
  ]);
  if(auth.error) throw auth.error;
  if(inputs.error) throw inputs.error;
  if(wallets.error) throw wallets.error;
  if(margin == null) throw new Error('Sem margem cadastrada para o ativo. Nenhuma autorização foi alterada.');
  const source = (inputs.data ?? []) as unknown as AuthorizationInput[];
  const pending = (auth.data ?? []).filter(r => !r.enabled);
  const mapped = pending.map(r => {
    const input = source.find(i => i.symbol === r.symbol && i.variant === r.variant && i.mode === r.mode);
    const wallet = wallets.data?.find(w => w.mode === r.mode);
    const eligible = canEnableAuthorization(input,wallet?.estado);
    return {...r, eligible, reason: wallet?.estado === 'carteira_insuficiente' ? 'carteira insuficiente — parado no simulado' : !input?.simulado_ativo ? 'modalidade desligada no simulado' : !eligible ? 'sem stop configurado — não é possível ligar' : null,
      three_stops_brl: eligible ? brlFromMult(STOPS_POR_DIA,Number(input?.stop_pts),Number(input?.point_value_brl),r.max_qty) : 0 };
  });
  const robots = mapped.filter(r => r.eligible);
  const marginTotal = robots.reduce((sum,r) => sum + r.max_qty * margin,0);
  const limitsTotal = robots.reduce((sum,r) => sum + r.three_stops_brl,0);
  const days = daysSinceLedger(carteira.data_corte,saoPauloDate(new Date()));
  const summary = {symbol,variant,robots,skipped:mapped.filter(r => !r.eligible),margin_per_contract_brl:margin,margin_brl:marginTotal,limits_brl:limitsTotal,capital_brl:carteira.capital_operacional_brl,ledger_date:carteira.data_corte,ledger_days:days,warnings:batchWarnings(marginTotal,limitsTotal,carteira.capital_operacional_brl,days)};
  return {...summary, snapshot:JSON.stringify(summary)};
}