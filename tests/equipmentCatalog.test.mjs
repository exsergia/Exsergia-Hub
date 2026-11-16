import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildEquipmentCatalogData,
  EQUIPMENT_CATEGORIES,
  filterEquipmentCatalog,
  formatEquipmentMeasure,
} from '../src/lib/equipmentCatalog.ts';

const form = {
  nome: ' Grupo gerador de teste ',
  codigo: ' eq-001 ',
  tag: ' gmg-01 ',
  modelo: ' Modelo demonstrativo ',
  categoria: 'Grupo motogerador',
  potencia: '250',
  potenciaUnidade: 'kVA',
  filtros: { oleo: ' OL-001 ', combustivel: 'CB-002', ar: 'AR-003', separador: 'SP-004' },
  capacidadeTanque: '400,5',
  autonomia: '12.5',
  autonomiaUnidade: 'L/h',
};

test('O cadastro salva a ficha técnica completa para as sete categorias', () => {
  assert.equal(EQUIPMENT_CATEGORIES.length, 7);
  for (const categoria of EQUIPMENT_CATEGORIES) {
    const saved = JSON.parse(JSON.stringify(buildEquipmentCatalogData({ ...form, categoria }, [])));
    assert.equal(saved.nome, 'Grupo gerador de teste');
    assert.equal(saved.codigo, 'EQ-001');
    assert.equal(saved.tag, 'GMG-01');
    assert.equal(saved.modelo, 'Modelo demonstrativo');
    assert.equal(saved.categoria, categoria);
    assert.equal(saved.potencia, 250);
    assert.equal(saved.potenciaUnidade, 'kVA');
    assert.equal(saved.capacidadeTanque, 400.5);
    assert.equal(saved.autonomia, 12.5);
    assert.equal(saved.autonomiaUnidade, 'L/h');
    assert.deepEqual(saved.filtros, { oleo: 'OL-001', combustivel: 'CB-002', ar: 'AR-003', separador: 'SP-004' });
  }
});

test('Campos técnicos opcionais podem ser apagados sem manter valores antigos na atualização', () => {
  const saved = buildEquipmentCatalogData({
    ...form, potencia: '', capacidadeTanque: '', autonomia: '',
    filtros: { oleo: '', combustivel: '', ar: '', separador: '' },
  }, []);
  const merged = JSON.parse(JSON.stringify({ potencia: 250, capacidadeTanque: 400, autonomia: 12, ...saved }));
  assert.equal(merged.potencia, null);
  assert.equal(merged.capacidadeTanque, null);
  assert.equal(merged.autonomia, null);
  assert.deepEqual(merged.filtros, { oleo: '', combustivel: '', ar: '', separador: '' });
});

test('O cadastro rejeita identificações duplicadas e medidas inválidas', () => {
  const existing = [{ id: 'anterior', nome: 'Outro equipamento', codigo: 'eq-001', status: 'Ativo' }];
  assert.throws(() => buildEquipmentCatalogData(form, existing), /Já existe um equipamento/);
  assert.doesNotThrow(() => buildEquipmentCatalogData(form, existing, 'anterior'));
  for (const field of ['nome', 'codigo', 'modelo', 'categoria']) {
    assert.throws(() => buildEquipmentCatalogData({ ...form, [field]: ' ' }, []));
  }
  for (const field of ['potencia', 'capacidadeTanque', 'autonomia']) {
    for (const value of ['-1', '0', 'Infinity', 'abc']) {
      assert.throws(() => buildEquipmentCatalogData({ ...form, [field]: value }, []), /maior que zero/);
    }
  }
  assert.throws(() => buildEquipmentCatalogData({ ...form, potenciaUnidade: 'inválida' }, []), /unidades válidas/);
});

test('Editar um equipamento antigo preserva sua categoria e não altera dados de aquisição ou foto', () => {
  const existing = [{
    id: 'legado', nome: 'Equipamento anterior', codigo: 'EQ-001', categoria: 'Categoria anterior',
    status: 'Locado', valorAquisicao: 10000, fotoUrl: 'foto-original', createdAt: '2026-01-01',
  }];
  const previous = structuredClone(existing);
  const catalogData = buildEquipmentCatalogData({ ...form, categoria: 'Categoria anterior' }, existing, 'legado');
  const edited = { ...existing[0], ...catalogData };
  assert.equal(edited.categoria, 'Categoria anterior');
  assert.equal(edited.valorAquisicao, 10000);
  assert.equal(edited.fotoUrl, 'foto-original');
  assert.equal(edited.status, 'Locado');
  assert.equal(edited.createdAt, '2026-01-01');
  assert.deepEqual(existing, previous);
  assert.throws(() => buildEquipmentCatalogData({ ...form, categoria: 'Categoria anterior' }, []), /categorias disponíveis/);
});

test('A pesquisa encontra nome, código, tag, modelo e filtros sem depender de acentos', () => {
  const items = [{ id: 'teste', ...buildEquipmentCatalogData(form, []), status: 'Ativo' },
    { id: 'legado', nome: 'Torre de iluminação antiga', status: 'Ativo', categoria: 'Torre de iluminação' }];
  for (const term of ['GERADOR', 'eq-001', 'gmg-01', 'demonstrativo', 'OL-001', 'CB-002', 'AR-003', 'SP-004']) {
    assert.deepEqual(filterEquipmentCatalog(items, term, 'Todas').map(item => item.id), ['teste']);
  }
  assert.deepEqual(filterEquipmentCatalog(items, 'iluminacao', 'Todas').map(item => item.id), ['legado']);
  assert.deepEqual(filterEquipmentCatalog(items, '', 'Grupo motogerador').map(item => item.id), ['teste']);
  assert.deepEqual(filterEquipmentCatalog(items, 'eq-001', 'Torre de iluminação'), []);
});

test('Potência, tanque e autonomia são apresentados com as unidades corretas', () => {
  assert.equal(formatEquipmentMeasure(250, 'kVA'), '250 kVA');
  assert.equal(formatEquipmentMeasure(400.5, 'L'), '400,5 L');
  assert.equal(formatEquipmentMeasure(12.5, 'L/h'), '12,5 L/h');
  assert.equal(formatEquipmentMeasure(650, 'km'), '650 km');
  assert.equal(formatEquipmentMeasure(null, 'h'), 'Não informado');
  assert.equal(formatEquipmentMeasure(undefined, 'L'), 'Não informado');
});

test('Novos cadastros exigem autonomia em L/h e valores anteriores não são reinterpretados', () => {
  for (const unit of ['h', 'km']) {
    assert.throws(() => buildEquipmentCatalogData({ ...form, autonomiaUnidade: unit }, []), /L\/h/);
    const original = { id: 'anterior', nome: 'Anterior', codigo: 'EQ-001', status: 'Ativo', autonomia: 12.5, autonomiaUnidade: unit };
    const unchanged = buildEquipmentCatalogData({ ...form, autonomiaUnidade: unit }, [original], original.id);
    assert.equal(unchanged.autonomiaUnidade, unit);
    assert.equal(unchanged.autonomia, 12.5);
    assert.throws(() => buildEquipmentCatalogData({ ...form, autonomia: '99', autonomiaUnidade: unit }, [original], original.id), /L\/h/);
    const updated = buildEquipmentCatalogData({ ...form, autonomia: '7,2' }, [original], original.id);
    assert.equal(updated.autonomia, 7.2);
    assert.equal(updated.autonomiaUnidade, 'L/h');
  }
});
