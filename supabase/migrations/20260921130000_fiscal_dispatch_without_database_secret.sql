-- Mantem o disparo fiscal funcionando mesmo quando as configuracoes customizadas
-- do Postgres nao foram cadastradas. A Edge Function valida o UUID imprevisivel
-- da fila e sempre carrega o payload canonico da tabela privada antes de enviar.

create or replace function public.dispatch_fiscal_notification_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.fiscal_notification_jobs%rowtype;
  supabase_url text := coalesce(
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'https://krbimgxlnyucldfxkvdy.supabase.co'
  );
  webhook_secret text := nullif(current_setting('app.settings.cron_secret', true), '');
  request_headers jsonb;
  queued_request_id bigint;
begin
  select * into job
  from public.fiscal_notification_jobs
  where id = p_job_id
  for update;

  if job.id is null or job.status in ('sent', 'partial') or job.attempts >= 8 then
    return false;
  end if;

  request_headers := jsonb_build_object('Content-Type', 'application/json');
  if webhook_secret is not null then
    request_headers := request_headers || jsonb_build_object('x-webhook-secret', webhook_secret);
  end if;

  select net.http_post(
    url := rtrim(supabase_url, '/') || '/functions/v1/notify-fiscal-doc',
    headers := request_headers,
    body := jsonb_build_object('jobId', job.id)
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
