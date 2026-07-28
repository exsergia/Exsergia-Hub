import React, { useEffect, useState } from 'react';
import { usePersistedTab } from '../hooks/usePersistedTab';
import { useCollection } from '../lib/supabaseHooks';
import { collection, query, orderBy, addDoc, serverTimestamp, updateDoc, doc, arrayUnion, arrayRemove } from '../lib/supabaseDb';
import { db, handleFirestoreError, OperationType } from '../lib/supabase';
import { getFiscalPhotoUrl } from '../lib/services';
import { Attachment, Checklist, Obra, Material, Atividade, Operator, Tool, ToolLog, Vehicle, VehicleLog, FiscalDoc } from '../types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts';
import {
  FileText,
  Calendar,
  User,
  Search,
  ChevronRight,
  ExternalLink,
  Users,
  Box,
  Activity,
  Image as ImageIcon,
  Copy,
  Plus,
  FileDown,
  Paperclip,
  X as XIcon,
  Trash2,
  Hammer,
  Truck,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  MapPin,
  Receipt,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { uploadFile } from '../lib/services';
import { utils, read, writeFile } from 'xlsx';
import { useAuth } from '../App';
import { formatGeo, mapsUrl } from '../lib/geo';

import { parseDateSafe as parseDate } from '../lib/dateUtils';

type RelatorioTab = 'diarios' | 'ferramentas' | 'frota' | 'fiscal' | 'bi';

function getToolUsagePlan(log: ToolLog) {
  const diasUso = Number(log.diasUso || 0);
  const saida = parseDate(log.dataSaida);
  const previsao = log.previsaoDevolucao ? parseDate(log.previsaoDevolucao) : null;

  if (diasUso > 0) {
    return {
      text: diasUso === 1 ? '1 dia' : `${diasUso} dias`,
      previsao,
    };
  }

  if (previsao && saida) {
    const diffMs = previsao.getTime() - saida.getTime();
    const diffDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    return {
      text: diffDays === 1 ? '1 dia' : `${diffDays} dias`,
      previsao,
    };
  }

  return {
    text: 'Não informado',
    previsao,
  };
}

const formatBytes = (bytes?: number) => {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(value / 1024)} KB`;
};

export default function Relatorios() {
  const { isAdmin, notify } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = usePersistedTab<RelatorioTab>('tab-relatorios', 'diarios');

  const [checklistsSnap, loading, checklistsError] = useCollection(
    query(collection(db, 'checklists'), orderBy('data', 'desc'))
  );
  const [obrasSnap, , obrasError] = useCollection(collection(db, 'obras'));
  const [materiaisSnap, , materiaisError] = useCollection(collection(db, 'materiais'));
  const [atividadesSnap, , atividadesError] = useCollection(collection(db, 'atividades'));
  const [operadoresSnap, , operadoresError] = useCollection(collection(db, 'operadores'));
  const [toolsSnap, , toolsError] = useCollection(collection(db, 'tools'));
  const [toolLogsSnap, loadingLogs, toolLogsError] = useCollection(
    query(collection(db, 'toolLogs'), orderBy('dataSaida', 'desc'))
  );
  const [vehiclesSnap, , vehiclesError] = useCollection(query(collection(db, 'vehicles'), orderBy('placa', 'asc')));
  const [vehicleLogsSnap, loadingVehicleLogs, vehicleLogsError] = useCollection(
    query(collection(db, 'vehicleLogs'), orderBy('dataSaida', 'desc'))
  );
  const [progressoDiarioSnap, , progressoDiarioError] = useCollection(collection(db, 'progresso_diario'));
  const [fiscalSnap, , fiscalError] = useCollection(query(collection(db, 'fiscal_docs'), orderBy('data', 'desc')));

  const [search, setSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [toolCategoryFilter, setToolCategoryFilter] = useState('Todas');
  const [toolStatusFilter, setToolStatusFilter] = useState('Todos');
  const [toolLocationFilter, setToolLocationFilter] = useState('Todos');
  const [toolMovementStatusFilter, setToolMovementStatusFilter] = useState('Todos');
  const [selectedChecklist, setSelectedChecklist] = useState<Checklist | null>(null);

  const checklists = (checklistsSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Checklist[]) || [];
  const obras = (obrasSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Obra[]) || [];
  const materiais = (materiaisSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]) || [];
  const atividades = (atividadesSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Atividade[]) || [];
  const operadores = (operadoresSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Operator[]) || [];
  const tools = (toolsSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Tool[]) || [];
  const toolLogs = (toolLogsSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ToolLog[]) || [];
  const vehicles = (vehiclesSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Vehicle[]) || [];
  const vehicleLogs = (vehicleLogsSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as VehicleLog[]) || [];
  const progressoDiario = (progressoDiarioSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() }))) || [];
  const fiscalDocs = (fiscalSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as FiscalDoc[]) || [];
  const loadError = checklistsError || obrasError || materiaisError || atividadesError || operadoresError || toolsError || toolLogsError || vehiclesError || vehicleLogsError || progressoDiarioError || fiscalError;
  const [fiscalThumbUrls, setFiscalThumbUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const docsWithPrivateImages = fiscalDocs.filter(f => f.thumbnailPath || f.fotoPath);
    if (docsWithPrivateImages.length === 0) {
      setFiscalThumbUrls({});
      return;
    }

    Promise.all(docsWithPrivateImages.map(async f => {
      try {
        const url = await getFiscalPhotoUrl(f.thumbnailPath || f.fotoPath);
        return [f.id, url] as const;
      } catch {
        return [f.id, ''] as const;
      }
    })).then(entries => {
      if (!cancelled) setFiscalThumbUrls(Object.fromEntries(entries.filter(([, url]) => url)));
    });

    return () => {
      cancelled = true;
    };
  }, [fiscalSnap]);

  const openFiscalImage = async (fiscalDoc: FiscalDoc) => {
    const url = fiscalDoc.fotoPath ? await getFiscalPhotoUrl(fiscalDoc.fotoPath) : fiscalDoc.fotoUrl || '';
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const toolCategoryOptions = Array.from(
    new Set(tools.map(t => (t.categoria || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const getOpenToolLog = (tool: Tool) => (
    toolLogs.find(l => (l.id === tool.lastLogId || l.toolId === tool.id) && l.statusLog === 'Aberta')
  );

  const toolMatchesLocation = (tool: Tool) => {
    if (toolLocationFilter === 'Todos') return true;
    const openLog = getOpenToolLog(tool);
    if (toolLocationFilter === 'Estoque') return !openLog && tool.status === 'Disponível';
    if (toolLocationFilter === 'Manutenção') return tool.status === 'Manutenção';
    if (toolLocationFilter.startsWith('obra:')) return openLog?.obraId === toolLocationFilter.slice(5);
    return true;
  };

  const logMatchesLocation = (log: ToolLog) => {
    if (toolLocationFilter === 'Todos') return true;
    if (toolLocationFilter === 'Estoque') return false;
    if (toolLocationFilter === 'Manutenção') return false;
    if (toolLocationFilter.startsWith('obra:')) return log.obraId === toolLocationFilter.slice(5);
    return true;
  };

  const filteredTools = tools.filter(t => {
    const q = search.trim().toLowerCase();
    if (toolCategoryFilter !== 'Todas' && (t.categoria || '') !== toolCategoryFilter) return false;
    if (toolStatusFilter !== 'Todos' && (t.status || '') !== toolStatusFilter) return false;
    if (!toolMatchesLocation(t)) return false;
    if (!q) return true;
    const openLog = getOpenToolLog(t);
    const obra = openLog ? obras.find(o => o.id === openLog.obraId) : null;
    return (
      (t.nome || '').toLowerCase().includes(q) ||
      (t.codigo || '').toLowerCase().includes(q) ||
      (t.modelo || '').toLowerCase().includes(q) ||
      (t.categoria || '').toLowerCase().includes(q) ||
      (t.status || '').toLowerCase().includes(q) ||
      (t.descricao || '').toLowerCase().includes(q) ||
      (obra?.nome || '').toLowerCase().includes(q) ||
      (obra?.cliente || '').toLowerCase().includes(q) ||
      (openLog?.responsavelNome || '').toLowerCase().includes(q)
    );
  });

  const filteredToolLogs = toolLogs.filter(l => {
    const tool = tools.find(t => t.id === l.toolId);
    if (toolCategoryFilter !== 'Todas' && (tool?.categoria || '') !== toolCategoryFilter) return false;
    if (toolStatusFilter !== 'Todos' && (tool?.status || '') !== toolStatusFilter) return false;
    if (toolMovementStatusFilter !== 'Todos' && l.statusLog !== toolMovementStatusFilter) return false;
    if (!logMatchesLocation(l)) return false;
    if (search) {
      const q = search.toLowerCase();
      const obra = obras.find(o => o.id === l.obraId);
      if (!(
        (tool?.nome || '').toLowerCase().includes(q) ||
        (tool?.codigo || '').toLowerCase().includes(q) ||
        (tool?.modelo || '').toLowerCase().includes(q) ||
        (tool?.categoria || '').toLowerCase().includes(q) ||
        (obra?.nome || '').toLowerCase().includes(q) ||
        (obra?.cliente || '').toLowerCase().includes(q) ||
        (l.responsavelNome || '').toLowerCase().includes(q)
      )) return false;
    }
    if (selectedDate) {
      const d = parseDate(l.dataSaida);
      if (format(d, 'yyyy-MM-dd') !== selectedDate) return false;
    }
    return true;
  });

  const filteredVehicles = vehicles.filter(v => {
    if (!search) return true;
    const q = search.toLowerCase();
    const activeLog = vehicleLogs.find(l => (l.id === v.lastLogId || l.vehicleId === v.id) && l.statusLog === 'Aberta');
    return (
      (v.placa || '').toLowerCase().includes(q) ||
      (v.codigo || '').toLowerCase().includes(q) ||
      (v.modelo || '').toLowerCase().includes(q) ||
      (v.status || '').toLowerCase().includes(q) ||
      (v.observacoes || '').toLowerCase().includes(q) ||
      (activeLog?.responsavelNome || '').toLowerCase().includes(q)
    );
  });

  const filteredVehicleLogs = vehicleLogs.filter(l => {
    if (search) {
      const q = search.toLowerCase();
      const vehicle = vehicles.find(v => v.id === l.vehicleId);
      if (!(
        (vehicle?.placa || '').toLowerCase().includes(q) ||
        (vehicle?.codigo || '').toLowerCase().includes(q) ||
        (vehicle?.modelo || '').toLowerCase().includes(q) ||
        (l.responsavelNome || '').toLowerCase().includes(q) ||
        (l.observacaoDevolucao || '').toLowerCase().includes(q)
      )) return false;
    }
    if (selectedDate) {
      const d = parseDate(l.dataSaida);
      if (format(d, 'yyyy-MM-dd') !== selectedDate) return false;
    }
    return true;
  });

  const filteredFiscal = fiscalDocs.filter(f => {
    if (search) {
      const q = search.toLowerCase();
      if (!(
        (f.fornecedor || '').toLowerCase().includes(q) ||
        (f.cartaoFinal || '').toLowerCase().includes(q) ||
        (f.tipo || '').toLowerCase().includes(q) ||
        (f.obraNome || '').toLowerCase().includes(q) ||
        (f.criadoPorNome || '').toLowerCase().includes(q) ||
        (f.operadoresPresentes || []).some(o => (o.nome || '').toLowerCase().includes(q))
      )) return false;
    }
    if (selectedDate) {
      const d = parseDate(f.data);
      if (format(d, 'yyyy-MM-dd') !== selectedDate) return false;
    }
    return true;
  });

  const totalFiscal = filteredFiscal.reduce((acc, f) => acc + (f.valor || 0), 0);

  const handleExportFiscal = () => {
    const wb = utils.book_new();
    const data = filteredFiscal.map(f => ({
      'Tipo': f.tipo === 'NF' ? 'Nota Fiscal' : 'Cupom Fiscal',
      'Data': f.data ? parseDate(f.data).toLocaleDateString('pt-BR') : '---',
      'Valor (R$)': typeof f.valor === 'number' ? f.valor.toFixed(2).replace('.', ',') : '---',
      'Fornecedor': f.fornecedor || '---',
      'Cartão (final)': f.cartaoFinal || '---',
      'Obra': f.obraNome || '---',
      'Presentes': (f.operadoresPresentes || []).map(o => o.nome).join(', ') || '---',
      'Lançado por': f.criadoPorNome || '---',
      'Documento (foto)': f.fotoPath || f.fotoUrl || '---',
      'Tamanho original': f.fotoSizeBytes || 0,
      'Tamanho armazenado': f.fotoStorageSizeBytes || 0,
      'Tamanho miniatura': f.thumbnailSizeBytes || 0,
    }));
    const ws = utils.json_to_sheet(data);
    utils.book_append_sheet(wb, ws, 'NF e Cupons');
    writeFile(wb, `relatorio-fiscal-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const handleExportInventario = () => {
    if (filteredTools.length === 0) {
      notify('warning', 'Sem dados para exportar', 'Nenhuma ferramenta corresponde aos filtros selecionados.');
      return;
    }
    const wb = utils.book_new();
    const data = filteredTools.map(t => {
      const openLog = toolLogs.find(l => l.toolId === t.id && l.statusLog === 'Aberta');
      let localizacao = 'Em estoque';
      if (openLog) {
        const obraNome = obras.find(o => o.id === openLog.obraId)?.nome || 'Obra não identificada';
        const ativNome = openLog.activityId ? atividades.find(a => a.id === openLog.activityId)?.descricao : '';
        localizacao = ativNome ? `${obraNome} — ${ativNome}` : obraNome;
      } else if (t.status === 'Manutenção') {
        localizacao = 'Em manutenção';
      }
      return {
        'Nome': t.nome || '---',
        'Código': t.codigo || '---',
        'Modelo': t.modelo || '---',
        'Descrição': t.descricao || '---',
        'Valor (R$)': typeof t.valor === 'number' ? t.valor.toFixed(2).replace('.', ',') : '---',
        'Data de Compra': t.dataCompra ? new Date(`${t.dataCompra}T00:00:00`).toLocaleDateString('pt-BR') : '---',
        'Status': t.status || '---',
        'Localização Atual': localizacao,
        'Foto de Referência': t.fotoModelo || '---',
      };
    });
    const ws = utils.json_to_sheet(data);
    const colWidths = [30, 15, 20, 40, 15, 16, 12, 45, 50];
    ws['!cols'] = colWidths.map(w => ({ wch: w }));
    utils.book_append_sheet(wb, ws, 'INVENTARIO_FERRAMENTAS');
    writeFile(wb, `Inventario_Ferramentas_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    notify('success', 'Excel Exportado', 'Inventário de ferramentas gerado com sucesso!');
  };

  const handleExportFerramentas = () => {
    if (filteredToolLogs.length === 0) {
      notify('warning', 'Sem dados para exportar', 'Nenhuma movimentacao corresponde aos filtros selecionados.');
      return;
    }
    const wb = utils.book_new();
    const data = filteredToolLogs.map(l => {
      const tool = tools.find(t => t.id === l.toolId);
      const obra = obras.find(o => o.id === l.obraId);
      const saida = parseDate(l.dataSaida);
      const devolucao = l.dataDevolucao ? parseDate(l.dataDevolucao) : null;
      const usoPrevisto = getToolUsagePlan(l);
      return {
        'ID Retirada': l.id,
        'ID Ferramenta': l.toolId,
        'Ferramenta': tool?.nome || '---',
        'Código': tool?.codigo || '---',
        'Responsável': l.responsavelNome,
        'Obra': obra?.nome || '---',
        'Data Saída': format(saida, 'dd/MM/yyyy'),
        'Hora Saída': format(saida, 'HH:mm:ss'),
        'Tempo Previsto de Uso': usoPrevisto.text,
        'Previsao Devolucao': usoPrevisto.previsao ? format(usoPrevisto.previsao, 'dd/MM/yyyy HH:mm:ss') : '---',
        'Data Devolução': devolucao ? format(devolucao, 'dd/MM/yyyy') : '---',
        'Hora Devolução': devolucao ? format(devolucao, 'HH:mm:ss') : '---',
        'Status': l.statusLog,
        'Foto Devolução': l.fotoDevolucaoUrl || '---'
      };
    });
    const ws = utils.json_to_sheet(data);
    utils.book_append_sheet(wb, ws, 'MOVIMENTACAO_FERRAMENTAS');
    writeFile(wb, `Ferramentas_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    notify('success', 'Excel Exportado', 'Histórico completo de movimentação gerado com sucesso!');
  };

  const handleExportInventarioFrota = () => {
    const wb = utils.book_new();
    const data = vehicles.map(v => {
      const openLog = vehicleLogs.find(l => (l.id === v.lastLogId || l.vehicleId === v.id) && l.statusLog === 'Aberta');
      const saida = openLog ? parseDate(openLog.dataSaida) : null;
      return {
        'Placa': v.placa || '---',
        'Código': v.codigo || '---',
        'Modelo': v.modelo || '---',
        'Status': v.status || '---',
        'Responsável Atual': openLog?.responsavelNome || '---',
        'Retirado em': saida ? format(saida, 'dd/MM/yyyy HH:mm:ss') : '---',
        'Local Retirada': formatGeo(openLog?.localSaida) || '---',
        'Observações': v.observacoes || '---',
        'Foto do Veículo': v.fotoVeiculo || '---',
      };
    });
    const ws = utils.json_to_sheet(data);
    ws['!cols'] = [14, 18, 28, 14, 28, 20, 22, 42, 50].map(w => ({ wch: w }));
    utils.book_append_sheet(wb, ws, 'INVENTARIO_FROTA');
    writeFile(wb, `Inventario_Frota_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    notify('success', 'Excel Exportado', 'Inventário da frota gerado com sucesso!');
  };

  const handleExportFrota = () => {
    const wb = utils.book_new();
    const data = vehicleLogs.map(l => {
      const vehicle = vehicles.find(v => v.id === l.vehicleId);
      const saida = parseDate(l.dataSaida);
      const devolucao = l.dataDevolucao ? parseDate(l.dataDevolucao) : null;
      return {
        'ID Movimentação': l.id,
        'ID Veículo': l.vehicleId,
        'Placa': vehicle?.placa || 'Veículo removido',
        'Código': vehicle?.codigo || '---',
        'Modelo': vehicle?.modelo || '---',
        'Responsável': l.responsavelNome || '---',
        'Data Saída': format(saida, 'dd/MM/yyyy'),
        'Hora Saída': format(saida, 'HH:mm:ss'),
        'Local Saída': formatGeo(l.localSaida) || '---',
        'Foto Painel Saída': l.fotoPainelSaida || '---',
        'Data Devolução': devolucao ? format(devolucao, 'dd/MM/yyyy') : '---',
        'Hora Devolução': devolucao ? format(devolucao, 'HH:mm:ss') : '---',
        'Local Devolução': formatGeo(l.localDevolucao) || '---',
        'Foto Painel Devolução': l.fotoPainelDevolucao || '---',
        'Observação Devolução': l.observacaoDevolucao || '---',
        'Fotos Avaria': (l.fotosAvaria || []).join(' | ') || '---',
        'Status': l.statusLog,
      };
    });
    const ws = utils.json_to_sheet(data);
    utils.book_append_sheet(wb, ws, 'MOVIMENTACAO_FROTA');
    writeFile(wb, `Frota_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    notify('success', 'Excel Exportado', 'Histórico completo da frota gerado com sucesso!');
  };

  const filteredChecklists = checklists.filter(c => {
    if (search) {
      const q = search.toLowerCase();
      const obra = obras.find(o => o.id === c.obraId);
      if (!(
        (obra?.nome || '').toLowerCase().includes(q) ||
        (c.nomeResponsavel || '').toLowerCase().includes(q)
      )) return false;
    }
    if (selectedDate) {
      const d = parseDate(c.data);
      if (format(d, 'yyyy-MM-dd') !== selectedDate) return false;
    }
    return true;
  });

  useEffect(() => {
    if (activeTab !== 'diarios' || selectedChecklist || filteredChecklists.length === 0) return;

    let checklistId = '';
    try {
      checklistId = sessionStorage.getItem('relatorio-checklist-id') || '';
      if (checklistId) sessionStorage.removeItem('relatorio-checklist-id');
    } catch {
      checklistId = '';
    }

    if (!checklistId) return;
    const checklist = filteredChecklists.find(c => c.id === checklistId) || checklists.find(c => c.id === checklistId);
    if (checklist) setSelectedChecklist(checklist);
  }, [activeTab, checklists, filteredChecklists, selectedChecklist]);

  const handleExportBI = () => {
    const workbook = utils.book_new();

    // 1. Raw Data Table (Checklists)
    const rawData = checklists.map(c => {
      const obra = obras.find(o => o.id === c.obraId);
      const date = parseDate(c.data);
      return {
        ID: c.id,
        Obra: obra?.nome || 'N/A',
        Data: format(date, 'yyyy-MM-dd'),
        Hora: format(date, 'HH:mm'),
        Responsavel: c.nomeResponsavel,
        Observacoes: c.observacoes || '',
        QtdMateriais: c.materiais.length,
        QtdProgresso: c.progresso.length,
        QtdEquipe: c.equipeIds?.length || 0
      };
    });

    // 2. Exploded Materials Table (for many-to-many analysis)
    const materialsData: any[] = [];
    checklists.forEach(c => {
      const obra = obras.find(o => o.id === c.obraId);
      const date = parseDate(c.data);
      c.materiais.forEach(mItem => {
        const mat = materiais.find(m => m.id === mItem.materialId);
        materialsData.push({
          RelatorioID: c.id,
          Data: format(date, 'yyyy-MM-dd'),
          Obra: obra?.nome || 'N/A',
          Material: mat?.descricao || 'N/A',
          Quantidade: mItem.qtdConferida,
          Unidade: mat?.unidade || ''
        });
      });
    });

    // 3. Exploded Progress Table
    const progressData: any[] = [];
    checklists.forEach(c => {
      const obra = obras.find(o => o.id === c.obraId);
      const date = parseDate(c.data);
      c.progresso.forEach(pItem => {
        const ativ = atividades.find(a => a.id === pItem.atividadeId);
        progressData.push({
          RelatorioID: c.id,
          Data: format(date, 'yyyy-MM-dd'),
          Obra: obra?.nome || 'N/A',
          Atividade: ativ?.descricao || 'N/A',
          QuantidadeExecutada: pItem.qtdExecutadaNoDia,
          Unidade: ativ?.unidade || ''
        });
      });
    });

    const vehiclesData = vehicles.map(v => {
      const openLog = vehicleLogs.find(l => (l.id === v.lastLogId || l.vehicleId === v.id) && l.statusLog === 'Aberta');
      return {
        ID: v.id,
        Placa: v.placa || '',
        Codigo: v.codigo || '',
        Modelo: v.modelo || '',
        Status: v.status || '',
        ResponsavelAtual: openLog?.responsavelNome || '',
        Observacoes: v.observacoes || '',
        FotoVeiculo: v.fotoVeiculo || ''
      };
    });

    const vehicleLogsData = vehicleLogs.map(l => {
      const vehicle = vehicles.find(v => v.id === l.vehicleId);
      const saida = parseDate(l.dataSaida);
      const devolucao = l.dataDevolucao ? parseDate(l.dataDevolucao) : null;
      return {
        ID: l.id,
        VehicleID: l.vehicleId,
        Placa: vehicle?.placa || '',
        Modelo: vehicle?.modelo || '',
        Responsavel: l.responsavelNome || '',
        DataSaida: format(saida, 'yyyy-MM-dd'),
        HoraSaida: format(saida, 'HH:mm'),
        LocalSaida: formatGeo(l.localSaida) || '',
        DataDevolucao: devolucao ? format(devolucao, 'yyyy-MM-dd') : '',
        HoraDevolucao: devolucao ? format(devolucao, 'HH:mm') : '',
        LocalDevolucao: formatGeo(l.localDevolucao) || '',
        ObservacaoDevolucao: l.observacaoDevolucao || '',
        QtdFotosAvaria: l.fotosAvaria?.length || 0,
        Status: l.statusLog
      };
    });

    utils.book_append_sheet(workbook, utils.json_to_sheet(rawData), "CHECKLISTS");
    utils.book_append_sheet(workbook, utils.json_to_sheet(materialsData), "DADOS_MATERIAIS");
    utils.book_append_sheet(workbook, utils.json_to_sheet(progressData), "DADOS_PROGRESSO");
    utils.book_append_sheet(workbook, utils.json_to_sheet(vehiclesData), "FROTA_VEICULOS");
    utils.book_append_sheet(workbook, utils.json_to_sheet(vehicleLogsData), "FROTA_MOVIMENTACOES");

    writeFile(workbook, `BI_Consolidado_Obras_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    notify('success', 'Excel Gerado', 'Base de dados para Power BI exportada com sucesso!');
  };

  const handleDuplicate = async (report: Checklist) => {
    if (!confirm('Deseja usar este relatório como base para um novo? Todos os dados (exceto a data) serão copiados.')) return;
    
    try {
      const { id, ...dataToCopy } = report;
      const newReport = {
        ...dataToCopy,
        data: serverTimestamp(),
        nomeResponsavel: `${dataToCopy.nomeResponsavel} (Base)`,
      };

      await addDoc(collection(db, 'checklists'), newReport);
      notify('success', 'Relatório Duplicado', 'O novo relatório já está disponível no seu histórico.');
    } catch (err: any) {
      notify('error', 'Erro ao Duplicar', err.message || 'Não foi possível duplicar o relatório.');
      handleFirestoreError(err, OperationType.WRITE, 'checklists-duplicate');
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      {/* Header */}
      <div data-tour="rel-header" className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900">Relatórios</h2>
          <p className="text-zinc-500 text-sm">Checklists diários, ferramentas, frota e indicadores gerenciais.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'diarios' && isAdmin && (
            <>
              <button
                onClick={handleExportBI}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-zinc-200 text-zinc-600 rounded-xl text-xs sm:text-sm font-bold hover:bg-zinc-50 transition-all shadow-sm"
              >
                <FileDown className="w-4 h-4 shrink-0" />
                Exportar Excel
              </button>
              <button
                onClick={() => navigate('/checklist')}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95"
              >
                <Plus className="w-4 h-4 shrink-0" />
                Novo Registro
              </button>
            </>
          )}
          {activeTab === 'ferramentas' && isAdmin && (
            <>
              <button
                onClick={handleExportInventario}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-zinc-800 transition-all shadow-sm"
              >
                <FileDown className="w-4 h-4 shrink-0" />
                Inventário Excel
              </button>
              <button
                onClick={handleExportFerramentas}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-zinc-200 text-zinc-600 rounded-xl text-xs sm:text-sm font-bold hover:bg-zinc-50 transition-all shadow-sm"
              >
                <FileDown className="w-4 h-4 shrink-0" />
                Movimentações Excel
              </button>
            </>
          )}
          {activeTab === 'frota' && isAdmin && (
            <>
              <button
                onClick={handleExportInventarioFrota}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-zinc-800 transition-all shadow-sm"
              >
                <FileDown className="w-4 h-4 shrink-0" />
                Inventário Excel
              </button>
              <button
                onClick={handleExportFrota}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-zinc-200 text-zinc-600 rounded-xl text-xs sm:text-sm font-bold hover:bg-zinc-50 transition-all shadow-sm"
              >
                <FileDown className="w-4 h-4 shrink-0" />
                Movimentações Excel
              </button>
            </>
          )}
          {activeTab === 'fiscal' && isAdmin && filteredFiscal.length > 0 && (
            <button
              onClick={handleExportFiscal}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-zinc-800 transition-all shadow-sm"
            >
              <FileDown className="w-4 h-4 shrink-0" />
              Exportar Excel
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <ReportsLoadError
          title="Erro ao carregar relatórios"
          message={loadError.message}
        />
      )}

      {/* Tabs */}
      <div data-tour="rel-tabs" className="flex bg-white p-1 rounded-xl border border-zinc-200 w-full sm:w-fit shadow-sm">
        {([
          { id: 'diarios', label: 'Relatórios Diários', labelMobile: 'Diários', icon: FileText },
          { id: 'ferramentas', label: 'Ferramentas', labelMobile: 'Ferramentas', icon: Hammer },
          { id: 'frota', label: 'Controle de Frota', labelMobile: 'Frota', icon: Truck },
          { id: 'fiscal', label: 'NF / Cupom Fiscal', labelMobile: 'NF', icon: Receipt },
          { id: 'bi', label: 'Dashboard BI', labelMobile: 'BI', icon: TrendingUp },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setSearch('');
              setSelectedDate('');
              setSelectedChecklist(null);
              setToolCategoryFilter('Todas');
              setToolStatusFilter('Todos');
              setToolLocationFilter('Todos');
              setToolMovementStatusFilter('Todos');
            }}
            className={cn(
              'flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-2 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all',
              activeTab === tab.id
                ? 'bg-zinc-900 text-white shadow-md'
                : 'text-zinc-500 hover:bg-zinc-50'
            )}
          >
            <tab.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="sm:hidden truncate">{tab.labelMobile}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── DASHBOARD BI TAB ── */}
      {activeTab === 'bi' && (
        <BIDashboard
          obras={obras}
          materiais={materiais}
          atividades={atividades}
          checklists={checklists}
          tools={tools}
          toolLogs={toolLogs}
          vehicles={vehicles}
          vehicleLogs={vehicleLogs}
          progressoDiario={progressoDiario}
        />
      )}

      {/* Search + Date filter (hidden on BI tab) */}
      {activeTab !== 'bi' && <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder={
              activeTab === 'diarios'
                ? 'Buscar por obra ou responsável...'
                : activeTab === 'frota'
                  ? 'Buscar por placa, modelo, código ou responsável...'
                  : activeTab === 'fiscal'
                    ? 'Buscar por fornecedor, cartão, tipo, obra ou presente...'
                    : 'Buscar por ferramenta, obra, cliente ou responsável...'
            }
            className="w-full pl-10 pr-4 py-3 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 shadow-sm transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:flex-none">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
            <input
              type="date"
              className="w-full sm:w-auto pl-9 pr-3 py-3 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 shadow-sm transition-all cursor-pointer"
              value={selectedDate}
              max={format(new Date(), 'yyyy-MM-dd')}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          {selectedDate && (
            <button
              onClick={() => setSelectedDate('')}
              className="p-3 bg-white border border-zinc-200 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 shadow-sm transition-all"
              title="Limpar filtro de data"
            >
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>}

      {activeTab === 'ferramentas' && (
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-3 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-zinc-400">Filtros de ferramentas</p>
              <p className="text-xs text-zinc-500">
                Inventario: {filteredTools.length} item(ns) · Movimentacoes: {filteredToolLogs.length} registro(s)
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setSelectedDate('');
                setToolCategoryFilter('Todas');
                setToolStatusFilter('Todos');
                setToolLocationFilter('Todos');
                setToolMovementStatusFilter('Todos');
              }}
              className="w-full sm:w-auto px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              Limpar filtros
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <select
              value={toolCategoryFilter}
              onChange={(e) => setToolCategoryFilter(e.target.value)}
              className="w-full px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            >
              <option value="Todas">Todas as categorias</option>
              {toolCategoryOptions.map(categoria => (
                <option key={categoria} value={categoria}>{categoria}</option>
              ))}
            </select>

            <select
              value={toolStatusFilter}
              onChange={(e) => setToolStatusFilter(e.target.value)}
              className="w-full px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            >
              <option value="Todos">Todos os status</option>
              <option value="Disponível">Disponivel</option>
              <option value="Em Uso">Em uso</option>
              <option value="Manutenção">Manutencao</option>
            </select>

            <select
              value={toolLocationFilter}
              onChange={(e) => setToolLocationFilter(e.target.value)}
              className="w-full px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            >
              <option value="Todos">Todos os locais</option>
              <option value="Estoque">Em estoque</option>
              <option value="Manutenção">Em manutencao</option>
              {obras.map(obra => (
                <option key={obra.id} value={`obra:${obra.id}`}>{obra.nome}</option>
              ))}
            </select>

            <select
              value={toolMovementStatusFilter}
              onChange={(e) => setToolMovementStatusFilter(e.target.value)}
              className="w-full px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            >
              <option value="Todos">Todas as movimentacoes</option>
              <option value="Aberta">Retiradas abertas</option>
              <option value="Concluída">Devolvidas</option>
            </select>
          </div>
        </div>
      )}

      {/* ── NF / CUPOM FISCAL TAB ── */}
      {activeTab === 'fiscal' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 pl-1">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
              Notas e Cupons ({filteredFiscal.length})
            </h3>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 text-white rounded-lg shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Total</span>
              <span className="text-sm font-black">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalFiscal)}</span>
            </div>
          </div>
          {filteredFiscal.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-2xl border-2 border-dashed border-zinc-100">
              <Receipt className="w-12 h-12 text-zinc-200 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm font-medium">Nenhum lançamento fiscal encontrado.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredFiscal.map(f => {
                const dt = parseDate(f.data);
                const previewUrl = f.thumbnailPath || f.fotoPath ? fiscalThumbUrls[f.id] : f.fotoUrl;
                const hasImage = Boolean(f.fotoPath || f.fotoUrl);
                return (
                  <div key={f.id} className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                    <button type="button" onClick={() => openFiscalImage(f)} className="block relative aspect-video bg-zinc-100 w-full text-left">
                      {hasImage
                        ? previewUrl
                          ? <img src={previewUrl} className="w-full h-full object-cover" alt="Documento fiscal" />
                          : <div className="w-full h-full flex items-center justify-center"><Receipt className="w-8 h-8 text-zinc-300 animate-pulse" /></div>
                        : <div className="w-full h-full flex items-center justify-center"><Receipt className="w-8 h-8 text-zinc-300" /></div>}
                      <span className={cn('absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider', f.tipo === 'NF' ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white')}>{f.tipo}</span>
                    </button>
                    <div className="p-4 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-lg font-black text-zinc-900">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(f.valor || 0)}</span>
                        <span className="text-[11px] text-zinc-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{dt ? format(dt, 'dd/MM/yyyy') : '---'}</span>
                      </div>
                      {f.fornecedor && <p className="text-xs text-zinc-600 break-words flex items-center gap-1"><Box className="w-3 h-3 text-zinc-400" />{f.fornecedor}</p>}
                      {f.obraNome && <p className="text-xs text-zinc-600 break-words flex items-center gap-1"><MapPin className="w-3 h-3 text-zinc-400" />{f.obraNome}</p>}
                      {(f.operadoresPresentes?.length || 0) > 0 && <p className="text-[11px] text-zinc-500 break-words flex items-center gap-1"><Users className="w-3 h-3 text-zinc-400" />{f.operadoresPresentes!.map(o => o.nome).join(', ')}</p>}
                      {(f.fotoSizeBytes || f.fotoStorageSizeBytes || f.thumbnailSizeBytes) && (
                        <p className="text-[10px] text-zinc-400 break-words">
                          Imagem: {[formatBytes(f.fotoSizeBytes), formatBytes(f.fotoStorageSizeBytes), formatBytes(f.thumbnailSizeBytes)]
                            .filter(Boolean)
                            .join(' / ')}
                        </p>
                      )}
                      <div className="flex items-center justify-between pt-1 text-[10px] text-zinc-400">
                        <span className="flex items-center gap-1 truncate"><User className="w-3 h-3" />{f.criadoPorNome || '—'}</span>
                        {f.cartaoFinal && <span className="font-mono">•••• {f.cartaoFinal}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── FERRAMENTAS TAB ── */}
      {activeTab === 'ferramentas' && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">
            Histórico de Movimentações ({filteredToolLogs.length})
          </h3>
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-zinc-100">
            {loadingLogs ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="p-4 animate-pulse"><div className="h-12 bg-zinc-100 rounded" /></div>
              ))
            ) : filteredToolLogs.length === 0 ? (
              <div className="p-12 text-center">
                <Hammer className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm font-medium">Nenhuma movimentação encontrada.</p>
              </div>
            ) : filteredToolLogs.map(log => {
              const tool = tools.find(t => t.id === log.toolId);
              const obra = obras.find(o => o.id === log.obraId);
              const saida = parseDate(log.dataSaida);
              const devolucao = log.dataDevolucao ? parseDate(log.dataDevolucao) : null;
              const usoPrevisto = getToolUsagePlan(log);
              const isPending = log.statusLog === 'Aberta';
              return (
                <div key={log.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-900">{tool?.nome || 'Ferramenta removida'}</p>
                      {tool?.codigo && <p className="text-xs text-zinc-400">#{tool.codigo}</p>}
                    </div>
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold uppercase shrink-0',
                      isPending ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                    )}>
                      {isPending ? <Clock className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                      {isPending ? 'Em Uso' : 'Devolvida'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600"><span className="font-bold">Resp:</span> {log.responsavelNome}</p>
                  <p className="text-xs text-zinc-500 break-words"><span className="font-bold">Obra:</span> {obra?.nome || '---'}</p>
                  <p className="text-xs text-zinc-500">
                    <span className="font-bold">Tempo previsto:</span> {usoPrevisto.text}
                    {usoPrevisto.previsao ? ` - até ${format(usoPrevisto.previsao, 'dd/MM/yy HH:mm')}` : ''}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                    <span className="flex items-center gap-1"><ArrowUpRight className="w-3 h-3 text-orange-500" />{format(saida, 'dd/MM/yy HH:mm')}</span>
                    {devolucao && <span className="flex items-center gap-1"><ArrowDownLeft className="w-3 h-3 text-green-500" />{format(devolucao, 'dd/MM/yy HH:mm')}</span>}
                  </div>
                  {log.fotoDevolucaoUrl && (
                    <a href={log.fotoDevolucaoUrl} target="_blank" rel="noopener noreferrer">
                      <img src={log.fotoDevolucaoUrl} alt="Foto devolução" className="w-16 h-16 object-cover rounded-lg border border-zinc-200" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-100">
                  <th className="px-3 lg:px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Ferramenta / ID</th>
                  <th className="px-3 lg:px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Responsável</th>
                  <th className="px-3 lg:px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Obra</th>
                  <th className="px-3 lg:px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Tempo de Uso</th>
                  <th className="px-3 lg:px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Saída</th>
                  <th className="px-3 lg:px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Devolução</th>
                  <th className="px-3 lg:px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Foto</th>
                  <th className="px-3 lg:px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {loadingLogs ? (
                  Array(5).fill(0).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={8} className="px-5 py-6"><div className="h-4 bg-zinc-100 rounded w-full" /></td>
                    </tr>
                  ))
                ) : filteredToolLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-16 text-center">
                      <Hammer className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                      <p className="text-zinc-400 text-sm font-medium">Nenhuma movimentação encontrada.</p>
                    </td>
                  </tr>
                ) : filteredToolLogs.map(log => {
                  const tool = tools.find(t => t.id === log.toolId);
                  const obra = obras.find(o => o.id === log.obraId);
                  const saida = parseDate(log.dataSaida);
                  const devolucao = log.dataDevolucao ? parseDate(log.dataDevolucao) : null;
                  const usoPrevisto = getToolUsagePlan(log);
                  const isPending = log.statusLog === 'Aberta';
                  return (
                    <tr key={log.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-3 lg:px-5 py-4">
                        <p className="text-sm font-bold text-zinc-900">{tool?.nome || 'Ferramenta removida'}</p>
                        <p className="text-[10px] font-mono text-zinc-400 mt-0.5">ID: {log.id.slice(0, 12)}…</p>
                        {tool?.codigo && <p className="text-[10px] font-bold text-zinc-500">#{tool.codigo}</p>}
                      </td>
                      <td className="px-3 lg:px-5 py-4">
                        <p className="text-sm font-semibold text-zinc-800">{log.responsavelNome}</p>
                      </td>
                      <td className="px-3 lg:px-5 py-4">
                        <p className="text-sm text-zinc-600">{obra?.nome || '---'}</p>
                      </td>
                      <td className="px-3 lg:px-5 py-4">
                        <p className="text-xs font-bold text-zinc-900">{usoPrevisto.text}</p>
                        {usoPrevisto.previsao && <p className="text-[10px] text-zinc-500">Até {format(usoPrevisto.previsao, 'dd/MM/yyyy HH:mm')}</p>}
                      </td>
                      <td className="px-3 lg:px-5 py-4">
                        <div className="flex items-center gap-1.5">
                          <ArrowUpRight className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                          <div>
                            <p className="text-xs font-bold text-zinc-900">{format(saida, 'dd/MM/yyyy')}</p>
                            <p className="text-[10px] text-zinc-500">{format(saida, 'HH:mm:ss')}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 lg:px-5 py-4">
                        {devolucao ? (
                          <div className="flex items-center gap-1.5">
                            <ArrowDownLeft className="w-3.5 h-3.5 text-green-600 shrink-0" />
                            <div>
                              <p className="text-xs font-bold text-zinc-900">{format(devolucao, 'dd/MM/yyyy')}</p>
                              <p className="text-[10px] text-zinc-500">{format(devolucao, 'HH:mm:ss')}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-zinc-400 font-bold uppercase">Pendente</span>
                        )}
                      </td>
                      <td className="px-3 lg:px-5 py-4 text-center">
                        {log.fotoDevolucaoUrl ? (
                          <a href={log.fotoDevolucaoUrl} target="_blank" rel="noopener noreferrer" className="inline-block" title="Ver foto da devolução">
                            <img src={log.fotoDevolucaoUrl} alt="Foto devolução" className="w-12 h-12 object-cover rounded-lg border border-zinc-200 hover:opacity-80 transition-opacity mx-auto" />
                          </a>
                        ) : (
                          <span className="text-[10px] text-zinc-300 font-bold uppercase">—</span>
                        )}
                      </td>
                      <td className="px-3 lg:px-5 py-4 text-center">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wide',
                          isPending ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                        )}>
                          {isPending ? <Clock className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                          {isPending ? 'Em Uso' : 'Devolvida'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}

      {activeTab === 'ferramentas' && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">
            Inventário de Ferramentas ({filteredTools.length})
          </h3>
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            {/* Mobile */}
            <div className="sm:hidden divide-y divide-zinc-100">
              {filteredTools.length === 0 ? (
                <div className="p-12 text-center">
                  <Hammer className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                  <p className="text-zinc-400 text-sm font-medium">Nenhuma ferramenta cadastrada.</p>
                </div>
              ) : filteredTools.map(tool => (
                <div key={tool.id} className="p-4 flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-zinc-100 overflow-hidden shrink-0 flex items-center justify-center">
                    {tool.fotoModelo
                      ? <img src={tool.fotoModelo} className="w-full h-full object-cover" alt={tool.nome} />
                      : <Hammer className="w-5 h-5 text-zinc-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold text-zinc-900 break-words">{tool.nome}</p>
                      <span className={cn(
                        'shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide',
                        tool.status === 'Disponível' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                      )}>{tool.status}</span>
                    </div>
                    {tool.codigo && <p className="text-[10px] font-mono text-zinc-400 mt-0.5">#{tool.codigo}</p>}
                    {tool.modelo && <p className="text-xs text-zinc-500 mt-0.5"><span className="font-bold">Modelo:</span> {tool.modelo}</p>}
                    {typeof tool.valor === 'number' && (
                      <p className="text-xs text-zinc-500"><span className="font-bold">Valor:</span> {tool.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                    )}
                    {tool.descricao && <p className="text-xs text-zinc-400 mt-1 break-words">{tool.descricao}</p>}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-100">
                    <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Ferramenta</th>
                    <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Código</th>
                    <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Modelo</th>
                    <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Valor</th>
                    <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Compra</th>
                    <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Foto</th>
                    <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredTools.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-16 text-center">
                        <Hammer className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                        <p className="text-zinc-400 text-sm font-medium">Nenhuma ferramenta cadastrada.</p>
                      </td>
                    </tr>
                  ) : filteredTools.map(tool => (
                    <tr key={tool.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-5 py-4">
                        <p className="text-sm font-bold text-zinc-900 break-words">{tool.nome}</p>
                        {tool.descricao && <p className="text-[10px] text-zinc-400 mt-0.5 break-words">{tool.descricao}</p>}
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs font-mono text-zinc-500">{tool.codigo || '—'}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs text-zinc-600 break-words">{tool.modelo || '—'}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs font-bold text-zinc-900">
                          {typeof tool.valor === 'number' ? tool.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs text-zinc-600">
                          {tool.dataCompra ? new Date(`${tool.dataCompra}T00:00:00`).toLocaleDateString('pt-BR') : '—'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        {tool.fotoModelo ? (
                          <a href={tool.fotoModelo} target="_blank" rel="noopener noreferrer">
                            <img src={tool.fotoModelo} alt={tool.nome} className="w-12 h-12 object-cover rounded-lg border border-zinc-200 hover:opacity-80 transition-opacity mx-auto" />
                          </a>
                        ) : (
                          <span className="text-[10px] text-zinc-300 font-bold">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wide',
                          tool.status === 'Disponível' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                        )}>
                          {tool.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {/* ── FROTA TAB ── */}
      {activeTab === 'frota' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              label="Veículos"
              value={String(vehicles.length)}
              sub={`${vehicles.filter(v => v.status === 'Disponível').length} disponíveis`}
              color="blue"
            />
            <KPICard
              label="Em Uso"
              value={String(vehicleLogs.filter(l => l.statusLog === 'Aberta').length)}
              sub="retiradas abertas"
              color="amber"
            />
            <KPICard
              label="Manutenção"
              value={String(vehicles.filter(v => v.status === 'Manutenção').length)}
              sub="fora de operação"
              color="red"
            />
            <KPICard
              label="Movimentações"
              value={String(vehicleLogs.length)}
              sub="histórico total"
              color="green"
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">
              Inventário de Veículos ({filteredVehicles.length})
            </h3>
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
              <div className="sm:hidden divide-y divide-zinc-100">
                {filteredVehicles.length === 0 ? (
                  <div className="p-12 text-center">
                    <Truck className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                    <p className="text-zinc-400 text-sm font-medium">Nenhum veículo cadastrado.</p>
                  </div>
                ) : filteredVehicles.map(vehicle => {
                  const activeLog = vehicleLogs.find(l => (l.id === vehicle.lastLogId || l.vehicleId === vehicle.id) && l.statusLog === 'Aberta');
                  return (
                    <div key={vehicle.id} className="p-4 flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl bg-zinc-100 overflow-hidden shrink-0 flex items-center justify-center">
                        {vehicle.fotoVeiculo
                          ? <img src={vehicle.fotoVeiculo} className="w-full h-full object-cover" alt={vehicle.placa} />
                          : <Truck className="w-5 h-5 text-zinc-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-bold text-zinc-900 break-words">{vehicle.placa}</p>
                          <VehicleStatusBadge status={vehicle.status} />
                        </div>
                        {vehicle.codigo && <p className="text-[10px] font-mono text-zinc-400 mt-0.5">#{vehicle.codigo}</p>}
                        {vehicle.modelo && <p className="text-xs text-zinc-500 mt-0.5"><span className="font-bold">Modelo:</span> {vehicle.modelo}</p>}
                        {activeLog && <p className="text-xs text-zinc-500"><span className="font-bold">Resp. atual:</span> {activeLog.responsavelNome}</p>}
                        {vehicle.observacoes && <p className="text-xs text-zinc-400 mt-1 break-words">{vehicle.observacoes}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-100">
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Veículo</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Código</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Status</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Responsável Atual</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Foto</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Observações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredVehicles.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-16 text-center">
                          <Truck className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                          <p className="text-zinc-400 text-sm font-medium">Nenhum veículo cadastrado.</p>
                        </td>
                      </tr>
                    ) : filteredVehicles.map(vehicle => {
                      const activeLog = vehicleLogs.find(l => (l.id === vehicle.lastLogId || l.vehicleId === vehicle.id) && l.statusLog === 'Aberta');
                      return (
                        <tr key={vehicle.id} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="px-5 py-4">
                            <p className="text-sm font-bold text-zinc-900 break-words">{vehicle.placa}</p>
                            {vehicle.modelo && <p className="text-[10px] text-zinc-400 mt-0.5 break-words">{vehicle.modelo}</p>}
                          </td>
                          <td className="px-5 py-4">
                            <span className="text-xs font-mono text-zinc-500">{vehicle.codigo || '—'}</span>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <VehicleStatusBadge status={vehicle.status} />
                          </td>
                          <td className="px-5 py-4">
                            <span className="text-xs font-semibold text-zinc-700">{activeLog?.responsavelNome || '—'}</span>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <PhotoLink url={vehicle.fotoVeiculo} label={`Foto ${vehicle.placa}`} />
                          </td>
                          <td className="px-5 py-4">
                            <p className="text-xs text-zinc-500 break-words">{vehicle.observacoes || '—'}</p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">
              Histórico de Movimentações da Frota ({filteredVehicleLogs.length})
            </h3>
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
              <div className="sm:hidden divide-y divide-zinc-100">
                {loadingVehicleLogs ? (
                  Array(4).fill(0).map((_, i) => (
                    <div key={i} className="p-4 animate-pulse"><div className="h-16 bg-zinc-100 rounded" /></div>
                  ))
                ) : filteredVehicleLogs.length === 0 ? (
                  <div className="p-12 text-center">
                    <Truck className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                    <p className="text-zinc-400 text-sm font-medium">Nenhuma movimentação encontrada.</p>
                  </div>
                ) : filteredVehicleLogs.map(log => {
                  const vehicle = vehicles.find(v => v.id === log.vehicleId);
                  const saida = parseDate(log.dataSaida);
                  const devolucao = log.dataDevolucao ? parseDate(log.dataDevolucao) : null;
                  const isPending = log.statusLog === 'Aberta';
                  return (
                    <div key={log.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-zinc-900">{vehicle?.placa || 'Veículo removido'}</p>
                          {vehicle?.modelo && <p className="text-xs text-zinc-400">{vehicle.modelo}</p>}
                        </div>
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold uppercase shrink-0',
                          isPending ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                        )}>
                          {isPending ? <Clock className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                          {isPending ? 'Em Uso' : 'Devolvido'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-600"><span className="font-bold">Resp:</span> {log.responsavelNome}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                        <span className="flex items-center gap-1"><ArrowUpRight className="w-3 h-3 text-orange-500" />{format(saida, 'dd/MM/yy HH:mm')}</span>
                        {devolucao && <span className="flex items-center gap-1"><ArrowDownLeft className="w-3 h-3 text-green-500" />{format(devolucao, 'dd/MM/yy HH:mm')}</span>}
                      </div>
                      {log.localSaida && <VehicleLocationLink point={log.localSaida} label="Retirada" />}
                      {log.localDevolucao && <VehicleLocationLink point={log.localDevolucao} label="Devolução" />}
                      {log.observacaoDevolucao && <p className="text-xs text-zinc-500 break-words"><span className="font-bold">Devolução:</span> {log.observacaoDevolucao}</p>}
                      <div className="flex flex-wrap gap-2">
                        <PhotoLink url={log.fotoPainelSaida} label="Painel saída" />
                        <PhotoLink url={log.fotoPainelDevolucao} label="Painel devolução" />
                        {(log.fotosAvaria || []).map((url, index) => (
                          <PhotoLink key={`${url}-${index}`} url={url} label={`Avaria ${index + 1}`} danger />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-100">
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Veículo / ID</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Responsável</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Saída</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Devolução</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Localização</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Fotos</th>
                      <th className="px-5 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {loadingVehicleLogs ? (
                      Array(5).fill(0).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td colSpan={7} className="px-5 py-6"><div className="h-4 bg-zinc-100 rounded w-full" /></td>
                        </tr>
                      ))
                    ) : filteredVehicleLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-16 text-center">
                          <Truck className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                          <p className="text-zinc-400 text-sm font-medium">Nenhuma movimentação encontrada.</p>
                        </td>
                      </tr>
                    ) : filteredVehicleLogs.map(log => {
                      const vehicle = vehicles.find(v => v.id === log.vehicleId);
                      const saida = parseDate(log.dataSaida);
                      const devolucao = log.dataDevolucao ? parseDate(log.dataDevolucao) : null;
                      const isPending = log.statusLog === 'Aberta';
                      return (
                        <tr key={log.id} className="hover:bg-zinc-50/50 transition-colors">
                          <td className="px-5 py-4">
                            <p className="text-sm font-bold text-zinc-900">{vehicle?.placa || 'Veículo removido'}</p>
                            <p className="text-[10px] font-mono text-zinc-400 mt-0.5">ID: {log.id.slice(0, 12)}…</p>
                            {vehicle?.modelo && <p className="text-[10px] text-zinc-500">{vehicle.modelo}</p>}
                          </td>
                          <td className="px-5 py-4">
                            <p className="text-sm font-semibold text-zinc-800">{log.responsavelNome}</p>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-1.5">
                              <ArrowUpRight className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                              <div>
                                <p className="text-xs font-bold text-zinc-900">{format(saida, 'dd/MM/yyyy')}</p>
                                <p className="text-[10px] text-zinc-500">{format(saida, 'HH:mm:ss')}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            {devolucao ? (
                              <div className="flex items-center gap-1.5">
                                <ArrowDownLeft className="w-3.5 h-3.5 text-green-600 shrink-0" />
                                <div>
                                  <p className="text-xs font-bold text-zinc-900">{format(devolucao, 'dd/MM/yyyy')}</p>
                                  <p className="text-[10px] text-zinc-500">{format(devolucao, 'HH:mm:ss')}</p>
                                </div>
                              </div>
                            ) : (
                              <span className="text-[10px] text-zinc-400 font-bold uppercase">Pendente</span>
                            )}
                            {log.observacaoDevolucao && <p className="text-[10px] text-zinc-400 mt-1 max-w-[180px] break-words">{log.observacaoDevolucao}</p>}
                          </td>
                          <td className="px-5 py-4">
                            <div className="space-y-1">
                              <VehicleLocationLink point={log.localSaida} label="Retirada" />
                              <VehicleLocationLink point={log.localDevolucao} label="Devolução" />
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center justify-center gap-2 min-w-[156px]">
                              <PhotoLink url={log.fotoPainelSaida} label="Painel saída" />
                              <PhotoLink url={log.fotoPainelDevolucao} label="Painel devolução" />
                              {(log.fotosAvaria || []).map((url, index) => (
                                <PhotoLink key={`${url}-${index}`} url={url} label={`Avaria ${index + 1}`} danger />
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <span className={cn(
                              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wide',
                              isPending ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                            )}>
                              {isPending ? <Clock className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                              {isPending ? 'Em Uso' : 'Devolvido'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DIÁRIOS TAB ── */}
      {activeTab === 'diarios' && <div className="grid md:grid-cols-2 gap-6">
        <div className={cn("space-y-4", selectedChecklist && "hidden md:block")}>
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Relatórios Recentes</h3>
          {loading ? (
            Array(4).fill(0).map((_, i) => (
              <div key={i} className="h-32 bg-white animate-pulse rounded-2xl border border-zinc-100" />
            ))
          ) : filteredChecklists.length > 0 ? (
            filteredChecklists.map(report => (
              <ReportCard 
                key={report.id} 
                report={report} 
                obra={obras.find(o => o.id === report.obraId)}
                isSelected={selectedChecklist?.id === report.id}
                onClick={() => setSelectedChecklist(report)}
              />
            ))
          ) : (
            <div className="py-20 text-center bg-white rounded-2xl border border-dashed border-zinc-200">
              <FileText className="w-12 h-12 text-zinc-200 mx-auto mb-4" />
              <p className="text-zinc-500">Nenhum relatório encontrado.</p>
            </div>
          )}
        </div>

        <div className="md:sticky md:top-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Detalhes do Relatório</h3>
            {selectedChecklist && (
              <button
                onClick={() => setSelectedChecklist(null)}
                className="md:hidden flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-900"
              >
                <ChevronRight className="w-4 h-4 rotate-180" /> Voltar
              </button>
            )}
          </div>
          {selectedChecklist ? (
            <div className="space-y-4">
              <ReportDetails 
                report={selectedChecklist}
                obra={obras.find(o => o.id === selectedChecklist.obraId)}
                materiais={materiais}
                atividades={atividades}
                operadores={operadores}
              />
              {isAdmin && (
                <button 
                  onClick={() => handleDuplicate(selectedChecklist)}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-bold text-sm hover:bg-zinc-200 transition-all border border-zinc-200"
                >
                  <Copy className="w-5 h-5" />
                  Usar como Base (Replicar)
                </button>
              )}
            </div>
          ) : (
            <div className="h-48 md:h-[500px] flex flex-col items-center justify-center bg-zinc-50 rounded-3xl border border-dashed border-zinc-200 text-center px-8">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-4">
                <ChevronRight className="w-8 h-8 text-zinc-300" />
              </div>
              <p className="text-zinc-500 font-medium">Selecione um relatório ao lado para visualizar os detalhes completos.</p>
            </div>
          )}
        </div>
      </div>}

    </div>
  );
}

function ReportsLoadError({ title, message }: { title: string; message?: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 flex items-start gap-3 shadow-sm">
      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-black">{title}</p>
        <p className="text-xs font-medium text-red-600 break-words">{message || 'Verifique permissoes e conexao com o banco.'}</p>
      </div>
    </div>
  );
}

function VehicleStatusBadge({ status }: { status: Vehicle['status'] }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wide',
      status === 'Disponível'
        ? 'bg-green-100 text-green-700'
        : status === 'Manutenção'
          ? 'bg-red-100 text-red-700'
          : 'bg-orange-100 text-orange-700'
    )}>
      {status || 'Sem status'}
    </span>
  );
}

function PhotoLink({ url, label, danger = false }: { key?: string | number; url?: string; label: string; danger?: boolean }) {
  if (!url) return <span className="text-[10px] text-zinc-300 font-bold uppercase">—</span>;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="relative inline-block group/photo" title={label}>
      <img
        src={url}
        alt={label}
        className={cn(
          "w-12 h-12 object-cover rounded-lg border hover:opacity-80 transition-opacity mx-auto",
          danger ? "border-amber-300 ring-2 ring-amber-100" : "border-zinc-200"
        )}
      />
      {danger && (
        <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-amber-600/90 px-1 py-0.5 text-center text-[7px] font-bold uppercase tracking-tight text-white">
          Avaria
        </span>
      )}
    </a>
  );
}

function VehicleLocationLink({ point, label }: { point?: VehicleLog['localSaida']; label: string }) {
  const url = mapsUrl(point);
  const text = formatGeo(point);
  if (!url || !text) return <span className="text-[10px] text-zinc-300 font-bold uppercase">—</span>;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1">
      <MapPin className="w-3 h-3 shrink-0" />
      <span>{label}: {text}</span>
    </a>
  );
}

function ReportCard({ report, obra, isSelected, onClick }: {
  key?: string | number,
  report: Checklist,
  obra?: Obra,
  isSelected: boolean,
  onClick: () => void
}) {
  const date = parseDate(report.data);

  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full p-5 rounded-2xl border transition-all text-left flex items-start gap-4",
        isSelected 
          ? "bg-zinc-900 border-zinc-900 text-white shadow-xl scale-[1.02]" 
          : "bg-white border-zinc-100 hover:border-zinc-300 shadow-sm"
      )}
    >
      <div className={cn(
        "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
        isSelected ? "bg-zinc-800" : "bg-zinc-50"
      )}>
        <FileText className="w-6 h-6" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h4 className="font-bold break-words text-sm">
            {obra?.nome || 'Obra Removida'}
          </h4>
          <span className={cn("text-[10px] font-bold uppercase", isSelected ? "text-zinc-400" : "text-zinc-400")}>
            {format(date, "HH:mm", { locale: ptBR })}
          </span>
        </div>
        <p className={cn("text-xs mb-2", isSelected ? "text-zinc-400" : "text-zinc-500")}>
          {format(date, "eeee, d 'de' MMMM", { locale: ptBR })}
        </p>
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-1.5">
             <User className="w-3 h-3" />
             <span className="text-[10px] font-bold break-words">{report.nomeResponsavel}</span>
           </div>
           <div className="flex items-center gap-1.5">
             <Box className="w-3 h-3" />
             <span className="text-[10px] font-bold">{report.materiais.length} Itens</span>
           </div>
        </div>
      </div>
      <ChevronRight className={cn("w-5 h-5 shrink-0 mt-3", isSelected ? "text-zinc-600" : "text-zinc-300")} />
    </button>
  );
}

function ReportDetails({ report, obra, materiais, atividades, operadores }: { 
  report: Checklist, 
  obra?: Obra,
  materiais: Material[],
  atividades: Atividade[],
  operadores: Operator[]
}) {
  const { isAdmin, notify } = useAuth();
  const date = parseDate(report.data);
  const [uploading, setUploading] = useState(false);

  const handleAddAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    setUploading(true);
    try {
      const newAttachments: Attachment[] = [];
      for (const file of files) {
        const url = await uploadFile(file, 'checklists/attachments');
        newAttachments.push({
          name: file.name,
          url,
          type: file.type,
          size: file.size
        });
      }

      const reportRef = doc(db, 'checklists', report.id);
      await updateDoc(reportRef, {
        attachments: arrayUnion(...newAttachments)
      });
      
      notify('success', 'Anexos Adicionados', `${newAttachments.length} arquivo(s) subido(s) com sucesso.`);
    } catch (err: any) {
      notify('error', 'Erro no Upload', 'Ocorreu um erro ao subir os arquivos de anexo.');
      handleFirestoreError(err, OperationType.WRITE, 'checklists-add-attachment');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAttachment = async (file: Attachment) => {
    if (!confirm('Deseja remover este anexo?')) return;

    try {
      const reportRef = doc(db, 'checklists', report.id);
      await updateDoc(reportRef, {
        attachments: arrayRemove(file)
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'checklists-remove-attachment');
    }
  };

  const handleFillTemplate = async (file: Attachment) => {
    try {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error('Erro ao baixar o arquivo.');
      const arrayBuffer = await response.arrayBuffer();
      const workbook = read(arrayBuffer, { type: 'array' });

      // Replace placeholders in all sheets
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) return;

        const range = utils.decode_range(sheet['!ref'] || 'A1:Z100');

        for (let R = range.s.r; R <= range.e.r; ++R) {
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = utils.encode_cell({ r: R, c: C });
            const cell = sheet[cellAddress];

            if (cell && cell.v && typeof cell.v === 'string') {
              let val = cell.v;
              
              // Basic replacements
              val = val.replace('{{OBRA}}', obra?.nome || '');
              val = val.replace('{{DATA}}', format(date, "dd/MM/yyyy"));
              val = val.replace('{{HORA}}', format(date, "HH:mm"));
              val = val.replace('{{RESPONSAVEL}}', report.nomeResponsavel);
              val = val.replace('{{OBSERVACOES}}', report.observacoes || '');

              // Check for table markers
              if (val.includes('[[TABELA_MATERIAIS]]')) {
                // Remove marker
                cell.v = val.replace('[[TABELA_MATERIAIS]]', '');
                
                // Write materials starting from this cell
                report.materiais.forEach((item, idx) => {
                  const m = materiais.find(mat => mat.id === item.materialId);
                  const rowAddr = utils.encode_cell({ r: R + idx + 1, c: C });
                  const qtyAddr = utils.encode_cell({ r: R + idx + 1, c: C + 1 });
                  
                  sheet[rowAddr] = { t: 's', v: m?.descricao || 'Material Removido' };
                  sheet[qtyAddr] = { t: 'n', v: item.qtdConferida };
                });
                
                // Update range if needed
                const newEndRow = Math.max(range.e.r, R + report.materiais.length);
                sheet['!ref'] = utils.encode_range({ s: range.s, e: { r: newEndRow, c: Math.max(range.e.c, C + 1) } });
              }

              if (val.includes('[[TABELA_ATIVIDADES]]')) {
                cell.v = val.replace('[[TABELA_ATIVIDADES]]', '');
                
                report.progresso.forEach((item, idx) => {
                  const a = atividades.find(ativ => ativ.id === item.atividadeId);
                  const rowAddr = utils.encode_cell({ r: R + idx + 1, c: C });
                  const valAddr = utils.encode_cell({ r: R + idx + 1, c: C + 1 });
                  
                  sheet[rowAddr] = { t: 's', v: a?.descricao || 'Atividade Removida' };
                  sheet[valAddr] = { t: 'n', v: item.qtdExecutadaNoDia };
                });

                const newEndRow = Math.max(range.e.r, R + report.progresso.length);
                sheet['!ref'] = utils.encode_range({ s: range.s, e: { r: newEndRow, c: Math.max(range.e.c, C + 1) } });
              }

              cell.v = val;
            }
          }
        }
      });

      // Add BI Data Sheet
      const biData = [
        ['ID_RELATORIO', 'DATA', 'OBRA', 'RESPONSAVEL', 'CATEGORIA', 'ITEM', 'VALOR', 'UNIDADE'],
        ...report.materiais.map(item => {
          const m = materiais.find(mat => mat.id === item.materialId);
          return [report.id, format(date, "yyyy-MM-dd"), obra?.nome || '', report.nomeResponsavel, 'MATERIAL', m?.descricao || '', item.qtdConferida, m?.unidade || ''];
        }),
        ...report.progresso.map(item => {
          const a = atividades.find(ativ => ativ.id === item.atividadeId);
          return [report.id, format(date, "yyyy-MM-dd"), obra?.nome || '', report.nomeResponsavel, 'PROGRESSO', a?.descricao || '', item.qtdExecutadaNoDia, a?.unidade || ''];
        })
      ];

      const biSheet = utils.aoa_to_sheet(biData);
      utils.book_append_sheet(workbook, biSheet, "DADOS_BI");

      // Add simple Dashboard Sheet
      const dashboardData = [
        ['RESUMO DE INDICADORES (BI)', ''],
        ['Obra', obra?.nome || 'N/A'],
        ['Data', format(date, "dd/MM/yyyy")],
        ['Responsável', report.nomeResponsavel],
        ['', ''],
        ['TOTAIS', 'QTD'],
        ['Itens Materiais', report.materiais.length],
        ['Etapas de Progresso', report.progresso.length],
        ['Equipe Presente', report.equipeIds?.length || 0]
      ];
      const dashSheet = utils.aoa_to_sheet(dashboardData);
      utils.book_append_sheet(workbook, dashSheet, "DASHBOARD");

      writeFile(workbook, `BI_Relatorio_${obra?.nome.replace(/\s+/g, '_')}_${format(date, "dd_MM_yyyy")}.xlsx`);
      notify('success', 'Excel com BI Gerado', 'Verifique as novas abas (DADOS_BI e DASHBOARD) no arquivo baixado.');

    } catch (err: any) {
      console.error('Erro ao preencher template:', err);
      notify('error', 'Erro no Processamento', 'Verifique se o arquivo é um Excel válido (.xlsx).');
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-zinc-200 shadow-xl overflow-hidden animate-in zoom-in-95 duration-300">
      <div className="p-4 sm:p-8 bg-zinc-900 text-white">
        <div className="flex items-start justify-between mb-4 sm:mb-6">
          <div className="space-y-1 min-w-0 flex-1">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">RELATÓRIO DIÁRIO</span>
            <h3 className="text-lg sm:text-2xl font-bold tracking-tight break-words">{obra?.nome}</h3>
          </div>
          <FileText className="w-8 h-8 sm:w-10 sm:h-10 text-zinc-700 shrink-0 ml-3" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">DATA E HORA</p>
            <p className="text-sm font-medium">{format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">RESPONSÁVEL</p>
            <p className="text-sm font-medium">{report.nomeResponsavel}</p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-8 space-y-6 sm:space-y-8 max-h-[55vh] sm:max-h-[600px] overflow-y-auto">
        {/* Equipe */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
            <Users className="w-4 h-4" />
            Equipe Presente
          </h4>
          <div className="flex flex-wrap gap-2">
            {report.equipeIds?.map(id => {
              const op = operadores.find(o => o.id === id);
              return op ? (
                <div key={id} className="px-3 py-1.5 bg-zinc-50 border border-zinc-100 rounded-lg text-xs font-bold text-zinc-700">
                  {op.nome} {op.sobrenome}
                </div>
              ) : null;
            }) || <p className="text-xs text-zinc-400">Nenhum operador registrado.</p>}
          </div>
        </div>

        {/* Materiais */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
            <Box className="w-4 h-4" />
            Materiais Conferidos
          </h4>
          <div className="space-y-2">
            {report.materiais.map(item => {
              const mat = materiais.find(m => m.id === item.materialId);
              return (
                <div key={item.materialId} className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                  <span className="text-sm font-bold text-zinc-700">{mat?.descricao || 'Material Removido'}</span>
                  <span className="text-xs font-bold text-zinc-900 bg-white px-2 py-1 rounded border border-zinc-200">
                    Qtd: {item.qtdConferida} {mat?.unidade}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Produção */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Produção do Dia
          </h4>
          <div className="space-y-2">
            {report.progresso.map(item => {
              const ativ = atividades.find(a => a.id === item.atividadeId);
              return (
                <div key={item.atividadeId} className="space-y-2 p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                   <div className="flex items-center justify-between">
                     <span className="text-sm font-bold text-zinc-700">{ativ?.descricao || 'Atividade Removida'}</span>
                     <span className="text-xs font-bold text-green-600">+{item.qtdExecutadaNoDia} {ativ?.unidade}</span>
                   </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Observações */}
        {report.observacoes && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Observações</h4>
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl italic text-zinc-600 text-sm">
              "{report.observacoes}"
            </div>
          </div>
        )}

        {/* Anexos */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <FileDown className="w-4 h-4" />
              Documentos e Anexos
            </h4>
            {isAdmin && (
              <label className="flex items-center gap-1 px-3 py-1 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-[10px] font-bold text-zinc-600 cursor-pointer transition-all">
                <Plus className="w-3 h-3" />
                {uploading ? 'ENVIANDO...' : 'ADICIONAR'}
                <input type="file" multiple className="hidden" onChange={handleAddAttachment} disabled={uploading} />
              </label>
            )}
          </div>
          
          <div className="grid gap-2">
            {report.attachments && report.attachments.length > 0 ? report.attachments.map((file, idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 bg-zinc-50 border border-zinc-100 rounded-xl hover:bg-zinc-100 transition-colors group">
                <a 
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center gap-3 min-w-0"
                >
                  <div className="w-8 h-8 rounded bg-white flex items-center justify-center border border-zinc-200 group-hover:border-zinc-900 transition-colors">
                    <FileText className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-800 break-all">{file.name}</p>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </a>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  {(file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) && (
                    <button 
                      onClick={() => handleFillTemplate(file)}
                      className="p-2 text-zinc-400 hover:text-green-600 flex items-center gap-1"
                      title="Preencher Template"
                    >
                      <Copy className="w-4 h-4" />
                      <span className="text-[10px] font-bold">PREENCHER</span>
                    </button>
                  )}
                  <a href={file.url} target="_blank" rel="noopener noreferrer" className="p-2 text-zinc-400 hover:text-zinc-900">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  {isAdmin && (
                    <button 
                      onClick={() => handleRemoveAttachment(file)}
                      className="p-2 text-zinc-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )) : (
              <div className="py-8 text-center bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                <Paperclip className="w-6 h-6 text-zinc-200 mx-auto mb-2" />
                <p className="text-[10px] font-bold text-zinc-400 uppercase">Nenhum anexo encontrado</p>
              </div>
            )}
          </div>
        </div>

        {/* Foto */}
        {report.photoUrl && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              Evidência Fotográfica
            </h4>
            <div className="rounded-2xl overflow-hidden border border-zinc-200">
              <img 
                src={report.photoUrl} 
                alt="Evidência" 
                className="w-full h-auto"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, color }: {
  label: string; value: string; sub: string;
  color: 'blue' | 'green' | 'amber' | 'purple' | 'red';
}) {
  const styles = {
    blue:   'border-blue-100   text-blue-700   bg-blue-50',
    green:  'border-green-100  text-green-700  bg-green-50',
    amber:  'border-amber-100  text-amber-700  bg-amber-50',
    purple: 'border-purple-100 text-purple-700 bg-purple-50',
    red:    'border-red-100    text-red-700    bg-red-50',
  };
  return (
    <div className={cn('p-3 sm:p-5 rounded-xl border shadow-sm', styles[color])}>
      <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mb-1 sm:mb-2 opacity-60">{label}</p>
      <p className="text-lg sm:text-2xl font-black mb-0.5 truncate">{value}</p>
      <p className="text-[9px] sm:text-[10px] opacity-50 font-medium truncate">{sub}</p>
    </div>
  );
}

// ─── Dashboard BI ─────────────────────────────────────────────────────────────

const PIE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const STATUS_COLORS: Record<string, string> = {
  'Ativa': '#22c55e', 'Concluída': '#3b82f6', 'Pausada': '#f59e0b', 'Cancelada': '#ef4444'
};

function BIDashboard({ obras, materiais, atividades, checklists, tools, toolLogs, vehicles, vehicleLogs, progressoDiario }: {
  obras: Obra[]; materiais: Material[]; atividades: Atividade[];
  checklists: Checklist[]; tools: Tool[]; toolLogs: ToolLog[];
  vehicles: Vehicle[]; vehicleLogs: VehicleLog[]; progressoDiario: any[];
}) {
  const fmtBRL = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const obrasAtivas = obras.filter(o => o.status === 'Ativa').length;
  const totalPrevisto = atividades.reduce((s, a) => s + Number(a.quantidadePrevista || 0), 0);
  const totalExecutado = atividades.reduce((s, a) => s + Number(a.quantidadeExecutada || 0), 0);
  const progressoGeral = totalPrevisto > 0 ? Math.min(100, (totalExecutado / totalPrevisto) * 100) : 0;
  const valorOrcado = atividades.reduce((s, a) => s + Number(a.quantidadePrevista || 0) * Number(a.valorUnitario || 0), 0);
  const valorExecutado = atividades.reduce((s, a) => s + Number(a.quantidadeExecutada || 0) * Number(a.valorUnitario || 0), 0);
  const ferramentasEmUso = toolLogs.filter(l => l.statusLog === 'Aberta').length;
  const veiculosEmUso = vehicleLogs.filter(l => l.statusLog === 'Aberta').length;
  const checklistsMes = checklists.filter(c => {
    const d = new Date(c.data || '');
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  // ── Progresso por obra ────────────────────────────────────────────────────
  const atividadesSemObra = atividades.filter(a => !a.obraId);
  const atividadesSemObraPendentes = atividadesSemObra.filter(a => Number(a.percentual || 0) < 100);
  const progressoPorObra = obras.filter(obra => obra.status !== 'Concluída').map(obra => {
    const atvsObra = atividades.filter(a => a.obraId === obra.id);
    const prev = atvsObra.reduce((s, a) => s + Number(a.quantidadePrevista || 0), 0);
    const exec = atvsObra.reduce((s, a) => s + Number(a.quantidadeExecutada || 0), 0);
    const orcado = atvsObra.reduce((s, a) => s + Number(a.quantidadePrevista || 0) * Number(a.valorUnitario || 0), 0);
    const executadoVal = atvsObra.reduce((s, a) => s + Number(a.quantidadeExecutada || 0) * Number(a.valorUnitario || 0), 0);
    const perc = prev > 0 ? Number(Math.min(100, (exec / prev) * 100).toFixed(1)) : 0;
    const nomeShort = obra.nome.length > 22 ? obra.nome.substring(0, 22) + '…' : obra.nome;
    return { nome: nomeShort, nomeCompleto: obra.nome, progresso: perc, status: obra.status, orcado, executado: executadoVal, centroCusto: (obra as any).centroCusto || 'N/A' };
  });

  if (atividadesSemObraPendentes.length > 0) {
    const prev = atividadesSemObraPendentes.reduce((s, a) => s + Number(a.quantidadePrevista || 0), 0);
    const exec = atividadesSemObraPendentes.reduce((s, a) => s + Number(a.quantidadeExecutada || 0), 0);
    const orcado = atividadesSemObraPendentes.reduce((s, a) => s + Number(a.quantidadePrevista || 0) * Number(a.valorUnitario || 0), 0);
    const executadoVal = atividadesSemObraPendentes.reduce((s, a) => s + Number(a.quantidadeExecutada || 0) * Number(a.valorUnitario || 0), 0);
    const perc = prev > 0 ? Number(Math.min(100, (exec / prev) * 100).toFixed(1)) : 0;
    progressoPorObra.push({
      nome: 'Atividades sem obra',
      nomeCompleto: 'Atividades sem obra vinculada',
      progresso: perc,
      status: 'Ativa',
      orcado,
      executado: executadoVal,
      centroCusto: 'Atividades sem obra',
    });
  }

  progressoPorObra.sort((a, b) => b.progresso - a.progresso);

  // ── Status das obras ──────────────────────────────────────────────────────
  const statusData = obras.reduce((acc: { name: string; value: number }[], o) => {
    const s = o.status || 'Sem Status';
    const found = acc.find(x => x.name === s);
    if (found) found.value++; else acc.push({ name: s, value: 1 });
    return acc;
  }, []);

  // ── Centro de custo ───────────────────────────────────────────────────────
  const centroCustoData = obras.reduce((acc: { name: string; orcado: number; obras: number }[], o) => {
    const cc = (o as any).centroCusto || 'N/A';
    const atvsObra = atividades.filter(a => a.obraId === o.id);
    const orcado = atvsObra.reduce((s, a) => s + Number(a.quantidadePrevista || 0) * Number(a.valorUnitario || 0), 0);
    const found = acc.find(x => x.name === cc);
    if (found) { found.orcado += orcado; found.obras++; }
    else acc.push({ name: cc, orcado, obras: 1 });
    return acc;
  }, []).filter(c => c.obras > 0);

  if (atividadesSemObra.length > 0) {
    centroCustoData.push({
      name: 'Atividades sem obra',
      orcado: atividadesSemObra.reduce((s, a) => s + Number(a.quantidadePrevista || 0) * Number(a.valorUnitario || 0), 0),
      obras: atividadesSemObra.length,
    });
  }

  // ── Evolução temporal (últimos 30 dias) ───────────────────────────────────
  const evolucao = [...progressoDiario]
    .filter((p: any) => p.id && p.percentual !== undefined)
    .sort((a: any, b: any) => new Date(a.id).getTime() - new Date(b.id).getTime())
    .slice(-30)
    .map((p: any) => ({
      data: format(new Date(p.id + 'T12:00:00'), 'dd/MM'),
      percentual: Number(Number(p.percentual || 0).toFixed(1))
    }));

  // ── Atividades críticas (< 30%) ───────────────────────────────────────────
  const atividadesCriticas = atividades
    .filter(a => Number(a.quantidadePrevista || 0) > 0 && Number(a.percentual || 0) < 30)
    .sort((a, b) => Number(a.percentual || 0) - Number(b.percentual || 0))
    .slice(0, 6)
    .map(a => ({ ...a, obraNome: obras.find(o => o.id === a.obraId)?.nome || 'Atividade sem obra' }));

  // ── Top materiais ─────────────────────────────────────────────────────────
  const topMateriais = materiais
    .reduce((acc: { descricao: string; total: number }[], m) => {
      const found = acc.find(x => x.descricao === m.descricao);
      if (found) found.total += Number(m.quantidade || 0);
      else acc.push({ descricao: m.descricao?.length > 18 ? m.descricao.substring(0, 18) + '…' : (m.descricao || 'N/A'), total: Number(m.quantidade || 0) });
      return acc;
    }, [])
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <KPICard label="Obras Ativas" value={String(obrasAtivas)} sub={`de ${obras.length} total`} color="blue" />
        <KPICard label="Progresso Geral" value={`${progressoGeral.toFixed(1)}%`} sub="mão de obra" color="green" />
        <KPICard label="Valor Executado" value={fmtBRL(valorExecutado)} sub={`orçado: ${fmtBRL(valorOrcado)}`} color="amber" />
        <KPICard label="Ferramentas em Uso" value={String(ferramentasEmUso)} sub={`de ${tools.length} cadastradas`} color="purple" />
        <KPICard label="Veículos em Uso" value={String(veiculosEmUso)} sub={`de ${vehicles.length} cadastrados`} color="blue" />
        <KPICard label="Checklists no Mês" value={String(checklistsMes)} sub={`de ${checklists.length} total`} color="red" />
      </div>

      {/* Progresso por Obra + Status */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
          <h3 className="font-semibold text-zinc-900 mb-0.5">Progresso por Obra</h3>
          <p className="text-xs text-zinc-400 mb-5">% de execução da mão de obra — verde ≥80% · amarelo ≥40% · vermelho &lt;40%</p>
          {progressoPorObra.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(180, progressoPorObra.length * 44)}>
              <BarChart data={progressoPorObra} layout="vertical" margin={{ left: 4, right: 52, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f1f1" />
                <XAxis type="number" domain={[0, 100]} fontSize={10} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="nome" width={135} fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: any) => [`${v}%`, 'Progresso']} contentStyle={{ borderRadius: '8px', border: '1px solid #e4e4e7', fontSize: 12 }} />
                <Bar dataKey="progresso" radius={[0, 4, 4, 0]} barSize={20}
                  label={{ position: 'right', fontSize: 10, fontWeight: 700, formatter: (v: any) => `${v}%` }}>
                  {progressoPorObra.map((entry, i) => (
                    <Cell key={i} fill={entry.progresso >= 80 ? '#22c55e' : entry.progresso >= 40 ? '#f59e0b' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-zinc-400 py-12 text-center">Nenhuma obra ativa ou pausada com atividade cadastrada.</p>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
          <h3 className="font-semibold text-zinc-900 mb-0.5">Status das Obras</h3>
          <p className="text-xs text-zinc-400 mb-5">distribuição atual</p>
          {obras.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={78} paddingAngle={3} dataKey="value">
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={STATUS_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any, name: any) => [v, name]} contentStyle={{ borderRadius: '8px', border: '1px solid #e4e4e7', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {statusData.map((s, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[s.name] || PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-xs text-zinc-600">{s.name}</span>
                    </div>
                    <span className="text-xs font-bold text-zinc-900">{s.value} obra{s.value !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-400 py-12 text-center">Nenhuma obra cadastrada.</p>
          )}
        </div>
      </div>

      {/* Evolução temporal + Centro de Custo */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
          <h3 className="font-semibold text-zinc-900 mb-0.5">Evolução do Progresso Global</h3>
          <p className="text-xs text-zinc-400 mb-5">últimos 30 dias — % geral de todas as obras</p>
          {evolucao.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={evolucao}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f1" />
                <XAxis dataKey="data" fontSize={10} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} fontSize={10} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: any) => [`${v}%`, 'Progresso']} contentStyle={{ borderRadius: '8px', border: '1px solid #e4e4e7', fontSize: 12 }} />
                <Line type="monotone" dataKey="percentual" stroke="#18181b" strokeWidth={2.5}
                  dot={{ r: 3, fill: '#fff', strokeWidth: 2, stroke: '#18181b' }}
                  activeDot={{ r: 5, fill: '#18181b' }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center">
              <TrendingUp className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
              <p className="text-sm text-zinc-400">Ainda sem histórico suficiente.</p>
              <p className="text-xs text-zinc-400 mt-1">Atualize progressos em Progresso Físico para gerar o gráfico.</p>
            </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
          <h3 className="font-semibold text-zinc-900 mb-0.5">Obras por Centro de Custo</h3>
          <p className="text-xs text-zinc-400 mb-5">quantidade de obras por categoria</p>
          {centroCustoData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={centroCustoData} margin={{ bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f1" />
                <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} angle={-15} textAnchor="end" />
                <YAxis fontSize={10} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip formatter={(v: any, name: any) => [v, name === 'obras' ? 'Qtd. Obras' : name]} contentStyle={{ borderRadius: '8px', border: '1px solid #e4e4e7', fontSize: 12 }} />
                <Bar dataKey="obras" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={36}
                  label={{ position: 'top', fontSize: 11, fontWeight: 700 }} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-zinc-400 py-12 text-center">Nenhuma obra com centro de custo definido.</p>
          )}
        </div>
      </div>

      {/* Orçado × Executado + Atividades Críticas */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
          <h3 className="font-semibold text-zinc-900 mb-0.5">Orçado × Executado por Obra</h3>
          <p className="text-xs text-zinc-400 mb-5">valor financeiro em R$ — requer valor unitário nas atividades</p>
          {progressoPorObra.filter(o => o.orcado > 0 || o.executado > 0).length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={progressoPorObra.filter(o => o.orcado > 0 || o.executado > 0)} margin={{ bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f1" />
                <XAxis dataKey="nome" fontSize={9} axisLine={false} tickLine={false} angle={-15} textAnchor="end" />
                <YAxis fontSize={10} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any, name: any) => [fmtBRL(Number(v)), name === 'orcado' ? 'Orçado' : 'Executado']} contentStyle={{ borderRadius: '8px', border: '1px solid #e4e4e7', fontSize: 12 }} />
                <Legend iconType="square" iconSize={8} formatter={(v: any) => v === 'orcado' ? 'Orçado' : 'Executado'} />
                <Bar dataKey="orcado" name="orcado" fill="#e4e4e7" radius={[4, 4, 0, 0]} barSize={16} />
                <Bar dataKey="executado" name="executado" fill="#22c55e" radius={[4, 4, 0, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-zinc-400 py-12 text-center">Cadastre valor unitário nas atividades para ver os dados financeiros.</p>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
          <h3 className="font-semibold text-zinc-900 mb-0.5 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Atividades Críticas
          </h3>
          <p className="text-xs text-zinc-400 mb-5">menos de 30% de execução — requer atenção imediata</p>
          {atividadesCriticas.length > 0 ? (
            <div className="space-y-4">
              {atividadesCriticas.map(a => {
                const perc = Number(a.percentual || 0);
                return (
                  <div key={a.id}>
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs font-bold text-zinc-800 break-words flex-1 pr-2">{a.descricao}</p>
                      <span className="text-[11px] font-black text-red-500 shrink-0">{perc.toFixed(0)}%</span>
                    </div>
                    <p className="text-[10px] text-zinc-400 mb-1.5 break-words">{a.obraNome}</p>
                    <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                      <div className="h-full bg-red-500 rounded-full" style={{ width: `${perc}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-200 mx-auto mb-3" />
              <p className="text-sm text-zinc-500 font-medium">Nenhuma atividade crítica.</p>
              <p className="text-xs text-zinc-400">Todas acima de 30% de execução.</p>
            </div>
          )}
        </div>
      </div>

      {/* Top Materiais */}
      {topMateriais.length > 0 && (
        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
          <h3 className="font-semibold text-zinc-900 mb-0.5">Top 5 Materiais por Volume</h3>
          <p className="text-xs text-zinc-400 mb-5">maior quantidade total entregue</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={topMateriais}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f1" />
              <XAxis dataKey="descricao" fontSize={10} axisLine={false} tickLine={false} />
              <YAxis fontSize={10} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip formatter={(v: any) => [v, 'Quantidade']} contentStyle={{ borderRadius: '8px', border: '1px solid #e4e4e7', fontSize: 12 }} />
              <Bar dataKey="total" fill="#18181b" radius={[4, 4, 0, 0]} barSize={40}
                label={{ position: 'top', fontSize: 10, fontWeight: 700 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  );
}
