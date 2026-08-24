-- Envia uma notificacao por e-mail sempre que uma nova Nota Fiscal (tipo NF)
-- e inserida. O envio e assincrono e nunca bloqueia o salvamento do registro.
--
-- Reutiliza as configuracoes usadas pelo agendador notify-overdue:
--   alter database postgres set app.settings.supabase_url = 'https://SEU-PROJETO.supabase.co';
--   alter database postgres set app.settings.cron_secret = 'MESMO_VALOR_DO_SECRET_CRON_SECRET';

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
  if upper(coalesce(new.data ->> 'tipo', '')) <> 'NF' then
    return new;
  end if;

  if supabase_url is null or webhook_secret is null then
    raise warning 'Notificacao fiscal ignorada: app.settings.supabase_url ou app.settings.cron_secret nao configurado.';
    return new;
  end if;

  perform net.http_post(
    url := rtrim(supabase_url, '/') || '/functions/v1/notify-fiscal-doc',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'record', jsonb_build_object(
        'id', new.id,
        'data', new.data,
        'created_at', new.created_at
      )
    )
  );

  return new;
exception
  when others then
    raise warning 'Falha ao enfileirar notificacao fiscal para %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_new_fiscal_doc_email() from public;

drop trigger if exists fiscal_docs_notify_email_after_insert on public.fiscal_docs;
create trigger fiscal_docs_notify_email_after_insert
after insert on public.fiscal_docs
for each row
execute function public.notify_new_fiscal_doc_email();
