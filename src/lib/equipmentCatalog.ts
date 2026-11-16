import type { Equipamento, EquipamentoAutonomiaUnidade, EquipamentoPotenciaUnidade } from '../types';

export const EQUIPMENT_CATEGORIES = [
  'Grupo motogerador',
  'Torre de iluminação',
  'Carro utilitário',
  'Carro de passeio',
  'Caminhão',
  'Empilhadeira',
  'Plataforma elevatória',
] as const;

export const EQUIPMENT_POWER_UNITS: EquipamentoPotenciaUnidade[] = ['kVA', 'kW', 'cv', 'HP'];
export const EQUIPMENT_AUTONOMY_UNITS: EquipamentoAutonomiaUnidade[] = ['L/h'];
export const EQUIPMENT_FILTER_FIELDS = [
  { key: 'oleo', label: 'Filtro de óleo' },
  { key: 'combustivel', label: 'Filtro de combustível' },
  { key: 'ar', label: 'Filtro de ar' },
  { key: 'separador', label: 'Filtro separador' },
] as const;

export type EquipmentCatalogInput = {
  nome: string;
  codigo: string;
  tag: string;
  modelo: string;
  categoria: string;
  potencia: string;
  potenciaUnidade: EquipamentoPotenciaUnidade;
  filtros: Record<typeof EQUIPMENT_FILTER_FIELDS[number]['key'], string>;
  capacidadeTanque: string;
  autonomia: string;
  autonomiaUnidade: EquipamentoAutonomiaUnidade;
};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

function optionalPositiveNumber(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} deve ser um número maior que zero ou ficar em branco.`);
  }
  return number;
}

export function buildEquipmentCatalogData(
  input: EquipmentCatalogInput,
  existing: Equipamento[],
  editingId?: string,
) {
  const nome = input.nome.trim();
  const codigo = input.codigo.trim().toUpperCase();
  const categoria = input.categoria.trim();
  const modelo = input.modelo.trim();
  if (!nome) throw new Error('Informe o nome do item de frota.');
  if (!codigo) throw new Error('Informe o código de identificação.');
  if (!modelo) throw new Error('Informe o modelo do equipamento.');
  if (!categoria) throw new Error('Selecione a categoria do equipamento.');

  const original = existing.find(item => item.id === editingId);
  const originalCategory = original?.categoria;
  if (!(EQUIPMENT_CATEGORIES as readonly string[]).includes(categoria) && categoria !== originalCategory) {
    throw new Error('Selecione uma das categorias disponíveis.');
  }
  if (existing.some(item => item.id !== editingId && (item.codigo || '').trim().toUpperCase() === codigo)) {
    throw new Error(`Já existe um equipamento com o código "${codigo}".`);
  }
  const autonomia = optionalPositiveNumber(input.autonomia, 'A autonomia');
  // Preserva medidas anteriores sem convertê-las automaticamente em consumo.
  const keepsLegacyAutonomy = original
    && ['h', 'km'].includes(input.autonomiaUnidade)
    && original.autonomiaUnidade === input.autonomiaUnidade
    && original.autonomia === autonomia;
  if (!EQUIPMENT_POWER_UNITS.includes(input.potenciaUnidade)
    || (!EQUIPMENT_AUTONOMY_UNITS.includes(input.autonomiaUnidade) && !keepsLegacyAutonomy)) {
    throw new Error('Selecione unidades válidas para potência e autonomia (L/h).');
  }

  return {
    nome,
    codigo,
    tag: input.tag.trim().toUpperCase(),
    modelo,
    categoria,
    potencia: optionalPositiveNumber(input.potencia, 'A potência'),
    potenciaUnidade: input.potenciaUnidade,
    filtros: {
      oleo: input.filtros.oleo.trim(),
      combustivel: input.filtros.combustivel.trim(),
      ar: input.filtros.ar.trim(),
      separador: input.filtros.separador.trim(),
    },
    capacidadeTanque: optionalPositiveNumber(input.capacidadeTanque, 'A capacidade do tanque'),
    autonomia,
    autonomiaUnidade: input.autonomiaUnidade,
  };
}

export function filterEquipmentCatalog(items: Equipamento[], search: string, category: string) {
  const term = normalize(search);
  return items.filter(item => {
    if (category !== 'Todas' && item.categoria !== category) return false;
    if (!term) return true;
    return [item.nome, item.codigo, item.tag, item.modelo, item.categoria,
      ...EQUIPMENT_FILTER_FIELDS.map(field => item.filtros?.[field.key])]
      .some(value => normalize(value || '').includes(term));
  });
}

export function formatEquipmentMeasure(value?: number | null, unit?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Não informado';
  const formatted = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);
  return unit ? `${formatted} ${unit}` : `${formatted} (unidade não informada)`;
}
