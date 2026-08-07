import React, { useState, useEffect, useRef, useMemo } from 'react';
import { usePersistedTab } from '../hooks/usePersistedTab';
import { useCollection } from '../lib/supabaseHooks';
import { collection, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, setDoc, query, where } from '../lib/supabaseDb';
import { db, handleFirestoreError, OperationType } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Obra, ObraStatus, Operator, Atividade } from '../types';
import {
  Plus,
  MapPin,
  Building2,
  User,
  Settings2,
  MoreVertical,
  Search,
  CheckCircle2,
  Clock,
  ChevronDown,
  Activity,
  Users,
  Briefcase,
  Trash2,
  Pencil,
  ExternalLink,
  ShieldCheck,
  ClipboardCheck,
  AlertCircle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../App';
import { useAutoSaveForm } from '../hooks/useAutoSaveForm';
import { refreshDailyProgressSnapshot } from '../lib/progress';

const OBRA_DRAFT_INITIAL: Partial<Obra> = {
  nome: '',
  cliente: '',
  endereco: '',
  responsavel: '',
  centroCusto: '',
  status: 'Ativa',
};

const TEAM_CATEGORY_OPTIONS = ['Todas', 'Eletrica', 'Hidraulica', 'Manutencao', 'Locacao', 'Outros'];

const TEAM_CATEGORY_MATCHERS: Record<string, string[]> = {
  Eletrica: ['eletric', 'eletrot', 'eletromec', 'spda', 'aterramento'],
  Hidraulica: ['hidraul', 'encanador', 'bombeiro'],
  Manutencao: ['manutenc', 'mecanic', 'tecnico', 'auxiliar', 'preventiv', 'corretiv'],
  Locacao: ['motorista', 'condutor'],
};

function normalizeSearch(value?: string) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .toLowerCase()
    .trim();
}

function getTeamCategoryFromCostCenter(centroCusto?: string) {
  const normalized = normalizeSearch(centroCusto);
  if (normalized.includes('eletric')) return 'Eletrica';
  if (normalized.includes('hidraul')) return 'Hidraulica';
  if (normalized.includes('manutenc')) return 'Manutencao';
  if (normalized.includes('loca')) return 'Locacao';
  if (normalized.includes('outro')) return 'Outros';
  return 'Todas';
}

function operatorMatchesTeamCategory(op: Operator, category: string) {
  if (category === 'Todas' || category === 'Outros') return true;
  const keywords = TEAM_CATEGORY_MATCHERS[category] || [];
  const funcao = normalizeSearch(op.funcao || '');
  return keywords.some(keyword => funcao.includes(keyword));
}

export default function Obras() {
  const { isAdmin, notify } = useAuth();
  const [obrasSnap, loading, obrasError] = useCollection(collection(db, 'obras'));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedObra, setSelectedObra] = useState<Obra | null>(null);
  const [editingObra, setEditingObra] = useState<Obra | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('Todas');
  const [isSavingObra, setIsSavingObra] = useState(false);
  const obraDraftBeforeEditRef = useRef<Partial<Obra> | null>(null);

  const [formData, setFormData, limparRascunhoObra] = useAutoSaveForm<Partial<Obra>>('rascunho-nova-obra', OBRA_DRAFT_INITIAL);


  const openCreateObra = () => {
    obraDraftBeforeEditRef.current = null;
    setEditingObra(null);
    setIsModalOpen(true);
  };

  const openEditObra = (obra: Obra) => {
    obraDraftBeforeEditRef.current = formData;
    setEditingObra(obra);
    setFormData({
      nome: obra.nome || '',
      cliente: obra.cliente || '',
      endereco: obra.endereco || '',
      responsavel: obra.responsavel || '',
      centroCusto: obra.centroCusto || '',
      status: obra.status || 'Ativa',
    });
    setIsModalOpen(true);
  };

  const closeObraModal = () => {
    const previousDraft = obraDraftBeforeEditRef.current;
    setIsModalOpen(false);
    setEditingObra(null);
    if (previousDraft) setFormData(previousDraft);
    obraDraftBeforeEditRef.current = null;
  };

  const handleSaveObra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingObra) return;

    const nomeNormalizado = (formData.nome || '').trim().toLowerCase();
    const clienteNormalizado = (formData.cliente || '').trim().toLowerCase();
    const jaExiste = obras.some(o =>
      o.id !== editingObra?.id &&
      (o.nome || '').trim().toLowerCase() === nomeNormalizado &&
      (o.cliente || '').trim().toLowerCase() === clienteNormalizado
    );

    if (jaExiste) {
      notify('warning', 'Obra já cadastrada', 'Já existe uma obra com esse nome e cliente.');
      return;
    }

    setIsSavingObra(true);
    try {
      const payload = {
        nome: (formData.nome || '').trim(),
        cliente: (formData.cliente || '').trim(),
        endereco: (formData.endereco || '').trim(),
        responsavel: (formData.responsavel || '').trim(),
        centroCusto: formData.centroCusto || '',
        status: (formData.status || 'Ativa') as ObraStatus,
        updatedAt: serverTimestamp(),
      };

      if (editingObra) {
        await updateDoc(doc(db, 'obras', editingObra.id), payload);
        setSelectedObra(prev => prev?.id === editingObra.id ? { ...prev, ...payload } as Obra : prev);
        notify('success', 'Obra atualizada', 'As informações da obra foram salvas.');
        setFormData(obraDraftBeforeEditRef.current || OBRA_DRAFT_INITIAL);
      } else {
        await addDoc(collection(db, 'obras'), {
          ...payload,
          operadoresIds: [],
          equipe: [],
          createdAt: serverTimestamp()
        });
        notify('success', 'Sucesso', 'Obra cadastrada com sucesso!');
        limparRascunhoObra();
      }

      setIsModalOpen(false);
      setEditingObra(null);
      obraDraftBeforeEditRef.current = null;
    } catch (err: any) {
      notify('error', 'Erro ao Salvar', err.message || 'Não foi possível salvar a obra.');
      handleFirestoreError(err, OperationType.WRITE, 'obras');
    } finally {
      setIsSavingObra(false);
    }
  };


  const todasObras = (obrasSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Obra[]) || [];
  const obras = todasObras;

  const filteredObras = obras.filter(o =>
    (o.nome.toLowerCase().includes(search.toLowerCase()) || o.cliente?.toLowerCase().includes(search.toLowerCase())) &&
    (filterStatus === 'Todas' || o.status === filterStatus)
  );

  const handleUpdateStatus = async (obraId: string, status: ObraStatus) => {
    if (!isAdmin) {
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar o status da obra.');
      return;
    }
    try {
      await updateDoc(doc(db, 'obras', obraId), { status });
      if (selectedObra?.id === obraId) {
        setSelectedObra(prev => prev ? { ...prev, status } : null);
      }
      notify('info', 'Status Atualizado', `A obra agora está com o status: ${status}`);
    } catch (err: any) {
      notify('error', 'Erro de Status', 'Não foi possível atualizar o status da obra.');
      handleFirestoreError(err, OperationType.WRITE, 'obras-status');
    }
  };

  const handleDeleteObra = async (obraId: string) => {
    if (!confirm('Deseja realmente excluir esta obra?')) return;
    try {
      await deleteDoc(doc(db, 'obras', obraId));
      if (selectedObra?.id === obraId) {
        setSelectedObra(null);
        setIsDetailsOpen(false);
      }
      notify('success', 'Obra Excluída', 'O registro da obra foi removido permanentemente.');
    } catch (err: any) {
      notify('error', 'Erro ao Excluir', 'Não foi possível remover o registro da obra.');
      handleFirestoreError(err, OperationType.WRITE, 'obras-delete');
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {isDetailsOpen && selectedObra ? (
        <ObraDetails 
          obra={selectedObra} 
          onBack={() => setIsDetailsOpen(false)} 
          onUpdateStatus={handleUpdateStatus}
          onDelete={handleDeleteObra}
          onEdit={openEditObra}
        />
      ) : (
        <>
          <div data-tour="obras-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-zinc-900 text-shadow-sm">Cadastro de Obras</h2>
              <p className="text-zinc-500">Gerencie todas as obras ativas e concluídas.</p>
            </div>
            {isAdmin && (
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  data-tour="obras-new"
                  onClick={openCreateObra}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-zinc-900 text-white rounded-lg font-semibold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 active:scale-95"
                >
                  <Plus className="w-5 h-5" />
                  Nova Obra
                </button>
              </div>
            )}
          </div>

          {obrasError && (
            <ObrasLoadError
              title="Erro ao carregar obras"
              message={obrasError.message}
            />
          )}

          {/* Filters */}
          <div data-tour="obras-filters" className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                placeholder="Buscar por nome ou cliente..."
                className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 transition-all"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {['Todas', 'Ativa', 'Concluída', 'Pausada'].map(status => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={cn(
                    "flex-1 min-w-fit px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all border",
                    filterStatus === status
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                  )}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div data-tour="obras-list" className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {loading ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="h-56 bg-white animate-pulse rounded-xl border border-zinc-200 shadow-sm" />
              ))
            ) : filteredObras.length > 0 ? (
              filteredObras.map(obra => (
                <ObraCard 
                  key={obra.id} 
                  obra={obra} 
                  onViewDetails={() => {
                    setSelectedObra(obra);
                    setIsDetailsOpen(true);
                  }}
                  onDelete={() => handleDeleteObra(obra.id)}
                  onStatusUpdate={(s) => handleUpdateStatus(obra.id, s)}
                  onEdit={() => openEditObra(obra)}
                />
              ))
            ) : (
              <div className="col-span-full py-20 text-center bg-white rounded-xl border border-dashed border-zinc-300">
                <Building2 className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
                <p className="text-zinc-500 font-medium">Nenhuma obra encontrada.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[92dvh] overflow-y-auto">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
              <h3 className="text-lg font-bold text-zinc-900 tracking-tight uppercase tracking-wider">{editingObra ? 'Editar Obra' : 'Nova Obra'}</h3>
              <button onClick={closeObraModal} className="p-2 hover:bg-zinc-200 rounded-full transition-colors">
                <Plus className="w-6 h-6 rotate-45 text-zinc-500" />
              </button>
            </div>
            <form onSubmit={handleSaveObra} className="p-6 space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Nome da Obra</label>
                  <input 
                    required
                    type="text" 
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                    placeholder="Ex: Condomínio Solar"
                    value={formData.nome}
                    onChange={(e) => setFormData({...formData, nome: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Cliente</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                    placeholder="Ex: Tecnisa S.A"
                    value={formData.cliente}
                    onChange={(e) => setFormData({...formData, cliente: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Endereço</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 w-4 h-4 text-zinc-400" />
                  <input 
                    type="text" 
                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                    placeholder="Rua, Número, Bairro, Cidade"
                    value={formData.endereco}
                    onChange={(e) => setFormData({...formData, endereco: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2 text-left">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Responsável Técnico</label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 w-4 h-4 text-zinc-400" />
                    <input 
                      type="text" 
                      className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                      placeholder="Eng. Nome Sobrenome"
                      value={formData.responsavel}
                      onChange={(e) => setFormData({...formData, responsavel: e.target.value})}
                    />
                  </div>
                </div>
                <div className="space-y-2 text-left">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Centro de Custo</label>
                  <div className="relative">
                    <select 
                      className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                      value={formData.centroCusto}
                      onChange={(e) => setFormData({...formData, centroCusto: e.target.value})}
                    >
                      <option value="">Selecione...</option>
                      <option value="Elétrica">Elétrica</option>
                      <option value="Hidraulica">Hidraulica</option>
                      <option value="Manutenção">Manutenção</option>
                      <option value="Locação">Locação</option>
                      <option value="Outros">Outros</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-left">
                <div className="flex items-start gap-3">
                  <Users className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-black text-blue-950">Equipe será definida depois</p>
                    <p className="text-xs font-semibold text-blue-700 mt-1 leading-relaxed">
                      Os operadores ficam cadastrados separadamente. A obra será criada sem equipe automática. Depois, abra a obra e use a aba Equipe Atribuída para colocar ou retirar operadores manualmente.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button" 
                  onClick={closeObraModal}
                  className="flex-1 py-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingObra}
                  className={cn(
                    "flex-1 py-3 text-sm font-semibold text-white rounded-xl transition-colors shadow-lg shadow-zinc-200",
                    isSavingObra ? "bg-zinc-400 cursor-not-allowed" : "bg-zinc-900 hover:bg-zinc-800"
                  )}
                >
                  {isSavingObra ? 'Salvando...' : editingObra ? 'Salvar Alterações' : 'Criar Obra'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

function ObraCard({ 
  obra, 
  onViewDetails, 
  onDelete,
  onStatusUpdate,
  onEdit
}: { 
  key?: string | number,
  obra: Obra, 
  onViewDetails: () => void, 
  onDelete: () => void | Promise<void>,
  onStatusUpdate: (s: ObraStatus) => void | Promise<void>,
  onEdit: () => void | Promise<void>
}) {
  const { isAdmin } = useAuth();
  const [showMenu, setShowMenu] = useState(false);

  const statusColors = {
    'Ativa': 'bg-green-50 text-green-600 border-green-200',
    'Concluída': 'bg-blue-50 text-blue-600 border-blue-200',
    'Pausada': 'bg-amber-50 text-amber-600 border-amber-200'
  };

  return (
    <div className="group bg-white rounded-xl border border-zinc-200 shadow-sm hover:shadow-xl hover:shadow-zinc-200 transition-all overflow-hidden flex flex-col relative">
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="w-12 h-12 rounded-xl bg-zinc-100 flex items-center justify-center border border-zinc-200 group-hover:bg-zinc-900 group-hover:text-white transition-colors cursor-pointer" onClick={onViewDetails}>
            <Building2 className="w-6 h-6" />
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border",
              statusColors[obra.status as keyof typeof statusColors]
            )}>
              {obra.status}
            </span>
          </div>
        </div>

        <div className="cursor-pointer" onClick={onViewDetails}>
          <h4 className="text-lg font-bold text-zinc-900 tracking-tight leading-tight mb-1 group-hover:text-zinc-700 transition-colors">
            {obra.nome}
          </h4>
          <p className="text-sm font-medium text-zinc-500 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            {obra.cliente || 'Consumidor Final'}
          </p>
        </div>

        <div className="space-y-2 pt-2 cursor-pointer" onClick={onViewDetails}>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <MapPin className="w-3.5 h-3.5" />
            <span className="break-words">{obra.endereco || 'A definir'}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Settings2 className="w-3.5 h-3.5" />
            <span>Eng: {obra.responsavel || 'Não atribuído'}</span>
          </div>
        </div>
      </div>

      <div className="mt-auto border-t border-zinc-100 p-3 bg-zinc-50 flex items-center justify-between">
        <div className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">
          CC: {obra.centroCusto || 'N/A'}
        </div>
        <div className="relative">
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-zinc-200 rounded-lg transition-colors text-zinc-400 hover:text-zinc-900 group-hover:bg-white group-hover:shadow-sm"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 bottom-full mb-2 w-48 bg-white rounded-xl shadow-xl border border-zinc-100 p-1 z-20 animate-in slide-in-from-bottom-2 duration-200">
                <button 
                  onClick={() => { onViewDetails(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Abrir Relatórios
                </button>
                <div className="h-px bg-zinc-100 my-1" />
                {isAdmin && (
                  <>
                    <button
                      onClick={() => { onStatusUpdate('Ativa'); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Marcar como Ativa
                    </button>
                    <button
                      onClick={() => { onStatusUpdate('Concluída'); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Concluir Obra
                    </button>
                    <button
                      onClick={() => { onStatusUpdate('Pausada'); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                    >
                      <Clock className="w-4 h-4" />
                      Pausar Obra
                    </button>
                    <div className="h-px bg-zinc-100 my-1" />
                    <button
                      onClick={() => { onEdit(); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                      Editar Obra
                    </button>
                    <button 
                      onClick={() => { onDelete(); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Excluir Obra
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AtividadeCard({ ativ, onSave, readOnly = false }: { key?: string; ativ: Atividade; onSave: (id: string, val: number) => void | Promise<void>; readOnly?: boolean }) {
  const [localExec, setLocalExecState] = useState(ativ.quantidadeExecutada ?? 0);
  const localExecRef = useRef(ativ.quantidadeExecutada ?? 0);
  const isDirty = useRef(false);

  const setLocalExec = (val: number) => {
    localExecRef.current = val;
    setLocalExecState(val);
    isDirty.current = true;
  };

  useEffect(() => {
    setLocalExecState(ativ.quantidadeExecutada ?? 0);
    localExecRef.current = ativ.quantidadeExecutada ?? 0;
    isDirty.current = false;
  }, [ativ.quantidadeExecutada]);

  // Salva ao sair da página se houver valor pendente
  useEffect(() => {
    return () => {
      if (isDirty.current && !readOnly) {
        onSave(ativ.id, localExecRef.current);
      }
    };
  }, []);

  const perc = ativ.quantidadePrevista > 0
    ? Math.min(100, Math.round((localExec / ativ.quantidadePrevista) * 100))
    : 0;
  const status = perc < 50 ? 'Abaixo de 50%' : perc < 100 ? 'Entre 50% e 99%' : 'Concluído';
  const colorClass = perc < 50 ? 'bg-red-500' : perc < 100 ? 'bg-amber-500' : 'bg-green-500';
  const badgeClass = perc < 50 ? 'bg-red-50 text-red-600 border-red-100' : perc < 100 ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-green-50 text-green-600 border-green-100';

  return (
    <div className="bg-white p-4 sm:p-6 rounded-3xl border border-zinc-100 shadow-sm hover:shadow-md transition-all flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">ATIVIDADE</span>
          <h4 className="text-base sm:text-xl font-bold text-zinc-900 leading-tight">{ativ.descricao}</h4>
          <p className="text-xs text-zinc-500 font-medium">
            Unidade: <span className="font-bold text-zinc-700">{ativ.unidade}</span> •
            Previsto: <span className="font-bold text-zinc-700">{ativ.quantidadePrevista} {ativ.unidade}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-center space-y-1">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest block">Total ({ativ.unidade})</span>
            <div className="w-16 sm:w-20 py-2 sm:py-3 bg-zinc-50 border border-zinc-100 rounded-2xl text-sm sm:text-lg font-bold text-zinc-900 text-center">
              {ativ.quantidadePrevista}
            </div>
          </div>
          <div className="text-center space-y-1">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest block">Executado ({ativ.unidade})</span>
            <input
              type="number"
              className={cn(
                "w-16 sm:w-24 py-2 sm:py-3 border-2 rounded-2xl text-sm sm:text-lg font-bold text-zinc-900 focus:outline-none transition-colors text-center shadow-inner",
                readOnly ? "bg-zinc-50 border-zinc-100 cursor-not-allowed" : "bg-white border-zinc-100 focus:border-zinc-900"
              )}
              value={localExec === 0 ? '' : localExec}
              min="0"
              readOnly={readOnly}
              onKeyDown={(e) => {
                if (['-', '+', 'e', 'E'].includes(e.key)) { e.preventDefault(); return; }
                if (e.key === 'Enter' && !readOnly) (e.target as HTMLInputElement).blur();
              }}
              onChange={(e) => !readOnly && setLocalExec(Math.max(0, parseFloat(e.target.value) || 0))}
              onBlur={() => { if (!readOnly) { onSave(ativ.id, localExecRef.current); isDirty.current = false; } }}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border", badgeClass)}>
            {status}
          </span>
          <span className="text-xs font-bold text-zinc-400">{perc}%</span>
        </div>
        <div className="h-2.5 w-full bg-zinc-100 rounded-full overflow-hidden">
          <div
            className={cn("h-full transition-all duration-300", colorClass)}
            style={{ width: `${perc}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function ObrasLoadError({ title, message }: { title: string; message?: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 flex items-start gap-3 shadow-sm">
      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-black">{title}</p>
        <p className="text-xs font-medium text-red-600 break-words">{message || 'Verifique permissoes e conexao com o banco.'}</p>
      </div>
    </div>
  );
}

function ObraDetails({
  obra,
  onBack,
  onUpdateStatus,
  onDelete,
  onEdit
}: {
  obra: Obra,
  onBack: () => void,
  onUpdateStatus: (obraId: string, status: ObraStatus) => void,
  onDelete: (obraId: string) => void,
  onEdit: (obra: Obra) => void
}) {
  const { isAdmin, notify } = useAuth();
  const navigate = useNavigate();
  const [atividadesSnap, , atividadesError] = useCollection(query(collection(db, 'atividades'), where('obraId', '==', obra.id)));
  const [operadoresSnap, , operadoresError] = useCollection(collection(db, 'operadores'));
  const [activeTab, setActiveTab] = usePersistedTab<'progresso' | 'equipe' | 'informacoes'>('tab-obra-detalhes', 'progresso');

  const atividades = (atividadesSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Atividade[]) || [];
  const todosOperadores = (operadoresSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Operator[]) || [];
  const loadError = atividadesError || operadoresError;

  // Estado local otimista para equipe — UI responde na hora sem esperar Realtime
  const [equipeLocal, setEquipeLocal] = useState(obra.equipe || []);
  const [idsLocal, setIdsLocal] = useState(obra.operadoresIds || []);
  const [teamCategoryFilter, setTeamCategoryFilter] = useState(() => getTeamCategoryFromCostCenter(obra.centroCusto));
  const [rolesLocal, setRolesLocal] = useState<Record<string, 'admin' | 'operator'>>(() => {
    const r: Record<string, 'admin' | 'operator'> = {};
    todosOperadores.forEach(op => { r[op.id] = (op.role as any) || 'operator'; });
    return r;
  });

  useEffect(() => {
    setEquipeLocal(obra.equipe || []);
    setIdsLocal(obra.operadoresIds || []);
    setTeamCategoryFilter(getTeamCategoryFromCostCenter(obra.centroCusto));
  }, [obra.equipe, obra.operadoresIds, obra.centroCusto]);

  useEffect(() => {
    const r: Record<string, 'admin' | 'operator'> = {};
    todosOperadores.forEach(op => { r[op.id] = (op.role as any) || 'operator'; });
    setRolesLocal(r);
  }, [operadoresSnap]);

  const operadoresFiltrados = useMemo(
    () => todosOperadores.filter(op => operatorMatchesTeamCategory(op, teamCategoryFilter)),
    [todosOperadores, teamCategoryFilter]
  );

  const handleToggleOperator = async (opId: string) => {
    if (!isAdmin) {
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar a equipe da obra.');
      return;
    }
    const op = todosOperadores.find(o => o.id === opId);
    const prevEquipe = equipeLocal;
    const prevIds = idsLocal;
    let newEquipe, newIds;

    if (idsLocal.includes(opId)) {
      newEquipe = equipeLocal.filter(e => e.operatorId !== opId);
      newIds = idsLocal.filter(id => id !== opId);
    } else {
      newEquipe = [...equipeLocal, { operatorId: opId, nivel: op?.funcao || 'Operador' }];
      newIds = [...idsLocal, opId];
    }

    setEquipeLocal(newEquipe);
    setIdsLocal(newIds);

    try {
      await updateDoc(doc(db, 'obras', obra.id), { equipe: newEquipe, operadoresIds: newIds });
    } catch (err) {
      setEquipeLocal(prevEquipe);
      setIdsLocal(prevIds);
      handleFirestoreError(err, OperationType.WRITE, 'obras-operators');
    }
  };

  const handleUpdateNivel = async (opId: string, nivel: string) => {
    if (!isAdmin) {
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar a equipe da obra.');
      return;
    }
    const prevEquipe = equipeLocal;
    const newEquipe = equipeLocal.map(e => e.operatorId === opId ? { ...e, nivel } : e);
    setEquipeLocal(newEquipe);
    try {
      await updateDoc(doc(db, 'obras', obra.id), { equipe: newEquipe });
    } catch (err) {
      setEquipeLocal(prevEquipe);
      handleFirestoreError(err, OperationType.WRITE, 'obras-nivel');
    }
  };

  const handleToggleAdmin = async (e: React.MouseEvent, opId: string) => {
    e.stopPropagation();
    if (!isAdmin) {
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar permissões.');
      return;
    }
    const current = rolesLocal[opId] || 'operator';
    const newRole = current === 'admin' ? 'operator' : 'admin';
    const operator = todosOperadores.find(op => op.id === opId);
    const email = (operator?.email || '').trim().toLowerCase();
    if (!email) {
      notify('error', 'E-mail obrigatÃ³rio', 'Cadastre um e-mail para alterar o acesso administrativo.');
      return;
    }

    setRolesLocal(prev => ({ ...prev, [opId]: newRole }));
    try {
      if (newRole === 'admin') {
        await setDoc(doc(db, 'admin_access', `email:${email}`), {
          tipo: 'email',
          valor: email,
          email,
          ativo: true,
          createdAt: serverTimestamp(),
        });
      } else {
        await deleteDoc(doc(db, 'admin_access', `email:${email}`));
      }
      await updateDoc(doc(db, 'operadores', opId), { role: newRole });
      notify('success', 'Acesso atualizado', `${newRole === 'admin' ? 'Administrador ativado' : 'Acesso alterado para Operador'}.`);
    } catch (err) {
      setRolesLocal(prev => ({ ...prev, [opId]: current }));
      handleFirestoreError(err, OperationType.WRITE, 'operadores-role');
    }
  };

  const handleStartChecklist = () => {
    localStorage.setItem('rascunho-checklist-obra', JSON.stringify(obra.id));
    localStorage.setItem('rascunho-checklist-etapa', JSON.stringify(1));
    navigate('/checklist');
  };

  const handleUpdateAtividade = async (id: string, qty: number) => {
    if (!isAdmin) {
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar o progresso da obra.');
      return;
    }
    try {
      const ativ = atividades.find(a => a.id === id);
      if (!ativ) return;
      
      const newTotal = Number(qty);
      await updateDoc(doc(db, 'atividades', id), {
        quantidadeExecutada: newTotal,
        percentual: ativ.quantidadePrevista > 0 ? Math.min(100, (newTotal / ativ.quantidadePrevista) * 100) : 0,
        updatedAt: serverTimestamp()
      });
      await refreshDailyProgressSnapshot();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'atividades-update');
    }
  };

  return (
    <div className="space-y-4 animate-in slide-in-from-right duration-300">
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-3">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="p-2 hover:bg-zinc-100 rounded-full text-zinc-500 shrink-0 mt-0.5">
            <ChevronDown className="w-5 h-5 rotate-90" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className="text-base sm:text-xl font-bold text-zinc-900 leading-tight break-words">{obra.nome}</h2>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border shrink-0",
                obra.status === 'Ativa' ? "bg-green-50 text-green-600 border-green-200" :
                obra.status === 'Concluída' ? "bg-blue-50 text-blue-600 border-blue-200" :
                "bg-amber-50 text-amber-600 border-amber-200"
              )}>
                {obra.status}
              </span>
            </div>
            <p className="text-xs font-medium text-zinc-500 flex items-start gap-1.5 break-words">
              <Briefcase className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {obra.cliente} • CC: {obra.centroCusto}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button
              onClick={() => onEdit(obra)}
              className="flex-1 px-3 py-2 bg-white text-zinc-900 border border-zinc-200 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-zinc-50 transition-all flex items-center justify-center gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Editar</span>
            </button>
          )}
          <button
            onClick={handleStartChecklist}
            className="flex-1 px-3 py-2 bg-zinc-900 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-zinc-700 transition-all flex items-center justify-center gap-1.5"
          >
            <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Fazer Checklist</span>
          </button>
          {isAdmin && obra.status !== 'Concluída' && (
            <button
              onClick={() => onUpdateStatus(obra.id, 'Concluída')}
              className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Concluir Obra</span>
            </button>
          )}
          {isAdmin && obra.status === 'Concluída' && (
            <button
              onClick={() => onUpdateStatus(obra.id, 'Ativa')}
              className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-green-700 transition-all flex items-center justify-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Reabrir Obra</span>
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <ObrasLoadError
          title="Erro ao carregar detalhes da obra"
          message={loadError.message}
        />
      )}

      <div className="flex bg-white p-1 rounded-xl border border-zinc-200 w-full">
        {[
          { id: 'progresso', label: 'Mão de Obra', labelMobile: 'Progresso', icon: Activity },
          { id: 'equipe', label: 'Equipe Atribuída', labelMobile: 'Equipe', icon: Users },
          { id: 'informacoes', label: 'Informações', labelMobile: 'Info', icon: Settings2 }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all",
              activeTab === tab.id
                ? "bg-zinc-900 text-white shadow-md"
                : "text-zinc-500 hover:bg-zinc-50"
            )}
          >
            <tab.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="sm:hidden truncate">{tab.labelMobile}</span>
            <span className="hidden sm:inline truncate">{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'progresso' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base sm:text-xl font-bold text-zinc-900 leading-tight">Mão de obra e progresso</h3>
              <p className="text-zinc-500 text-xs sm:text-sm">Linha de progressão por atividade.</p>
            </div>
            <button
              onClick={() => navigate('/progresso')}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-bold text-zinc-900 hover:bg-zinc-50 transition-all shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">+ </span>Atividade
            </button>
          </div>

          <div className="grid gap-4">
            {atividades.map(ativ => (
              <AtividadeCard
                key={ativ.id}
                ativ={ativ}
                onSave={handleUpdateAtividade}
                readOnly={!isAdmin}
              />
            ))}

            {atividades.length === 0 && (
              <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-zinc-200">
                <Activity className="w-12 h-12 text-zinc-200 mx-auto mb-4" />
                <p className="text-zinc-500 font-medium">Nenhuma atividade de mão de obra cadastrada para esta obra.</p>
                <button
                  onClick={() => navigate('/progresso')}
                  className="mt-4 text-zinc-900 font-bold underline"
                >
                  Cadastrar atividades agora
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'equipe' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-bold text-zinc-900">Operadores Atribuídos</h3>
            <p className="text-zinc-500 text-sm">Selecione os operadores que fazem parte da equipe principal desta obra.</p>
          </div>

          <div className="max-w-sm space-y-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Categoria da equipe</label>
            <div className="relative">
              <select
                value={teamCategoryFilter}
                onChange={(e) => setTeamCategoryFilter(e.target.value)}
                className="w-full px-4 py-2.5 pr-10 bg-white border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-700 appearance-none focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
              >
                {TEAM_CATEGORY_OPTIONS.map(category => (
                  <option key={category} value={category}>
                    {category === 'Eletrica' ? 'Elétrica' :
                      category === 'Hidraulica' ? 'Hidráulica' :
                      category === 'Manutencao' ? 'Manutenção' :
                      category === 'Locacao' ? 'Locação' :
                      category}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {operadoresFiltrados.map(op => {
              const equipeEntry = equipeLocal.find(e => e.operatorId === op.id);
              const isAssigned = idsLocal.includes(op.id);
              const isAdmin_op = rolesLocal[op.id] === 'admin';

              return (
                <div
                  key={op.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => isAdmin && handleToggleOperator(op.id)}
                  onKeyDown={(e) => {
                    if (isAdmin && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleToggleOperator(op.id); }
                  }}
                  className={cn(
                    "p-4 rounded-2xl border transition-all flex items-center gap-3 text-left relative cursor-pointer select-none",
                    isAssigned
                      ? "bg-zinc-900 border-zinc-900 text-white shadow-lg"
                      : "bg-white border-zinc-200 hover:border-zinc-400 text-zinc-900"
                  )}
                >
                  <div className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center font-bold shrink-0 pointer-events-none text-sm",
                    isAssigned ? "bg-zinc-800" : "bg-zinc-100 text-zinc-500"
                  )}>
                    {op.nome?.[0] || '?'}{op.sobrenome?.[0] || ''}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="font-bold break-words text-sm">{op.nome} {op.sobrenome}</p>
                      {isAdmin_op && <ShieldCheck className={cn("w-3.5 h-3.5 shrink-0", isAssigned ? "text-blue-300" : "text-blue-500")} />}
                    </div>
                    {isAssigned && equipeEntry ? (
                      <select
                        className="bg-transparent border-none p-0 text-[10px] uppercase tracking-widest font-bold text-zinc-400 focus:ring-0 w-full cursor-pointer"
                        value={equipeEntry.nivel}
                        onClick={(e) => e.stopPropagation()}
                        disabled={!isAdmin}
                        onChange={(e) => { e.stopPropagation(); handleUpdateNivel(op.id, e.target.value); }}
                      >
                        <option className="text-zinc-900" value="Operador">Operador</option>
                        <option className="text-zinc-900" value="Encarregado">Encarregado</option>
                        <option className="text-zinc-900" value="Supervisor">Supervisor</option>
                        <option className="text-zinc-900" value="Técnico">Técnico</option>
                        <option className="text-zinc-900" value="Engenheiro">Engenheiro</option>
                        {op.funcao && !['Operador','Encarregado','Supervisor','Técnico','Engenheiro'].includes(op.funcao) && (
                          <option className="text-zinc-900" value={op.funcao}>{op.funcao}</option>
                        )}
                      </select>
                    ) : (
                      <p className={cn("text-[10px] uppercase tracking-widest font-bold", isAssigned ? "text-zinc-500" : "text-zinc-400")}>
                        {op.funcao || 'Disponível'}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-1.5 shrink-0">
                    {isAssigned && <CheckCircle2 className="w-4 h-4 text-white" />}
                    {isAdmin && (
                      <button
                        type="button"
                        title={isAdmin_op ? 'Admin — clique para rebaixar' : 'Operador — clique para tornar admin'}
                        onClick={(e) => handleToggleAdmin(e, op.id)}
                        className={cn(
                          "p-1.5 rounded-lg transition-colors",
                          isAdmin_op
                            ? (isAssigned ? "bg-blue-500/30 text-blue-300 hover:bg-blue-500/50" : "bg-blue-100 text-blue-600 hover:bg-blue-200")
                            : (isAssigned ? "bg-zinc-700 text-zinc-500 hover:bg-zinc-600" : "bg-zinc-100 text-zinc-400 hover:bg-zinc-200")
                        )}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {operadoresFiltrados.length === 0 && (
              <div className="col-span-full py-14 text-center bg-white rounded-2xl border border-dashed border-zinc-200">
                <Users className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                <p className="text-zinc-500 text-sm font-bold">Nenhum operador nesta categoria.</p>
                <p className="text-zinc-400 text-xs mt-1">Confira a funcao cadastrada em Operadores ou altere o filtro de categoria.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'informacoes' && (
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm space-y-8">
           <div className="grid sm:grid-cols-2 gap-8">
             <div className="space-y-4">
               <div>
                 <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">ENDEREÇO DA OBRA</span>
                 <p className="text-zinc-800 font-medium">{obra.endereco || 'Não informado'}</p>
               </div>
               <div>
                 <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">CLIENTE</span>
                 <p className="text-zinc-800 font-medium">{obra.cliente || 'Não informado'}</p>
               </div>
             </div>
             <div className="space-y-4">
               <div>
                 <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">RESPONSÁVEL TÉCNICO</span>
                 <p className="text-zinc-800 font-medium">{obra.responsavel || 'Não informado'}</p>
               </div>
               <div>
                 <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">CENTRO DE CUSTO</span>
                 <p className="text-zinc-800 font-medium font-mono">{obra.centroCusto || 'N/A'}</p>
               </div>
             </div>
           </div>
           <div className="pt-6 border-t border-zinc-100">
             {isAdmin && (
               <button
                 onClick={() => onDelete(obra.id)}
                 className="text-zinc-400 hover:text-red-600 transition-colors text-xs font-bold uppercase tracking-widest flex items-center gap-2"
               >
                 <Trash2 className="w-4 h-4" />
                 Excluir registro da obra
               </button>
             )}
           </div>
        </div>
      )}
    </div>
  );
}
