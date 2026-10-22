export const FISCAL_MATERIAL_OPTIONS = [
  'Material para projeto',
  'Material para base – Gerador',
  'Material para base – Veículo',
  'Material predial',
] as const;

export const FISCAL_EXPENSE_OPTIONS = [
  'Abastecimento',
  'Estacionamento',
  'Almoço',
  'Café',
  'Jantar',
  'Hospedagem',
  'Cozinha',
  ...FISCAL_MATERIAL_OPTIONS,
  'Outros',
] as const;

export type FiscalAccounting = {
  productLine: string;
  accountPlan: string;
};

const normalizeExpense = (value?: string) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const TRAVEL_ACCOUNT = '3.2.4.15 Despesas Com Viagens, Estadias, Transporte E Alimentação';

const ACCOUNTING_BY_EXPENSE: Record<string, FiscalAccounting> = {
  ABASTECIMENTO: {
    productLine: 'ABASTECIMENTO',
    accountPlan: '3.2.4.26 Combustível (Projetos E Obras)',
  },
  ESTACIONAMENTO: {
    productLine: 'ESTACIONAMENTO',
    accountPlan: '3.2.4.25 Estacionamento',
  },
  ALMOCO: {
    productLine: 'ALIMENTAÇÃO',
    accountPlan: TRAVEL_ACCOUNT,
  },
  CAFE: {
    productLine: 'ALIMENTAÇÃO',
    accountPlan: TRAVEL_ACCOUNT,
  },
  JANTAR: {
    productLine: 'ALIMENTAÇÃO',
    accountPlan: TRAVEL_ACCOUNT,
  },
  JANTA: {
    productLine: 'ALIMENTAÇÃO',
    accountPlan: TRAVEL_ACCOUNT,
  },
  'ALMOCO, CAFE E JANTA': {
    productLine: 'ALIMENTAÇÃO',
    accountPlan: TRAVEL_ACCOUNT,
  },
  'MATERIAL PARA PROJETO': {
    productLine: 'INSUMO PADRÃO',
    accountPlan: '3.2.4.10 Compras De Mercadorias Para Obras E Projetos',
  },
  // Lançamentos antigos usavam apenas "Material". Eles continuam sendo
  // exportados como material de projeto até serem detalhados pelo usuário.
  MATERIAL: {
    productLine: 'INSUMO PADRÃO',
    accountPlan: '3.2.4.10 Compras De Mercadorias Para Obras E Projetos',
  },
  'MATERIAL PARA BASE - GERADOR': {
    productLine: 'INSUMO PADRÃO',
    accountPlan: '3.2.4.58 Manutenção E Conservação - Equipamentos',
  },
  'MATERIAL PARA BASE - VEICULO': {
    productLine: 'INSUMO PADRÃO',
    accountPlan: '3.2.4.64 Outras Despesas Com Veículos',
  },
  'MATERIAL PREDIAL': {
    productLine: 'INSUMO PADRÃO',
    accountPlan: '3.2.4.57 Manutenção E Conservação - Predial',
  },
  HOSPEDAGEM: {
    productLine: 'HOSPEDAGEM',
    accountPlan: TRAVEL_ACCOUNT,
  },
  COZINHA: {
    productLine: 'ALIMENTAÇÃO',
    accountPlan: '3.2.4.52 Alimentos E Bebidas',
  },
};

export function resolveFiscalAccounting(expense?: string): FiscalAccounting {
  const normalizedExpense = normalizeExpense(expense);
  const mapped = ACCOUNTING_BY_EXPENSE[normalizedExpense];

  if (mapped) return mapped;

  return {
    productLine: normalizedExpense || 'DESPESA',
    accountPlan: 'SEM CONTA DEFINIDA',
  };
}
