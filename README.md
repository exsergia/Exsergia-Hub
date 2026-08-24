# Exsergia Hub

Aplicação web/PWA para controle operacional de obras da Exsergia.

O projeto centraliza:

- obras e equipes;
- progresso físico;
- materiais;
- ferramentas e movimentações;
- frota;
- NF/Cupom Fiscal;
- financeiro;
- relatórios;
- scanner IA para documentos fiscais.

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Supabase Auth, Database, Storage, Realtime e Edge Functions
- Vercel Serverless API em `/api/*`
- XLSX para exportação

## Configuração Local

1. Instale as dependências:

```bash
npm install
```

2. Copie `.env.example` para `.env` e preencha:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_ANON_PUBLICA
```

3. Rode o schema no Supabase:

```text
supabase/schema.sql
```

4. Inicie o projeto:

```bash
npm run dev
```

O app abre em:

```text
http://localhost:3000
```

## Variáveis de Ambiente

Frontend:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

API serverless na Vercel:

```env
SUPABASE_SERVICE_ROLE_KEY=
```

IA fiscal na Supabase Edge Function:

```bash
supabase secrets set OPENAI_API_KEY=...
supabase secrets set OPENAI_VISION_MODEL=gpt-4o-mini
```

Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` ou `OPENAI_API_KEY` no frontend.

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run preview
```

## Banco de Dados

O app usa tabelas Postgres com `data jsonb` e colunas planas auxiliares.

Principais tabelas:

- `obras`
- `atividades`
- `materiais`
- `checklists`
- `progresso_diario`
- `operadores`
- `admin_access`
- `tools`
- `toolLogs`
- `vehicles`
- `vehicleLogs`
- `fiscal_docs`
- `equipamentos`
- `equipamento_manutencoes`
- `equipamento_locacoes`

## Administradores

Administradores são controlados pela tabela `admin_access`.

Por e-mail:

```sql
insert into public.admin_access (id, data)
values (
  'email:admin@exsergia.eng.br',
  '{"tipo":"email","valor":"admin@exsergia.eng.br","ativo":true}'
);
```

Por CPF:

```sql
insert into public.admin_access (id, data)
values (
  'cpf:00000000000',
  '{"tipo":"cpf","valor":"00000000000","ativo":true}'
);
```

## API

As rotas serverless ficam em `/api/*`.

Principais rotas:

- `GET /api/health`
- `GET /api/fiscal-docs`
- `POST /api/fiscal-docs`
- `PATCH /api/fiscal-docs?id=<id>`
- `GET /api/records?table=obras`
- `POST|PUT|PATCH /api/records?table=fiscal_docs`

Rotas protegidas exigem:

```http
Authorization: Bearer <access_token_do_supabase>
```

Mais detalhes em `api/README.md`.

## IA Fiscal

A Edge Function `supabase/functions/analyze-fiscal-image/index.ts` analisa imagens de NF/Cupom Fiscal.

Ela retorna:

- status da análise;
- confiança;
- tipo do documento;
- valor identificado;
- data identificada;
- fornecedor/despesa provável;
- avisos e motivos.

O resultado é salvo em `fiscal_docs.data.aiAnalysis`.

## Notificação de nova Nota Fiscal

Quando um registro do tipo `NF` é inserido em `fiscal_docs`, o banco chama a Edge Function
`supabase/functions/notify-fiscal-doc/index.ts`. Ela envia os dados do lançamento para
`contasapagar@exsergia.eng.br`. Cupons fiscais não disparam esse aviso.

Configure os secrets SMTP e publique a função:

```bash
supabase secrets set SMTP_HOST=... SMTP_PORT=465 SMTP_USER=... SMTP_PASS=... SMTP_FROM=...
supabase secrets set CRON_SECRET=... FISCAL_NOTIFICATION_EMAIL=contasapagar@exsergia.eng.br
supabase functions deploy notify-fiscal-doc --no-verify-jwt
supabase db push
```

O banco precisa das mesmas configurações usadas pelo `notify-overdue`:

```sql
alter database postgres set app.settings.supabase_url = 'https://SEU-PROJETO.supabase.co';
alter database postgres set app.settings.cron_secret = 'MESMO_VALOR_DO_SECRET_CRON_SECRET';
```

## Deploy

Antes de publicar:

```bash
npm run lint
npm run build
```

No Vercel, configure:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

No Supabase, configure os secrets da IA fiscal quando o scanner estiver ativo.

## Documentação Técnica

A documentação completa fica em:

```text
DOCUMENTACAO_EXSERGIA.md
docs_tecnica.html
api/README.md
```
