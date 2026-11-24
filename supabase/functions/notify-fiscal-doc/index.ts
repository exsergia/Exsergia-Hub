import webpush from 'npm:web-push@3.6.7';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

type JsonRecord = Record<string, unknown>;
type PushKeys = { p256dh: string; auth: string };
type PushSubscription = { id: string; userId: string; endpoint: string; keys: PushKeys };
type RecipientPushResult = {
  email: string;
  users: number;
  subscriptions: number;
  sent: number;
  failed: number;
  reason?: string;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:naoresponda@exsergia.eng.br';
const SMTP_HOST = Deno.env.get('SMTP_HOST') || '';
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') || '465');
const SMTP_USER = Deno.env.get('SMTP_USER') || '';
const SMTP_PASS = Deno.env.get('SMTP_PASS') || '';
const SMTP_FROM = Deno.env.get('SMTP_FROM') || SMTP_USER;
const DEFAULT_NOTIFICATION_EMAILS = [
  'contasapagar@exsergia.eng.br',
  'nascimentoerick446@gmail.com',
];
const NOTIFICATION_EMAILS = Array.from(new Set([
  ...DEFAULT_NOTIFICATION_EMAILS,
  ...(Deno.env.get('FISCAL_NOTIFICATION_EMAILS') || '').split(','),
  Deno.env.get('FISCAL_NOTIFICATION_EMAIL') || '',
].map((email) => email.trim().toLowerCase()).filter(Boolean)));
const APP_URL = Deno.env.get('FISCAL_APP_URL') || 'https://exsergia-hub-sage.vercel.app/notas-fiscais';
const SMTP_ENABLED = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM);
const PUSH_ENABLED = Boolean(SUPABASE_URL && SERVICE_ROLE && VAPID_PUBLIC && VAPID_PRIVATE);

if (PUSH_ENABLED) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Erro desconhecido.');
}

function errorStatusCode(error: unknown) {
  const statusCode = asRecord(error).statusCode;
  return typeof statusCode === 'number' ? statusCode : null;
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function cleanText(value: unknown, fallback = 'Nao informado', maxLength = 300) {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
  return text || fallback;
}

function escapeHtml(value: unknown) {
  return cleanText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatCurrency(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Nao informado';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
}

function formatDate(value: unknown) {
  const raw = String(value ?? '').trim();
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) return cleanText(raw);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function operatorNames(value: unknown) {
  if (!Array.isArray(value)) return 'Nao informado';
  const names = value
    .map((item) => cleanText(asRecord(item).nome, '', 120))
    .filter(Boolean);
  return names.length ? names.join(', ') : 'Nao informado';
}

function createAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function subscriptionFingerprint(endpoint: string) {
  const bytes = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function findUserIdsByEmails(supabase: SupabaseClient, emails: string[]) {
  const wanted = new Set(emails.map(normalizeEmail));
  const idsByEmail = new Map<string, Set<string>>(emails.map((email) => [normalizeEmail(email), new Set()]));

  const { data: operatorRows, error: operatorError } = await supabase
    .from('operadores')
    .select('id,data');
  if (operatorError) throw operatorError;

  for (const value of operatorRows || []) {
    const row = asRecord(value);
    const email = normalizeEmail(asRecord(row.data).email);
    if (wanted.has(email) && row.id) idsByEmail.get(email)?.add(String(row.id));
  }

  // A conta pode existir no Auth sem possuir uma linha correspondente em operadores.
  // O service role permite localizar esses usuarios sem expor a lista ao navegador.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data.users || [];
    for (const user of users) {
      const email = normalizeEmail(user.email);
      if (wanted.has(email)) idsByEmail.get(email)?.add(user.id);
    }
    if (users.length < 1000) break;
  }

  return idsByEmail;
}

async function loadPushSubscriptions(supabase: SupabaseClient, userIds: Set<string>) {
  if (userIds.size === 0) return [] as PushSubscription[];
  const { data: rows, error } = await supabase.from('push_subscriptions').select('id,data');
  if (error) throw error;

  const subscriptions: PushSubscription[] = [];
  for (const value of rows || []) {
    const row = asRecord(value);
    const data = asRecord(row.data);
    const keys = asRecord(data.keys);
    const userId = String(data.userId || '');
    if (
      !userIds.has(userId)
      || typeof data.endpoint !== 'string'
      || typeof keys.p256dh !== 'string'
      || typeof keys.auth !== 'string'
    ) continue;
    subscriptions.push({
      id: String(row.id || ''),
      userId,
      endpoint: data.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    });
  }
  return subscriptions;
}

async function sendSubscriptions(
  supabase: SupabaseClient,
  subscriptions: PushSubscription[],
  payload: string,
  previouslySent: Set<string>,
) {
  let sent = 0;
  let failed = 0;
  const sentFingerprints = new Set(previouslySent);

  for (const subscription of subscriptions) {
    const fingerprint = await subscriptionFingerprint(subscription.endpoint);
    if (sentFingerprints.has(fingerprint)) {
      sent += 1;
      continue;
    }
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        payload,
      );
      sentFingerprints.add(fingerprint);
      sent += 1;
    } catch (error: unknown) {
      const statusCode = errorStatusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
      } else {
        failed += 1;
        console.error('Falha ao enviar push fiscal', error);
      }
    }
  }

  return { sent, failed, sentFingerprints: Array.from(sentFingerprints) };
}

async function sendFiscalPush(input: {
  supabase: SupabaseClient;
  documentId: string;
  documentLabel: string;
  documentArticle: string;
  documentPushTitle: string;
  amount: string;
  supplier: string;
  worksite: string;
  submittedBy: string;
  previouslySent: Set<string>;
}) {
  if (!PUSH_ENABLED) {
    return {
      sent: 0,
      failed: 0,
      subscriptions: 0,
      recipients: [] as RecipientPushResult[],
      sentFingerprints: Array.from(input.previouslySent),
      reason: 'Push nao configurado.',
    };
  }

  const idsByEmail = await findUserIdsByEmails(input.supabase, NOTIFICATION_EMAILS);
  const allUserIds = new Set(Array.from(idsByEmail.values()).flatMap((ids) => Array.from(ids)));
  const subscriptions = await loadPushSubscriptions(input.supabase, allUserIds);
  const details = [input.amount, input.supplier, input.worksite]
    .filter((value) => value && value !== 'Nao informado')
    .join(' - ');
  const body = input.submittedBy && input.submittedBy !== 'Nao informado'
    ? `${input.submittedBy} lancou ${input.documentArticle} ${input.documentLabel}${details ? `: ${details}` : '.'}`
    : `${input.documentPushTitle}${details ? `: ${details}` : '.'}`;
  const payload = JSON.stringify({
    title: input.documentPushTitle,
    body,
    url: '/notas-fiscais',
    tag: `nota-fiscal-${input.documentId}`,
  });

  let totalSent = 0;
  let totalFailed = 0;
  const sentFingerprints = new Set(input.previouslySent);
  const recipients: RecipientPushResult[] = [];

  for (const email of NOTIFICATION_EMAILS) {
    const userIds = idsByEmail.get(email) || new Set<string>();
    const recipientSubscriptions = subscriptions.filter((subscription) => userIds.has(subscription.userId));
    const delivery = await sendSubscriptions(input.supabase, recipientSubscriptions, payload, sentFingerprints);
    delivery.sentFingerprints.forEach((fingerprint) => sentFingerprints.add(fingerprint));
    totalSent += delivery.sent;
    totalFailed += delivery.failed;
    recipients.push({
      email,
      users: userIds.size,
      subscriptions: recipientSubscriptions.length,
      sent: delivery.sent,
      failed: delivery.failed,
      reason: userIds.size === 0
        ? 'Conta nao encontrada no Auth nem em operadores.'
        : recipientSubscriptions.length === 0
          ? 'Nenhum aparelho cadastrado.'
          : delivery.failed > 0
            ? 'Um ou mais aparelhos falharam.'
            : undefined,
    });
  }

  return {
    sent: totalSent,
    failed: totalFailed,
    subscriptions: subscriptions.length,
    recipients,
    sentFingerprints: Array.from(sentFingerprints),
    reason: recipients.every((recipient) => recipient.sent === 0)
      ? 'Nenhum destinatario possui aparelho apto.'
      : undefined,
  };
}

async function sendFiscalRejectionPush(input: {
  supabase: SupabaseClient;
  documentId: string;
  recipientUserId: string;
  title: string;
  body: string;
  previouslySent: Set<string>;
}) {
  if (!PUSH_ENABLED) {
    return { sent: 0, failed: 0, subscriptions: 0, sentFingerprints: Array.from(input.previouslySent), reason: 'Push nao configurado.' };
  }
  if (!input.recipientUserId) {
    return { sent: 0, failed: 0, subscriptions: 0, sentFingerprints: Array.from(input.previouslySent), reason: 'Criador do documento nao informado.' };
  }

  const subscriptions = await loadPushSubscriptions(input.supabase, new Set([input.recipientUserId]));
  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    url: '/notas-fiscais',
    tag: `fiscal-reprovado-${input.documentId}`,
  });
  const delivery = await sendSubscriptions(input.supabase, subscriptions, payload, input.previouslySent);
  return {
    ...delivery,
    subscriptions: subscriptions.length,
    reason: subscriptions.length === 0 ? 'O colaborador nao possui aparelho cadastrado.' : undefined,
  };
}

async function sendEmail(to: string[], subject: string, html: string) {
  if (!SMTP_ENABLED) return { sent: false, error: 'SMTP nao configurado.' };
  if (to.length === 0) return { sent: false, error: 'Destinatario de e-mail nao encontrado.' };

  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: SMTP_PORT === 465,
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  });
  try {
    await client.send({
      from: SMTP_FROM,
      to: to.join(', '),
      subject,
      content: 'auto',
      html,
    });
    return { sent: true, error: '' };
  } catch (error) {
    console.error('Falha ao enviar e-mail fiscal', error);
    return { sent: false, error: errorMessage(error) };
  } finally {
    try {
      await client.close();
    } catch {
      // O resultado do envio nao deve ser alterado por uma falha ao encerrar a conexao.
    }
  }
}

async function claimJob(supabase: SupabaseClient, jobId: string) {
  if (!jobId) return { claimed: false, previousResult: {} as JsonRecord, payload: {} as JsonRecord };
  const { data: claimed, error } = await supabase.rpc('claim_fiscal_notification_job', { p_job_id: jobId });
  if (error) throw error;
  if (!claimed) return { claimed: false, previousResult: {} as JsonRecord, payload: {} as JsonRecord };

  const { data: row, error: rowError } = await supabase
    .from('fiscal_notification_jobs')
    .select('status,result,payload')
    .eq('id', jobId)
    .maybeSingle();
  if (rowError) throw rowError;
  if (!row) return { claimed: false, previousResult: {} as JsonRecord, payload: {} as JsonRecord };
  if (row.status === 'sent') {
    return { claimed: false, previousResult: asRecord(row.result), payload: asRecord(row.payload) };
  }

  return {
    claimed: Boolean(claimed),
    previousResult: asRecord(row.result),
    payload: asRecord(row.payload),
  };
}

async function finishJob(
  supabase: SupabaseClient,
  jobId: string,
  status: 'sent' | 'partial' | 'failed',
  result: JsonRecord,
  lastError = '',
) {
  if (!jobId) return;
  const now = new Date();
  const { error } = await supabase
    .from('fiscal_notification_jobs')
    .update({
      status,
      result,
      last_error: lastError || null,
      delivered_at: status === 'sent' ? now.toISOString() : null,
      next_attempt_at: status === 'failed'
        ? new Date(now.getTime() + 5 * 60 * 1000).toISOString()
        : now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', jobId);
  if (error) console.error('Falha ao atualizar a fila fiscal', error);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Metodo nao permitido.' }, 405);
  let body: JsonRecord;
  try {
    body = asRecord(await req.json());
  } catch {
    return json({ ok: false, error: 'Corpo JSON invalido.' }, 400);
  }

  const jobId = cleanText(body.jobId, '', 100);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    return json({ ok: false, error: 'Nao autorizado.' }, 401);
  }

  const supabase = createAdminClient();
  let previousResult: JsonRecord = {};
  try {
    const claim = await claimJob(supabase, jobId);
    if (!claim.claimed) return json({ ok: true, skipped: true, reason: 'Notificacao ja processada ou em processamento.', jobId }, 202);
    previousResult = claim.previousResult;
    // O payload confiavel vem da fila protegida por RLS. Assim, mesmo quando o
    // segredo do webhook nao estiver configurado no Postgres, um chamador nao
    // consegue forjar destinatarios ou dados do documento.
    body = claim.payload;
  } catch (error) {
    console.error('Falha ao reservar a notificacao fiscal', error);
    return json({ ok: false, error: 'Falha ao reservar a notificacao.', jobId }, 500);
  }

  const record = asRecord(body.record);
  const fiscalDoc = asRecord(record.data);
  const documentType = cleanText(fiscalDoc.tipo, '', 20).toUpperCase();
  const eventType = cleanText(body.eventType, 'new_document', 50).toLowerCase();
  const documentId = cleanText(record.id, 'sem-id', 100);

  if (!['NF', 'CUPOM'].includes(documentType)) {
    await finishJob(supabase, jobId, 'partial', { skipped: true, reason: 'Documento invalido.' }, 'O documento nao e NF nem Cupom.');
    return json({ ok: true, skipped: true, reason: 'O documento nao e NF nem Cupom.' }, 202);
  }

  const isReceipt = documentType === 'CUPOM';
  const documentLabel = isReceipt ? 'cupom fiscal' : 'nota fiscal';
  const documentArticle = isReceipt ? 'um' : 'uma';
  const documentPushTitle = isReceipt ? 'Novo cupom fiscal lancado' : 'Nova nota fiscal lancada';
  const documentHeading = isReceipt ? 'Novo cupom fiscal recebido' : 'Nova nota fiscal recebida';
  const previousFingerprints = new Set(
    Array.isArray(previousResult.sentSubscriptionFingerprints)
      ? previousResult.sentSubscriptionFingerprints.map(String)
      : [],
  );
  const emailAlreadySent = previousResult.emailSent === true;

  try {
    if (eventType === 'fiscal_rejected') {
      if (cleanText(fiscalDoc.approvalStatus, '', 30).toLowerCase() !== 'rejected') {
        await finishJob(supabase, jobId, 'partial', { skipped: true }, 'O documento nao esta reprovado.');
        return json({ ok: true, skipped: true, reason: 'O documento nao esta reprovado.' }, 202);
      }

      const recipientUserId = cleanText(fiscalDoc.criadoPorId, '', 100);
      const title = isReceipt ? 'Cupom fiscal reprovado' : 'Nota fiscal reprovada';
      const rejectionBody = `${isReceipt ? 'Seu cupom fiscal foi reprovado' : 'Sua nota fiscal foi reprovada'}. Fale com o Financeiro (Ariany).`;
      const push = await sendFiscalRejectionPush({
        supabase,
        documentId,
        recipientUserId,
        title,
        body: rejectionBody,
        previouslySent: previousFingerprints,
      });
      const complete = push.sentFingerprints.length > 0 && push.failed === 0;
      const retryable = push.failed > 0 || !PUSH_ENABLED;
      const result: JsonRecord = {
        eventType,
        documentId,
        recipientUserId,
        pushSent: push.sent,
        pushSubscriptions: push.subscriptions,
        pushReason: push.reason,
        sentSubscriptionFingerprints: push.sentFingerprints,
      };
      const lastError = [push.failed ? 'Falha temporaria no push.' : '', push.reason || '']
        .filter(Boolean)
        .join(' ');
      await finishJob(supabase, jobId, complete ? 'sent' : retryable ? 'failed' : 'partial', result, lastError);
      return json({ ok: complete || !retryable, jobId }, retryable ? 500 : 200);
    }

    if (eventType !== 'new_document') {
      await finishJob(supabase, jobId, 'partial', { eventType }, 'Tipo de evento invalido.');
      return json({ ok: false, error: 'Tipo de evento invalido.' }, 400);
    }

    const amount = formatCurrency(fiscalDoc.valor);
    const supplier = cleanText(fiscalDoc.fornecedor);
    const worksite = cleanText(fiscalDoc.obraNome);
    const submittedBy = cleanText(fiscalDoc.criadoPorNome);
    const fiscalDate = formatDate(fiscalDoc.data);
    const operators = operatorNames(fiscalDoc.operadoresPresentes);
    const subject = cleanText(`${documentHeading} - ${amount} - ${worksite}`, documentHeading, 180);
    const html = `
      <div style="font-family:Arial,sans-serif;color:#18181b;line-height:1.5;max-width:640px">
        <h2 style="margin:0 0 16px">${escapeHtml(documentHeading)}</h2>
        <p>Um novo lancamento do tipo <strong>${isReceipt ? 'Cupom Fiscal' : 'Nota Fiscal'}</strong> foi enviado ao Exsergia Hub.</p>
        <table style="border-collapse:collapse;width:100%;margin:20px 0">
          <tr><td style="padding:8px;border-bottom:1px solid #e4e4e7"><strong>Valor</strong></td><td style="padding:8px;border-bottom:1px solid #e4e4e7">${escapeHtml(amount)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e4e4e7"><strong>Data da NF</strong></td><td style="padding:8px;border-bottom:1px solid #e4e4e7">${escapeHtml(fiscalDate)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e4e4e7"><strong>Fornecedor</strong></td><td style="padding:8px;border-bottom:1px solid #e4e4e7">${escapeHtml(supplier)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e4e4e7"><strong>Obra</strong></td><td style="padding:8px;border-bottom:1px solid #e4e4e7">${escapeHtml(worksite)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e4e4e7"><strong>Enviado por</strong></td><td style="padding:8px;border-bottom:1px solid #e4e4e7">${escapeHtml(submittedBy)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e4e4e7"><strong>Equipe presente</strong></td><td style="padding:8px;border-bottom:1px solid #e4e4e7">${escapeHtml(operators)}</td></tr>
          <tr><td style="padding:8px"><strong>ID</strong></td><td style="padding:8px">${escapeHtml(documentId)}</td></tr>
        </table>
        <p><a href="${escapeHtml(APP_URL)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Abrir notas fiscais</a></p>
        <p style="color:#71717a;font-size:12px;margin-top:24px">Mensagem automatica do Exsergia Hub.</p>
      </div>`;

    const push = await sendFiscalPush({
      supabase,
      documentId,
      documentLabel,
      documentArticle,
      documentPushTitle,
      amount,
      supplier,
      worksite,
      submittedBy,
      previouslySent: previousFingerprints,
    });
    const email = emailAlreadySent
      ? { sent: true, error: '' }
      : await sendEmail(NOTIFICATION_EMAILS, subject, html);
    const allPushRecipientsReached = push.recipients.length > 0
      && push.recipients.every((recipient) => recipient.sent > 0 && recipient.failed === 0);
    const complete = email.sent && allPushRecipientsReached;
    const retryable = !email.sent || push.failed > 0;
    const result: JsonRecord = {
      eventType,
      documentId,
      emailSent: email.sent,
      emailRecipients: NOTIFICATION_EMAILS,
      pushSent: push.sent,
      pushSubscriptions: push.subscriptions,
      pushRecipients: push.recipients,
      pushReason: push.reason,
      sentSubscriptionFingerprints: push.sentFingerprints,
    };
    const lastError = [email.error, push.failed ? 'Falha temporaria no push.' : '', !allPushRecipientsReached ? push.reason || 'Destinatario sem aparelho cadastrado.' : '']
      .filter(Boolean)
      .join(' ');
    await finishJob(supabase, jobId, complete ? 'sent' : retryable ? 'failed' : 'partial', result, lastError);
    return json({ ok: complete || !retryable, jobId }, retryable ? 500 : 200);
  } catch (error) {
    const message = errorMessage(error);
    console.error('Falha ao processar notificacao fiscal', error);
    await finishJob(supabase, jobId, 'failed', {
      ...previousResult,
      eventType,
      documentId,
      error: message,
    }, message);
    return json({ ok: false, error: 'Falha ao processar a notificacao fiscal.' }, 500);
  }
});
