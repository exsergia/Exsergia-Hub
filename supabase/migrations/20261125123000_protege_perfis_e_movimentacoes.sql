-- Separa dados cadastrais da lista usada para selecionar equipes.
create or replace function public.list_operator_directory()
returns table(id text, data jsonb)
language sql stable security definer set search_path = ''
as $$
  select o.id, jsonb_build_object(
    'nome', coalesce(o.data ->> 'nome', o.nome, ''),
    'sobrenome', coalesce(o.data ->> 'sobrenome', o.sobrenome, ''),
    'funcao', coalesce(o.data ->> 'funcao', o.funcao, ''),
    'role', case when exists (
      select 1 from public.admin_access a left join auth.users u on u.id::text = o.id
      where btrim(a.id) = 'email:' || lower(coalesce(u.email, o.email, o.data ->> 'email'))
        and coalesce((a.data ->> 'ativo')::boolean, true)
    ) then 'admin' else 'operator' end
  )
  from public.operadores o
  where (select auth.uid()) is not null
  order by o.id;
$$;
revoke all on function public.list_operator_directory() from public, anon, authenticated;
grant execute on function public.list_operator_directory() to authenticated;

drop policy if exists "select authenticated operadores" on public.operadores;
create policy "perfil pessoal ou administrativo" on public.operadores
  for select to authenticated
  using (id = (select auth.uid())::text or (select public.is_app_admin()));

-- Regras restritivas compõem com as regras antigas e não dependem do nome delas.
create policy "cadastro administrativo ferramentas" on public.tools as restrictive
  for insert to authenticated with check ((select public.is_app_admin()));
create policy "exclusao administrativa ferramentas" on public.tools as restrictive
  for delete to authenticated using ((select public.is_app_admin()));
create policy "cadastro administrativo frota" on public.vehicles as restrictive
  for insert to authenticated with check ((select public.is_app_admin()));
create policy "exclusao administrativa frota" on public.vehicles as restrictive
  for delete to authenticated using ((select public.is_app_admin()));

create policy "retirada propria ferramentas" on public."toolLogs" as restrictive
  for insert to authenticated with check (
    data ->> 'responsavelId' = (select auth.uid())::text and data ->> 'statusLog' = 'Aberta'
  );
create policy "retirada propria frota" on public."vehicleLogs" as restrictive
  for insert to authenticated with check (
    data ->> 'responsavelId' = (select auth.uid())::text and data ->> 'statusLog' = 'Aberta'
  );
create policy "responsabilidade movimentacao ferramentas" on public."toolLogs" as restrictive
  for update to authenticated
  using ((select public.is_app_admin()) or (select public.is_app_encarregado()) or data ->> 'responsavelId' = (select auth.uid())::text)
  with check ((select public.is_app_admin()) or (select public.is_app_encarregado()) or data ->> 'responsavelId' = (select auth.uid())::text);
create policy "responsabilidade movimentacao frota" on public."vehicleLogs" as restrictive
  for update to authenticated
  using ((select public.is_app_admin()) or (select public.is_app_encarregado()) or data ->> 'responsavelId' = (select auth.uid())::text)
  with check ((select public.is_app_admin()) or (select public.is_app_encarregado()) or data ->> 'responsavelId' = (select auth.uid())::text);

create or replace function public.guard_asset_movement()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  actor text := auth.uid()::text;
  is_admin boolean;
  is_staff boolean;
  log_table text;
  asset_key text;
  movement jsonb;
  link_id text;
  checkout boolean;
  movement_fields text[];
begin
  if auth.role() is distinct from 'authenticated' then return new; end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'Identidade do registro não pode ser alterada.' using errcode = '42501';
  end if;
  is_admin := public.is_app_admin();
  is_staff := public.is_app_encarregado();

  if tg_table_name in ('toolLogs','vehicleLogs') then
    movement_fields := case when tg_table_name = 'toolLogs' then
      array['previsaoDevolucao','diasUso','activityId','movementHash','dataDevolucao','fotoDevolucaoUrl','statusLog','updatedAt']
    else array['activityId','movementHash','dataDevolucao','fotoPainelDevolucao',
      'localDevolucao','observacaoDevolucao','fotosAvaria','statusLog','updatedAt'] end;

    if (new.data - movement_fields - 'id') is distinct from (old.data - movement_fields - 'id')
       or old.data ->> 'statusLog' is distinct from 'Aberta'
       or coalesce(new.data ->> 'statusLog','') not in ('Aberta','Concluída')
       or (new.data ->> 'statusLog' = 'Concluída' and nullif(new.data ->> 'dataDevolucao','') is null)
       or (new.data ->> 'statusLog' = 'Aberta' and new.data ->> 'dataDevolucao' is not null) then
      raise exception 'Alteração de movimentação não permitida.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Somente administradores podem editar os campos cadastrais.
  if (new.data - array['status','lastLogId','updatedAt','id'])
       is distinct from (old.data - array['status','lastLogId','updatedAt','id']) then
    if is_admin then return new; end if;
    raise exception 'Cadastro do ativo restrito a administradores.' using errcode = '42501';
  end if;
  if new.data ->> 'status' is not distinct from old.data ->> 'status'
     and new.data ->> 'lastLogId' is not distinct from old.data ->> 'lastLogId'
     and is_admin then return new; end if;

  log_table := case when tg_table_name = 'tools' then 'toolLogs' else 'vehicleLogs' end;
  asset_key := case when tg_table_name = 'tools' then 'toolId' else 'vehicleId' end;
  checkout := old.data ->> 'status' = 'Disponível' and new.data ->> 'status' = 'Em Uso';

  if checkout then
    link_id := new.data ->> 'lastLogId';
  elsif old.data ->> 'status' = 'Em Uso' and new.data ->> 'status' = 'Disponível'
        and new.data ->> 'lastLogId' is null then
    link_id := old.data ->> 'lastLogId';
  elsif is_admin and new.data ->> 'lastLogId' is not distinct from old.data ->> 'lastLogId' then
    return new;
  else
    raise exception 'Status do ativo incompatível com a movimentação.' using errcode = '42501';
  end if;

  execute format('select data from public.%I where id = $1', log_table) into movement using link_id;
  if movement ->> asset_key is distinct from new.id
     or movement ->> 'statusLog' is distinct from (case when checkout then 'Aberta' else 'Concluída' end)
     or (not (not checkout and (is_admin or is_staff)) and movement ->> 'responsavelId' is distinct from actor) then
    raise exception 'Movimentação não corresponde ao ativo ou ao responsável.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_asset_movement() from public, anon, authenticated;
create trigger guard_tool_change before update on public.tools
for each row execute function public.guard_asset_movement();
create trigger guard_vehicle_change before update on public.vehicles
for each row execute function public.guard_asset_movement();
create trigger guard_tool_log_change before update on public."toolLogs"
for each row execute function public.guard_asset_movement();
create trigger guard_vehicle_log_change before update on public."vehicleLogs"
for each row execute function public.guard_asset_movement();

-- A validação ocorre no commit, quando a movimentação e seu ativo já foram
-- atualizados pelo mesmo lote. Isso impede registros abertos sem retirada
-- e devoluções que deixam um ativo preso a um registro concluído.
create or replace function public.check_active_movement_link()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  asset_table text;
  asset_key text;
  asset jsonb;
begin
  if auth.role() is distinct from 'authenticated' then return null; end if;
  asset_table := case when tg_table_name = 'toolLogs' then 'tools' else 'vehicles' end;
  asset_key := case when tg_table_name = 'toolLogs' then 'toolId' else 'vehicleId' end;
  execute format('select data from public.%I where id = $1', asset_table)
    into asset using (new.data ->> asset_key);
  if (new.data ->> 'statusLog' = 'Aberta'
      and (asset ->> 'lastLogId' is distinct from new.id or asset ->> 'status' is distinct from 'Em Uso'))
     or (new.data ->> 'statusLog' = 'Concluída' and asset ->> 'lastLogId' = new.id) then
    raise exception 'Atualize o ativo e a movimentação no mesmo lote.' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function public.check_active_movement_link() from public, anon, authenticated;
create constraint trigger tool_log_active_link after insert or update on public."toolLogs"
deferrable initially deferred for each row execute function public.check_active_movement_link();
create constraint trigger vehicle_log_active_link after insert or update on public."vehicleLogs"
deferrable initially deferred for each row execute function public.check_active_movement_link();
