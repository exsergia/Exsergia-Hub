-- Concede ao Erick as mesmas permissoes de revisao fiscal da conta
-- contasapagar, sem ampliar o acesso de outros usuarios.

create or replace function public.is_fiscal_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'contasapagar@exsergia.eng.br',
      'nascimentoerick446@gmail.com'
    );
$$;

revoke all on function public.is_fiscal_reviewer() from public, anon;
grant execute on function public.is_fiscal_reviewer() to authenticated;
