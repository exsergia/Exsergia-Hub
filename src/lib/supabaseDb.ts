import { supabase, withSupabaseRetry } from './supabase';

export type WhereFilter = { type: 'where'; field: string; op: string; value: any };
export type OrderFilter = { type: 'orderBy'; field: string; direction?: 'asc' | 'desc' };
export type LimitFilter = { type: 'limit'; count: number };
export type QueryConstraint = WhereFilter | OrderFilter | LimitFilter;
export type CollectionRef = { table: string; constraints: QueryConstraint[] };
export type DocRef = { table: string; id: string };

export const LOCAL_WRITE_EVENT = 'exsergia:local-write';

const normalizeTable = (table: string) => table;
const newId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const db = {};

function notifyLocalWrite(table: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { table } }));
  if (table === 'operadores') {
    window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { table: 'operadores_diretorio' } }));
  }
}

function notifyBatchWrite(ops: Array<{ table: string }>) {
  Array.from(new Set(ops.map(op => op.table))).forEach(notifyLocalWrite);
}

export function collection(_dbOrCollection: unknown, table?: string): CollectionRef {
  if (typeof _dbOrCollection === 'string') return { table: normalizeTable(_dbOrCollection), constraints: [] };
  if (!table) throw new Error('Nome da tabela não informado.');
  return { table: normalizeTable(table), constraints: [] };
}

export function doc(dbOrCollection: unknown, tableOrId?: string, maybeId?: string): DocRef {
  if (typeof dbOrCollection === 'object' && dbOrCollection && 'table' in (dbOrCollection as any)) {
    const col = dbOrCollection as CollectionRef;
    return { table: col.table, id: tableOrId || newId() };
  }
  if (!tableOrId) throw new Error('Tabela não informada.');
  return { table: normalizeTable(tableOrId), id: maybeId || newId() };
}

export function where(field: string, op: string, value: any): WhereFilter {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): OrderFilter {
  return { type: 'orderBy', field, direction };
}

export function limit(count: number): LimitFilter {
  return { type: 'limit', count };
}

export function query(ref: CollectionRef, ...constraints: QueryConstraint[]): CollectionRef {
  return { ...ref, constraints: [...(ref.constraints || []), ...constraints] };
}

export function serverTimestamp() {
  return new Date().toISOString();
}

function unwrap(row: any) {
  const item = { id: row.id, ...(row.data || {}) };

  if (row.lgpd_aceite_versao || row.lgpd_aceite_data) {
    item.lgpdAceite = {
      versao: row.lgpd_aceite_versao || item.lgpdAceite?.versao || '',
      data: row.lgpd_aceite_data || item.lgpdAceite?.data || '',
    };
  }

  return item;
}

function docSnap(id: string, data: any | null) {
  return {
    id,
    exists: () => !!data,
    data: () => data,
  };
}

function docsSnap(items: any[]) {
  return {
    empty: items.length === 0,
    size: items.length,
    docs: items.map((item) => ({ id: item.id, data: () => item })),
  };
}

function getNested(obj: any, field: string) {
  return field.split('.').reduce((acc, key) => acc?.[key], obj);
}

function applyConstraints(items: any[], constraints: QueryConstraint[] = []) {
  let result = [...items];
  for (const c of constraints) {
    if (c.type === 'where') {
      result = result.filter((item) => {
        const actual = getNested(item, c.field);
        if (c.op === '==') return actual === c.value;
        if (c.op === '!=') return actual !== c.value;
        if (c.op === 'array-contains') return Array.isArray(actual) && actual.includes(c.value);
        return actual === c.value;
      });
    }
  }
  for (const c of constraints) {
    if (c.type === 'orderBy') {
      result.sort((a, b) => {
        const av = getNested(a, c.field) ?? '';
        const bv = getNested(b, c.field) ?? '';
        if (av === bv) return 0;
        const order = av > bv ? 1 : -1;
        return c.direction === 'desc' ? -order : order;
      });
    }
  }
  const limitConstraint = constraints.find((c): c is LimitFilter => c.type === 'limit');
  if (limitConstraint) result = result.slice(0, limitConstraint.count);
  return result;
}

export async function getDoc(ref: DocRef) {
  const { data, error } = await withSupabaseRetry(
    () => supabase.from(ref.table).select('*').eq('id', ref.id).maybeSingle()
  );
  if (error) throw error;
  return docSnap(ref.id, data ? unwrap(data) : null);
}

// Campos que têm coluna flat no PostgreSQL (para filtro server-side)
const FLAT_COLUMN_MAP: Record<string, Record<string, string>> = {
  atividades: { obraId: 'obra_id' },
};

// Monta a consulta empurrando o máximo possível para o servidor (PostgREST):
// filtros de igualdade (coluna flat ou campo JSONB), além de orderBy e limit.
// orderBy/limit só são empurrados quando TODOS os WHERE são '==' (server-side),
// senão o limite cortaria linhas antes do filtro feito em JS.
function buildServerQuery(ref: CollectionRef) {
  let q = supabase.from(ref.table).select('*');

  const wheres = ref.constraints.filter((c): c is WhereFilter => c.type === 'where');
  const allEq = wheres.every((c) => c.op === '==');

  for (const c of wheres) {
    if (c.op !== '==') continue;
    const flatCol = FLAT_COLUMN_MAP[ref.table]?.[c.field];
    q = flatCol ? q.eq(flatCol, c.value) : q.eq(`data->>${c.field}`, c.value);
  }

  if (allEq) {
    for (const c of ref.constraints) {
      if (c.type === 'orderBy') {
        const col = FLAT_COLUMN_MAP[ref.table]?.[c.field] || `data->>${c.field}`;
        q = q.order(col, { ascending: c.direction !== 'desc' });
      }
    }
    const lim = ref.constraints.find((c): c is LimitFilter => c.type === 'limit');
    if (lim) q = q.limit(lim.count);
  }

  return q;
}

export async function getDocs(ref: CollectionRef) {
  if (ref.table === 'operadores_diretorio') {
    const { data, error } = await withSupabaseRetry(() => supabase.rpc('list_operator_directory'));
    if (error) throw error;
    return docsSnap(applyConstraints((data || []).map(unwrap), ref.constraints));
  }
  // Tenta a consulta otimizada (menos payload trafegado).
  let { data, error } = await withSupabaseRetry(() => buildServerQuery(ref));

  // Fallback seguro: se a consulta otimizada falhar (ex.: sintaxe JSONB não
  // aceita em algum campo), busca tudo e filtra/ordena/limita em JS — exatamente
  // o comportamento anterior. Garante que nada quebra.
  if (error) {
    console.warn('getDocs: consulta otimizada falhou, usando fallback completo:', error.message);
    ({ data, error } = await withSupabaseRetry(() => supabase.from(ref.table).select('*')));
    if (error) throw error;
  }

  const items = applyConstraints((data || []).map(unwrap), ref.constraints);
  return docsSnap(items);
}

export async function setDoc(ref: DocRef, value: any) {
  const payload = { ...value, id: ref.id };
  const row: any = { id: ref.id, data: payload };

  if (ref.table === 'operadores') {
    const { nome, sobrenome, email, cpf, telefone, funcao, role, lgpdAceite } = payload;
    if (nome !== undefined) row.nome = nome;
    if (sobrenome !== undefined) row.sobrenome = sobrenome;
    if (email !== undefined) row.email = email;
    if (cpf !== undefined) row.cpf = cpf;
    if (telefone !== undefined) row.telefone = telefone;
    if (funcao !== undefined) row.funcao = funcao;
    if (role !== undefined) row.role = role;
    if (lgpdAceite !== undefined) {
      row.lgpd_aceite_versao = lgpdAceite?.versao || null;
      row.lgpd_aceite_data = lgpdAceite?.data || null;
    }
  }

  if (ref.table === 'obras') {
    const { nome, status, cliente, responsavel, centroCusto } = payload;
    if (nome !== undefined) row.nome = nome;
    if (status !== undefined) row.status = status;
    if (cliente !== undefined) row.cliente = cliente;
    if (responsavel !== undefined) row.responsavel = responsavel;
    if (centroCusto !== undefined) row.centro_custo = centroCusto;
  }

  if (ref.table === 'atividades') {
    const { obraId, updatedAt } = payload;
    if (obraId !== undefined) row.obra_id = obraId;
    if (updatedAt !== undefined) row.updated_at = updatedAt;
  }

  if (ref.table === 'encarregados') {
    const { operadorId, nome, email } = payload;
    if (operadorId !== undefined) row.operador_id = operadorId;
    if (nome !== undefined) row.nome = nome;
    if (email !== undefined) row.email = email;
  }

  const { error } = await withSupabaseRetry(
    () => supabase.from(ref.table).upsert(row)
  );
  if (error) throw error;
  notifyLocalWrite(ref.table);
}

export async function addDoc(ref: CollectionRef, value: any) {
  const id = newId();
  await setDoc({ table: ref.table, id }, { ...value, id });
  return { id };
}

export async function updateDoc(ref: DocRef, value: any) {
  const { error } = await withSupabaseRetry(
    () => supabase.rpc('commit_json_batch', {
      p_ops: [{
        type: 'update',
        table: ref.table,
        id: ref.id,
        value,
      }],
    })
  );
  if (!error) {
    notifyLocalWrite(ref.table);
    return;
  }
  if (!String(error.message || '').includes('Could not find the function')) throw error;

  const current = await getDoc(ref);
  const existing = current.exists() ? current.data() : { id: ref.id };
  const next = { ...existing };
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'object' && val && '__op' in (val as any)) {
      const op = val as any;
      if (op.__op === 'arrayUnion') next[key] = [...(Array.isArray(next[key]) ? next[key] : []), ...op.values];
      if (op.__op === 'arrayRemove') next[key] = (Array.isArray(next[key]) ? next[key] : []).filter((x: any) => !op.values.some((v: any) => JSON.stringify(v) === JSON.stringify(x)));
      if (op.__op === 'increment') next[key] = Number(next[key] || 0) + Number(op.value || 0);
    } else {
      next[key] = val;
    }
  }
  await setDoc(ref, next);
}

export async function deleteDoc(ref: DocRef, options?: { requireDeleted: boolean }) {
  const deletion = supabase.from(ref.table).delete().eq('id', ref.id);
  const { data, error } = await (options?.requireDeleted ? deletion.select('id').maybeSingle() : deletion);
  if (error) throw error;
  if (options?.requireDeleted && !data) throw new Error('Equipamento indisponível para exclusão.');
  notifyLocalWrite(ref.table);
}

export function arrayUnion(...values: any[]) {
  return { __op: 'arrayUnion', values };
}

export function arrayRemove(...values: any[]) {
  return { __op: 'arrayRemove', values };
}

export function increment(value: number) {
  return { __op: 'increment', value };
}

export function writeBatch(_db: unknown) {
  const ops: Array<{ type: 'set' | 'update' | 'delete'; table: string; id: string; value?: any }> = [];
  return {
    set: (ref: DocRef, value: any) => ops.push({ type: 'set', table: ref.table, id: ref.id, value }),
    update: (ref: DocRef, value: any) => ops.push({ type: 'update', table: ref.table, id: ref.id, value }),
    delete: (ref: DocRef) => ops.push({ type: 'delete', table: ref.table, id: ref.id }),
    commit: async () => {
      const { error } = await supabase.rpc('commit_json_batch', { p_ops: ops });
      if (!error) {
        notifyBatchWrite(ops);
        return;
      }
      if (!String(error.message || '').includes('Could not find the function')) throw error;

      const refs = Array.from(new Map(
        ops.map(op => [`${op.table}/${op.id}`, { table: op.table, id: op.id }])
      ).values());
      const before = new Map<string, { exists: boolean; data: any }>();

      for (const ref of refs) {
        const snap = await getDoc(ref);
        before.set(`${ref.table}/${ref.id}`, {
          exists: snap.exists(),
          data: snap.exists() ? snap.data() : null,
        });
      }

      const rollback = async () => {
        for (const ref of refs.reverse()) {
          const previous = before.get(`${ref.table}/${ref.id}`);
          if (!previous) continue;
          try {
            if (previous.exists) await setDoc(ref, previous.data);
            else await deleteDoc(ref);
          } catch (rollbackError) {
            console.error('Falha ao desfazer gravação parcial do lote:', rollbackError);
          }
        }
      };

      try {
        for (const op of ops) {
          if (op.type === 'set') await setDoc({ table: op.table, id: op.id }, op.value);
          if (op.type === 'update') await updateDoc({ table: op.table, id: op.id }, op.value);
          if (op.type === 'delete') await deleteDoc({ table: op.table, id: op.id });
        }
      } catch (fallbackError) {
        await rollback();
        throw fallbackError;
      }
    },
  };
}
