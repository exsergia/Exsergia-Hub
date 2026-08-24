-- EXSERGIA HUB - SUPABASE LIMPO
-- Rode este arquivo no SQL Editor do Supabase.
-- Ele cria a estrutura zerada, sem obras/materiais/checklists fictícios.
-- Mantém somente os administradores iniciais em admin_access.

create extension if not exists "pgcrypto";

create table if not exists public.obras (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.materiais (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.atividades (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.checklists (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.operadores (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  nome text,
  sobrenome text,
  email text,
  cpf text,
  telefone text,
  funcao text,
  role text default 'operator',
  lgpd_aceite_versao text,
  lgpd_aceite_data timestamptz,
  created_at timestamptz not null default now()
);

alter table public.operadores add column if not exists nome text;
alter table public.operadores add column if not exists sobrenome text;
alter table public.operadores add column if not exists email text;
alter table public.operadores add column if not exists cpf text;
alter table public.operadores add column if not exists telefone text;
alter table public.operadores add column if not exists funcao text;
alter table public.operadores add column if not exists role text default 'operator';
alter table public.operadores add column if not exists lgpd_aceite_versao text;
alter table public.operadores add column if not exists lgpd_aceite_data timestamptz;
alter table public.obras add column if not exists nome text;
alter table public.obras add column if not exists status text;
alter table public.obras add column if not exists cliente text;
alter table public.obras add column if not exists responsavel text;
alter table public.obras add column if not exists centro_custo text;
alter table public.atividades add column if not exists obra_id text;
alter table public.atividades add column if not exists updated_at timestamptz;

create table if not exists public.cpfs (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tools (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public."toolLogs" (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public."vehicleLogs" (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.fiscal_docs (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.equipamentos (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.equipamento_manutencoes (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.equipamento_locacoes (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_access (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.encarregados (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  operador_id text,
  nome text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.progresso_diario (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Índices de performance e bloqueio contra obra duplicada por duplo clique.
create unique index if not exists obras_nome_cliente_unico
  on public.obras (lower(coalesce(data ->> 'nome', '')), lower(coalesce(data ->> 'cliente', '')))
  where coalesce(data ->> 'nome', '') <> '';

create index if not exists idx_obras_created_at on public.obras (created_at desc);
create index if not exists idx_materiais_created_at on public.materiais (created_at desc);
create index if not exists idx_atividades_created_at on public.atividades (created_at desc);
create index if not exists idx_tools_status on public.tools ((data ->> 'status'));
create index if not exists idx_toollogs_responsavel_status_saida on public."toolLogs" ((data ->> 'responsavelId'), (data ->> 'statusLog'), (data ->> 'dataSaida'));
create index if not exists idx_toollogs_tool_status on public."toolLogs" ((data ->> 'toolId'), (data ->> 'statusLog'));
create index if not exists idx_vehicles_status on public.vehicles ((data ->> 'status'));
create index if not exists idx_vehicles_codigo on public.vehicles ((data ->> 'codigo'));
create index if not exists idx_vehiclelogs_vehicle on public."vehicleLogs" ((data ->> 'vehicleId'));
create index if not exists idx_fiscal_docs_created on public.fiscal_docs (created_at desc);
create index if not exists idx_equipamentos_status on public.equipamentos ((data ->> 'status'));
create index if not exists idx_manut_equip on public.equipamento_manutencoes ((data ->> 'equipamentoId'));
create index if not exists idx_locacoes_equip on public.equipamento_locacoes ((data ->> 'equipamentoId'));
create index if not exists idx_operadores_lgpd_aceite_data on public.operadores (lgpd_aceite_data);
create index if not exists idx_encarregados_operador on public.encarregados (operador_id);
create index if not exists idx_encarregados_email on public.encarregados (lower(email));
create index if not exists idx_atividades_obra_id on public.atividades (obra_id);
create index if not exists idx_progresso_diario_updated_at on public.progresso_diario (updated_at desc);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions ((data ->> 'userId'));

-- ZERA DADOS DE TESTE/FICTÍCIOS.
-- Não apaga auth.users. Usuários do Supabase Auth devem ser controlados em Authentication > Users.
truncate table
  public.obras,
  public.materiais,
  public.atividades,
  public.checklists,
  public.operadores,
  public.cpfs,
  public.tools,
  public."toolLogs",
  public.vehicles,
  public."vehicleLogs",
  public.fiscal_docs,
  public.equipamentos,
  public.equipamento_manutencoes,
  public.equipamento_locacoes,
  public.encarregados,
  public.progresso_diario,
  public.push_subscriptions,
  public.admin_access
restart identity cascade;

-- Administradores iniciais reais.
-- Para adicionar outro admin, insira novo registro no padrão:
-- id = email:email@dominio.com ou cpf:00000000000
insert into public.admin_access (id, data) values
  ('email:nascimentoerick446@gmail.com', '{"tipo":"email","valor":"nascimentoerick446@gmail.com","ativo":true}'::jsonb),
  ('email:exsergiacel7234@gmail.com', '{"tipo":"email","valor":"exsergiacel7234@gmail.com","ativo":true}'::jsonb),
  ('email:contasapagar@exsergia.eng.br', '{"tipo":"email","valor":"contasapagar@exsergia.eng.br","ativo":true}'::jsonb),
  ('email:rosangela@exsergia.eng.br', '{"tipo":"email","valor":"rosangela@exsergia.eng.br","ativo":true}'::jsonb)
on conflict (id) do update set data = excluded.data;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.admin_access a
      where regexp_replace(a.id, '^\s+|\s+$', '', 'g') = ('email:' || lower(coalesce(auth.jwt() ->> 'email', '')))
        and coalesce((a.data ->> 'ativo')::boolean, true) = true
    )
    or exists (
      select 1
      from public.operadores o
      join public.admin_access a on regexp_replace(a.id, '^\s+|\s+$', '', 'g') = ('cpf:' || regexp_replace(coalesce(o.data ->> 'cpf', ''), '\\D', '', 'g'))
      where o.id = auth.uid()::text
        and coalesce((a.data ->> 'ativo')::boolean, true) = true
    );
$$;

create or replace function public.is_app_encarregado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.encarregados e
    where e.id = auth.uid()::text
      and coalesce((e.data ->> 'ativo')::boolean, true) = true
  );
$$;

create or replace function public.is_fiscal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_admin()
    or lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'contasapagar@gmail.com',
      'nascimentoerick446@gmail.com'
    );
$$;

create or replace function public.try_timestamptz(value text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;
  return value::timestamptz;
exception when others then
  return null;
end;
$$;

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

create or replace function public.resolve_login_identifier(p_identifier text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  digits text := regexp_replace(coalesce(p_identifier, ''), '\D', '', 'g');
  digits_sem_pais text := case when left(regexp_replace(coalesce(p_identifier, ''), '\D', '', 'g'), 2) = '55'
    then substr(regexp_replace(coalesce(p_identifier, ''), '\D', '', 'g'), 3)
    else regexp_replace(coalesce(p_identifier, ''), '\D', '', 'g')
  end;
  resolved_email text;
begin
  if digits = '' then
    return null;
  end if;

  select lower(c.data ->> 'email')
    into resolved_email
  from public.cpfs c
  where c.id = digits
     or c.id = digits_sem_pais
  limit 1;

  if resolved_email is not null and resolved_email <> '' then
    return resolved_email;
  end if;

  select lower(coalesce(o.email, o.data ->> 'email'))
    into resolved_email
  from public.operadores o
  where regexp_replace(coalesce(o.cpf, o.data ->> 'cpf', ''), '\D', '', 'g') in (digits, digits_sem_pais)
     or regexp_replace(coalesce(o.telefone, o.data ->> 'telefone', ''), '\D', '', 'g') in (digits, digits_sem_pais)
     or right(regexp_replace(coalesce(o.telefone, o.data ->> 'telefone', ''), '\D', '', 'g'), 11) = right(digits_sem_pais, 11)
  limit 1;

  return nullif(resolved_email, '');
end;
$$;

revoke all on function public.resolve_login_identifier(text) from public;
grant execute on function public.resolve_login_identifier(text) to anon, authenticated;

create or replace function public.sync_app_flat_columns()
returns trigger
language plpgsql
as $$
declare
  planned numeric;
  executed numeric;
  percent numeric;
begin
  new.data = coalesce(new.data, '{}'::jsonb) || jsonb_build_object('id', new.id);

  if TG_TABLE_NAME = 'obras' then
    new.nome = new.data ->> 'nome';
    new.status = new.data ->> 'status';
    new.cliente = new.data ->> 'cliente';
    new.responsavel = new.data ->> 'responsavel';
    new.centro_custo = new.data ->> 'centroCusto';
  elsif TG_TABLE_NAME = 'atividades' then
    planned := public.try_numeric(new.data ->> 'quantidadePrevista');
    executed := public.try_numeric(new.data ->> 'quantidadeExecutada');
    percent := case when planned > 0 then least(100, (executed / planned) * 100) else 0 end;
    new.data = jsonb_set(new.data, '{percentual}', to_jsonb(percent), true);
    new.obra_id = new.data ->> 'obraId';
    new.updated_at = coalesce(public.try_timestamptz(new.data ->> 'updatedAt'), new.updated_at, now());
  elsif TG_TABLE_NAME = 'operadores' then
    new.nome = new.data ->> 'nome';
    new.sobrenome = new.data ->> 'sobrenome';
    new.email = new.data ->> 'email';
    new.cpf = new.data ->> 'cpf';
    new.telefone = new.data ->> 'telefone';
    new.funcao = new.data ->> 'funcao';
    new.role = coalesce(new.data ->> 'role', new.role, 'operator');
    new.lgpd_aceite_versao = coalesce(new.data #>> '{lgpdAceite,versao}', new.lgpd_aceite_versao);
    new.lgpd_aceite_data = coalesce(public.try_timestamptz(new.data #>> '{lgpdAceite,data}'), new.lgpd_aceite_data);
  elsif TG_TABLE_NAME = 'encarregados' then
    new.operador_id = coalesce(new.data ->> 'operadorId', new.id);
    new.nome = new.data ->> 'nome';
    new.email = new.data ->> 'email';
  elsif TG_TABLE_NAME = 'progresso_diario' then
    new.updated_at = coalesce(public.try_timestamptz(new.data ->> 'updatedAt'), new.updated_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_obras_flat on public.obras;
create trigger trg_sync_obras_flat before insert or update on public.obras
for each row execute function public.sync_app_flat_columns();

drop trigger if exists trg_sync_atividades_flat on public.atividades;
create trigger trg_sync_atividades_flat before insert or update on public.atividades
for each row execute function public.sync_app_flat_columns();

drop trigger if exists trg_sync_operadores_flat on public.operadores;
create trigger trg_sync_operadores_flat before insert or update on public.operadores
for each row execute function public.sync_app_flat_columns();

drop trigger if exists trg_sync_encarregados_flat on public.encarregados;
create trigger trg_sync_encarregados_flat before insert or update on public.encarregados
for each row execute function public.sync_app_flat_columns();

drop trigger if exists trg_sync_progresso_diario_flat on public.progresso_diario;
create trigger trg_sync_progresso_diario_flat before insert or update on public.progresso_diario
for each row execute function public.sync_app_flat_columns();

create or replace function public.jsonb_only_has_keys(p_value jsonb, p_keys text[])
returns boolean
language sql
immutable
as $$
  select not exists (
    select 1
    from jsonb_object_keys(coalesce(p_value, '{}'::jsonb)) as obj(key)
    where not (obj.key = any(p_keys))
  );
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
begin
  for key, val in select * from jsonb_each(coalesce(p_patch, '{}'::jsonb)) loop
    if jsonb_typeof(val) = 'object' and val ? '__op' then
      op := val ->> '__op';

      if op = 'arrayUnion' then
        existing_array := case when jsonb_typeof(next_data -> key) = 'array' then next_data -> key else '[]'::jsonb end;
        for item in select value from jsonb_array_elements(coalesce(val -> 'values', '[]'::jsonb)) loop
          if not exists (select 1 from jsonb_array_elements(existing_array) as elem(value) where elem.value = item) then
            existing_array := existing_array || jsonb_build_array(item);
          end if;
        end loop;
        next_data := jsonb_set(next_data, array[key], existing_array, true);
      elsif op = 'arrayRemove' then
        existing_array := case when jsonb_typeof(next_data -> key) = 'array' then next_data -> key else '[]'::jsonb end;
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
        next_data := jsonb_set(next_data, array[key], to_jsonb(public.try_numeric(next_data ->> key) + public.try_numeric(val ->> 'value')), true);
      end if;
    else
      next_data := jsonb_set(next_data, array[key], val, true);
    end if;
  end loop;

  return next_data;
end;
$$;

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
    return p_action = 'update' and public.jsonb_only_has_keys(p_value, array['status', 'lastLogId', 'updatedAt']);
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

create or replace function public.commit_json_batch(p_ops jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  op jsonb;
  action text;
  tbl text;
  rec_id text;
  patch jsonb;
  current_data jsonb;
  next_data jsonb;
begin
  if jsonb_typeof(coalesce(p_ops, '[]'::jsonb)) <> 'array' then
    raise exception 'Operacoes invalidas.';
  end if;

  for op in select value from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    action := op ->> 'type';
    tbl := op ->> 'table';
    rec_id := op ->> 'id';
    patch := coalesce(op -> 'value', '{}'::jsonb);

    if action not in ('set', 'update', 'delete') or rec_id is null or tbl is null then
      raise exception 'Operacao invalida no batch.';
    end if;

    if tbl not in (
      'obras', 'materiais', 'atividades', 'checklists', 'operadores', 'encarregados',
      'tools', 'toolLogs', 'vehicles', 'vehicleLogs', 'fiscal_docs',
      'equipamentos', 'equipamento_manutencoes', 'equipamento_locacoes', 'progresso_diario'
    ) then
      raise exception 'Tabela nao permitida no batch: %', tbl;
    end if;

    if not public.can_write_app_table(tbl, action, rec_id, patch) then
      raise exception 'Permissao negada para % em %', action, tbl;
    end if;

    if action = 'delete' then
      execute format('delete from public.%I where id = $1', tbl) using rec_id;
    elsif action = 'set' then
      next_data := coalesce(patch, '{}'::jsonb) || jsonb_build_object('id', rec_id);
      execute format('insert into public.%I (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data', tbl)
        using rec_id, next_data;
    elsif action = 'update' then
      execute format('select data from public.%I where id = $1 for update', tbl) into current_data using rec_id;
      next_data := public.apply_jsonb_patch(coalesce(current_data, '{}'::jsonb) || jsonb_build_object('id', rec_id), patch);
      execute format('insert into public.%I (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data', tbl)
        using rec_id, next_data;
    end if;
  end loop;
end;
$$;

revoke all on function public.commit_json_batch(jsonb) from public;
grant execute on function public.commit_json_batch(jsonb) to authenticated;

alter table public.obras enable row level security;
alter table public.materiais enable row level security;
alter table public.atividades enable row level security;
alter table public.checklists enable row level security;
alter table public.operadores enable row level security;
alter table public.cpfs enable row level security;
alter table public.tools enable row level security;
alter table public."toolLogs" enable row level security;
alter table public.vehicles enable row level security;
alter table public."vehicleLogs" enable row level security;
alter table public.fiscal_docs enable row level security;
alter table public.equipamentos enable row level security;
alter table public.equipamento_manutencoes enable row level security;
alter table public.equipamento_locacoes enable row level security;
alter table public.admin_access enable row level security;
alter table public.encarregados enable row level security;
alter table public.progresso_diario enable row level security;
alter table public.push_subscriptions enable row level security;

do $$
declare
  tbl text;
  pol record;
begin
  foreach tbl in array array['obras','materiais','atividades','checklists','operadores','cpfs','tools','toolLogs','vehicles','vehicleLogs','fiscal_docs','equipamentos','equipamento_manutencoes','equipamento_locacoes','admin_access','encarregados','progresso_diario','push_subscriptions'] loop
    for pol in execute format('select policyname from pg_policies where schemaname = ''public'' and tablename = %L', tbl) loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;
  end loop;
end $$;

create policy "select authenticated obras" on public.obras for select to authenticated using (true);
create policy "select authenticated materiais" on public.materiais for select to authenticated using (true);
create policy "select authenticated atividades" on public.atividades for select to authenticated using (true);
create policy "select authenticated checklists" on public.checklists for select to authenticated using (true);
create policy "select operadores scoped" on public.operadores for select to authenticated using (id = auth.uid()::text or public.is_app_admin() or public.is_app_encarregado() or public.is_fiscal_user());
create policy "select authenticated tools" on public.tools for select to authenticated using (true);
create policy "select authenticated toolLogs" on public."toolLogs" for select to authenticated using (true);
create policy "select authenticated vehicles" on public.vehicles for select to authenticated using (true);
create policy "select authenticated vehicleLogs" on public."vehicleLogs" for select to authenticated using (true);
create policy "select fiscal docs auth" on public.fiscal_docs for select to authenticated using (true);
create policy "select equipamentos admin" on public.equipamentos for select to authenticated using (public.is_app_admin());
create policy "select equipamento manutencoes admin" on public.equipamento_manutencoes for select to authenticated using (public.is_app_admin());
create policy "select equipamento locacoes admin" on public.equipamento_locacoes for select to authenticated using (public.is_app_admin());

create policy "admin all obras" on public.obras for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "admin all materiais" on public.materiais for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "admin all atividades" on public.atividades for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "admin all checklists" on public.checklists for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "admin all operadores" on public.operadores for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "admin all admin_access" on public.admin_access for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "fiscal docs insert auth" on public.fiscal_docs for insert to authenticated
  with check (public.is_app_admin() or coalesce(data ->> 'criadoPorId', '') = auth.uid()::text);
create policy "fiscal docs update own" on public.fiscal_docs for update to authenticated
  using (public.is_app_admin() or coalesce(data ->> 'criadoPorId', '') = auth.uid()::text)
  with check (public.is_app_admin() or coalesce(data ->> 'criadoPorId', '') = auth.uid()::text);
create policy "fiscal docs delete admin" on public.fiscal_docs for delete to authenticated using (public.is_app_admin());
create policy "equipamentos admin all" on public.equipamentos for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "equipamento manutencoes admin all" on public.equipamento_manutencoes for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "equipamento locacoes admin all" on public.equipamento_locacoes for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

create policy "staff write tools" on public.tools for all to authenticated using (public.is_app_admin() or public.is_app_encarregado()) with check (public.is_app_admin() or public.is_app_encarregado());
create policy "staff write vehicles" on public.vehicles for all to authenticated using (public.is_app_admin() or public.is_app_encarregado()) with check (public.is_app_admin() or public.is_app_encarregado());
create policy "staff write atividades" on public.atividades for all to authenticated using (public.is_app_admin() or public.is_app_encarregado()) with check (public.is_app_admin() or public.is_app_encarregado());
create policy "staff write checklists" on public.checklists for all to authenticated using (public.is_app_admin() or public.is_app_encarregado()) with check (public.is_app_admin() or public.is_app_encarregado());
create policy "staff write materiais" on public.materiais for all to authenticated using (public.is_app_admin() or public.is_app_encarregado()) with check (public.is_app_admin() or public.is_app_encarregado());
create policy "staff update obras" on public.obras for update to authenticated using (public.is_app_admin() or public.is_app_encarregado()) with check (public.is_app_admin() or public.is_app_encarregado());

create policy "toolLogs insert owner" on public."toolLogs" for insert to authenticated with check (public.is_app_admin() or public.is_app_encarregado() or data ->> 'responsavelId' = auth.uid()::text);
create policy "toolLogs update owner" on public."toolLogs" for update to authenticated using (public.is_app_admin() or public.is_app_encarregado() or data ->> 'responsavelId' = auth.uid()::text) with check (public.is_app_admin() or public.is_app_encarregado() or data ->> 'responsavelId' = auth.uid()::text);
create policy "toolLogs delete staff" on public."toolLogs" for delete to authenticated using (public.is_app_admin() or public.is_app_encarregado());
create policy "vehicleLogs insert owner" on public."vehicleLogs" for insert to authenticated with check (public.is_app_admin() or public.is_app_encarregado() or data ->> 'responsavelId' = auth.uid()::text);
create policy "vehicleLogs update owner" on public."vehicleLogs" for update to authenticated using (public.is_app_admin() or public.is_app_encarregado() or data ->> 'responsavelId' = auth.uid()::text) with check (public.is_app_admin() or public.is_app_encarregado() or data ->> 'responsavelId' = auth.uid()::text);
create policy "vehicleLogs delete staff" on public."vehicleLogs" for delete to authenticated using (public.is_app_admin() or public.is_app_encarregado());

create policy "insert cpf map" on public.cpfs for insert to anon, authenticated with check (id ~ '^[0-9]{11}$' and coalesce(data ->> 'email', '') <> '');
create policy "update cpf map admin" on public.cpfs for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "insert operador self" on public.operadores for insert to anon, authenticated with check (true);
create policy "update operador self or admin" on public.operadores for update to authenticated using (id = auth.uid()::text or public.is_app_admin()) with check (id = auth.uid()::text or public.is_app_admin());
create policy "read admin registry" on public.admin_access for select to authenticated using (true);
create policy "admin write admin registry" on public.admin_access for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "select encarregados scoped" on public.encarregados for select to authenticated using (id = auth.uid()::text or public.is_app_admin() or public.is_app_encarregado());
create policy "admin write encarregados" on public.encarregados for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "select progresso diario" on public.progresso_diario for select to authenticated using (true);
create policy "staff write progresso diario" on public.progresso_diario for all to authenticated using (public.is_app_admin() or public.is_app_encarregado()) with check (public.is_app_admin() or public.is_app_encarregado());
create policy "push subscriptions own" on public.push_subscriptions for all to authenticated
  using (public.is_app_admin() or coalesce(data ->> 'userId', '') = auth.uid()::text)
  with check (public.is_app_admin() or coalesce(data ->> 'userId', '') = auth.uid()::text);

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do update set public = false;

drop policy if exists "authenticated read uploads" on storage.objects;
drop policy if exists "authenticated upload files" on storage.objects;
drop policy if exists "authenticated update files" on storage.objects;
drop policy if exists "authenticated delete files" on storage.objects;

create policy "authenticated read uploads" on storage.objects for select to authenticated using (bucket_id = 'uploads');
create policy "authenticated upload files" on storage.objects for insert to authenticated with check (bucket_id = 'uploads');
create policy "authenticated update files" on storage.objects for update to authenticated using (bucket_id = 'uploads') with check (bucket_id = 'uploads');
create policy "authenticated delete files" on storage.objects for delete to authenticated using (bucket_id = 'uploads' and public.is_app_admin());

insert into storage.buckets (id, name, public)
values ('fiscal-private', 'fiscal-private', false)
on conflict (id) do update set public = false;

drop policy if exists "authenticated read fiscal private" on storage.objects;
drop policy if exists "authenticated upload fiscal private" on storage.objects;
drop policy if exists "authenticated update fiscal private" on storage.objects;
drop policy if exists "admin delete fiscal private" on storage.objects;

create policy "authenticated read fiscal private" on storage.objects for select to authenticated using (bucket_id = 'fiscal-private');
create policy "authenticated upload fiscal private" on storage.objects for insert to authenticated with check (bucket_id = 'fiscal-private');
create policy "authenticated update fiscal private" on storage.objects for update to authenticated using (bucket_id = 'fiscal-private') with check (bucket_id = 'fiscal-private');
create policy "admin delete fiscal private" on storage.objects for delete to authenticated using (bucket_id = 'fiscal-private' and public.is_app_admin());

-- Ativa Supabase Realtime nas tabelas do aplicativo.
-- Se aparecer aviso de que já existe na publicação, pode ignorar.
do $$
begin
  begin alter publication supabase_realtime add table public.obras; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.materiais; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.atividades; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.checklists; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.operadores; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.cpfs; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tools; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public."toolLogs"; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.vehicles; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public."vehicleLogs"; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.fiscal_docs; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.equipamentos; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.equipamento_manutencoes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.equipamento_locacoes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.admin_access; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.encarregados; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.progresso_diario; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.push_subscriptions; exception when duplicate_object then null; end;
end $$;

-- Notificacao assincrona por e-mail para novas Notas Fiscais.
-- Requer app.settings.supabase_url e app.settings.cron_secret no banco,
-- alem da Edge Function notify-fiscal-doc publicada com os secrets SMTP.
create extension if not exists pg_net;

create or replace function public.notify_new_fiscal_doc_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  supabase_url text := nullif(current_setting('app.settings.supabase_url', true), '');
  webhook_secret text := nullif(current_setting('app.settings.cron_secret', true), '');
begin
  if upper(coalesce(new.data ->> 'tipo', '')) <> 'NF' then return new; end if;
  if supabase_url is null or webhook_secret is null then return new; end if;

  perform net.http_post(
    url := rtrim(supabase_url, '/') || '/functions/v1/notify-fiscal-doc',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('record', jsonb_build_object('id', new.id, 'data', new.data, 'created_at', new.created_at))
  );
  return new;
exception when others then
  raise warning 'Falha ao enfileirar notificacao fiscal para %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_new_fiscal_doc_email() from public;
drop trigger if exists fiscal_docs_notify_email_after_insert on public.fiscal_docs;
create trigger fiscal_docs_notify_email_after_insert
after insert on public.fiscal_docs
for each row execute function public.notify_new_fiscal_doc_email();
