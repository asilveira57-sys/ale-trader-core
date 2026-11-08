import { describe,it,expect } from 'vitest';
import postgres from 'postgres';

// Explicit integration run against current owner wallets; every write rolls back.
const url=process.env.SUPABASE_DB_URL;
// sandbox_exec intentionally has no execution grants; run these only with a
// privileged test connection. Equivalent rollback SQL is verified via Cloud.
describe.skipIf(!url || process.env.B3_WALLET_PRIVILEGED_TESTS!=='1')('carteira fase A — transações revertidas',()=>{
  async function scenario(check:(tx:any,user:string)=>Promise<void>){
    if(!url)throw new Error('Conexão de teste ausente');
    const db=postgres(url,{max:1}); const rollback=new Error('ROLLBACK_TEST');
    try{await db.begin(async tx=>{
      const users=await tx`select user_id from public.b3_carteira_robo where symbol='WIN' and variant='range' group by user_id`;
      expect(users).toHaveLength(1);const user=users[0].user_id;
      await tx`select set_config('request.jwt.claim.sub',${user},true),set_config('request.jwt.claims',${JSON.stringify({sub:user,role:'authenticated'})},true)`;
      await check(tx,user);throw rollback;
    });}catch(e){if(e!==rollback)throw e;}finally{await db.end();}
  }
  async function move(tx:any,user:string,value:number,preview=false){
    const r=await tx`select public.b3_carteira_transferir(${user}::uuid,'WIN','range','enoir','agressivo',${value},'Conferência fase A — rollback',${preview}) as result`;
    return r[0].result;
  }
  it('R$285: 202/1 e 482/2; total 1722/3, lucro intacto e transferências -285/+285',async()=>scenario(async(tx,user)=>{
    const before=await tx`select mode,resultado_proprio_brl from public.b3_carteira_robo where user_id=${user} and symbol='WIN' and variant='range' and mode in ('enoir','agressivo') order by mode`;
    const p=await move(tx,user,285);expect(p.ok).toBe(true);
    expect([Number(p.de_saldo_antes),Number(p.para_saldo_antes),Number(p.de_saldo_depois),Number(p.para_saldo_depois)]).toEqual([487,197,202,482]);
    expect([p.de_contratos_depois,p.para_contratos_depois,p.contratos_antes,p.contratos_depois]).toEqual([1,2,2,3]);
    expect([Number(p.capital_antes),Number(p.capital_depois)]).toEqual([1722,1722]);
    const after=await tx`select mode,resultado_proprio_brl,recebido_de_transferencias_brl,saldo_inicial_brl+resultado_proprio_brl+recebido_de_transferencias_brl=saldo_atual_brl as invariant from public.b3_carteira_robo where user_id=${user} and symbol='WIN' and variant='range' and mode in ('enoir','agressivo') order by mode`;
    expect(after.map((r:any)=>r.resultado_proprio_brl)).toEqual(before.map((r:any)=>r.resultado_proprio_brl));
    expect(after.map((r:any)=>Number(r.recebido_de_transferencias_brl))).toEqual([285,-285]);expect(after.every((r:any)=>r.invariant)).toBe(true);
    const saved=await tx`select * from public.b3_carteira_transferencia where id=${p.id}`;
    expect(saved).toHaveLength(1);expect([Number(saved[0].de_saldo_depois),Number(saved[0].para_saldo_depois),saved[0].de_contratos_depois,saved[0].para_contratos_depois]).toEqual([202,482,1,2]);
  }));
  it('R$300 recusados, máximo 285,50, sem movimentação',async()=>scenario(async(tx,user)=>{
    const r=await move(tx,user,300);expect(r.ok).toBe(false);expect(Number(r.maximo_permitido)).toBe(285.50);
    const w=await tx`select saldo_atual_brl from public.b3_carteira_robo where user_id=${user} and symbol='WIN' and variant='range' and mode='enoir'`;expect(Number(w[0].saldo_atual_brl)).toBe(487);
  }));
  it('máximo 285,50 mantém doador acima de um contrato',async()=>scenario(async(tx,user)=>{
    const r=await move(tx,user,285.5);expect(r.ok).toBe(true);expect(Number(r.de_saldo_depois)).toBe(201.5);expect(r.de_contratos_depois).toBe(1);
  }));
  it('prévia é somente leitura e alerta quando contratos caem',async()=>scenario(async(tx,user)=>{
    const before=await tx`select count(*)::int as n from public.b3_carteira_transferencia`;
    const p=await tx`select public.b3_carteira_transferir(${user}::uuid,'WIN','price_action','enoir','conservador',1,'Teste de prévia',true) as result`;
    // Concrete decrease scenario using rollback-only fixture balances, no persistent changes.
    await tx`update public.b3_carteira_robo set saldo_atual_brl=403,resultado_proprio_brl=403-saldo_inicial_brl-recebido_de_transferencias_brl,contratos_atuais=2 where user_id=${user} and symbol='WIN' and variant='range' and mode='enoir'`;
    const r=await move(tx,user,1,true);expect(r.ok).toBe(true);expect(r.reduz_contratos).toBe(true);expect(r.contratos_antes).toBe(2);expect(r.contratos_depois).toBe(1);
    const after=await tx`select count(*)::int as n from public.b3_carteira_transferencia`;expect(after[0].n).toBe(before[0].n);expect(p[0].result).toBeDefined();
  }));
  it('motivo vazio e modo de outra modalidade são recusados',async()=>scenario(async(tx,user)=>{
    const empty=await tx`select public.b3_carteira_transferir(${user}::uuid,'WIN','range','enoir','agressivo',1,' ',true) as r`;expect(empty[0].r.ok).toBe(false);
    const other=await tx`select public.b3_carteira_transferir(${user}::uuid,'WIN','range','enoir','agressivo_sc',1,'Teste',true) as r`;expect(other[0].r.ok).toBe(false);
  }));
  it('snapshot desatualizado recusa confirmação',async()=>scenario(async(tx,user)=>{
    const p=await move(tx,user,285,true);
    await tx`update public.b3_carteira_robo set atualizada_em=now() where user_id=${user} and symbol='WIN' and variant='range' and mode='enoir'`;
    const r=await tx`select public.b3_carteira_transferir(${user}::uuid,'WIN','range','enoir','agressivo',285,'Teste',false,${JSON.stringify(p.snapshot)}::jsonb) as r`;
    expect(r[0].r.ok).toBe(false);expect(r[0].r.error).toContain('mudaram');
  }));
  it('chamada antiga de quatro argumentos ainda soma resultado, não transferência',async()=>scenario(async(tx,user)=>{
    const before=await tx`select * from public.b3_carteira_robo where user_id=${user} and symbol='WIN' and variant='range' and mode='enoir'`;
    await tx`select public.b3_carteira_aplicar(${before[0].id}::uuid,1::numeric,10::integer,'Teste compatibilidade'::text)`;
    const after=await tx`select * from public.b3_carteira_robo where id=${before[0].id}`;
    expect(Number(after[0].resultado_proprio_brl)).toBe(Number(before[0].resultado_proprio_brl)+1);expect(after[0].recebido_de_transferencias_brl).toBe(before[0].recebido_de_transferencias_brl);
  }));
});