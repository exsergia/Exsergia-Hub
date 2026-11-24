import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMatchingPage } from '../api/_lib/api.js';

test('Filtra também documentos fora dos 500 mais recentes e pagina os resultados filtrados', async () => {
  const rows = Array.from({ length: 704 }, (_, index) => ({
    id: String(index),
    data: { criadoPorId: index >= 698 ? 'conta-1' : 'conta-2' },
  }));
  const database = {
    from() { return this; },
    select() { return this; },
    order() { return this; },
    range(start, end) { return Promise.resolve({ data: rows.slice(start, end + 1) }); },
  };
  const filter = items => items.filter(item => item.criadoPorId === 'conta-1');
  const first = await readMatchingPage(database, 'fiscal_docs', filter, 4, 0);
  assert.deepEqual(first.items.map(item => item.id), ['698', '699', '700', '701']);
  assert.equal(first.nextOffset, 4);
  const last = await readMatchingPage(database, 'fiscal_docs', filter, 4, first.nextOffset);
  assert.deepEqual(last.items.map(item => item.id), ['702', '703']);
  assert.equal(last.nextOffset, null);
});
