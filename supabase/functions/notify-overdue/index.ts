// Edge Function: notify-overdue
// Varre os toolLogs abertos cuja previsão de devolução venceu e avisa o
// responsável por Web Push (app fechado) e por e-mail (SMTP).
//
// Acionada pelo agendador (pg_cron) via net.http_post, com o header
// `x-cron-secret`. Deploy com --no-verify-jwt.
//
// Secrets (supabase secrets set ...):
//   Push:  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
//   Email: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Se os secrets de SMTP não existirem, o envio de e-mail é simplesmente pulado
// (o push continua funcionando normalmente). SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

type JsonRecord = Record<string, unknown>;
type PushKeys = { p256dh: string; auth: string };
type PushSubscription = { id: string; endpoint: string; keys: PushKeys };

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function unwrapRow(value: unknown): JsonRecord {
  const row = asRecord(value);
  return { id: row.id, ...asRecord(row.data) };
}

function errorStatusCode(error: unknown) {
  const statusCode = asRecord(error).statusCode;
  return typeof statusCode === 'number' ? statusCode : null;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:naoresponda@exsergia.eng.br';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OVERDUE_MANAGER_EMAIL = 'nascimentoerick446@gmail.com';

// SMTP (opcional)
const SMTP_HOST = Deno.env.get('SMTP_HOST') || '';
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') || '465');
const SMTP_USER = Deno.env.get('SMTP_USER') || '';
const SMTP_PASS = Deno.env.get('SMTP_PASS') || '';
const SMTP_FROM = Deno.env.get('SMTP_FROM') || SMTP_USER;
const SMTP_ENABLED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const isValidEmail = (e?: string) => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

async function enviarEmails(porUsuario: Record<string, { email: string; nome: string; tools: string[] }>) {
  const destinatarios = Object.values(porUsuario).filter(u => isValidEmail(u.email));
  if (!SMTP_ENABLED || destinatarios.length === 0) return 0;

  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: SMTP_PORT === 465, // 465 = TLS implícito; 587 = STARTTLS
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  });

  let enviados = 0;
  for (const u of destinatarios) {
    const lista = u.tools.map(t => `<li>${t}</li>`).join('');
    const html = `
      <div style="font-family:Arial,sans-serif;color:#18181b">
        <h2 style="margin:0 0 8px">Ferramenta(s) em atraso</h2>
        <p>Olá, ${u.nome || 'colaborador'}. As seguintes ferramentas passaram do prazo de devolução:</p>
        <ul>${lista}</ul>
        <p>Por favor, <strong>renove o prazo ou devolva</strong> o quanto antes no aplicativo.</p>
        <p style="color:#71717a;font-size:12px">Mensagem automática — não responda este e-mail.</p>
      </div>`;
    try {
      await client.send({
        from: SMTP_FROM,
        to: u.email,
        subject: `Ferramenta em atraso (${u.tools.length})`,
        content: 'auto',
        html,
      });
      enviados += 1;
    } catch (err) {
      console.error('Falha ao enviar e-mail para', u.email, err);
    }
  }
  try { await client.close(); } catch { /* ignora */ }
  return enviados;
}

Deno.serve(async (req) => {
  // Autenticação simples por segredo compartilhado com o agendador.
  if (CRON_SECRET) {
    const got = req.headers.get('x-cron-secret');
    if (got !== CRON_SECRET) return new Response('unauthorized', { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = Date.now();

  const { data: logRows, error: logErr } = await supabase.from('toolLogs').select('*');
  if (logErr) return new Response(JSON.stringify({ error: logErr.message }), { status: 500 });

  const overdue = (logRows || [])
    .map(unwrapRow)
    .filter((log) =>
      log.statusLog === 'Aberta' &&
      typeof log.previsaoDevolucao === 'string' &&
      new Date(log.previsaoDevolucao).getTime() < now
    );

  if (overdue.length === 0) {
    return Response.json({ overdue: 0, sent: 0, emails: 0 });
  }

  const { data: toolRows } = await supabase.from('tools').select('*');
  const tools: Record<string, JsonRecord> = Object.fromEntries((toolRows || []).map((value: unknown) => {
    const row = asRecord(value);
    return [String(row.id || ''), asRecord(row.data)];
  }));

  // Mapa de e-mails dos responsáveis (operadores.id == auth.uid).
  const { data: opRows } = await supabase.from('operadores').select('*');
  const emailById: Record<string, string> = {};
  const operatorIdByEmail: Record<string, string> = {};
  for (const r of opRows || []) {
    const row = asRecord(r);
    const data = asRecord(row.data);
    const id = String(row.id || '');
    const email = String(data.email || row.email || '').trim().toLowerCase();
    if (email) {
      emailById[id] = email;
      operatorIdByEmail[email] = id;
    }
  }
  const overdueManagerId = operatorIdByEmail[OVERDUE_MANAGER_EMAIL] || '';

  const { data: subRows } = await supabase.from('push_subscriptions').select('*');
  const subsByUser: Record<string, PushSubscription[]> = {};
  for (const r of subRows || []) {
    const row = asRecord(r);
    const data = asRecord(row.data);
    const keys = asRecord(data.keys);
    if (
      typeof data.userId !== 'string' ||
      typeof data.endpoint !== 'string' ||
      typeof keys.p256dh !== 'string' ||
      typeof keys.auth !== 'string'
    ) continue;
    (subsByUser[data.userId] ||= []).push({
      id: String(row.id || ''),
      endpoint: data.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    });
  }

  // Agrupa atrasos por responsável (para 1 e-mail por pessoa).
  const porUsuario: Record<string, { email: string; nome: string; tools: string[] }> = {};

  let sent = 0;
  for (const log of overdue) {
    const toolId = String(log.toolId || '');
    const rawToolName = tools[toolId]?.nome;
    const toolName = typeof rawToolName === 'string' && rawToolName ? rawToolName : 'Ferramenta';

    // Acumula para o e-mail agregado.
    const uid = String(log.responsavelId || '');
    const responsavelEmail = typeof log.responsavelEmail === 'string' ? log.responsavelEmail : '';
    const responsavelNome = typeof log.responsavelNome === 'string' ? log.responsavelNome : '';
    if (uid) {
      (porUsuario[uid] ||= { email: emailById[uid] || responsavelEmail, nome: responsavelNome, tools: [] }).tools.push(toolName);
    }
    if (overdueManagerId && overdueManagerId !== uid) {
      const detalhe = responsavelNome ? `${toolName} - responsavel: ${responsavelNome}` : toolName;
      (porUsuario[overdueManagerId] ||= { email: emailById[overdueManagerId] || OVERDUE_MANAGER_EMAIL, nome: 'Erick', tools: [] }).tools.push(detalhe);
    }

    // Push (um por ferramenta).
    const subs = subsByUser[uid] || [];
    const payload = JSON.stringify({
      title: 'Ferramenta em atraso',
      body: `"${toolName}" passou do prazo de devolução. Renove ou devolva o quanto antes.`,
      url: '/#/ferramentas',
      tag: `atraso-${log.id}`,
    });
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
        sent += 1;
      } catch (err: unknown) {
        const statusCode = errorStatusCode(err);
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', s.id);
        }
      }
    }
    if (overdueManagerId && overdueManagerId !== uid) {
      const managerSubs = subsByUser[overdueManagerId] || [];
      if (managerSubs.length === 0) continue;
      const adminPayload = JSON.stringify({
        title: 'Ferramenta em atraso',
        body: `"${toolName}" esta atrasada${responsavelNome ? ` com ${responsavelNome}` : ''}.`,
        url: '/#/ferramentas',
        tag: `atraso-admin-${log.id}`,
      });
      for (const s of managerSubs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, adminPayload);
          sent += 1;
        } catch (err: unknown) {
          const statusCode = errorStatusCode(err);
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', s.id);
          }
        }
      }
    }
  }

  const emails = await enviarEmails(porUsuario);

  return Response.json({ overdue: overdue.length, sent, emails });
});
