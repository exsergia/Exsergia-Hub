import { format } from 'date-fns';
import { FiscalDoc, Obra } from '../types';
import { parseDate } from './dateUtils';

export const fiscalInvoiceHeaders = [
  'Referencia de pagamento ',
  'Nome de Exibição do Parceiro na Fatura',
  'Data da Fatura/Conta',
  'Data de Vencimento',
  'Referência',
  'Termos e Condições',
  'Projeto',
  'Linhas da Fatura/Produto',
  'Linhas da Fatura/Conta',
  'Linhas da Fatura/Quantidade',
  'Linhas da Fatura/Preço Unitário',
];

export const fiscalInvoiceColumnWidths = [
  17,
  36,
  19,
  19,
  19,
  60,
  32,
  23,
  46,
  26,
  28,
].map(wch => ({ wch }));

const normalize = (value?: string) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

const fiscalDate = (value: any) => {
  const parsed = parseDate(value) || new Date();
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const fiscalDateOnly = (value: any) => format(fiscalDate(value), 'dd/MM/yyyy');

const fiscalProduct = (despesa?: string) => {
  const value = normalize(despesa);
  if (['ALMOCO', 'JANTAR', 'JANTA', 'CAFE'].includes(value)) return 'ALIMENTAÇÃO';
  if (value === 'ESTACIONAMENTO') return 'ESTACIONAMENTO';
  if (value === 'HOSPEDAGEM') return 'HOSPEDAGEM';
  if (value === 'MATERIAL') return 'INSUMO PADRÃO';
  return value || 'DESPESA';
};

const firstPartnerName = (doc: FiscalDoc) =>
  doc.criadoPorNome ||
  doc.operadoresPresentes?.find(op => op.nome)?.nome ||
  'PARCEIRO NÃO INFORMADO';

export function buildFiscalInvoiceRows(fiscalDocs: FiscalDoc[], obras: Obra[]) {
  return fiscalDocs.map(doc => {
    const date = fiscalDate(doc.data);
    const dateOnly = fiscalDateOnly(doc.data);
    const partnerName = normalize(firstPartnerName(doc));
    const despesa = normalize(doc.fornecedor);
    const obraNome = doc.obraNome || obras.find(o => o.id === doc.obraId)?.nome || '';
    const termos = normalize([
      despesa || doc.tipo,
      doc.observacoes,
      obraNome,
    ].filter(Boolean).join(' - '));

    return {
      [fiscalInvoiceHeaders[0]]: format(date, 'dMMyyyy'),
      [fiscalInvoiceHeaders[1]]: partnerName,
      [fiscalInvoiceHeaders[2]]: dateOnly,
      [fiscalInvoiceHeaders[3]]: dateOnly,
      [fiscalInvoiceHeaders[4]]: partnerName,
      [fiscalInvoiceHeaders[5]]: termos || 'SEM DESCRIÇÃO',
      [fiscalInvoiceHeaders[6]]: obraNome || 'SEM PROJETO',
      [fiscalInvoiceHeaders[7]]: fiscalProduct(doc.fornecedor),
      [fiscalInvoiceHeaders[8]]: doc.cartaoFinal ? `Cartão final ${doc.cartaoFinal}` : 'SEM CONTA',
      [fiscalInvoiceHeaders[9]]: 1,
      [fiscalInvoiceHeaders[10]]: Number(doc.valor || 0),
    };
  });
}

export function applyFiscalInvoiceSheetLayout(sheet: any) {
  sheet['!cols'] = fiscalInvoiceColumnWidths;
  const range = sheet['!ref'];
  if (!range) return;

  const dateColumns = ['C', 'D'];
  for (const column of dateColumns) {
    for (let row = 2; ; row += 1) {
      const cell = sheet[`${column}${row}`];
      if (!cell) break;
      cell.z = 'dd/mm/yyyy';
    }
  }
}
