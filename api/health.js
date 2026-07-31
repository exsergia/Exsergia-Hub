import { getServerSupabase, handleOptions, requireMethod, sendJson } from './_lib/api.js';

export default async function handler(req, res) {
  res.req = req;
  if (handleOptions(req, res)) return;
  if (!requireMethod(req, res, ['GET', 'OPTIONS'])) return;

  try {
    getServerSupabase();
    sendJson(res, 200, {
      ok: true,
      service: 'exsergia-api',
      supabaseConfigured: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      service: 'exsergia-api',
      supabaseConfigured: false,
      error: 'API nao configurada.',
    });
  }
}
