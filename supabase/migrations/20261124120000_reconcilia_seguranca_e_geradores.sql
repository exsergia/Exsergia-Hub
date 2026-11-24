-- Fecha acessos diretos desnecessarios, consolida policies equivalentes e
-- cadastra os geradores que constavam na planilha mas ainda nao existiam no Hub.

-- Funcoes usadas apenas por triggers nao devem ser chamadas pela API.
revoke all on function public.archive_final_fiscal_doc() from public, anon, authenticated;
revoke all on function public.assign_fiscal_payment_reference() from public, anon, authenticated;

-- RPCs e helpers de autorizacao continuam disponiveis apenas para usuarios
-- autenticados; cada funcao valida internamente a identidade e o papel.
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;
revoke all on function public.is_app_encarregado() from public, anon;
grant execute on function public.is_app_encarregado() to authenticated;
revoke all on function public.is_fiscal_reviewer() from public, anon;
grant execute on function public.is_fiscal_reviewer() to authenticated;
revoke all on function public.review_fiscal_doc(text, text, text) from public, anon;
grant execute on function public.review_fiscal_doc(text, text, text) to authenticated;
revoke all on function public.retry_fiscal_notification_job(uuid) from public, anon;
grant execute on function public.retry_fiscal_notification_job(uuid) to authenticated;
revoke all on function public.get_fiscal_notification_health() from public, anon;
grant execute on function public.get_fiscal_notification_health() to authenticated;

-- As policies "admin all" se sobrepunham as policies especificas. Mantemos
-- exatamente as permissoes necessarias, separadas por operacao.
drop policy if exists "admin all atividades" on public.atividades;
drop policy if exists "admin all checklists" on public.checklists;
drop policy if exists "admin all materiais" on public.materiais;

drop policy if exists "admin all admin_access" on public.admin_access;
create policy "admin insert admin_access" on public.admin_access
  for insert to authenticated with check (public.is_app_admin());
create policy "admin update admin_access" on public.admin_access
  for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "admin delete admin_access" on public.admin_access
  for delete to authenticated using (public.is_app_admin());

drop policy if exists "admin all obras" on public.obras;
create policy "admin insert obras" on public.obras
  for insert to authenticated with check (public.is_app_admin());
create policy "admin delete obras" on public.obras
  for delete to authenticated using (public.is_app_admin());

drop policy if exists "admin all operadores" on public.operadores;
create policy "admin delete operadores" on public.operadores
  for delete to authenticated using (public.is_app_admin());

-- Evita recalcular auth.uid() para cada linha consultada.
drop policy if exists "update operador self or admin" on public.operadores;
create policy "update operador self or admin" on public.operadores
  for update to authenticated
  using (id = (select auth.uid())::text or public.is_app_admin())
  with check (id = (select auth.uid())::text or public.is_app_admin());

drop policy if exists "fiscal archive select scoped" on public.fiscal_docs_archive;
create policy "fiscal archive select scoped" on public.fiscal_docs_archive
  for select to authenticated
  using (
    public.is_app_admin()
    or public.is_fiscal_reviewer()
    or coalesce(snapshot ->> 'criadoPorId', '') = (select auth.uid())::text
  );

-- O codigo interno permanece no padrao GER-xxx e a identificacao operacional
-- da planilha permanece no campo tag como GMG xxx.
with novos (
  codigo, tag, modelo, potencia, autonomia, tanque, ano, fabricante, motor,
  filtro_combustivel
) as (
  values
    ('GER-145', 'GMG 145', 'TDWG12000SGE', 12.5::numeric, null::numeric, 26::numeric, 2014, null::text, null::text, '944254004'),
    ('GER-149', 'GMG 149', 'MAQ4401',      250,           null,          null,        null, 'WEG',      'SCANIA',   null),
    ('GER-153', 'GMG 153', 'MWM-D229',      30,            7.5,            42,        null, null,       null,       null),
    ('GER-155', 'GMG 155', 'TD4000CX',       3.6,          null,          12.5,        null, null,       null,       null)
), ausentes as (
  select n.*
  from novos n
  where not exists (
    select 1
    from public.equipamentos e
    where regexp_replace(upper(coalesce(e.data ->> 'codigo', '')), '[^A-Z0-9]', '', 'g')
            in (
              regexp_replace(upper(n.codigo), '[^A-Z0-9]', '', 'g'),
              regexp_replace(upper(n.tag), '[^A-Z0-9]', '', 'g')
            )
       or regexp_replace(upper(coalesce(e.data ->> 'tag', '')), '[^A-Z0-9]', '', 'g')
            = regexp_replace(upper(n.tag), '[^A-Z0-9]', '', 'g')
  )
)
insert into public.equipamentos (data)
select jsonb_strip_nulls(jsonb_build_object(
  'nome', 'Grupo motogerador ' || a.tag,
  'codigo', a.codigo,
  'tag', a.tag,
  'modelo', a.modelo,
  'categoria', 'Grupo motogerador',
  'potencia', a.potencia,
  'potenciaUnidade', 'kVA',
  'autonomia', a.autonomia,
  'autonomiaUnidade', 'L/h',
  'capacidadeTanque', a.tanque,
  'anoFabricacao', a.ano,
  'fabricanteGerador', a.fabricante,
  'motor', a.motor,
  'status', 'Ativo',
  'valorAquisicao', 0,
  'oleoLubrificanteTipo', '15W 40',
  'filtros', jsonb_strip_nulls(jsonb_build_object(
    'combustivel', a.filtro_combustivel
  )),
  'createdAt', now(),
  'updatedAt', now()
))
from ausentes a;
