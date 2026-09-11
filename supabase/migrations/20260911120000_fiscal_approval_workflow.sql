-- Fluxo de aprovação de NF/Cupom fiscal.
-- Somente contasapagar@exsergia.eng.br pode aprovar ou reprovar documentos.

create or replace function public.is_fiscal_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'authenticated'
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'contasapagar@exsergia.eng.br';
$$;

revoke all on function public.is_fiscal_reviewer() from public;
grant execute on function public.is_fiscal_reviewer() to authenticated;

create or replace function public.protect_fiscal_approval_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  protected_keys constant text[] := array[
    'approvalStatus',
    'rejectionReason',
    'reviewedById',
    'reviewedByEmail',
    'reviewedAt'
  ];
  content_changed boolean;
  requested_status text;
  requested_reason text;
begin
  new.data := coalesce(new.data, '{}'::jsonb);

  if tg_op = 'INSERT' then
    new.data := (new.data - protected_keys) || jsonb_build_object('approvalStatus', 'pending');
    return new;
  end if;

  content_changed := (new.data - protected_keys) is distinct from (old.data - protected_keys);

  -- Qualquer alteração nos dados do documento exige uma nova análise.
  if content_changed then
    new.data := (new.data - protected_keys) || jsonb_build_object('approvalStatus', 'pending');
    return new;
  end if;

  if new.data is not distinct from old.data then
    return new;
  end if;

  if not public.is_fiscal_reviewer() then
    raise exception 'Somente Contas a Pagar pode revisar documentos fiscais.'
      using errcode = '42501';
  end if;

  requested_status := lower(coalesce(new.data ->> 'approvalStatus', ''));
  requested_reason := lower(coalesce(new.data ->> 'rejectionReason', ''));

  if requested_status not in ('approved', 'rejected') then
    raise exception 'Decisão fiscal inválida.' using errcode = '22023';
  end if;

  if requested_status = 'rejected'
     and requested_reason not in ('dados_nao_condizentes', 'imagem_nao_legivel') then
    raise exception 'Motivo de reprovação inválido.' using errcode = '22023';
  end if;

  new.data := (new.data - protected_keys) || jsonb_build_object(
    'approvalStatus', requested_status,
    'reviewedById', auth.uid()::text,
    'reviewedByEmail', lower(coalesce(auth.jwt() ->> 'email', '')),
    'reviewedAt', to_jsonb(now())
  );

  if requested_status = 'rejected' then
    new.data := new.data || jsonb_build_object('rejectionReason', requested_reason);
  end if;

  return new;
end;
$$;

drop trigger if exists protect_fiscal_approval_fields_before_write on public.fiscal_docs;

-- Todos os documentos anteriores ao fluxo entram como pendentes. As chaves são
-- normalizadas para que nenhum valor antigo ou forjado seja tratado como decisão.
update public.fiscal_docs
set data = (
  coalesce(data, '{}'::jsonb)
  - array['approvalStatus', 'rejectionReason', 'reviewedById', 'reviewedByEmail', 'reviewedAt']::text[]
) || jsonb_build_object('approvalStatus', 'pending');

create trigger protect_fiscal_approval_fields_before_write
before insert or update of data on public.fiscal_docs
for each row execute function public.protect_fiscal_approval_fields();

create or replace function public.review_fiscal_doc(
  p_fiscal_doc_id text,
  p_decision text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_decision text := lower(trim(coalesce(p_decision, '')));
  normalized_reason text := lower(trim(coalesce(p_rejection_reason, '')));
  reviewed_document jsonb;
  review_patch jsonb;
begin
  if auth.role() <> 'authenticated' or not public.is_fiscal_reviewer() then
    raise exception 'Somente Contas a Pagar pode revisar documentos fiscais.'
      using errcode = '42501';
  end if;

  if normalized_decision not in ('approved', 'rejected') then
    raise exception 'A decisão deve ser approved ou rejected.' using errcode = '22023';
  end if;

  if normalized_decision = 'rejected'
     and normalized_reason not in ('dados_nao_condizentes', 'imagem_nao_legivel') then
    raise exception 'Selecione um motivo válido para a reprovação.' using errcode = '22023';
  end if;

  review_patch := jsonb_build_object(
    'approvalStatus', normalized_decision,
    'reviewedById', auth.uid()::text,
    'reviewedByEmail', lower(coalesce(auth.jwt() ->> 'email', '')),
    'reviewedAt', to_jsonb(now())
  );

  if normalized_decision = 'rejected' then
    review_patch := review_patch || jsonb_build_object('rejectionReason', normalized_reason);
  end if;

  update public.fiscal_docs
  set data = (
    coalesce(data, '{}'::jsonb)
    - array['approvalStatus', 'rejectionReason', 'reviewedById', 'reviewedByEmail', 'reviewedAt']::text[]
  ) || review_patch
  where id = p_fiscal_doc_id
  returning data into reviewed_document;

  if reviewed_document is null then
    raise exception 'Documento fiscal não encontrado.' using errcode = 'P0002';
  end if;

  return reviewed_document;
end;
$$;

revoke all on function public.review_fiscal_doc(text, text, text) from public;
grant execute on function public.review_fiscal_doc(text, text, text) to authenticated;
