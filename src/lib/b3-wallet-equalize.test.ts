import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';

const url = process.env.SUPABASE_DB_URL;
// These tests ONLY read SQL plans and definitions. Never call commit, even in rollback.
describe.skipIf(!url)('igualar modalidade — SQL somente leitura', () => {
  async function plan(total: number) {
    const minted = JSON.parse(await readFile(`${homedir()}/.cache/lovable-auth/session.json`, 'utf8'));
    const base = Math.trunc(total * 100 / 8) / 100;
    const rows = Array.from({ length: 8 }, (_, i) => ({ mode: `r${i}`, saldo: i === 0 ? total - base * 7 : base, contratos: 0, teto: 10, resultado_proprio: 0, transferencias_liquidas: 0 }));
    const result = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/b3_carteira_igualar_plano`, {
      method: 'POST', headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '', Authorization: `Bearer ${minted.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_symbol: 'WIN', p_rows: rows }),
    });
    if (!result.ok) throw new Error(`Leitura de plano recusada: ${result.status}`);
    return result.json();
  }
  it('R$1.368 usa n=6, seis saldos228 e dois zero; total1368/6contratos', async () => {
    const p = await plan(1368);
    expect(p.ok).toBe(true); expect(p.n).toBe(6);
    expect(p.rows.map((r: any) => Number(r.saldo_depois)).sort((a: number, b: number) => a - b)).toEqual([0, 0, 228, 228, 228, 228, 228, 228]);
    expect([Number(p.capital_antes), Number(p.capital_depois), p.contratos_depois]).toEqual([1368, 1368, 6]);
  });
  it('R$200 recusa por não sustentar um contrato', async () => {
    expect((await plan(200)).ok).toBe(false);
  });
  it('limite n=8 e sobra em centavos conservam capital', async () => {
    const p = await plan(2000.03);
    expect(p.n).toBe(8);
    expect(Math.round(p.rows.reduce((s: number, r: any) => s + Number(r.saldo_depois), 0) * 100)).toBe(200003);
    expect(Number(p.capital_depois)).toBe(2000.03);
  });
  it('transferências líquidas somam zero e lucro próprio segue intacto no plano', async () => {
    const p = await plan(1368);
    expect(p.rows.reduce((s: number, r: any) => s + Number(r.transferencias_depois), 0)).toBe(0);
    expect(p.rows.every((r: any) => Number(r.resultado_proprio) === 0)).toBe(true);
  });
  it('núcleo de zeragem não é executável diretamente por authenticated', async () => {
    if (!url) throw new Error('Conexão ausente');
    const db = postgres(url, { max: 1 });
    try {
      const r = await db`select has_function_privilege('authenticated','public.b3_carteira_transferir_interno(uuid,text,text,text,text,numeric,text,boolean,jsonb,boolean)','execute') as allowed`;
      expect(r[0].allowed).toBe(false);
    } finally { await db.end(); }
  });
});