-- A integridade do histórico vale para qualquer cliente e também em concorrência.
alter table public.equipamento_manutencoes
  add column equipamento_id text generated always as (data ->> 'equipamentoId') stored not null;
alter table public.equipamento_locacoes
  add column equipamento_id text generated always as (data ->> 'equipamentoId') stored not null;

create index idx_manutencoes_equipamento_fk on public.equipamento_manutencoes (equipamento_id);
create index idx_locacoes_equipamento_fk on public.equipamento_locacoes (equipamento_id);

alter table public.equipamento_manutencoes
  add constraint manutencoes_equipamento_fk foreign key (equipamento_id)
  references public.equipamentos (id) on delete cascade;
alter table public.equipamento_locacoes
  add constraint locacoes_equipamento_fk foreign key (equipamento_id)
  references public.equipamentos (id) on delete cascade;

-- A oitava tentativa já foi contada pelo dispatcher ao enfileirar a chamada.
create or replace function public.claim_fiscal_notification_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.fiscal_notification_jobs
  set status = 'processing', updated_at = now()
  where id = p_job_id and status = 'queued' and attempts between 1 and 8;
  return found;
end;
$$;

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
  update public.fiscal_notification_jobs
  set status = 'failed',
      last_error = coalesce(last_error, 'Limite de tentativas atingido sem confirmação de entrega.'),
      updated_at = now()
  where attempts >= 8 and status in ('queued', 'processing')
    and updated_at < now() - interval '10 minutes';

  for pending_job in
    select id
    from public.fiscal_notification_jobs
    where attempts < 8
      and next_attempt_at <= now()
      and (
        status in ('pending', 'failed', 'configuration_error')
        or (status in ('queued', 'processing') and updated_at < now() - interval '10 minutes')
      )
    order by created_at, id
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  loop
    if public.dispatch_fiscal_notification_job(pending_job.id) then
      dispatched := dispatched + 1;
    end if;
  end loop;
  return dispatched;
end;
$$;
