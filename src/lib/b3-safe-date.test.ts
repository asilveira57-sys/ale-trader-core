import { describe, it, expect } from 'vitest';
import { realTime, realDuration, realCalendarDate } from './b3-safe-date';
describe('Cockpit Real — datas ausentes e identidade de alertas', () => {
  it.each([null, undefined, '', '2026-11-09:WIN', '2026-11-09:3', 'not-a-date'])('não formata %s como data', value => {
    expect(realTime(value)).toBe('—');
    expect(realDuration(value, null)).toBe('—');
    expect(realCalendarDate(value)).toBe('—');
  });
  it('horário válido preserva BRT', () => expect(realTime('2026-11-09T15:03:00Z', true)).toBe('12:03:00'));
  it('fim inválido não gera duração inválida', () => expect(realDuration('2026-11-09T15:03:00Z', '2026-11-09:WIN')).toBe('—'));
});