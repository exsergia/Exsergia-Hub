-- Referência de pagamento fiscal permanente, crescente e segura para concorrência.
-- Os documentos existentes são numerados pela ordem de criação e novos
-- lançamentos recebem o próximo número automaticamente no banco.

create sequence if not exists public.fiscal_payment_reference_seq
  as bigint
  minvalue 1
  start with 1
  increment by 1
  no cycle;

revoke all on sequence public.fiscal_payment_reference_seq from public, anon, authenticated;

-- Mantém referências válidas que eventualmente já existam e numera os demais
-- após o maior número encontrado.
with existing_max as (
  select coalesce(max((data ->> 'paymentReference')::bigint), 0) as value
  from public.fiscal_docs
  where coalesce(data ->> 'paymentReference', '') ~ '^[0-9]+$'
), missing_references as (
  select
    id,
    row_number() over (order by created_at asc, id asc) + existing_max.value as reference_number
  from public.fiscal_docs
  cross join existing_max
  where coalesce(data ->> 'paymentReference', '') !~ '^[0-9]+$'
)
update public.fiscal_docs as fiscal_doc
set data = coalesce(fiscal_doc.data, '{}'::jsonb) || jsonb_build_object(
  'paymentReference', lpad(missing_references.reference_number::text, 6, '0')
)
from missing_references
where fiscal_doc.id = missing_references.id;

create unique index if not exists idx_fiscal_docs_payment_reference_unique
on public.fiscal_docs ((data ->> 'paymentReference'))
where coalesce(data ->> 'paymentReference', '') ~ '^[0-9]+$';

do $$
declare
  last_reference bigint;
begin
  select coalesce(max((data ->> 'paymentReference')::bigint), 0)
  into last_reference
  from public.fiscal_docs
  where coalesce(data ->> 'paymentReference', '') ~ '^[0-9]+$';

  if last_reference > 0 then
    perform setval('public.fiscal_payment_reference_seq', last_reference, true);
  else
    perform setval('public.fiscal_payment_reference_seq', 1, false);
  end if;
end;
$$;

create or replace function public.assign_fiscal_payment_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_reference bigint;
begin
  new.data := coalesce(new.data, '{}'::jsonb);

  if tg_op = 'UPDATE' then
    -- A referência identifica o lançamento e não pode ser alterada depois.
    new.data := new.data || jsonb_build_object(
      'paymentReference', old.data ->> 'paymentReference'
    );
    return new;
  end if;

  -- Ignora qualquer número enviado pelo cliente. Somente o banco emite a
  -- referência, impedindo repetição ou manipulação manual.
  next_reference := nextval('public.fiscal_payment_reference_seq');
  new.data := new.data || jsonb_build_object(
    'paymentReference', lpad(next_reference::text, 6, '0')
  );

  return new;
end;
$$;

revoke all on function public.assign_fiscal_payment_reference() from public;

drop trigger if exists assign_fiscal_payment_reference_before_write on public.fiscal_docs;
create trigger assign_fiscal_payment_reference_before_write
before insert or update of data on public.fiscal_docs
for each row execute function public.assign_fiscal_payment_reference();
