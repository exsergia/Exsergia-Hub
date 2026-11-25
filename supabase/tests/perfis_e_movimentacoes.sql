begin;

select set_config('hub.test_actor', gen_random_uuid()::text, true);
select set_config('hub.test_peer', gen_random_uuid()::text, true);

insert into public.operadores (id, data) values
  (current_setting('hub.test_actor'), '{"nome":"Teste titular","cpf":"00000000000"}'),
  (current_setting('hub.test_peer'), '{"nome":"Teste colega","telefone":"00000000000"}');
insert into public.tools (id, data)
values (current_setting('hub.test_actor'), '{"nome":"Teste ferramenta","status":"Disponível"}');
insert into public.vehicles (id, data)
values (current_setting('hub.test_actor'), '{"placa":"TESTE-1","status":"Disponível"}');

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('hub.test_actor'), 'role', 'authenticated'
)::text, true);

do $$
declare
  actor text := current_setting('hub.test_actor');
  peer text := current_setting('hub.test_peer');
  asset_table text;
  log_table text;
  asset_key text;
begin
  if not exists (select 1 from public.operadores where id = actor)
     or exists (select 1 from public.operadores where id = peer)
     or not exists (
       select 1 from public.list_operator_directory()
       where id = peer and data ->> 'nome' = 'Teste colega'
       and not (data ?| array['cpf','telefone','email'])
     ) then
    raise exception 'Escopo do diretório de operadores incorreto.';
  end if;

  foreach asset_table in array array['tools','vehicles'] loop
    log_table := case when asset_table = 'tools' then 'toolLogs' else 'vehicleLogs' end;
    asset_key := case when asset_table = 'tools' then 'toolId' else 'vehicleId' end;

    perform public.commit_json_batch(jsonb_build_array(
      jsonb_build_object('type','set','table',log_table,'id',actor,
        'value',jsonb_build_object(asset_key,actor,'responsavelId',actor,'statusLog','Aberta')),
      jsonb_build_object('type','update','table',asset_table,'id',actor,
        'value',jsonb_build_object('status','Em Uso','lastLogId',actor))
    ));
    set constraints all immediate;
    set constraints all deferred;

    perform public.commit_json_batch(jsonb_build_array(
      jsonb_build_object('type','update','table',log_table,'id',actor,
        'value',jsonb_build_object('statusLog','Concluída','dataDevolucao',now())),
      jsonb_build_object('type','update','table',asset_table,'id',actor,
        'value',jsonb_build_object('status','Disponível','lastLogId',null))
    ));
    set constraints all immediate;
    set constraints all deferred;
  end loop;
end;
$$;

select 'diretório, retirada e devolução validados' as resultado;
rollback;
