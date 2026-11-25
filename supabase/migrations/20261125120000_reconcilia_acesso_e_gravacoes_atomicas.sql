-- Verifica o acesso no esquema efetivo de produção.
drop policy if exists "read cpf map" on public.cpfs;
drop policy if exists "insert cpf map" on public.cpfs;
drop policy if exists "update cpf map admin" on public.cpfs;
revoke all on public.cpfs from public, anon, authenticated;

-- Privilegios administrativos dependem do e-mail autenticado e do cadastro
-- restrito, nunca de um CPF editavel no perfil.
create or replace function public.is_app_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admin_access a
    where btrim(a.id) = 'email:' || lower(auth.jwt() ->> 'email')
      and coalesce((a.data ->> 'ativo')::boolean, true)
  );
$$;

drop policy if exists "insert operador self" on public.operadores;
create policy "insert operador self" on public.operadores for insert to authenticated
  with check (id = (select auth.uid())::text or (select public.is_app_admin()));
revoke insert on public.operadores from anon;

-- O resolvedor só atende o servidor do Hub. Nenhum endpoint devolve o e-mail
-- associado ao identificador. Referencias antigas sao ligadas ao Auth por UID.
create or replace function public.resolve_login_identifier(p_identifier text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(p_identifier, ''), '[^0-9]', '', 'g');
  phone text;
  matched_email text;
  matched_count bigint;
begin
  if length(digits) not between 10 and 13 then return null; end if;
  if length(digits) = 11 then
    select lower(u.email) into matched_email
    from public.cpfs c join auth.users u on c.data ->> 'uid' = u.id::text
    where c.id = digits and lower(c.data ->> 'email') = lower(u.email);
    if found then return matched_email; end if;

    select min(email), count(*) into matched_email, matched_count
    from auth.users u
    where exists (select 1 from public.operadores o where o.id = u.id::text
         and regexp_replace(coalesce(nullif(o.cpf, ''), o.data ->> 'cpf', ''), '[^0-9]', '', 'g') = digits);
    if matched_count > 0 then
      return case when matched_count = 1 then lower(matched_email) end;
    end if;
  end if;

  phone := case when length(digits) in (12, 13) and left(digits, 2) = '55'
    then substr(digits, 3) else digits end;
  if length(phone) not in (10, 11) then return null; end if;
  select min(u.email), count(*) into matched_email, matched_count
    from auth.users u left join public.operadores o on o.id = u.id::text
    where exists (
      select 1 from unnest(array[u.phone, u.raw_user_meta_data ->> 'telefone',
        o.telefone, o.data ->> 'telefone']) as contact(number)
      cross join lateral (select regexp_replace(coalesce(contact.number, ''), '[^0-9]', '', 'g') as normalized) n
      where n.normalized in (phone, '55' || phone)
    );
  return case when matched_count = 1 then lower(matched_email) end;
end;
$$;
revoke all on function public.resolve_login_identifier(text) from public, anon, authenticated;
grant execute on function public.resolve_login_identifier(text) to service_role;

create or replace function public.check_new_signup_cpf()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  cpf text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'cpf', ''), '[^0-9]', '', 'g');
begin
  if length(cpf) = 11 then
    perform pg_advisory_xact_lock(hashtextextended('signup-cpf:' || cpf, 0));
    if exists (
      select 1 from auth.users u where
        exists (select 1 from public.cpfs c where c.id = cpf
          and c.data ->> 'uid' = u.id::text and lower(c.data ->> 'email') = lower(u.email))
        or exists (select 1 from public.operadores o where o.id = u.id::text
          and regexp_replace(coalesce(nullif(o.cpf, ''), o.data ->> 'cpf', ''), '[^0-9]', '', 'g') = cpf)
    ) then
      raise exception 'Identificador indisponivel para novo cadastro.' using errcode = '23505';
    end if;
    insert into public.cpfs (id, data) values (
      cpf, jsonb_build_object('uid', new.id, 'email', lower(new.email))
    ) on conflict (id) do update set data = excluded.data;
  end if;
  return new;
end;
$$;
revoke all on function public.check_new_signup_cpf() from public, anon, authenticated;
create trigger check_new_signup_cpf before insert on auth.users
for each row execute function public.check_new_signup_cpf();

drop policy if exists "fiscal_docs select auth" on public.fiscal_docs;
drop policy if exists "fiscal_docs insert auth" on public.fiscal_docs;
drop policy if exists "fiscal_docs update auth" on public.fiscal_docs;
create policy "fiscal docs select scoped" on public.fiscal_docs for select to authenticated
  using ((select public.is_app_admin()) or (select public.is_fiscal_reviewer())
    or data ->> 'criadoPorId' = (select auth.uid())::text);
create policy "fiscal docs insert own" on public.fiscal_docs for insert to authenticated
  with check ((select public.is_app_admin()) or data ->> 'criadoPorId' = (select auth.uid())::text);
create policy "fiscal docs update own" on public.fiscal_docs for update to authenticated
  using ((select public.is_app_admin()) or data ->> 'criadoPorId' = (select auth.uid())::text)
  with check ((select public.is_app_admin()) or data ->> 'criadoPorId' = (select auth.uid())::text);

-- Preserva a leitura de anexos pelo Financeiro e restringe regras antigas
-- permissivas do bucket ao escopo do documento ou da pasta do usuario.
create policy "fiscal attachment access boundary" on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'fiscal-private' or (select public.is_app_admin())
    or (select public.is_fiscal_reviewer()) or (storage.foldername(name))[2] = (select auth.uid())::text
    or exists (select 1 from public.fiscal_docs f where
      f.data ->> 'criadoPorId' = (select auth.uid())::text
      and name in (f.data ->> 'fotoPath', f.data ->> 'thumbnailPath')));
create policy "fiscal attachments readable by reviewers" on storage.objects for select to authenticated
  using (bucket_id = 'fiscal-private' and (select public.is_fiscal_reviewer()));

create or replace function public.try_numeric(value text)
returns numeric
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return 0;
  end if;
  return value::numeric;
exception when others then
  return 0;
end;
$$;

create or replace function public.apply_jsonb_patch(p_base jsonb, p_patch jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  next_data jsonb := coalesce(p_base, '{}'::jsonb);
  key text;
  val jsonb;
  op text;
  existing_array jsonb;
  updated_array jsonb;
  item jsonb;
  current_num numeric;
  delta numeric;
begin
  for key, val in select * from jsonb_each(coalesce(p_patch, '{}'::jsonb)) loop
    if jsonb_typeof(val) = 'object' and val ? '__op' then
      op := val ->> '__op';

      if op = 'arrayUnion' then
        existing_array := case
          when jsonb_typeof(next_data -> key) = 'array' then next_data -> key
          else '[]'::jsonb
        end;

        for item in select value from jsonb_array_elements(coalesce(val -> 'values', '[]'::jsonb)) loop
          if not exists (
            select 1 from jsonb_array_elements(existing_array) as elem(value)
            where elem.value = item
          ) then
            existing_array := existing_array || jsonb_build_array(item);
          end if;
        end loop;

        next_data := jsonb_set(next_data, array[key], existing_array, true);
      elsif op = 'arrayRemove' then
        existing_array := case
          when jsonb_typeof(next_data -> key) = 'array' then next_data -> key
          else '[]'::jsonb
        end;

        select coalesce(jsonb_agg(elem.value), '[]'::jsonb)
          into updated_array
        from jsonb_array_elements(existing_array) as elem(value)
        where not exists (
          select 1
          from jsonb_array_elements(coalesce(val -> 'values', '[]'::jsonb)) as rem(value)
          where rem.value = elem.value
        );

        next_data := jsonb_set(next_data, array[key], coalesce(updated_array, '[]'::jsonb), true);
      elsif op = 'increment' then
        current_num := public.try_numeric(next_data ->> key);
        delta := public.try_numeric(val ->> 'value');
        next_data := jsonb_set(next_data, array[key], to_jsonb(current_num + delta), true);
      end if;
    else
      next_data := jsonb_set(next_data, array[key], val, true);
    end if;
  end loop;

  return next_data;
end;
$$;

-- SECURITY INVOKER preserva as policies ativas de cada tabela. Uma falha
-- cancela o lote inteiro. Uma atualizacao nunca cria uma linha implicitamente.
create or replace function public.commit_json_batch(p_ops jsonb)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  op jsonb;
  action text;
  tbl text;
  rec_id text;
  patch jsonb;
  affected bigint;
  flat_updates text;
begin
  if auth.uid() is null then raise exception 'Sessao obrigatoria.' using errcode = '42501'; end if;
  if jsonb_typeof(p_ops) is distinct from 'array' then raise exception 'Lote invalido.'; end if;
  for op in select value from jsonb_array_elements(p_ops) loop
    action := op ->> 'type';
    tbl := op ->> 'table';
    rec_id := op ->> 'id';
    patch := coalesce(op -> 'value', '{}'::jsonb) - 'id';

    if action is null or action not in ('set', 'update', 'delete')
       or nullif(rec_id, '') is null or jsonb_typeof(patch) <> 'object'
       or tbl is null or tbl not in (
         'obras', 'materiais', 'atividades', 'checklists', 'operadores', 'encarregados',
         'tools', 'toolLogs', 'vehicles', 'vehicleLogs', 'fiscal_docs', 'equipamentos',
         'equipamento_manutencoes', 'equipamento_locacoes', 'progresso_diario',
         'admin_access', 'push_subscriptions'
       ) then raise exception 'Operacao invalida no lote.'; end if;

    if action = 'set' then
      execute format('insert into public.%I (id, data) values ($1, $2 || jsonb_build_object(''id'', $1))', tbl)
        using rec_id, patch;
    elsif action = 'update' then
      -- Mantém as colunas que as consultas e cadastros legados ainda usam.
      flat_updates := case tbl
        when 'atividades' then $flat$,
          obra_id = case when $2 ? 'obraId' then $2 ->> 'obraId' else obra_id end,
          updated_at = case when $2 ? 'updatedAt' then ($2 ->> 'updatedAt')::timestamptz else updated_at end$flat$
        when 'obras' then $flat$,
          nome = case when $2 ? 'nome' then $2 ->> 'nome' else nome end,
          status = case when $2 ? 'status' then $2 ->> 'status' else status end,
          cliente = case when $2 ? 'cliente' then $2 ->> 'cliente' else cliente end,
          responsavel = case when $2 ? 'responsavel' then $2 ->> 'responsavel' else responsavel end,
          centro_custo = case when $2 ? 'centroCusto' then $2 ->> 'centroCusto' else centro_custo end$flat$
        when 'operadores' then $flat$,
          nome = case when $2 ? 'nome' then $2 ->> 'nome' else nome end,
          sobrenome = case when $2 ? 'sobrenome' then $2 ->> 'sobrenome' else sobrenome end,
          email = case when $2 ? 'email' then $2 ->> 'email' else email end,
          cpf = case when $2 ? 'cpf' then $2 ->> 'cpf' else cpf end,
          telefone = case when $2 ? 'telefone' then $2 ->> 'telefone' else telefone end,
          funcao = case when $2 ? 'funcao' then $2 ->> 'funcao' else funcao end,
          role = case when $2 ? 'role' then $2 ->> 'role' else role end,
          lgpd_aceite_versao = case when $2 ? 'lgpdAceite' then $2 #>> '{lgpdAceite,versao}' else lgpd_aceite_versao end,
          lgpd_aceite_data = case when $2 ? 'lgpdAceite' then ($2 #>> '{lgpdAceite,data}')::timestamptz else lgpd_aceite_data end$flat$
        when 'encarregados' then $flat$,
          operador_id = case when $2 ? 'operadorId' then $2 ->> 'operadorId' else operador_id end,
          nome = case when $2 ? 'nome' then $2 ->> 'nome' else nome end,
          email = case when $2 ? 'email' then $2 ->> 'email' else email end$flat$
        else ''
      end;
      execute format('update public.%I set data = public.apply_jsonb_patch(data, $2) || jsonb_build_object(''id'', $1)%s where id = $1', tbl, flat_updates)
        using rec_id, patch;
      get diagnostics affected = row_count;
      if affected <> 1 then raise exception 'Registro indisponivel para atualizacao.' using errcode = '42501'; end if;
    else
      execute format('delete from public.%I where id = $1', tbl) using rec_id;
      get diagnostics affected = row_count;
      if affected <> 1 then raise exception 'Registro indisponivel para exclusao.' using errcode = '42501'; end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.commit_json_batch(jsonb) from public, anon;
grant execute on function public.commit_json_batch(jsonb) to authenticated;

-- Exercita a RPC com o mesmo papel do navegador. O primeiro INSERT deve
-- desaparecer quando a segunda operação falhar.
set local role authenticated;
do $$
declare
  test_id text := 'hub-batch-test-' || gen_random_uuid()::text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(), 'role', 'authenticated'
  )::text, true);
  begin
    perform public.commit_json_batch(jsonb_build_array(
      jsonb_build_object('type', 'set', 'table', 'checklists', 'id', test_id, 'value', '{}'::jsonb),
      jsonb_build_object('type', 'update', 'table', 'checklists', 'id', test_id || '-missing', 'value', '{}'::jsonb)
    ));
    raise exception 'O teste esperava uma falha de atualizacao.';
  exception when insufficient_privilege then
    if sqlerrm <> 'Registro indisponivel para atualizacao.' then raise; end if;
  end;
  if exists (select 1 from public.checklists where id = test_id) then
    raise exception 'O lote deixou gravacao parcial.';
  end if;
  perform set_config('request.jwt.claims', '', true);
end;
$$;
reset role;
