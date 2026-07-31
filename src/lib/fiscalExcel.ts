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

/**
 * Converte o valor recebido em uma data sem considerar horário.
 *
 * A função retorna somente uma string no formato dd/MM/yyyy.
 * Nenhum objeto Date é enviado para a planilha.
 */
const fiscalDateOnly = (value: unknown): string => {
  const parsedDate = parseDate(value) || new Date();

  return format(
    new Date(
      parsedDate.getFullYear(),
      parsedDate.getMonth(),
      parsedDate.getDate()
    ),
    'dd/MM/yyyy'
  );
};

/**
 * Retorna a data sem barras para ser usada como referência de pagamento.
 *
 * Exemplo:
 * 31/07/2026 → 31072026
 */
const fiscalPaymentReference = (value: unknown): string => {
  const parsedDate = parseDate(value) || new Date();

  return format(
    new Date(
      parsedDate.getFullYear(),
      parsedDate.getMonth(),
      parsedDate.getDate()
    ),
    'ddMMyyyy'
  );
};

const fiscalProduct = (despesa?: string) => {
  const value = normalize(despesa);

  if (['ALMOCO', 'JANTAR', 'JANTA', 'CAFE'].includes(value)) {
    return 'ALIMENTAÇÃO';
  }

  if (value === 'ESTACIONAMENTO') {
    return 'ESTACIONAMENTO';
  }

  if (value === 'HOSPEDAGEM') {
    return 'HOSPEDAGEM';
  }

  if (value === 'MATERIAL') {
    return 'INSUMO PADRÃO';
  }

  return value || 'DESPESA';
};

const firstPartnerName = (doc: FiscalDoc) =>
  doc.criadoPorNome ||
  doc.operadoresPresentes?.find(operador => operador.nome)?.nome ||
  'PARCEIRO NÃO INFORMADO';

export function buildFiscalInvoiceRows(
  fiscalDocs: FiscalDoc[],
  obras: Obra[]
) {
  return fiscalDocs.map(doc => {
    const dateOnly = fiscalDateOnly(doc.data);
    const paymentReference = fiscalPaymentReference(doc.data);

    const partnerName = normalize(firstPartnerName(doc));
    const despesa = normalize(doc.fornecedor);

    const obraNome =
      doc.obraNome ||
      obras.find(obra => obra.id === doc.obraId)?.nome ||
      '';

    const termos = normalize(
      [
        despesa || doc.tipo,
        doc.observacoes,
        obraNome,
      ]
        .filter(Boolean)
        .join(' - ')
    );

    return {
      [fiscalInvoiceHeaders[0]]: paymentReference,
      [fiscalInvoiceHeaders[1]]: partnerName,
      [fiscalInvoiceHeaders[2]]: dateOnly,
      [fiscalInvoiceHeaders[3]]: dateOnly,
      [fiscalInvoiceHeaders[4]]: partnerName,
      [fiscalInvoiceHeaders[5]]: termos || 'SEM DESCRIÇÃO',
      [fiscalInvoiceHeaders[6]]: obraNome || 'SEM PROJETO',
      [fiscalInvoiceHeaders[7]]: fiscalProduct(doc.fornecedor),
      [fiscalInvoiceHeaders[8]]: doc.cartaoFinal
        ? `Cartão final ${doc.cartaoFinal}`
        : 'SEM CONTA',
      [fiscalInvoiceHeaders[9]]: 1,
      [fiscalInvoiceHeaders[10]]: Number(doc.valor || 0),
    };
  });
}

export function applyFiscalInvoiceSheetLayout(sheet: any) {
  sheet['!cols'] = fiscalInvoiceColumnWidths;

  const range = sheet['!ref'];

  if (!range) {
    return;
  }

  /**
   * As colunas C e D são configuradas explicitamente como texto.
   * Isso impede que Excel ou LibreOffice adicionem horário às datas.
   */
  const dateColumns = ['C', 'D'];

  for (const column of dateColumns) {
    for (let row = 2; ; row += 1) {
      const cellReference = `${column}${row}`;
      const cell = sheet[cellReference];

      if (!cell) {
        break;
      }

      const value = String(cell.v ?? cell.w ?? '');

      cell.t = 's';
      cell.v = value;
      cell.z = '@';

      delete cell.w;
    }
  }

  /**
   * A referência de pagamento também é tratada como texto,
   * evitando conversões automáticas do Excel.
   */
  for (let row = 2; ; row += 1) {
    const cell = sheet[`A${row}`];

    if (!cell) {
      break;
    }

    cell.t = 's';
    cell.v = String(cell.v ?? cell.w ?? '');
    cell.z = '@';

    delete cell.w;
  }
}
