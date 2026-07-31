import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateLimitStore = new Map();

export const API_TABLES = new Set([
  'obras',
  'materiais',
  'atividades',
  'checklists',
  'progresso_diario',
  'tools',
  'toolLogs',
  'vehicles',
  'vehicleLogs',
  'fiscal_docs',
  'equipamentos',
  'equipamento_manutencoes',
  'equipamento_locacoes',
  'operadores',
]);

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(res.req));
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Max-Age', '600');
  res.end(JSON.stringify(body));
}

export function handleOptions(req, res) {
  if (req.method !== 'OPTIONS') return false;
  sendJson(res, 204, {});
  return true;
}

export function getAllowedOrigin(req) {
  const origin = String(req?.headers?.origin || '').trim();
  const host = String(req?.headers?.host || '').trim();
  const configured = String(process.env.API_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([
    'https://exsergia-hub-sage.vercel.app',
    'https://exsergia-hub-exsergias-projects.vercel.app',
    'https://exsergia-hub-git-main-exsergias-projects.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    ...configured,
  ]);

  if (origin && allowedOrigins.has(origin)) return origin;
  if (!origin && host) return `https://${host}`;
  return 'https://exsergia-hub-sage.vercel.app';
}

export function enforceRateLimit(req, res, userKey = '') {
  const ip = String(
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown',
  ).split(',')[0].trim();
  const key = `${userKey || 'anon'}:${ip}`;
  const now = Date.now();
  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  current.count += 1;
  if (current.count > RATE_LIMIT_MAX_REQUESTS) {
    res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    sendJson(res, 429, { ok: false, error: 'Muitas requisicoes em pouco tempo. Tente novamente em instantes.' });
    return false;
  }

  return true;
}

export function requireMethod(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  sendJson(res, 405, { ok: false, error: 'Metodo nao permitido.' });
  return false;
}

export function getServerSupabase() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('API sem SUPABASE_URL/VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY configurado.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function requireUser(req, res, supabase) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    sendJson(res, 401, { ok: false, error: 'Token de acesso ausente.' });
    return null;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    sendJson(res, 401, { ok: false, error: 'Token de acesso invalido ou expirado.' });
    return null;
  }

  if (!enforceRateLimit(req, res, data.user.id)) return null;

  return data.user;
}

export async function isAppAdmin(supabase, user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return false;

  const { data, error } = await supabase
    .from('admin_access')
    .select('id,data')
    .eq('id', `email:${email}`)
    .maybeSingle();

  if (error) return false;
  return Boolean(data && data.data?.ativo !== false);
}

export async function getOperatorProfile(supabase, user) {
  const { data } = await supabase
    .from('operadores')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (!data) return null;
  return unwrapRow(data);
}

export function unwrapRow(row) {
  return { id: row.id, ...(row.data || {}) };
}

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function toPositiveInt(value, fallback = 100, max = 500) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export async function readJsonBody(req) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_JSON_BODY_BYTES) {
    throw new Error('Payload muito grande.');
  }

  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) throw new Error('Payload muito grande.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}

export function sanitizeFiscalPayload(input, user, operatorProfile) {
  const payload = {
    tipo: input.tipo === 'NF' ? 'NF' : 'Cupom',
    fotoUrl: String(input.fotoUrl || '').trim(),
    fotoPath: input.fotoPath ? String(input.fotoPath).trim() : undefined,
    thumbnailPath: input.thumbnailPath ? String(input.thumbnailPath).trim() : undefined,
    fotoSizeBytes: Number(input.fotoSizeBytes || 0),
    fotoStorageSizeBytes: Number(input.fotoStorageSizeBytes || 0),
    thumbnailSizeBytes: Number(input.thumbnailSizeBytes || 0),
    valor: Number(input.valor || 0),
    data: input.data || new Date().toISOString().slice(0, 10),
    fornecedor: input.fornecedor ? String(input.fornecedor).trim() : undefined,
    cartaoFinal: input.cartaoFinal ? String(input.cartaoFinal).trim().slice(-4) : undefined,
    observacoes: input.observacoes ? String(input.observacoes).trim() : undefined,
    obraId: input.obraId ? String(input.obraId).trim() : undefined,
    obraNome: input.obraNome ? String(input.obraNome).trim() : undefined,
    operadoresPresentes: Array.isArray(input.operadoresPresentes) ? input.operadoresPresentes : [],
    aiAnalysis: input.aiAnalysis || undefined,
    criadoPorId: user.id,
    criadoPorNome: operatorProfile?.nome || user.email || 'Usuario',
    createdAt: new Date().toISOString(),
  };

  if (!payload.fotoPath && !payload.fotoUrl) throw new Error('fotoPath ou fotoUrl e obrigatorio.');
  if (!Number.isFinite(payload.valor) || payload.valor <= 0) throw new Error('valor precisa ser maior que zero.');

  return payload;
}
