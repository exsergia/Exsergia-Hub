-- Hardening de acesso administrativo e arquivos fiscais privados.
-- Mantem o login consultando apenas o proprio registro de admin, mas impede
-- usuarios autenticados de listar todos os administradores.

drop policy if exists "admin access select auth" on public.admin_access;
drop policy if exists "read admin registry" on public.admin_access;
drop policy if exists "admin access select scoped" on public.admin_access;

create policy "admin access select scoped" on public.admin_access
  for select to authenticated
  using (
    public.is_app_admin()
    or id = ('email:' || lower(coalesce(auth.jwt() ->> 'email', '')))
    or id = (
      'cpf:' || regexp_replace(
        coalesce(auth.jwt() -> 'user_metadata' ->> 'cpf', ''),
        '\D',
        '',
        'g'
      )
    )
  );

drop policy if exists "authenticated read fiscal private" on storage.objects;
drop policy if exists "authenticated upload fiscal private" on storage.objects;
drop policy if exists "authenticated update fiscal private" on storage.objects;
drop policy if exists "admin delete fiscal private" on storage.objects;
drop policy if exists "fiscal private select scoped" on storage.objects;
drop policy if exists "fiscal private insert own folder" on storage.objects;
drop policy if exists "fiscal private update own folder" on storage.objects;
drop policy if exists "fiscal private delete admin" on storage.objects;

create policy "fiscal private select scoped"
on storage.objects for select
to authenticated
using (
  bucket_id = 'fiscal-private'
  and (
    public.is_app_admin()
    or (storage.foldername(name))[2] = auth.uid()::text
    or exists (
      select 1
      from public.fiscal_docs fd
      where
        coalesce(fd.data ->> 'criadoPorId', '') = auth.uid()::text
        and (
          fd.data ->> 'fotoPath' = storage.objects.name
          or fd.data ->> 'thumbnailPath' = storage.objects.name
        )
    )
  )
);

create policy "fiscal private insert own folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'fiscal-private'
  and (storage.foldername(name))[1] = 'fiscal'
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy "fiscal private update own folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'fiscal-private'
  and (
    public.is_app_admin()
    or (storage.foldername(name))[2] = auth.uid()::text
  )
)
with check (
  bucket_id = 'fiscal-private'
  and (
    public.is_app_admin()
    or (storage.foldername(name))[2] = auth.uid()::text
  )
);

create policy "fiscal private delete admin"
on storage.objects for delete
to authenticated
using (bucket_id = 'fiscal-private' and public.is_app_admin());
