-- Registra o pg_net fora do schema public. As funcoes da extensao continuam
-- no namespace net; apenas o registro da extensao deixa de ficar exposto.
-- A fila fiscal reprocessa automaticamente eventuais chamadas HTTP pendentes.

drop extension if exists pg_net;
drop schema if exists net cascade;
create extension pg_net with schema extensions;
