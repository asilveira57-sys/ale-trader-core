
revoke execute on function public.match_strategic_memory(extensions.vector, integer, text, uuid) from public, anon;
grant execute on function public.match_strategic_memory(extensions.vector, integer, text, uuid) to authenticated, service_role;
