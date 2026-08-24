import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

type JsonRecord = Record<string, unknown>;

const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SMTP_HOST = Deno.env.get('SMTP_HOST') || '';
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') || '465');
const SMTP_USER = Deno.env.get('SMTP_USER') || '';
const SMTP_PASS = Deno.env.get('SMTP_PASS') || '';
const SMTP_FROM = Deno.env.get('SMTP_FROM') || SMTP_USER;
const NOTIFICATION_EMAIL = Deno.env.get('FISCAL_NOTIFICATION_EMAIL') || 'contasapagar@exsergia.eng.br';
const APP_URL = Deno.env.get('FISCAL_APP_URL') || 'https://exsergia-hub-sage.vercel.app/#/notas-fiscais';
const SMTP_ENABLED = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM);

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Metodo nao permitido.' }, 405);
  if (!CRON_SECRET) return json({ ok: false, error: 'CRON_SECRET nao configurado.' }, 503);
  if (req.headers.get('x-webhook-secret') !== CRON_SECRET) {
    return json({ ok: false, error: 'Nao autorizado.' }, 401);
  }
  if (!SMTP_ENABLED) return json({ ok: false, error: 'SMTP nao configurado.' }, 503);

  let body: JsonRecord;
  try {
    body = asRecord(await req.json());
  } catch {
    return json({ ok: false, error: 'Corpo JSON invalido.' }, 400);
  }

  const record = asRecord(body.record);
  const fiscalDoc = asRecord(record.data);
  if (fiscalDoc.tipo !== 'NF') {
    return json({ ok: true, skipped: true, reason: 'O documento nao e do tipo NF.' }, 202);
  }

  const documentId = cleanText(record.id, 'sem-id', 100);
  const amount = formatCurrency(fiscalDoc.valor);
  const supplier = cleanText(fiscalDoc.fornecedor);
  const worksite = cleanText(fiscalDoc.obraNome);
  const submittedBy = cleanText(fiscalDoc.criadoPorNome);
  const fiscalDate = formatDate(fiscalDoc.data);
  const operators = operatorNames(fiscalDoc.operadoresPresentes);
  const subject = cleanText(`Nova nota fiscal recebida - ${amount} - ${worksite}`, 'Nova nota fiscal recebida', 180);
  const html = `
    <div style="font-family:Arial,sans-serif;color:#18181b;line-height:1.5;max-width:640px">
      <h2 style="margin:0 0 16px">Nova nota fiscal recebida</h2>
      <p>Um novo lancamento do tipo <strong>Nota Fiscal</strong> foi enviado ao Exsergia Hub.</p>
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
      to: NOTIFICATION_EMAIL,
      subject,
      content: 'auto',
      html,
    });
    return json({ ok: true, sent: true, recipient: NOTIFICATION_EMAIL, documentId });
  } catch (error) {
    console.error('Falha ao enviar notificacao de nova nota fiscal', error);
    return json({ ok: false, error: 'Falha ao enviar o e-mail.' }, 500);
  } finally {
    try {
      await client.close();
    } catch {
      // A mensagem ja foi processada; falha ao encerrar SMTP nao altera o resultado.
    }
  }
});
