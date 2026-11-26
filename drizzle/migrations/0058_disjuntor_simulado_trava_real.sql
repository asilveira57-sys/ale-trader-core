-- 26/11/2026 (dono): quando o disjuntor SIMULADO do ativo dispara, o espelho real
-- para de abrir ordens novas no resto do dia. A trava fica gravada (1 linha por
-- ativo e dia) e a verificação cara (b3_cockpit_disjuntor_niveis) roda no máximo
-- a cada 60 s por ativo; depois de disparar, nunca mais no dia.
create table if not exists public.b3_disjuntor_sim_trava (
  user_id uuid not null,
  symbol text not null,
  data date not null,
  disparou_em_brt text,
  motivo text,
  resultado_no_disparo_brl numeric,
  verificado_em timestamptz not null default now(),
  primary key (user_id, symbol, data)
);
alter table public.b3_disjuntor_sim_trava enable row level security;
drop policy if exists "dono le trava" on public.b3_disjuntor_sim_trava;
create policy "dono le trava" on public.b3_disjuntor_sim_trava for select using (auth.uid() = user_id);

create or replace function public.b3_disjuntor_sim_verificar(p_user uuid, p_symbol text)
returns table(disparou boolean, hora text, motivo text)
language plpgsql security definer set search_path = public as $$
declare
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
  v_row b3_disjuntor_sim_trava;
  v_x jsonb;
begin
  if auth.uid() is not null and auth.uid() <> p_user then raise exception 'Acesso negado'; end if;
  select * into v_row from b3_disjuntor_sim_trava t where t.user_id = p_user and t.symbol = p_symbol and t.data = v_dia;
  if found and v_row.disparou_em_brt is not null then
    return query select true, v_row.disparou_em_brt, v_row.motivo; return;
  end if;
  if found and v_row.verificado_em > now() - interval '60 seconds' then
    return query select false, null::text, null::text; return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select x into v_x
  from jsonb_array_elements((b3_cockpit_disjuntor_niveis(p_user, v_dia, v_dia, array[p_symbol], null, null))->'rows') r,
       jsonb_array_elements(coalesce(r->'disparos', '[]'::jsonb)) x
  where r->>'nivel' = 'ativo' and x->>'hora_disparo_brt' is not null
  limit 1;
  insert into b3_disjuntor_sim_trava as t (user_id, symbol, data, disparou_em_brt, motivo, resultado_no_disparo_brl, verificado_em)
  values (p_user, p_symbol, v_dia, left(v_x->>'hora_disparo_brt', 8), v_x->>'motivo',
          nullif(v_x->>'resultado_com_disjuntor_brl', '')::numeric, now())
  on conflict (user_id, symbol, data) do update
    set disparou_em_brt = coalesce(t.disparou_em_brt, excluded.disparou_em_brt),
        motivo = coalesce(t.motivo, excluded.motivo),
        resultado_no_disparo_brl = coalesce(t.resultado_no_disparo_brl, excluded.resultado_no_disparo_brl),
        verificado_em = now();
  return query select v_x is not null, left(v_x->>'hora_disparo_brt', 8), v_x->>'motivo';
end $$;
revoke all on function public.b3_disjuntor_sim_verificar(uuid, text) from public;
grant execute on function public.b3_disjuntor_sim_verificar(uuid, text) to authenticated, service_role;
