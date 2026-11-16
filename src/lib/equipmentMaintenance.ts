import { addMonths, format, startOfDay } from 'date-fns';
import type {
  Equipamento, EquipamentoManutencao, ManutencaoChecklistItem, ManutencaoPeriodicidade, ManutencaoResultado,
} from '../types';
import { parseDate } from './dateUtils';

export const MAINTENANCE_PLAN_VERSION = 1;
export const AUTHORIZATION_ITEM_ID = 'mensal-testes-protecao-alarmes';
type PlanItem = { id: string; descricao: string };
type Plan = { label: string; months: number; items: PlanItem[] };

export const GENERATOR_MAINTENANCE_PLANS: Record<Exclude<ManutencaoPeriodicidade, 'avulsa'>, Plan> = {
  mensal: {
    label: 'Verificação mensal', months: 1,
    items: [
      { id: 'mensal-oleo-lubrificante', descricao: 'Verificação do nível de óleo lubrificante' },
      { id: 'mensal-oleo-bomba-injetora', descricao: 'Verificação do nível de óleo da bomba injetora' },
      { id: 'mensal-conservacao-tanques', descricao: 'Avaliação do estado de conservação dos tanques' },
      { id: 'mensal-boias-alarme-combustivel', descricao: 'Verificação da regulagem de boias e sistema de alarme de combustível' },
      { id: 'mensal-vazamentos-tubulacoes', descricao: 'Verificação de vazamentos pelas conexões e tubulações' },
      { id: 'mensal-respiro-tanques', descricao: 'Verificação do respiro dos tanques' },
      { id: 'mensal-entrada-saida-ar', descricao: 'Verificação de obstruções da entrada e saída de ar' },
      { id: 'mensal-nivel-arrefecimento', descricao: 'Verificação do nível do líquido de arrefecimento' },
      { id: 'mensal-vazamentos-combustivel', descricao: 'Verificação de vazamentos nas conexões de combustível' },
      { id: 'mensal-torque-baterias', descricao: 'Verificação do torque dos terminais das baterias' },
      { id: 'mensal-pre-aquecimento', descricao: 'Verificação do funcionamento do sistema de pré-aquecimento' },
      { id: 'mensal-limpeza-filtro-ar', descricao: 'Limpeza do filtro de ar' },
      { id: 'mensal-mangotes-reapertos', descricao: 'Verificação dos mangotes e reapertos' },
      { id: 'mensal-alternador', descricao: 'Verificação do alternador (análise visual)' },
      { id: 'mensal-carcaca', descricao: 'Verificação da carcaça do gerador' },
      { id: 'mensal-limpeza-tecnica', descricao: 'Limpeza técnica do equipamento com aplicação de produtos adequados' },
      { id: 'mensal-funcionamento-geral', descricao: 'Verificação do funcionamento geral' },
      { id: 'mensal-carregador-baterias', descricao: 'Verificação do carregador de baterias' },
      { id: 'mensal-parametros-baterias', descricao: 'Verificação de parâmetros das baterias' },
      { id: AUTHORIZATION_ITEM_ID, descricao: 'Testes operacionais de proteção e alarmes (sem carga e com carga, mediante autorização da CONTRATANTE)' },
      { id: 'mensal-ruidos', descricao: 'Verificação de ruídos' },
      { id: 'mensal-combustivel-escapamento', descricao: 'Inspeção do sistema de combustível e escapamento' },
      { id: 'mensal-conexoes-forca', descricao: 'Verificação das conexões de força' },
      { id: 'mensal-turbina-fixacoes', descricao: 'Inspeção de turbina e fixações' },
      { id: 'mensal-drenagem-tanque', descricao: 'Drenagem de impurezas do tanque' },
      { id: 'mensal-sistema-arrefecimento', descricao: 'Verificação do sistema de arrefecimento' },
      { id: 'mensal-inspecao-sensor', descricao: 'Verificação e inspeção de sensor' },
      { id: 'mensal-ciclo-baterias', descricao: 'Avaliação do ciclo de vida das baterias' },
      { id: 'mensal-sensores-amortecedores', descricao: 'Inspeção de sensores e amortecedores' },
    ],
  },
  bimestral: {
    label: 'Verificação bimestral', months: 2,
    items: [
      { id: 'bimestral-coletor-escape', descricao: 'Reaperto do coletor de escape' },
      { id: 'bimestral-correias', descricao: 'Verificação de correias' },
      { id: 'bimestral-terminais-eletricos', descricao: 'Reaperto de terminais elétricos' },
      { id: 'bimestral-luva-acoplamento', descricao: 'Inspeção da luva de acoplamento' },
      { id: 'bimestral-filtro-separador', descricao: 'Drenagem de filtro separador de água' },
      { id: 'bimestral-treinamento', descricao: 'Treinamento operacional' },
    ],
  },
  semestral: {
    label: 'Verificação semestral', months: 6,
    items: [
      { id: 'semestral-comandos-controle', descricao: 'Verificação de comandos e sistema de controle' },
      { id: 'semestral-oleo-lubrificante', descricao: 'Verificação de óleo lubrificante' },
      { id: 'semestral-troca-oleo', descricao: 'Substituição de óleo lubrificante conforme horas trabalhadas' },
      { id: 'semestral-troca-filtros', descricao: 'Substituição de filtros conforme periodicidade' },
    ],
  },
};

export const MAINTENANCE_PERIODS = Object.keys(GENERATOR_MAINTENANCE_PLANS) as Array<Exclude<ManutencaoPeriodicidade, 'avulsa'>>;

export function isGeneratorEquipment(equipment: Equipamento) {
  return /gerador/i.test(`${equipment.categoria || ''} ${equipment.nome}`) || /^GMG\b/i.test(equipment.tag || '');
}

export function maintenanceLabel(record: Pick<EquipamentoManutencao, 'periodicidade' | 'tipo'>) {
  return record.periodicidade && record.periodicidade !== 'avulsa'
    ? GENERATOR_MAINTENANCE_PLANS[record.periodicidade]?.label || `Manutenção ${record.tipo}`
    : `Manutenção ${record.tipo}`;
}

export function getMaintenanceDate(record: Pick<EquipamentoManutencao, 'data'>) {
  const date = parseDate(record.data);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function getLatestMaintenance(records: EquipamentoManutencao[], equipmentId?: string) {
  return records.filter(record => (!equipmentId || record.equipamentoId === equipmentId) && getMaintenanceDate(record))
    .sort((a, b) => getMaintenanceDate(b)!.getTime() - getMaintenanceDate(a)!.getTime()
      || (parseDate(b.createdAt)?.getTime() || 0) - (parseDate(a.createdAt)?.getTime() || 0))[0] || null;
}

export function maintenanceChecklistCounts(record: Pick<EquipamentoManutencao, 'checklist'>) {
  const items = Array.isArray(record.checklist) ? record.checklist : [];
  return {
    realizados: items.filter(item => item.resultado === 'realizado').length,
    naoAplicaveis: items.filter(item => item.resultado === 'nao_aplicavel').length,
    pendentes: items.filter(item => item.resultado !== 'realizado' && item.resultado !== 'nao_aplicavel').length,
    total: items.length,
  };
}

export function maintenanceDescription(record: EquipamentoManutencao) {
  if (record.servicoRealizado?.trim()) return record.servicoRealizado;
  const performed = (record.checklist || []).filter(item => item.resultado === 'realizado');
  if (performed.length) return `${performed.slice(0, 2).map(item => item.descricao).join('; ')}${performed.length > 2 ? `; +${performed.length - 2} serviço(s)` : ''}`;
  return record.observacoes?.trim() || 'Serviços não detalhados no registro anterior.';
}

export function lastMaintenanceForItem(records: EquipamentoManutencao[], itemId: string) {
  return getLatestMaintenance(records.filter(record => record.checklist?.some(item => item.id === itemId && item.resultado === 'realizado')));
}

export function isCompleteMaintenance(record: EquipamentoManutencao) {
  const period = record.periodicidade;
  if (!period || period === 'avulsa') return false;
  const plan = GENERATOR_MAINTENANCE_PLANS[period];
  if (!plan) return false;
  return plan.items.every(expected => record.checklist?.some(item => item.id === expected.id
    && (item.resultado === 'realizado' || item.resultado === 'nao_aplicavel')))
    && maintenanceChecklistCounts(record).realizados > 0
    && (!record.checklist?.some(item => item.id === AUTHORIZATION_ITEM_ID && item.resultado === 'realizado') || record.autorizacaoContratante === true);
}

export function getMaintenanceSchedule(records: EquipamentoManutencao[], today = new Date()) {
  const day = startOfDay(today).getTime();
  return MAINTENANCE_PERIODS.map(period => {
    const last = getLatestMaintenance(records.filter(record => record.periodicidade === period && isCompleteMaintenance(record)));
    const lastDate = last ? getMaintenanceDate(last) : null;
    const nextDate = lastDate ? addMonths(lastDate, GENERATOR_MAINTENANCE_PLANS[period].months) : null;
    const nextDay = nextDate ? startOfDay(nextDate).getTime() : null;
    const state = nextDay === null ? 'sem_historico' : nextDay < day ? 'atrasada' : nextDay === day ? 'hoje' : 'em_dia';
    return { period, label: GENERATOR_MAINTENANCE_PLANS[period].label, last, lastDate, nextDate, state };
  });
}

export function buildMaintenanceDetails(input: {
  data: string;
  periodicidade: ManutencaoPeriodicidade;
  resultados: Record<string, ManutencaoResultado>;
  servicoRealizado: string;
  horimetro: string;
  responsavelNome: string;
  autorizacaoContratante: boolean;
}, today = new Date()) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.data) ? parseDate(input.data) : null;
  if (!date || format(date, 'yyyy-MM-dd') !== input.data) throw new Error('Informe uma data válida para a manutenção.');
  if (input.data > format(today, 'yyyy-MM-dd')) throw new Error('A manutenção realizada não pode ter uma data futura.');
  const period = input.periodicidade;
  if (period !== 'avulsa' && !MAINTENANCE_PERIODS.includes(period)) throw new Error('Selecione uma periodicidade válida.');
  const checklist: ManutencaoChecklistItem[] = period === 'avulsa' ? [] : GENERATOR_MAINTENANCE_PLANS[period].items.map(item => {
    const resultado = input.resultados[item.id] || 'pendente';
    if (!['realizado', 'nao_aplicavel', 'pendente'].includes(resultado)) throw new Error('Selecione um resultado válido para os serviços.');
    return { ...item, resultado };
  });
  const performed = checklist.filter(item => item.resultado === 'realizado');
  if (period !== 'avulsa' && !performed.length) throw new Error('Marque ao menos um serviço que foi realmente realizado.');
  if (period === 'avulsa' && !input.servicoRealizado.trim()) throw new Error('Descreva qual serviço de manutenção foi realizado.');
  if (performed.some(item => item.id === AUTHORIZATION_ITEM_ID) && !input.autorizacaoContratante) {
    throw new Error('Confirme a autorização da contratante para registrar os testes de proteção e alarmes.');
  }
  const horimetro = input.horimetro.trim() ? Number(input.horimetro.trim().replace(',', '.')) : null;
  if (horimetro !== null && (!Number.isFinite(horimetro) || horimetro < 0)) throw new Error('Informe uma leitura válida do horímetro.');
  return {
    periodicidade: period,
    servicoRealizado: input.servicoRealizado.trim(),
    checklist,
    checklistVersao: MAINTENANCE_PLAN_VERSION,
    checklistCompleto: checklist.length > 0 && checklist.every(item => item.resultado !== 'pendente'),
    autorizacaoContratante: input.autorizacaoContratante,
    horimetro,
    responsavelNome: input.responsavelNome.trim(),
  };
}
