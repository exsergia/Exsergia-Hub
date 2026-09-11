-- Revoga a concessão administrativa criada por engano para este e-mail.
-- A conta do Supabase Auth não é removida por esta migração.

delete from public.admin_access
where id = 'email:gabriela.souza@exsergia.eng.br'
   or lower(coalesce(data ->> 'valor', '')) = 'gabriela.souza@exsergia.eng.br';

-- Defesa adicional: se existir um perfil com esse e-mail, ele deixa de ser
-- administrador sem que seus dados ou sua conta de autenticação sejam apagados.
update public.operadores
set
  data = jsonb_set(
    jsonb_set(coalesce(data, '{}'::jsonb), '{role}', '"operator"'::jsonb, true),
    '{funcao}',
    '"Operador de Campo"'::jsonb,
    true
  ),
  role = 'operator',
  funcao = 'Operador de Campo'
where lower(coalesce(email, data ->> 'email', '')) = 'gabriela.souza@exsergia.eng.br';
