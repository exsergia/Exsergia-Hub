-- Evita ambiguidade entre a variável PL/pgSQL e auth.users.phone.
create or replace function public.resolve_login_identifier(p_identifier text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(p_identifier, ''), '[^0-9]', '', 'g');
  normalized_phone text;
  matched_email text;
  matched_count bigint;
begin
  if length(digits) not between 10 and 13 then return null; end if;
  if length(digits) = 11 then
    select lower(u.email) into matched_email
    from public.cpfs c join auth.users u on c.data ->> 'uid' = u.id::text
    where c.id = digits and lower(c.data ->> 'email') = lower(u.email);
    if found then return matched_email; end if;

    select min(email), count(*) into matched_email, matched_count
    from auth.users u
    where exists (select 1 from public.operadores o where o.id = u.id::text
         and regexp_replace(coalesce(nullif(o.cpf, ''), o.data ->> 'cpf', ''), '[^0-9]', '', 'g') = digits);
    if matched_count > 0 then
      return case when matched_count = 1 then lower(matched_email) end;
    end if;
  end if;

  normalized_phone := case when length(digits) in (12, 13) and left(digits, 2) = '55'
    then substr(digits, 3) else digits end;
  if length(normalized_phone) not in (10, 11) then return null; end if;
  select min(u.email), count(*) into matched_email, matched_count
    from auth.users u left join public.operadores o on o.id = u.id::text
    where exists (
      select 1 from unnest(array[u.phone, u.raw_user_meta_data ->> 'telefone',
        o.telefone, o.data ->> 'telefone']) as contact(number)
      cross join lateral (select regexp_replace(coalesce(contact.number, ''), '[^0-9]', '', 'g') as normalized) n
      where n.normalized in (normalized_phone, '55' || normalized_phone)
    );
  return case when matched_count = 1 then lower(matched_email) end;
end;
$$;
revoke all on function public.resolve_login_identifier(text) from public, anon, authenticated;
grant execute on function public.resolve_login_identifier(text) to service_role;
