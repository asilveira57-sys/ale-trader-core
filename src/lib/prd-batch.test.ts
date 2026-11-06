import { describe,it,expect } from 'vitest';
import { batchWarnings,daysSinceLedger } from './prd-batch';
import { canEnableAuthorization } from './prd-authorization-view';
describe('lote real 06/11',()=>{
  it('avisa margem apenas acima do capital',()=>{
    expect(batchWarnings(371,100,370,0).margin).toBe(true);
    expect(batchWarnings(370,100,370,0).margin).toBe(false);
  });
  it('avisa lançamento com mais de 3 dias, não com 3',()=>{
    expect(batchWarnings(0,0,370,3).stale).toBe(false);
    expect(batchWarnings(0,0,370,4).stale).toBe(true);
    expect(daysSinceLedger('2026-10-27','2026-11-06')).toBe(10);
  });
  it('avisa perda apenas acima do capital',()=>{
    expect(batchWarnings(0,371,370,0).loss).toBe(true);
    expect(batchWarnings(0,370,370,0).loss).toBe(false);
  });
  it('carteira insuficiente nunca permite ligar mesmo com stop',()=>{
    expect(canEnableAuthorization({symbol:'WIN',variant:'price_action_sc',mode:'agressivo_sc',stop_pts:320,point_value_brl:0.2,sim_max_contracts:1,simulado_ativo:true},'carteira_insuficiente')).toBe(false);
  });
});