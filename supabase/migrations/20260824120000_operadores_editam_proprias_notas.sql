-- Permite que cada operador edite os lancamentos fiscais que ele proprio criou.
-- Administradores continuam podendo editar qualquer lancamento.

drop policy if exists "fiscal docs insert auth" on public.fiscal_docs;
drop policy if exists "fiscal_docs insert auth" on public.fiscal_docs;
create policy "fiscal docs insert auth" on public.fiscal_docs
  for insert to authenticated
  with check (
    public.is_app_admin()
    or coalesce(data ->> 'criadoPorId', '') = auth.uid()::text
  );

drop policy if exists "fiscal docs update auth" on public.fiscal_docs;
drop policy if exists "fiscal_docs update auth" on public.fiscal_docs;
drop policy if exists "fiscal docs update fiscal" on public.fiscal_docs;
drop policy if exists "fiscal docs update own" on public.fiscal_docs;
create policy "fiscal docs update own" on public.fiscal_docs
  for update to authenticated
  using (
    public.is_app_admin()
    or coalesce(data ->> 'criadoPorId', '') = auth.uid()::text
  )
  with check (
    public.is_app_admin()
    or coalesce(data ->> 'criadoPorId', '') = auth.uid()::text
  );

-- commit_json_batch e SECURITY DEFINER, portanto a verificacao de propriedade
-- tambem precisa existir nesta funcao e nao apenas nas policies RLS.
create or replace function public.can_write_app_table(
  p_table text,
  p_action text,
  p_record_id text,
  p_value jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  is_admin boolean := public.is_app_admin();
  is_enc boolean := public.is_app_encarregado();
  current_owner text;
begin
  if auth.role() <> 'authenticated' then
    return false;
  end if;

  if is_admin then
    return true;
  end if;

  if p_table in ('obras', 'materiais', 'atividades', 'checklists', 'progresso_diario') then
    return is_enc;
  end if;

  if p_table in ('admin_access', 'encarregados', 'equipamentos', 'equipamento_manutencoes', 'equipamento_locacoes') then
    return false;
  end if;

  if p_table = 'fiscal_docs' then
    if p_action = 'insert' then
      return coalesce(p_value ->> 'criadoPorId', '') = auth.uid()::text;
    elsif p_action = 'update' then
      select data ->> 'criadoPorId'
        into current_owner
        from public.fiscal_docs
        where id = p_record_id;
      return current_owner = auth.uid()::text
        and (not (p_value ? 'criadoPorId') or p_value ->> 'criadoPorId' = auth.uid()::text);
    end if;
    return false;
  end if;

  if p_table in ('tools', 'vehicles') then
    if is_enc then
      return true;
    end if;
    return p_action = 'update'
      and public.jsonb_only_has_keys(p_value, array['status', 'lastLogId', 'updatedAt']);
  end if;

  if p_table = 'toolLogs' then
    if is_enc then
      return true;
    end if;
    if p_action = 'insert' then
      return coalesce(p_value ->> 'responsavelId', '') = auth.uid()::text;
    elsif p_action = 'update' then
      select data ->> 'responsavelId' into current_owner from public."toolLogs" where id = p_record_id;
      return current_owner = auth.uid()::text
        and public.jsonb_only_has_keys(p_value, array['previsaoDevolucao', 'diasUso', 'activityId', 'movementHash', 'dataDevolucao', 'fotoDevolucaoUrl', 'statusLog', 'updatedAt']);
    end if;
    return false;
  end if;

  if p_table = 'vehicleLogs' then
    if is_enc then
      return true;
    end if;
    if p_action = 'insert' then
      return coalesce(p_value ->> 'responsavelId', '') = auth.uid()::text;
    elsif p_action = 'update' then
      select data ->> 'responsavelId' into current_owner from public."vehicleLogs" where id = p_record_id;
      return current_owner = auth.uid()::text
        and public.jsonb_only_has_keys(p_value, array['activityId', 'movementHash', 'dataDevolucao', 'fotoPainelDevolucao', 'localDevolucao', 'observacaoDevolucao', 'fotosAvaria', 'statusLog', 'updatedAt']);
    end if;
    return false;
  end if;

  if p_table = 'operadores' then
    return p_action = 'update' and p_record_id = auth.uid()::text;
  end if;

  return false;
end;
$$;
