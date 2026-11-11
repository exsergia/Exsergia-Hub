import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { resolveFiscalAccounting } from '../src/lib/fiscalAccounting.ts';
import {
  applyFiscalInvoiceSheetLayout,
  buildFiscalInvoiceRows,
  fiscalInvoiceHeaders,
} from '../src/lib/fiscalExcel.ts';

const travelAccount = '3.2.4.15 Despesas Com Viagens, Estadias, Transporte E Alimentação';
const accountingCases = [
  ['abastecimento', 'ABASTECIMENTO', '3.2.4.26 Combustível (Projetos E Obras)'],
  ['estacionamento', 'ESTACIONAMENTO', '3.2.4.25 Estacionamento'],
  ['almoço, café e janta', 'ALIMENTAÇÃO', travelAccount],
  ['MATERIAL PARA PROJETO', 'INSUMO PADRÃO', '3.2.4.10 Compras De Mercadorias Para Obras E Projetos'],
  ['MATERIAL PARA BASE - GERADOR', 'INSUMO PADRÃO', '3.2.4.58 Manutenção E Conservação - Equipamentos'],
  ['MATERIAL PARA BASE - VEÍCULO', 'INSUMO PADRÃO', '3.2.4.64 Outras Despesas Com Veículos'],
  ['MATERIAL PREDIAL', 'INSUMO PADRÃO', '3.2.4.57 Manutenção E Conservação - Predial'],
  ['HOSPEDAGEM', 'HOSPEDAGEM', travelAccount],
  ['COZINHA', 'ALIMENTAÇÃO', '3.2.4.52 Alimentos E Bebidas'],
];

const documents = accountingCases.map(([fornecedor], index) => ({
  id: `TESTE-${index}`,
  tipo: index % 2 ? 'Cupom' : 'NF',
  fornecedor,
  valor: 10 + index,
  data: '2026-11-11T12:00:00Z',
  paymentReference: String(index + 1).padStart(6, '0'),
  obraNome: '1000x26 - Projeto Fictício',
  criadoPorNome: 'Pessoa Exemplo',
  operadoresPresentes: [{ id: 'TESTE', nome: 'Pessoa Exemplo' }],
  observacoes: 'Observação fictícia',
}));

test('As nove categorias seguem os planos de conta informados', () => {
  for (const [expense, productLine, accountPlan] of accountingCases) {
    assert.deepEqual(resolveFiscalAccounting(expense), { productLine, accountPlan }, expense);
  }
});

test('Variações de alimentação e materiais antigos continuam reconhecidas', () => {
  for (const expense of ['Almoço', 'Café', 'Jantar', 'Janta']) {
    assert.deepEqual(resolveFiscalAccounting(expense), {
      productLine: 'ALIMENTAÇÃO',
      accountPlan: travelAccount,
    });
  }
  assert.equal(resolveFiscalAccounting('Material para base – Veículo').accountPlan, accountingCases[5][2]);
  assert.equal(resolveFiscalAccounting('Material para base — Gerador').accountPlan, accountingCases[4][2]);
  assert.equal(resolveFiscalAccounting('Material').accountPlan, accountingCases[3][2]);
});

test('O arquivo XLSX mantém Produto em G, Conta em H e Projeto em I para NF e Cupom', () => {
  const rows = buildFiscalInvoiceRows(documents, []);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: fiscalInvoiceHeaders });
  applyFiscalInvoiceSheetLayout(sheet);

  assert.deepEqual(sheet['!cols'].slice(6, 9), [{ wch: 23 }, { wch: 46 }, { wch: 32 }]);

  // O teste abre o Excel gerado em memória para validar as células do arquivo final.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Fiscal');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const exported = XLSX.read(bytes, { type: 'buffer' }).Sheets.Fiscal;

  assert.equal(exported.G1.v, 'Linhas da Fatura/Produto');
  assert.equal(exported.H1.v, 'Linhas da Fatura/Conta');
  assert.equal(exported.I1.v, 'Projeto');
  assert.equal(exported.J1.v, 'Linhas da Fatura/Quantidade');
  assert.equal(exported.K1.v, 'Linhas da Fatura/Preço Unitário');

  for (let index = 0; index < documents.length; index += 1) {
    const row = index + 2;
    assert.equal(exported[`G${row}`].v, accountingCases[index][1]);
    assert.equal(exported[`H${row}`].v, accountingCases[index][2]);
    assert.equal(exported[`I${row}`].v, documents[index].obraNome);
    assert.equal(exported[`A${row}`].v, documents[index].paymentReference);
    assert.equal(exported[`A${row}`].t, 's');
    assert.equal(exported[`C${row}`].v, '11/11/2026');
    assert.equal(exported[`C${row}`].t, 's');
    assert.equal(exported[`D${row}`].v, '11/11/2026');
    assert.equal(exported[`D${row}`].t, 's');
    assert.equal(exported[`F${row}`].v,
      `1000x26 - ${documents[index].fornecedor} - Pessoa Exemplo - Observação fictícia`);
    assert.equal(exported[`J${row}`].v, 1);
    assert.equal(exported[`K${row}`].v, documents[index].valor);
  }
});
