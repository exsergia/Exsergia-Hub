-- Concede acesso administrativo a Gabriela pelo e-mail usado no Supabase Auth.

insert into public.admin_access (id, data) values
  (
    'email:gabriela.souza@exsergia.eng.br',
    '{"tipo":"email","valor":"gabriela.souza@exsergia.eng.br","ativo":true}'::jsonb
  )
on conflict (id) do update set data = excluded.data;

-- Se o perfil já existir, sincroniza a função imediatamente. O registro acima
-- também garante que um perfil criado no futuro será reconhecido no login.
update public.operadores
set
  data = jsonb_set(
    jsonb_set(coalesce(data, '{}'::jsonb), '{role}', '"admin"'::jsonb, true),
    '{funcao}',
    '"Administrador"'::jsonb,
    true
  ),
  role = 'admin',
  funcao = 'Administrador'
where lower(coalesce(email, data ->> 'email', '')) = 'gabriela.souza@exsergia.eng.br';
