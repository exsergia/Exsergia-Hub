import { createClient } from '@supabase/supabase-js';
import { enforceRateLimit, getServerSupabase, handleOptions, readJsonBody, requireMethod, sendJson } from './_lib/api.js';

export default async function handler(req, res) {
  res.req = req;
  res.setHeader('Cache-Control', 'no-store');
  if (handleOptions(req, res) || !requireMethod(req, res, ['POST', 'OPTIONS'])) return;
  if (!enforceRateLimit(req, res, 'auth-identifier', 10)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Solicitação inválida.' });
  }
  const { identifier, password, action } = body || {};
  if (typeof identifier !== 'string' || !/^\d{10,13}$/.test(identifier) || !['login', 'recover'].includes(action)
      || (action === 'login' && (typeof password !== 'string' || !password || password.length > 1024))) {
    return sendJson(res, 400, { error: 'Informe um CPF ou celular e os dados de acesso.' });
  }

  try {
    const { data: email, error } = await getServerSupabase()
      .rpc('resolve_login_identifier', { p_identifier: identifier });
    if (error) throw error;
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth;
    if (action === 'recover') {
      if (email) {
        const { error: recoveryError } = await auth.resetPasswordForEmail(email, {
          redirectTo: 'https://exsergia-hub-sage.vercel.app/',
        });
        if (recoveryError) console.warn('Falha ao solicitar recuperação por identificador', recoveryError.code);
      }
      return sendJson(res, 200, { ok: true });
    }
    // A autenticação recebe a mesma resposta caso o identificador ou a senha estejam incorretos.
    const { data, error: loginError } = await auth.signInWithPassword({
      email: email || 'identificador-invalido@invalid.example', password,
    });
    if (!email || loginError || !data.session) {
      return sendJson(res, 401, { error: 'Login ou senha inválidos.' });
    }
    return sendJson(res, 200, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch {
    return sendJson(res, 503, { error: 'Serviço de acesso temporariamente indisponível.' });
  }
}
