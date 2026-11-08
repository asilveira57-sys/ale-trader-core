import {it,expect} from 'vitest';
import postgres from 'postgres';
const url=process.env.SUPABASE_DB_URL;
it.skipIf(!url)('dados atuais de conferência: 487/2,197/0,1722/2 e máximo285.50',async()=>{
  if(!url)throw new Error('Conexão ausente');const db=postgres(url,{max:1});
  try{
    const w=await db`select mode,saldo_atual_brl,contratos_atuais from public.b3_carteira_robo where symbol='WIN' and variant='range' order by mode`;
    const source=w.find(r=>r.mode==='enoir'),target=w.find(r=>r.mode==='agressivo');
    expect([Number(source?.saldo_atual_brl),source?.contratos_atuais,Number(target?.saldo_atual_brl),target?.contratos_atuais]).toEqual([487,2,197,0]);
    const t=await db`select sum(saldo_atual_brl) as capital,sum(contratos_atuais) as ctr from public.b3_carteira_robo where symbol='WIN' and variant='range'`;
    expect([Number(t[0].capital),Number(t[0].ctr)]).toEqual([1722,2]);
    const margin=await db`select max(margin_per_contract_brl) as m from public.b3_asset_profiles where public.b3_carteira_raiz(symbol)='WIN' and margin_per_contract_brl>0`;
    expect(Number(source?.saldo_atual_brl)-Number(margin[0].m)*1.30).toBe(285.50);
  }finally{await db.end();}
});
it.skipIf(!url)('invariante permanece nas144 carteiras após rollback',async()=>{
  if(!url)throw new Error('Conexão ausente');const db=postgres(url,{max:1});
  try{const r=await db`select count(*) as n,count(*) filter(where saldo_inicial_brl+resultado_proprio_brl+recebido_de_transferencias_brl<>saldo_atual_brl) as invalid from public.b3_carteira_robo`;
    expect(Number(r[0].n)).toBe(144);expect(Number(r[0].invalid)).toBe(0);
  }finally{await db.end();}
});