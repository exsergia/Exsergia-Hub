import { randomUUID } from 'crypto';
import {
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

function filterFiscalDocs(items, query, user, admin) {
  const search = normalizeText(query.search || query.q || '');
  const obraId = String(query.obraId || '').trim();
  const pessoa = normalizeText(query.pessoa || '');

  return items.filter((item) => {
    if (!admin && item.criadoPorId !== user.id) return false;
    if (obraId && item.obraId !== obraId) return false;

    if (pessoa) {
      const people = [
        item.criadoPorNome,
        item.criadoPorId,
        ...(Array.isArray(item.operadoresPresentes)
          ? item.operadoresPresentes.flatMap((op) => [op?.nome, op?.id])
          : []),
      ];
      if (!people.some((value) => normalizeText(value).includes(pessoa))) return false;
    }

    if (!search) return true;
    const haystack = normalizeText([
      item.tipo,
      item.fornecedor,
      item.obraNome,
      item.criadoPorNome,
      item.observacoes,
      item.valor,
      item.data,
    ].join(' '));
    return haystack.includes(search);
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

  if (req.method === 'GET') {
    const limit = toPositiveInt(url.searchParams.get('limit'), 100, 500);
    const { data, error } = await supabase
      .from('fiscal_docs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      sendJson(res, 500, { ok: false, error: error.message });
      return;
    }

    const items = filterFiscalDocs(
      (data || []).map(unwrapRow),
      Object.fromEntries(url.searchParams.entries()),
      user,
      admin,
    ).slice(0, limit);

    sendJson(res, 200, { ok: true, admin, count: items.length, items });
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const operatorProfile = await getOperatorProfile(supabase, user);
      const id = body.id || randomUUID();
      const payload = { ...sanitizeFiscalPayload(body, user, operatorProfile), id };

      const { error } = await supabase
        .from('fiscal_docs')
        .insert({ id, data: payload });

      if (error) {
        sendJson(res, 500, { ok: false, error: error.message });
        return;
      }

      sendJson(res, 201, { ok: true, item: payload });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === 'PATCH' || req.method === 'PUT') {
    try {
      const body = await readJsonBody(req);
      const id = String(body.id || url.searchParams.get('id') || '').trim();
      if (!id) throw new Error('id e obrigatorio para edicao.');

      const { data: currentRow, error: currentError } = await supabase
        .from('fiscal_docs')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (currentError) {
        sendJson(res, 500, { ok: false, error: currentError.message });
        return;
      }
      if (!currentRow) {
        sendJson(res, 404, { ok: false, error: 'Documento fiscal nao encontrado.' });
        return;
      }

      const current = unwrapRow(currentRow);
      if (!admin && current.criadoPorId !== user.id) {
        sendJson(res, 403, { ok: false, error: 'Voce so pode editar documentos fiscais que criou.' });
        return;
      }
      const payload = {
        ...current,
        ...body,
        id,
        criadoPorId: current.criadoPorId || user.id,
        criadoPorNome: current.criadoPorNome || user.email || 'Usuario',
        updatedAt: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('fiscal_docs')
        .upsert({ id, data: payload });

      if (error) {
        sendJson(res, 500, { ok: false, error: error.message });
        return;
      }

      sendJson(res, 200, { ok: true, item: payload });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  sendJson(res, 405, { ok: false, error: 'Metodo nao permitido.' });
}
