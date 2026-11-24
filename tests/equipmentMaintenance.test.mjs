import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { format } from 'date-fns';
import {
  AUTHORIZATION_ITEM_ID, buildMaintenanceDetails, GENERATOR_MAINTENANCE_PLANS,
  getLatestMaintenance, getMaintenanceSchedule, isCompleteMaintenance, lastMaintenanceForItem,
  maintenanceChecklistCounts, maintenanceDescription,
} from '../src/lib/equipmentMaintenance.ts';
import {
  EquipmentMaintenanceOverview, MaintenanceCardSummary, MaintenanceChecklist, MaintenanceChecklistHistory,
} from '../src/components/EquipmentMaintenance.tsx';

const today = new Date(2026, 10, 16, 12);
const equipment = { id: 'gerador-teste', nome: 'Gerador de teste', tag: 'GMG TESTE', categoria: 'Grupo motogerador', status: 'Ativo' };
const form = {
  data: '2026-11-05', periodicidade: 'mensal', resultados: {}, servicoRealizado: '', horimetro: '',
  responsavelNome: '', autorizacaoContratante: false,
};

function completed(period, data, extra = {}) {
  const results = Object.fromEntries(GENERATOR_MAINTENANCE_PLANS[period].items.map(item => [item.id, 'realizado']));
  const details = buildMaintenanceDetails({ ...form, periodicidade: period, data, resultados: results, autorizacaoContratante: true }, today);
  return {
    id: `${period}-${data}`, equipamentoId: equipment.id, tipo: 'Preventiva', data,
    horasEquipe: 0, custoHora: 0, valorMaoObra: 0, pecas: [], outrosCustos: [], custoTotal: 0,
    ...details, ...extra,
  };
}

test('Os planos contêm os 39 serviços das imagens e preservam as condições de execução', () => {
  assert.equal(GENERATOR_MAINTENANCE_PLANS.mensal.items.length, 29);
  assert.equal(GENERATOR_MAINTENANCE_PLANS.bimestral.items.length, 6);
  assert.equal(GENERATOR_MAINTENANCE_PLANS.semestral.items.length, 4);
  const all = Object.values(GENERATOR_MAINTENANCE_PLANS).flatMap(plan => plan.items);
  assert.equal(new Set(all.map(item => item.id)).size, 39);
  assert.match(all.find(item => item.id === AUTHORIZATION_ITEM_ID).descricao, /autorização da CONTRATANTE/);
  assert.match(all.find(item => item.id === 'semestral-troca-oleo').descricao, /conforme horas trabalhadas/);
});

test('Uma execução parcial guarda os serviços realizados, não aplicáveis e pendentes', () => {
  const details = buildMaintenanceDetails({ ...form,
    resultados: { 'mensal-oleo-lubrificante': 'realizado', 'mensal-oleo-bomba-injetora': 'nao_aplicavel' },
    horimetro: '1250,5', responsavelNome: ' Técnico Exemplo ',
  }, today);
  assert.deepEqual(maintenanceChecklistCounts(details), { realizados: 1, naoAplicaveis: 1, pendentes: 27, total: 29 });
  assert.equal(details.checklistCompleto, false);
  assert.equal(details.horimetro, 1250.5);
  assert.equal(details.responsavelNome, 'Técnico Exemplo');
  assert.equal(details.checklistVersao, 1);
  assert.equal(isCompleteMaintenance({ ...details, data: form.data }), false);
});

test('Nenhum serviço vem marcado e testes de carga exigem a confirmação da autorização', () => {
  assert.throws(() => buildMaintenanceDetails(form, today), /ao menos um serviço/);
  assert.throws(() => buildMaintenanceDetails({ ...form, resultados: { [AUTHORIZATION_ITEM_ID]: 'realizado' } }, today), /autorização/);
  assert.doesNotThrow(() => buildMaintenanceDetails({ ...form, resultados: { [AUTHORIZATION_ITEM_ID]: 'realizado' }, autorizacaoContratante: true }, today));
  const onlyNA = Object.fromEntries(GENERATOR_MAINTENANCE_PLANS.mensal.items.map(item => [item.id, 'nao_aplicavel']));
  assert.throws(() => buildMaintenanceDetails({ ...form, resultados: onlyNA }, today), /ao menos um serviço/);
});

test('Não é possível registrar manutenção futura, data inválida ou horímetro negativo', () => {
  const valid = { ...form, periodicidade: 'avulsa', servicoRealizado: 'Troca da mangueira de combustível' };
  for (const data of ['', '2026-02-30', '2026-11-17', 'data-inválida']) {
    assert.throws(() => buildMaintenanceDetails({ ...valid, data }, today));
  }
  for (const horimetro of ['-1', 'Infinity', 'abc']) assert.throws(() => buildMaintenanceDetails({ ...valid, horimetro }, today), /horímetro/);
  assert.throws(() => buildMaintenanceDetails({ ...valid, servicoRealizado: ' ' }, today), /Descreva qual serviço/);
  assert.equal(buildMaintenanceDetails({ ...valid, horimetro: '0' }, today).horimetro, 0);
});

test('A última manutenção usa a data de realização e fica isolada por equipamento', () => {
  const older = completed('mensal', '2026-10-05', { createdAt: '2026-11-16T15:00:00Z' });
  const newer = completed('bimestral', '2026-11-05', { createdAt: '2026-11-05T15:00:00Z' });
  const other = completed('semestral', '2026-11-15', { equipamentoId: 'outro-gerador' });
  const invalid = { ...newer, id: 'invalid', data: 'data-inválida' };
  const records = [older, newer, other, invalid];
  const originalOrder = records.map(record => record.id);
  assert.equal(getLatestMaintenance(records, equipment.id)?.id, newer.id);
  assert.deepEqual(records.map(record => record.id), originalOrder);
  assert.equal(getLatestMaintenance(records, 'sem-historico'), null);
});

test('O último serviço de cada item não é substituído por uma marcação não aplicável', () => {
  const oil = completed('mensal', '2026-10-05');
  const later = { ...completed('mensal', '2026-11-05'), checklist: [
    { id: 'mensal-oleo-lubrificante', descricao: 'Óleo', resultado: 'nao_aplicavel' },
    { id: 'mensal-limpeza-filtro-ar', descricao: 'Filtro de ar', resultado: 'realizado' },
  ] };
  assert.equal(lastMaintenanceForItem([oil, later], 'mensal-oleo-lubrificante').id, oil.id);
  assert.equal(lastMaintenanceForItem([oil, later], 'mensal-limpeza-filtro-ar').id, later.id);
  assert.equal(lastMaintenanceForItem([oil], 'bimestral-treinamento'), null);
});

test('Os prazos usam meses de calendário e execuções parciais não adiam a rotina', () => {
  const monthly = completed('mensal', '2026-08-31');
  const bi = completed('bimestral', '2026-09-16');
  const semi = completed('semestral', '2026-07-31');
  const partial = { ...completed('mensal', '2026-11-15'), checklist: [
    { id: 'mensal-oleo-lubrificante', descricao: 'Óleo', resultado: 'realizado' },
  ] };
  const [monthSchedule, biSchedule, semiSchedule] = getMaintenanceSchedule([monthly, bi, semi, partial], today);
  assert.equal(format(monthSchedule.nextDate, 'yyyy-MM-dd'), '2026-09-30');
  assert.equal(monthSchedule.state, 'atrasada');
  assert.equal(format(biSchedule.nextDate, 'yyyy-MM-dd'), '2026-11-16');
  assert.equal(biSchedule.state, 'hoje');
  assert.equal(format(semiSchedule.nextDate, 'yyyy-MM-dd'), '2027-01-31');
  assert.equal(semiSchedule.state, 'em_dia');
  const leap = { ...monthly, data: '2028-01-31' };
  assert.equal(format(getMaintenanceSchedule([leap], new Date(2028, 0, 31))[0].nextDate, 'yyyy-MM-dd'), '2028-02-29');
});

test('Sem histórico ou com registros antigos avulsos, não são inventados prazos de manutenção', () => {
  const legacy = { id: 'legado', equipamentoId: equipment.id, data: '2026-10-01', tipo: 'Corretiva', observacoes: 'Troca de mangueira', custoTotal: 50 };
  for (const records of [[], [legacy], [completed('semestral', '2026-10-01')]]) {
    const monthly = getMaintenanceSchedule(records, today)[0];
    assert.equal(monthly.state, 'sem_historico');
    assert.equal(monthly.nextDate, null);
  }
  assert.equal(maintenanceDescription(legacy), 'Troca de mangueira');
  assert.equal(isCompleteMaintenance(legacy), false);
});

test('Os avisos renderizados mostram a última realização e não confundem falha de consulta com histórico vazio', () => {
  const record = completed('bimestral', '2026-11-05', { createdAt: '2026-11-13T12:00:00Z' });
  const html = renderToStaticMarkup(createElement(MaintenanceCardSummary, { latest: record }));
  assert.match(html, /Verificação bimestral/);
  assert.match(html, /05\/11\/2026/);
  assert.doesNotMatch(html, /13\/11\/2026/);
  const failure = renderToStaticMarkup(createElement(MaintenanceCardSummary, { error: true }));
  assert.match(failure, /Histórico indisponível/);
  assert.doesNotMatch(failure, /Nenhuma manutenção/);
  const empty = renderToStaticMarkup(createElement(EquipmentMaintenanceOverview, { equipamento: equipment, records: [], onAdd() {} }));
  assert.match(empty, /Ainda não há manutenção registrada/);
  assert.doesNotMatch(empty, /Verificação em atraso/);
});

test('O checklist apresenta os itens, a última realização e a condição de autorização do documento', () => {
  const html = renderToStaticMarkup(createElement(MaintenanceChecklist, {
    periodicidade: 'mensal', resultados: { [AUTHORIZATION_ITEM_ID]: 'realizado' }, onChange() {},
    records: [completed('mensal', '2026-11-05')], autorizado: false, onAuthorizationChange() {},
  }));
  assert.match(html, /Avaliação do ciclo de vida das baterias/);
  assert.match(html, /Inspeção de sensores e amortecedores/);
  assert.match(html, /05\/11\/2026/);
  assert.match(html, /Confirmo que os testes de proteção e alarmes/);
  const history = renderToStaticMarkup(createElement(MaintenanceChecklistHistory, { record: completed('semestral', '2026-11-05') }));
  assert.match(history, /Substituição de óleo lubrificante conforme horas trabalhadas/);
  assert.match(history, /4 realizado/);
});
