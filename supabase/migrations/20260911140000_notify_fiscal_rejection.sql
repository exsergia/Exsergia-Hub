-- Notifica o colaborador que lançou a NF/Cupom quando o Financeiro reprovar.

create or replace function public.notify_fiscal_rejection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  supabase_url text := nullif(current_setting('app.settings.supabase_url', true), '');
  webhook_secret text := nullif(current_setting('app.settings.cron_secret', true), '');
begin
  if lower(coalesce(new.data ->> 'approvalStatus', '')) <> 'rejected' then
    return new;
  end if;

  -- Envia uma única vez por transição para reprovado. Uma nova reprovação só
  -- volta a avisar se o documento tiver passado por outro status antes.
  if lower(coalesce(old.data ->> 'approvalStatus', '')) = 'rejected' then
    return new;
  end if;

  if coalesce(new.data ->> 'criadoPorId', '') = '' then
    return new;
  end if;

  if supabase_url is null or webhook_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := rtrim(supabase_url, '/') || '/functions/v1/notify-fiscal-doc',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
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
  );

  return new;
exception when others then
  raise warning 'Falha ao enfileirar reprovacao fiscal para %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_fiscal_rejection() from public;

drop trigger if exists fiscal_docs_notify_rejection_after_update on public.fiscal_docs;
create trigger fiscal_docs_notify_rejection_after_update
after update of data on public.fiscal_docs
for each row execute function public.notify_fiscal_rejection();
