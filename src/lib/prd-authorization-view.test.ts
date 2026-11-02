import { describe, it, expect } from 'vitest';
import { authorizationState, canEnableAuthorization, dailyLossPresentation, visibleAuthorizations, type AuthorizationInput } from './prd-authorization-view';
const input: AuthorizationInput = { symbol: 'WIN', variant: 'price_action_sc', mode: 'agressivo_sc', stop_pts: 320, point_value_brl: 0.2, sim_max_contracts: 1, simulado_ativo: true };
describe('autorizações reais 02/11', () => {
  it('desligado ignora limite histórico e prevê exatamente 3 stops', () => expect(dailyLossPresentation(false, 1, 320, 0.2, 1)).toMatchObject({ amount: 192, forecast: true, origin: 'tres_stops' }));
  it('ligado usa o menor limite digitado', () => expect(dailyLossPresentation(true, 160, 320, 0.2, 1)).toMatchObject({ amount: 160, origin: 'manual', forecast: false }));
  it('ligado não ultrapassa três stops', () => expect(dailyLossPresentation(true, 500, 320, 0.2, 1)).toMatchObject({ amount: 192, origin: 'tres_stops' }));
  it('sem stop não pode ligar', () => expect(canEnableAuthorization({ ...input, stop_pts: null })).toBe(false));
  it('modalidade desligada não pode ligar', () => expect(canEnableAuthorization({ ...input, simulado_ativo: false })).toBe(false));
  it('SC ativo pode ligar com stop configurado', () => expect(canEnableAuthorization(input)).toBe(true));
  it('oculta pela atividade do banco e aceita modalidade nova sem lista fixa', () => {
    const rows = [input, { ...input, variant: 'nova' }, { ...input, variant: 'vwap' }];
    const inputs = [input, { ...input, variant: 'nova' }, { ...input, variant: 'vwap', simulado_ativo: false }];
    expect(visibleAuthorizations(rows, inputs, false).map(r => r.variant)).toEqual(['price_action_sc','nova']);
    expect(visibleAuthorizations(rows, inputs, true)).toHaveLength(3);
  });
  it('desligado nunca é travado mesmo com freio ativo', () => expect(authorizationState(false, 'stop diário')).toBe('desligado'));
  it('ligado sem trava real', () => expect(authorizationState(true, null)).toBe('ligado'));
  it('trava com motivo real', () => expect(authorizationState(true, 'disjuntor')).toBe('travado'));
});