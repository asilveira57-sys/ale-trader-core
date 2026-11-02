import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
const sql = readFileSync(new URL('../../drizzle/migrations/0018_prd_sc_magic_and_readonly_authorization_inputs.sql', import.meta.url), 'utf8');
const body = sql.split('CREATE OR REPLACE FUNCTION public.b3_magic')[1]?.split('$function$;')[0] ?? '';
const cases = [...body.matchAll(/WHEN '([^']+)' THEN (\d+)/g)];
const indices = new Map(cases.map(m => [m[1], Number(m[2])]));
describe('identidades reais preservadas', () => {
  it('mantém WIN=2, indicador=0 e price_action=5', () => {
    expect(indices.get('WIN')).toBe(2); expect(indices.get('indicador')).toBe(0); expect(indices.get('price_action')).toBe(5);
    expect(Number(indices.get('WIN'))*1000 + Number(indices.get('indicador'))*100 + Number(indices.get('conservador'))).toBe(2001);
    expect(Number(indices.get('WIN'))*1000 + Number(indices.get('price_action'))*100 + Number(indices.get('semi_agressivo'))).toBe(2504);
  });
  it('SC usa modalidade 7 e dá 2701 a 2708, sem colisão', () => {
    expect(indices.get('price_action_sc')).toBe(7);
    const modes = ['conservador','moderado','equilibrado','semi_agressivo','agressivo','cauteloso','arrojado','enoir'];
    modes.forEach((m,i) => { expect(indices.get(m+'_sc')).toBe(i+1); expect(indices.get(m+'_sc')).toBe(indices.get(m)); });
    expect(modes.map(m => Number(indices.get('WIN'))*1000 + Number(indices.get('price_action_sc'))*100 + Number(indices.get(m+'_sc')))).toEqual([2701,2702,2703,2704,2705,2706,2707,2708]);
  });
});