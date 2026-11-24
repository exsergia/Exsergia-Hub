-- Torna as notificacoes fiscais rastreaveis e resilientes a falhas temporarias.
-- A fila nunca bloqueia o cadastro da NF/Cupom e nao expoe o conteudo ao cliente.

create extension if not exists pg_net;
create extension if not exists pg_cron;
create table if not exists public.fiscal_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  fiscal_doc_id text not null,
  event_type text not null check (event_type in ('new_document', 'fiscal_rejected')),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'processing', 'sent', 'partial', 'failed', 'configuration_error')),
  payload jsonb not null,
  result jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  request_id bigint,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz
);
create unique index if not exists fiscal_notification_jobs_new_document_unique
  on public.fiscal_notification_jobs (fiscal_doc_id, event_type)
  where event_type = 'new_document';
create index if not exists fiscal_notification_jobs_retry_idx
  on public.fiscal_notification_jobs (status, next_attempt_at, updated_at)
  where status in ('pending', 'queued', 'processing', 'failed', 'configuration_error');
alter table public.fiscal_notification_jobs enable row level security;
revoke all on table public.fiscal_notification_jobs from anon, authenticated;
-- A Edge Function usa esta funcao para garantir que duas tentativas nao enviem
-- o mesmo evento simultaneamente.
create or replace function public.claim_fiscal_notification_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  update public.fiscal_notification_jobs
  set status = 'processing',
      updated_at = now()
  where id = p_job_id
    and attempts < 8
    and (
      status in ('pending', 'queued', 'failed', 'configuration_error')
      or (status = 'processing' and updated_at < now() - interval '10 minutes')
    )
  returning id into claimed_id;

  return claimed_id is not null;
end;
$$;
revoke all on function public.claim_fiscal_notification_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_fiscal_notification_job(uuid) to service_role;
-- Enfileira a chamada HTTP. O resultado final e gravado pela Edge Function na
-- propria linha da fila, permitindo diagnostico e novas tentativas.
create or replace function public.dispatch_fiscal_notification_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.fiscal_notification_jobs%rowtype;
  supabase_url text := nullif(current_setting('app.settings.supabase_url', true), '');
  webhook_secret text := nullif(current_setting('app.settings.cron_secret', true), '');
  queued_request_id bigint;
begin
  select * into job
  from public.fiscal_notification_jobs
  where id = p_job_id
  for update;

  if job.id is null or job.status in ('sent', 'partial') or job.attempts >= 8 then
    return false;
  end if;

  if supabase_url is null or webhook_secret is null then
    update public.fiscal_notification_jobs
    set status = 'configuration_error',
        last_error = 'app.settings.supabase_url ou app.settings.cron_secret nao configurado.',
        next_attempt_at = now() + interval '15 minutes',
        updated_at = now()
    where id = p_job_id;
    return false;
  end if;

  select net.http_post(
    url := rtrim(supabase_url, '/') || '/functions/v1/notify-fiscal-doc',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := job.payload || jsonb_build_object('jobId', job.id)
  ) into queued_request_id;

  update public.fiscal_notification_jobs
  set status = 'queued',
      attempts = attempts + 1,
      request_id = queued_request_id,
      last_error = null,
      next_attempt_at = now() + make_interval(mins => least(60, (5 * power(2, attempts))::integer)),
      updated_at = now()
  where id = p_job_id;

  return true;
exception when others then
  update public.fiscal_notification_jobs
  set status = 'failed',
      attempts = attempts + 1,
      last_error = left(sqlerrm, 1000),
      next_attempt_at = now() + interval '5 minutes',
      updated_at = now()
  where id = p_job_id;
  return false;
end;
$$;
revoke all on function public.dispatch_fiscal_notification_job(uuid) from public, anon, authenticated;
grant execute on function public.dispatch_fiscal_notification_job(uuid) to service_role;
create or replace function public.dispatch_fiscal_notification_jobs(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_job record;
  dispatched integer := 0;
begin
  for pending_job in
    select id
    from public.fiscal_notification_jobs
    where attempts < 8
      and next_attempt_at <= now()
      and (
        status in ('pending', 'failed', 'configuration_error')
        or (status in ('queued', 'processing') and updated_at < now() - interval '10 minutes')
      )
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  loop
    if public.dispatch_fiscal_notification_job(pending_job.id) then
      dispatched := dispatched + 1;
    end if;
  end loop;

  return dispatched;
end;
$$;
revoke all on function public.dispatch_fiscal_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.dispatch_fiscal_notification_jobs(integer) to service_role;
-- Substitui o disparo direto por uma fila duravel para documentos novos.
create or replace function public.notify_new_fiscal_doc_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_id uuid;
begin
  if upper(trim(coalesce(new.data ->> 'tipo', ''))) not in ('NF', 'CUPOM') then
    return new;
  end if;

  insert into public.fiscal_notification_jobs (fiscal_doc_id, event_type, payload)
  values (
    new.id,
    'new_document',
    jsonb_build_object(
      'eventType', 'new_document',
      'record', jsonb_build_object(
        'id', new.id,
        'data', new.data,
        'created_at', new.created_at
      )
    )
  )
  on conflict (fiscal_doc_id, event_type) where event_type = 'new_document'
  do nothing
  returning id into job_id;

  if job_id is not null then
    perform public.dispatch_fiscal_notification_job(job_id);
  end if;
  return new;
exception when others then
  raise warning 'Falha ao enfileirar notificacao fiscal para %: %', new.id, sqlerrm;
  return new;
end;
$$;
revoke all on function public.notify_new_fiscal_doc_email() from public, anon, authenticated;
drop trigger if exists fiscal_docs_notify_email_after_insert on public.fiscal_docs;
create trigger fiscal_docs_notify_email_after_insert
after insert on public.fiscal_docs
for each row execute function public.notify_new_fiscal_doc_email();
-- A rejeicao tambem usa a fila e pode ocorrer novamente depois de uma correcao.
create or replace function public.notify_fiscal_rejection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_id uuid;
begin
  if lower(coalesce(new.data ->> 'approvalStatus', '')) <> 'rejected'
    or lower(coalesce(old.data ->> 'approvalStatus', '')) = 'rejected'
    or coalesce(new.data ->> 'criadoPorId', '') = '' then
    return new;
  end if;

  insert into public.fiscal_notification_jobs (fiscal_doc_id, event_type, payload)
  values (
    new.id,
    'fiscal_rejected',
    jsonb_build_object(
      'eventType', 'fiscal_rejected',
      'record', jsonb_build_object(
        'id', new.id,
        'data', jsonb_build_object(
          'tipo', new.data ->> 'tipo',
          'criadoPorId', new.data ->> 'criadoPorId',
          'approvalStatus', new.data ->> 'approvalStatus',
          'rejectionReason', new.data ->> 'rejectionReason'
        )
      )
    )
  )
  returning id into job_id;

  perform public.dispatch_fiscal_notification_job(job_id);
  return new;
exception when others then
  raise warning 'Falha ao enfileirar reprovacao fiscal para %: %', new.id, sqlerrm;
  return new;
end;
$$;
revoke all on function public.notify_fiscal_rejection() from public, anon, authenticated;
drop trigger if exists fiscal_docs_notify_rejection_after_update on public.fiscal_docs;
create trigger fiscal_docs_notify_rejection_after_update
after update of data on public.fiscal_docs
for each row execute function public.notify_fiscal_rejection();
-- Permite que o Financeiro ou um administrador tente novamente um envio
-- especifico depois de corrigir SMTP, push ou cadastro do aparelho.
create or replace function public.retry_fiscal_notification_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  updated_id uuid;
begin
  if auth.uid() is null or not (
    public.is_app_admin()
    or caller_email = 'contasapagar@exsergia.eng.br'
  ) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  update public.fiscal_notification_jobs
  set status = 'pending',
      attempts = 0,
      next_attempt_at = now(),
      last_error = null,
      updated_at = now()
  where id = p_job_id
    and (
      status in ('partial', 'failed', 'configuration_error')
      or (status in ('queued', 'processing') and updated_at < now() - interval '10 minutes')
    )
  returning id into updated_id;

  if updated_id is null then
    return false;
  end if;

  return public.dispatch_fiscal_notification_job(updated_id);
end;
$$;
revoke all on function public.retry_fiscal_notification_job(uuid) from public, anon;
grant execute on function public.retry_fiscal_notification_job(uuid) to authenticated;
-- Diagnostico seguro: mostra configuracao, aparelhos por destinatario e os
-- ultimos resultados sem expor payloads, endpoints, chaves ou secrets.
create or replace function public.get_fiscal_notification_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  response jsonb;
begin
  if auth.uid() is null or not (
    public.is_app_admin()
    or caller_email = 'contasapagar@exsergia.eng.br'
  ) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  with wanted(email) as (
    values ('contasapagar@exsergia.eng.br'::text), ('nascimentoerick446@gmail.com'::text)
  ), recipient_ids as (
    select wanted.email, users.id::text as user_id
    from wanted
    join auth.users users on lower(coalesce(users.email, '')) = wanted.email
    union
    select wanted.email, operators.id
    from wanted
    join public.operadores operators
      on lower(coalesce(operators.data ->> 'email', '')) = wanted.email
  ), recipient_health as (
    select wanted.email,
      count(distinct recipient_ids.user_id)::integer as users,
      count(distinct subscriptions.id)::integer as devices
    from wanted
    left join recipient_ids on recipient_ids.email = wanted.email
    left join public.push_subscriptions subscriptions
      on subscriptions.data ->> 'userId' = recipient_ids.user_id
    group by wanted.email
  ), latest_jobs as (
    select jsonb_agg(jsonb_build_object(
      'id', recent.id,
      'documentId', recent.fiscal_doc_id,
      'eventType', recent.event_type,
      'status', recent.status,
      'attempts', recent.attempts,
      'lastError', recent.last_error,
      'createdAt', recent.created_at,
      'updatedAt', recent.updated_at,
      'deliveredAt', recent.delivered_at,
      'emailSent', coalesce((recent.result ->> 'emailSent')::boolean, false),
      'pushSent', coalesce((recent.result ->> 'pushSent')::integer, 0)
    ) order by recent.created_at desc) as items
    from (
      select * from public.fiscal_notification_jobs
      order by created_at desc
      limit 20
    ) recent
  )
  select jsonb_build_object(
    'configured', jsonb_build_object(
      'supabaseUrl', nullif(current_setting('app.settings.supabase_url', true), '') is not null,
      'webhookSecret', nullif(current_setting('app.settings.cron_secret', true), '') is not null
    ),
    'recipients', coalesce((select jsonb_agg(to_jsonb(recipient_health) order by email) from recipient_health), '[]'::jsonb),
    'statusCounts', coalesce((
      select jsonb_object_agg(status, total)
      from (select status, count(*)::integer as total from public.fiscal_notification_jobs group by status) counts
    ), '{}'::jsonb),
    'latestJobs', coalesce((select items from latest_jobs), '[]'::jsonb)
  ) into response;

  return response;
end;
$$;
revoke all on function public.get_fiscal_notification_health() from public, anon;
grant execute on function public.get_fiscal_notification_health() to authenticated;
-- Reprocessa falhas temporarias e chamadas que ficaram sem resposta.
do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'retry-fiscal-notifications'
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'retry-fiscal-notifications',
    '*/2 * * * *',
    'select public.dispatch_fiscal_notification_jobs(20);'
  );
exception when others then
  raise warning 'Nao foi possivel agendar as tentativas fiscais: %', sqlerrm;
end;
$$;
