import { randomUUID } from 'crypto';
import {
  API_TABLES,
  getOperatorProfile,
  getServerSupabase,
  handleOptions,
  isAppAdmin,
  normalizeText,
  readJsonBody,
  requireMethod,
  requireUser,
  sanitizeFiscalPayload,
  sendJson,
  toPositiveInt,
  unwrapRow,
} from './_lib/api.js';

const OPERATOR_READ_OWN_TABLES = new Set(['operadores', 'fiscal_docs']);
const OPERATOR_WRITE_TABLES = new Set(['fiscal_docs']);

function assertAllowedTable(table) {
  if (!API_TABLES.has(table)) throw new Error('Tabela nao permitida pela API.');
}

function filterItems(items, query, user, admin, table) {
  const search = normalizeText(query.search || query.q || '');
  const obraId = String(query.obraId || '').trim();
  const status = String(query.status || '').trim();

  return items.filter((item) => {
    if (!admin && OPERATOR_READ_OWN_TABLES.has(table)) {
      const belongsToUser =
        item.id === user.id ||
        item.criadoPorId === user.id ||
        item.operatorId === user.id ||
        item.responsavelId === user.id;
      if (!belongsToUser) return false;
    }

    if (obraId && item.obraId !== obraId) return false;
    if (status && item.status !== status && item.statusLog !== status && item.statusConferencia !== status) return false;

    if (!search) return true;
    return normalizeText(JSON.stringify(item)).includes(search);
  });
}

export default async function handler(req, res) {
  res.req = req;
  if (handleOptions(req, res)) return;
  if (!requireMethod(req, res, ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'])) return;

  let supabase;
  try {
    supabase = getServerSupabase();
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    return;
  }

  const user = await requireUser(req, res, supabase);
  if (!user) return;

  const admin = await isAppAdmin(supabase, user);
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const table = String(url.searchParams.get('table') || '').trim();

  try {
    assertAllowedTable(table);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    return;
  }

  if (!admin && !OPERATOR_READ_OWN_TABLES.has(table)) {
    sendJson(res, 403, { ok: false, error: 'Sem permissao para consultar esta tabela pela API.' });
    return;
  }

  if (req.method === 'GET') {
    const limit = toPositiveInt(url.searchParams.get('limit'), 100, 500);
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      sendJson(res, 500, { ok: false, error: error.message });
      return;
    }

    const items = filterItems(
      (data || []).map(unwrapRow),
      Object.fromEntries(url.searchParams.entries()),
      user,
      admin,
      table,
    ).slice(0, limit);

    sendJson(res, 200, { ok: true, table, admin, count: items.length, items });
    return;
  }

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    if (!admin && !OPERATOR_WRITE_TABLES.has(table)) {
      sendJson(res, 403, { ok: false, error: 'Somente administradores podem gravar nesta tabela pela API.' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const id = body.id || randomUUID();
      let existing = {};

      if (req.method === 'PATCH') {
        const { data: currentRow, error: currentError } = await supabase
          .from(table)
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (currentError) {
          sendJson(res, 500, { ok: false, error: currentError.message });
          return;
        }
        existing = currentRow ? unwrapRow(currentRow) : {};

        if (!admin && table === 'fiscal_docs' && existing.criadoPorId && existing.criadoPorId !== user.id) {
          sendJson(res, 403, { ok: false, error: 'Sem permissao para editar este documento.' });
          return;
        }
      }

      let payload = {
        ...existing,
        ...body,
        id,
        updatedAt: new Date().toISOString(),
        createdAt: body.createdAt || new Date().toISOString(),
      };

      if (!admin) {
        if (table !== 'fiscal_docs') {
          sendJson(res, 403, { ok: false, error: 'Sem permissao para gravar nesta tabela pela API.' });
          return;
        }
        const operatorProfile = await getOperatorProfile(supabase, user);
        payload = {
          ...payload,
          ...sanitizeFiscalPayload({ ...payload, id }, user, operatorProfile),
          id,
          createdAt: existing.createdAt || body.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      const { error } = await supabase
        .from(table)
        .upsert({ id, data: payload });

      if (error) {
        sendJson(res, 500, { ok: false, error: error.message });
        return;
      }

      sendJson(res, req.method === 'POST' ? 201 : 200, { ok: true, table, item: payload });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  sendJson(res, 405, { ok: false, error: 'Metodo nao permitido.' });
}
