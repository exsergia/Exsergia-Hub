export type ObraStatus = 'Ativa' | 'Concluída' | 'Pausada';
export type MaterialStatus = 'Pendente' | 'Conferido' | 'Divergente';

export interface Obra {
  id: string;
  nome: string;
  cliente?: string;
  endereco?: string;
  responsavel?: string;
  centroCusto?: string;
  status: ObraStatus;
  operadoresIds?: string[];
  equipe?: { operatorId: string; nivel: string }[];
  createdAt: any;
}

export interface Material {
  id: string;
  obraId: string;
  codigoEntrega: string;
  descricao: string;
  unidade: string;
  categoria: string;
  fornecedor: string;
  quantidade: number;
  precoUnitario: number;
  valorTotal: number;
  dataEntrega: any;
  observacoes?: string;
  statusConferencia: MaterialStatus;
  photoUrl?: string;
}

export interface Operator {
  id: string;
  nome: string;
  sobrenome?: string;
  funcao?: string;
  email: string;
  telefone?: string;
  cpf?: string;
  role: 'admin' | 'encarregado' | 'operator';
  lgpdAceite?: { versao: string; data: string };
}

export interface Atividade {
  id: string;
  obraId: string;
  descricao: string;
  unidade: string;
  quantidadePrevista: number;
  quantidadeExecutada: number;
  percentual: number;
  valorUnitario?: number;
  equipeResponsavel?: string;
}

export interface Attachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

export interface Tool {
  id: string;
  nome: string;
  codigo?: string;
  modelo?: string;
  categoria?: string;
  valor?: number;
  dataCompra?: string;
  descricao?: string;
  fotoModelo?: string;
  status: 'Disponível' | 'Em Uso' | 'Manutenção';
  lastLogId?: string;
}

export interface ToolLog {
  id: string;
  toolId: string;
  obraId: string;
  responsavelNome: string;
  responsavelId?: string;
  responsavelEmail?: string;
  dataSaida: any;
  dataDevolucao?: any;
  fotoDevolucaoUrl?: string;
  statusLog: 'Aberta' | 'Concluída';
  diasUso?: number;            // tempo de uso estipulado na retirada (em dias)
  previsaoDevolucao?: any;     // data prevista de devolução (ISO) = dataSaida + diasUso
  movementHash?: string;
  activityId?: string;
}

export type VehicleStatus = 'Disponível' | 'Em Uso' | 'Manutenção';

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface Vehicle {
  id: string;
  placa: string;
  modelo: string;
  codigo?: string;        // código interno / QR Code
  status: VehicleStatus;
  fotoVeiculo?: string;   // opcional
  observacoes?: string;
  lastLogId?: string;
}

export interface VehicleLog {
  id: string;
  vehicleId: string;
  responsavelNome: string;
  responsavelId?: string;
  // Retirada
  dataSaida: any;
  fotoPainelSaida?: string;
  localSaida?: GeoPoint | null;
  // Devolução
  dataDevolucao?: any;
  fotoPainelDevolucao?: string;
  localDevolucao?: GeoPoint | null;
  observacaoDevolucao?: string;   // "Sem avarias" ou texto livre
  fotosAvaria?: string[];         // fotos extras de avaria
  statusLog: 'Aberta' | 'Concluída';
  movementHash?: string;
  activityId?: string;
}

export interface Checklist {
  id: string;
  obraId: string;
  operatorId: string;
  data: any;
  nomeResponsavel: string;
  observacoes?: string;
  photoUrl?: string;
  attachments?: Attachment[];
  equipeIds?: string[];
  materiais: { materialId: string; qtdConferida: number }[];
  progresso: { atividadeId: string; qtdExecutadaNoDia: number }[];
}

// ── Frente 1: NF / Cupom Fiscal ────────────────────────────────────────────
export interface FiscalDoc {
  id: string;
  tipo: 'NF' | 'Cupom';
  fotoUrl?: string;           // legado/fallback: URL assinada antiga
  fotoPath?: string;          // caminho privado no Storage
  thumbnailPath?: string;     // miniatura privada no Storage
  fotoSizeBytes?: number;     // tamanho original enviado
  fotoStorageSizeBytes?: number; // tamanho após compressão para Storage
  thumbnailSizeBytes?: number;
  valor: number;
  data: any;                  // data do documento (ISO)
  hora?: string;              // horário informado no lançamento (HH:mm)
  fornecedor?: string;
  cartaoFinal?: string;       // últimos 4 dígitos do cartão usado
  observacoes?: string;       // legado (campo removido do formulário)
  obraId?: string;            // obra vinculada
  obraNome?: string;          // denormalizado para exibição
  operadoresPresentes?: { id: string; nome: string }[]; // quem estava presente
  criadoPorNome?: string;
  criadoPorId?: string;
  aiAnalysis?: FiscalAiAnalysis;
  createdAt: any;
}

export interface FiscalAiAnalysis {
  status: 'aprovado' | 'revisar' | 'reprovado' | 'pendente';
  confidence: number;
  documentType: 'NF' | 'Cupom' | 'Outro' | 'Indefinido';
  extractedValue: number | null;
  extractedDate: string | null;
  vendor: string | null;
  reasons: string[];
  warnings: string[];
  rawTextSummary?: string;
  model?: string;
  analyzedAt: string;
  configured?: boolean;
  error?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost?: {
    amountUsd: number | null;
    inputUsd: number | null;
    outputUsd: number | null;
    source: 'estimated_from_tokens' | 'not_returned_by_openai';
  };
}

// ── Frente 2: Equipamentos (custo e rentabilidade) ─────────────────────────
export type EquipamentoStatus = 'Ativo' | 'Em Manutenção' | 'Locado' | 'Inativo' | 'Vendido';

export interface Equipamento {
  id: string;
  nome: string;
  codigo?: string;
  categoria?: string;
  dataAquisicao?: string;     // date
  valorAquisicao?: number;
  status: EquipamentoStatus;
  fotoUrl?: string;
  observacoes?: string;
  createdAt?: any;
}

export type ManutencaoTipo = 'Preventiva' | 'Corretiva' | 'Preditiva';

export interface CustoItem {
  descricao: string;
  valor: number;
}

export interface EquipamentoManutencao {
  id: string;
  equipamentoId: string;
  data: any;                  // data da manutenção (ISO/date)
  tipo: ManutencaoTipo;
  horasEquipe: number;
  custoHora: number;
  valorMaoObra: number;       // = horasEquipe * custoHora
  pecas: CustoItem[];         // peças e materiais utilizados
  outrosCustos: CustoItem[];  // deslocamento, combustível, terceiros, etc.
  custoTotal: number;         // mão de obra + peças + outros
  observacoes?: string;
  createdAt?: any;
}

export interface EquipamentoLocacao {
  id: string;
  equipamentoId: string;
  cliente: string;
  dataInicio: string;         // date
  dataFim?: string;           // date
  valorLocacao: number;       // receita total da locação
  observacoes?: string;
  createdAt?: any;
}
