-- Torna permanentes as decisões de aprovação e reprovação de documentos fiscais.
-- Um documento finalizado não pode ser editado, excluído nem receber outra decisão.

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
  previous_status text;
  content_changed boolean;
  requested_status text;
  requested_reason text;
begin
  new.data := coalesce(new.data, '{}'::jsonb);

  if tg_op = 'INSERT' then
    new.data := (new.data - protected_keys) || jsonb_build_object('approvalStatus', 'pending');
    return new;
  end if;

  previous_status := lower(coalesce(old.data ->> 'approvalStatus', 'pending'));

  -- A decisão final e todo o conteúdo analisado são imutáveis.
  if previous_status in ('approved', 'rejected') then
    if new.data is distinct from old.data then
      raise exception 'Documento fiscal finalizado é permanente e não pode ser alterado.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  content_changed := (new.data - protected_keys) is distinct from (old.data - protected_keys);

  -- Enquanto está pendente, o documento pode ser corrigido, mas o aplicativo
  -- nunca pode forjar os campos reservados à revisão do Financeiro.
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
create or replace function public.prevent_final_fiscal_doc_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if lower(coalesce(old.data ->> 'approvalStatus', 'pending')) in ('approved', 'rejected') then
    raise exception 'Documento fiscal finalizado é permanente e não pode ser excluído.'
      using errcode = '23514';
  end if;

  return old;
end;
$$;
drop trigger if exists prevent_final_fiscal_doc_delete_before_delete on public.fiscal_docs;
create trigger prevent_final_fiscal_doc_delete_before_delete
before delete on public.fiscal_docs
for each row execute function public.prevent_final_fiscal_doc_delete();
-- Arquivo permanente e separado da tabela operacional. Ele guarda uma cópia
-- integral do JSON aprovado/reprovado, inclusive as referências das imagens.
create table if not exists public.fiscal_docs_archive (
  fiscal_doc_id text primary key,
  document_type text not null,
  approval_status text not null check (approval_status in ('approved', 'rejected')),
  snapshot jsonb not null,
  reviewed_by_id text,
  reviewed_by_email text,
  reviewed_at timestamptz,
  archived_at timestamptz not null default now()
);
alter table public.fiscal_docs_archive enable row level security;
revoke all on table public.fiscal_docs_archive from public, anon, authenticated;
grant select on table public.fiscal_docs_archive to authenticated;
drop policy if exists "fiscal archive select scoped" on public.fiscal_docs_archive;
create policy "fiscal archive select scoped"
on public.fiscal_docs_archive for select
to authenticated
using (
  public.is_app_admin()
  or public.is_fiscal_reviewer()
  or coalesce(snapshot ->> 'criadoPorId', '') = auth.uid()::text
);
create or replace function public.archive_final_fiscal_doc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  final_status text := lower(coalesce(new.data ->> 'approvalStatus', 'pending'));
begin
  if final_status not in ('approved', 'rejected') then
    return new;
  end if;

  insert into public.fiscal_docs_archive (
    fiscal_doc_id,
    document_type,
    approval_status,
    snapshot,
    reviewed_by_id,
    reviewed_by_email,
    reviewed_at
  ) values (
    new.id,
    coalesce(nullif(new.data ->> 'tipo', ''), 'Fiscal'),
    final_status,
    new.data,
    nullif(new.data ->> 'reviewedById', ''),
    nullif(new.data ->> 'reviewedByEmail', ''),
    nullif(new.data ->> 'reviewedAt', '')::timestamptz
  )
  on conflict (fiscal_doc_id) do nothing;

  return new;
end;
$$;
drop trigger if exists archive_final_fiscal_doc_after_update on public.fiscal_docs;
create trigger archive_final_fiscal_doc_after_update
after update of data on public.fiscal_docs
for each row
when (
  lower(coalesce(old.data ->> 'approvalStatus', 'pending')) = 'pending'
  and lower(coalesce(new.data ->> 'approvalStatus', 'pending')) in ('approved', 'rejected')
)
execute function public.archive_final_fiscal_doc();
-- Inclui no arquivo os documentos que já estavam finalizados antes desta regra.
insert into public.fiscal_docs_archive (
  fiscal_doc_id,
  document_type,
  approval_status,
  snapshot,
  reviewed_by_id,
  reviewed_by_email,
  reviewed_at
)
select
  id,
  coalesce(nullif(data ->> 'tipo', ''), 'Fiscal'),
  lower(data ->> 'approvalStatus'),
  data,
  nullif(data ->> 'reviewedById', ''),
  nullif(data ->> 'reviewedByEmail', ''),
  nullif(data ->> 'reviewedAt', '')::timestamptz
from public.fiscal_docs
where lower(coalesce(data ->> 'approvalStatus', 'pending')) in ('approved', 'rejected')
on conflict (fiscal_doc_id) do nothing;
create or replace function public.prevent_fiscal_archive_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'O arquivo permanente de documentos fiscais não pode ser alterado nem excluído.'
    using errcode = '23514';
end;
$$;
drop trigger if exists prevent_fiscal_archive_mutation_before_write on public.fiscal_docs_archive;
create trigger prevent_fiscal_archive_mutation_before_write
before update or delete on public.fiscal_docs_archive
for each row execute function public.prevent_fiscal_archive_mutation();
-- A foto de um documento finalizado também não pode ser substituída ou apagada.
drop policy if exists "fiscal private update own folder" on storage.objects;
create policy "fiscal private update own folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'fiscal-private'
  and (
    public.is_app_admin()
    or (storage.foldername(name))[2] = auth.uid()::text
  )
  and not exists (
    select 1
    from public.fiscal_docs fd
    where lower(coalesce(fd.data ->> 'approvalStatus', 'pending')) in ('approved', 'rejected')
      and (fd.data ->> 'fotoPath' = storage.objects.name or fd.data ->> 'thumbnailPath' = storage.objects.name)
  )
)
with check (
  bucket_id = 'fiscal-private'
  and (
    public.is_app_admin()
    or (storage.foldername(name))[2] = auth.uid()::text
  )
  and not exists (
    select 1
    from public.fiscal_docs fd
    where lower(coalesce(fd.data ->> 'approvalStatus', 'pending')) in ('approved', 'rejected')
      and (fd.data ->> 'fotoPath' = storage.objects.name or fd.data ->> 'thumbnailPath' = storage.objects.name)
  )
);
drop policy if exists "fiscal private delete admin" on storage.objects;
create policy "fiscal private delete admin"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'fiscal-private'
  and public.is_app_admin()
  and not exists (
    select 1
    from public.fiscal_docs fd
    where lower(coalesce(fd.data ->> 'approvalStatus', 'pending')) in ('approved', 'rejected')
      and (fd.data ->> 'fotoPath' = storage.objects.name or fd.data ->> 'thumbnailPath' = storage.objects.name)
  )
);
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
  current_document jsonb;
  current_status text;
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

  -- O bloqueio da linha impede duas decisões concorrentes sobre o mesmo documento.
  select data
  into current_document
  from public.fiscal_docs
  where id = p_fiscal_doc_id
  for update;

  if not found then
    raise exception 'Documento fiscal não encontrado.' using errcode = 'P0002';
  end if;

  current_status := lower(coalesce(current_document ->> 'approvalStatus', 'pending'));
  if current_status in ('approved', 'rejected') then
    raise exception 'Este documento fiscal já possui uma decisão final e não pode ser revisado novamente.'
      using errcode = '23514';
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

  return reviewed_document;
end;
$$;
revoke all on function public.review_fiscal_doc(text, text, text) from public;
grant execute on function public.review_fiscal_doc(text, text, text) to authenticated;
