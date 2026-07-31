import React, { useEffect, useState } from 'react';
import { useCollection } from '../lib/supabaseHooks';
import { collection, addDoc, deleteDoc, doc, serverTimestamp, query, orderBy, updateDoc, where } from '../lib/supabaseDb';
import { db, handleFirestoreError, OperationType, auth } from '../lib/supabase';
import { FiscalDoc } from '../types';
import { useAuth } from '../App';
import { deleteFiscalPhotos, getFiscalPhotoUrl, uploadFiscalPhoto } from '../lib/services';
import { CameraCapture } from '../components/CameraCapture';
import { CurrencyInput } from '../components/CurrencyInput';
import { useAutoSaveForm } from '../hooks/useAutoSaveForm';
import { parseDate } from '../lib/dateUtils';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import {
  Receipt, Plus, Camera, X, Search, CreditCard, Calendar,
  AlertCircle, Trash2, CheckCircle2, User,
  HardHat, Users, Edit2, Download, ChevronDown,
} from 'lucide-react';
import { Obra, Operator } from '../types';

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const DESPESAS_OPTIONS = ['Almoço', 'Jantar', 'Café', 'Estacionamento', 'Hospedagem', 'Material', 'Abastecimento', 'Outros'];

const formatBytes = (bytes?: number) => {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(value / 1024)} KB`;
};

const sanitizeFileName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'documento-fiscal';

async function downloadFiscalImage(url: string, filename: string) {
  if (!url) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Falha ao baixar imagem.');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

async function openFiscalImage(fiscalDoc: FiscalDoc) {
  const url = fiscalDoc.fotoPath ? await getFiscalPhotoUrl(fiscalDoc.fotoPath) : fiscalDoc.fotoUrl || '';
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function downloadFiscalDocumentImage(fiscalDoc: FiscalDoc, filename: string) {
  const url = fiscalDoc.fotoPath ? await getFiscalPhotoUrl(fiscalDoc.fotoPath) : fiscalDoc.fotoUrl || '';
  await downloadFiscalImage(url, filename);
}

type FiscalDraft = {
  tipo: 'NF' | 'Cupom';
  valor: number | '';
  data: string;
  fornecedor: string;
  cartaoFinal: string;
  observacoes: string;
  obraId: string;
  operadoresPresentes: string[];
};
export default function NotasFiscais() {
  const { userProfile, isAdmin, notify } = useAuth();
  const currentUserId = userProfile?.id || auth.currentUser?.id || '';
  const [docsSnap, loading, docsError] = useCollection(
    isAdmin
      ? query(collection(db, 'fiscal_docs'), orderBy('createdAt', 'desc'))
      : currentUserId
        ? query(collection(db, 'fiscal_docs'), where('criadoPorId', '==', currentUserId), orderBy('createdAt', 'desc'))
        : null
  );
  const [showModal, setShowModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<FiscalDoc | null>(null);
  const [search, setSearch] = useState('');
  const [obraFilter, setObraFilter] = useState('Todas');
  const [pessoaFilter, setPessoaFilter] = useState('Todas');
  const [fiscalThumbUrls, setFiscalThumbUrls] = useState<Record<string, string>>({});

  const docs = (docsSnap?.docs.map(d => ({ id: d.id, ...d.data() })) as FiscalDoc[]) || [];
  useEffect(() => {
    let cancelled = false;
    const docsWithPrivateImages = docs.filter(d => d.thumbnailPath || d.fotoPath);
    if (docsWithPrivateImages.length === 0) {
      setFiscalThumbUrls({});
      return;
    }

    Promise.all(docsWithPrivateImages.map(async d => {
      try {
        const url = await getFiscalPhotoUrl(d.thumbnailPath || d.fotoPath);
        return [d.id, url] as const;
      } catch {
        return [d.id, ''] as const;
      }
    })).then(entries => {
      if (!cancelled) setFiscalThumbUrls(Object.fromEntries(entries.filter(([, url]) => url)));
    });

    return () => {
      cancelled = true;
    };
  }, [docsSnap]);

  const obraOptions = Array.from(
    docs.reduce((acc, d) => {
      const key = d.obraId || d.obraNome || '';
      const label = d.obraNome || (d.obraId ? 'Obra sem nome' : '');
      if (key && label) acc.set(key, label);
      return acc;
    }, new Map<string, string>())
  ).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));

  const pessoaOptions = Array.from(
    docs.reduce((acc, d) => {
      (d.operadoresPresentes || []).forEach(p => {
        const nome = (p.nome || '').trim();
        if (nome) acc.add(nome);
      });
      const criadoPor = (d.criadoPorNome || '').trim();
      if (criadoPor) acc.add(criadoPor);
      return acc;
    }, new Set<string>())
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const filtered = docs.filter(d => {
    const q = search.toLowerCase();
    const obraKey = d.obraId || d.obraNome || '';
    const pessoas = [
      d.criadoPorNome || '',
      ...(d.operadoresPresentes || []).map(p => p.nome || '')
    ];
    const matchesObra = obraFilter === 'Todas' || obraKey === obraFilter;
    const matchesPessoa = pessoaFilter === 'Todas' || pessoas.some(nome => nome === pessoaFilter);
    const matchesSearch = !q || (
      (d.fornecedor || '').toLowerCase().includes(q) ||
      (d.observacoes || '').toLowerCase().includes(q) ||
      (d.cartaoFinal || '').includes(q) ||
      (d.tipo || '').toLowerCase().includes(q) ||
      (d.obraNome || '').toLowerCase().includes(q) ||
      pessoas.some(nome => nome.toLowerCase().includes(q))
    );
    return (
      matchesObra &&
      matchesPessoa &&
      matchesSearch
    );
  });

  const total = filtered.reduce((acc, d) => acc + (d.valor || 0), 0);

  const handleDelete = async (fiscalDoc: FiscalDoc) => {
    if (!confirm('Excluir este lançamento?')) return;
    try {
      await deleteDoc(doc(db, 'fiscal_docs', fiscalDoc.id));
      try {
        await deleteFiscalPhotos([fiscalDoc.fotoPath, fiscalDoc.thumbnailPath]);
      } catch (storageError: any) {
        notify('warning', 'Lançamento removido', storageError?.message || 'A foto não pôde ser removida do Storage.');
        return;
      }
      notify('success', 'Excluído', 'Lançamento removido.');
    } catch (err: any) {
      notify('error', 'Erro ao excluir', err.message || 'Não foi possível remover.');
      handleFirestoreError(err, OperationType.DELETE, 'fiscal_docs');
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <div data-tour="nf-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">NF / Cupom Fiscal</h2>
          <p className="text-zinc-500">Lançamento de notas e cupons com foto e cartão utilizado.</p>
        </div>
        <button
          data-tour="nf-new"
          onClick={() => setShowModal(true)}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95"
        >
          <Plus className="w-4 h-4" /> Novo Lançamento
        </button>
      </div>

      {isAdmin ? (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px_220px_auto] gap-3">
          <div data-tour="nf-search" className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por despesa, cartao, tipo, obra ou pessoa..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 shadow-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="relative">
            <HardHat className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
            <select
              value={obraFilter}
              onChange={(e) => setObraFilter(e.target.value)}
              className="w-full pl-10 pr-8 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 shadow-sm appearance-none"
            >
              <option value="Todas">Todas as obras</option>
              {obraOptions.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="relative">
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
            <select
              value={pessoaFilter}
              onChange={(e) => setPessoaFilter(e.target.value)}
              className="w-full pl-10 pr-8 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 shadow-sm appearance-none"
            >
              <option value="Todas">Todas as pessoas</option>
              {pessoaOptions.map(nome => (
                <option key={nome} value={nome}>{nome}</option>
              ))}
            </select>
          </div>
          <div data-tour="nf-total" className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 text-white rounded-xl shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Total</span>
            <span className="text-sm font-black">{brl(total)}</span>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5 text-blue-900">
          <p className="text-sm font-black">Meus lancamentos fiscais</p>
          <p className="text-xs sm:text-sm font-medium mt-1 text-blue-800">
            Voce visualiza apenas as notas e cupons fiscais que lancou no sistema.
          </p>
          <p className="hidden">
            Você pode cadastrar uma nova nota ou cupom fiscal, mas a consulta dos documentos já lançados fica restrita aos administradores.
          </p>
        </div>
      )}

      {!isAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar nos meus lancamentos..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 shadow-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 text-white rounded-xl shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Meu total</span>
            <span className="text-sm font-black">{brl(total)}</span>
          </div>
        </div>
      )}

      {docsError ? (
        <FiscalLoadError title="Erro ao carregar documentos fiscais" message={docsError.message} />
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array(3).fill(0).map((_, i) => <div key={i} className="h-48 bg-white rounded-2xl border border-zinc-100 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-3xl border-2 border-dashed border-zinc-100">
          <Receipt className="w-14 h-14 text-zinc-200 mx-auto mb-3" />
          <p className="text-sm font-bold text-zinc-500">Nenhum lançamento</p>
          <p className="text-xs text-zinc-400">Adicione a primeira nota ou cupom fiscal.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(d => {
            const dt = parseDate(d.data);
            const downloadName = `${sanitizeFileName(`${d.tipo}-${d.fornecedor || d.obraNome || d.id}-${dt ? format(dt, 'yyyy-MM-dd') : 'sem-data'}`)}.jpg`;
            const previewUrl = d.thumbnailPath || d.fotoPath ? fiscalThumbUrls[d.id] : d.fotoUrl;
            const hasImage = Boolean(d.fotoPath || d.fotoUrl);
            return (
              <div key={d.id} className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden group">
                <div className="relative aspect-video bg-zinc-100">
                  {hasImage ? (
                    <button type="button" onClick={() => openFiscalImage(d)} className="block w-full h-full text-left">
                      {previewUrl
                        ? <img src={previewUrl} className="w-full h-full object-cover" alt="Documento fiscal" />
                        : <div className="w-full h-full flex items-center justify-center"><Receipt className="w-8 h-8 text-zinc-300 animate-pulse" /></div>}
                    </button>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Receipt className="w-8 h-8 text-zinc-300" /></div>
                  )}
                  <span className={cn(
                    'absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider',
                    d.tipo === 'NF' ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white'
                  )}>{d.tipo}</span>
                  {hasImage && (
                    <button
                      type="button"
                      onClick={() => downloadFiscalDocumentImage(d, downloadName)}
                      className="absolute top-2 right-2 p-2 rounded-xl bg-white/90 text-zinc-700 shadow-sm border border-white/60 hover:bg-white hover:text-zinc-900 transition-colors"
                      title="Baixar imagem"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-lg font-black text-zinc-900">{brl(d.valor)}</span>
                    <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />{dt ? format(dt, 'dd/MM/yyyy') : '---'}
                    </span>
                  </div>
                  {d.fornecedor && <p className="text-xs text-zinc-600 break-words flex items-center gap-1"><Receipt className="w-3 h-3 text-zinc-400" />{d.fornecedor}</p>}
                  {d.cartaoFinal && (
                    <p className="text-xs text-zinc-600 flex items-center gap-1 font-mono"><CreditCard className="w-3 h-3 text-zinc-400" />•••• {d.cartaoFinal}</p>
                  )}
                  {d.obraNome && <p className="text-xs text-zinc-600 break-words flex items-center gap-1"><HardHat className="w-3 h-3 text-zinc-400" />{d.obraNome}</p>}
                  {(d.operadoresPresentes?.length || 0) > 0 && <p className="text-[11px] text-zinc-500 break-words flex items-center gap-1"><Users className="w-3 h-3 text-zinc-400" />{d.operadoresPresentes!.map(p => p.nome).join(', ')}</p>}
                  {d.observacoes && <p className="text-[11px] text-zinc-400 break-words">{d.observacoes}</p>}
                  {(d.fotoSizeBytes || d.fotoStorageSizeBytes || d.thumbnailSizeBytes) && (
                    <p className="text-[10px] text-zinc-400 break-words">
                      Imagem: {[formatBytes(d.fotoSizeBytes), formatBytes(d.fotoStorageSizeBytes), formatBytes(d.thumbnailSizeBytes)]
                        .filter(Boolean)
                        .join(' / ')}
                    </p>
                  )}
                  <div className="flex items-center justify-between pt-1 gap-2">
                    <span className="text-[10px] text-zinc-400 flex items-center gap-1 truncate"><User className="w-3 h-3" />{d.criadoPorNome || '—'}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {isAdmin && (
                        <>
                          {hasImage && (
                            <button onClick={() => downloadFiscalDocumentImage(d, downloadName)} className="p-1.5 text-zinc-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Baixar imagem">
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => setEditingDoc(d)} className="p-1.5 text-zinc-300 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors" title="Editar">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(d)} className="p-1.5 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(showModal || editingDoc) && (
        <FiscalModal
          editingDoc={editingDoc}
          userName={userProfile ? `${userProfile.nome} ${userProfile.sobrenome || ''}`.trim() : (auth.currentUser?.email || 'Usuário')}
          userId={userProfile?.id || auth.currentUser?.id || ''}
          onClose={() => { setShowModal(false); setEditingDoc(null); }}
          onSaved={(isEdit) => {
            setShowModal(false);
            setEditingDoc(null);
            notify('success', isEdit ? 'Atualizado' : 'Lançado', isEdit ? 'Documento fiscal atualizado.' : 'Documento fiscal registrado.');
          }}
        />
      )}
    </div>
  );
}

function FiscalModal({
  editingDoc,
  userName,
  userId,
  onClose,
  onSaved,
}: {
  editingDoc?: FiscalDoc | null;
  userName: string;
  userId: string;
  onClose: () => void;
  onSaved: (isEdit?: boolean) => void;
}) {
  const { isAdmin } = useAuth();
  const [obrasSnap, , obrasError] = useCollection(query(collection(db, 'obras'), orderBy('nome', 'asc')));
  const [operadoresSnap, , operadoresError] = useCollection(query(collection(db, 'operadores'), orderBy('nome', 'asc')));
  const obras = (obrasSnap?.docs.map(d => ({ id: d.id, ...d.data() })) as Obra[]) || [];
  const obrasDisponiveis = obras.filter(o => o.status !== 'Concluída');
  const operadores = (operadoresSnap?.docs.map(d => ({ id: d.id, ...d.data() })) as Operator[]) || [];

  const editDate = editingDoc ? parseDate(editingDoc.data) : null;
  const fiscalDraftInitial: FiscalDraft = {
    tipo: 'Cupom',
    valor: '',
    data: format(new Date(), 'yyyy-MM-dd'),
    fornecedor: '',
    cartaoFinal: '',
    observacoes: '',
    obraId: '',
    operadoresPresentes: [],
  };
  const [draft, setDraft, limparRascunhoFiscal] = useAutoSaveForm<FiscalDraft>('rascunho-novo-lancamento-fiscal', fiscalDraftInitial);
  const [tipo, setTipoState] = useState<'NF' | 'Cupom'>(editingDoc?.tipo || draft.tipo);
  const [valor, setValorState] = useState<number | ''>(editingDoc?.valor || draft.valor);
  const [data, setDataState] = useState(editDate ? format(editDate, 'yyyy-MM-dd') : draft.data);
  const [fornecedor, setFornecedorState] = useState(editingDoc?.fornecedor || draft.fornecedor);
  const [cartaoFinal, setCartaoFinalState] = useState(editingDoc?.cartaoFinal || draft.cartaoFinal);
  const [observacoes, setObservacoesState] = useState(editingDoc?.observacoes || draft.observacoes);
  const [obraId, setObraIdState] = useState(editingDoc?.obraId || draft.obraId);
  const [obraPickerOpen, setObraPickerOpen] = useState(false);
  const [obraSearch, setObraSearch] = useState('');
  const [operadoresPresentes, setOperadoresPresentesState] = useState<string[]>(editingDoc ? (editingDoc.operadoresPresentes || []).map(op => op.id) : draft.operadoresPresentes);
  const existingHasPhoto = Boolean(editingDoc?.fotoPath || editingDoc?.fotoUrl);
  const [fotoFile, setFotoFile] = useState<File | null>(() => existingHasPhoto ? new File([], 'existing-fiscal-photo') : null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(editingDoc?.fotoUrl || null);
  const [showCamera, setShowCamera] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingStep, setSavingStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const previewDownloadName = `${sanitizeFileName(`${tipo}-${fornecedor || editingDoc?.obraNome || editingDoc?.id || 'documento'}-${data || 'sem-data'}`)}.jpg`;

  useEffect(() => {
    let cancelled = false;
    if (!editingDoc?.fotoPath) return;
    getFiscalPhotoUrl(editingDoc.fotoPath)
      .then(url => {
        if (!cancelled) setFotoPreview(url);
      })
      .catch(() => {
        if (!cancelled) setFotoPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [editingDoc?.fotoPath]);

  const saveDraft = (patch: Partial<FiscalDraft>) => {
    if (!editingDoc) setDraft(prev => ({ ...prev, ...patch }));
  };
  const setTipo = (value: 'NF' | 'Cupom') => { setTipoState(value); saveDraft({ tipo: value }); };
  const setValor = (value: number | '') => { setValorState(value); saveDraft({ valor: value }); };
  const setData = (value: string) => { setDataState(value); saveDraft({ data: value }); };
  const setFornecedor = (value: string) => { setFornecedorState(value); saveDraft({ fornecedor: value }); };
  const setCartaoFinal = (value: string) => { setCartaoFinalState(value); saveDraft({ cartaoFinal: value }); };
  const setObservacoes = (value: string) => { setObservacoesState(value); saveDraft({ observacoes: value }); };
  const setObraId = (value: string) => { setObraIdState(value); saveDraft({ obraId: value, operadoresPresentes: [] }); };
  const setOperadoresPresentes = (value: string[] | ((prev: string[]) => string[])) => {
    setOperadoresPresentesState(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      saveDraft({ operadoresPresentes: next });
      return next;
    });
  };

  // Equipe da obra selecionada — os operadores presentes saem DAQUI, não de todos.
  const obraSelecionada = obras.find(o => o.id === obraId);
  const obrasFiltradas = obrasDisponiveis.filter(o => {
    const termo = obraSearch.trim().toLowerCase();
    if (!termo) return true;
    return (o.nome || '').toLowerCase().includes(termo);
  });
  const idsEquipe = obraSelecionada
    ? (obraSelecionada.operadoresIds?.length ? obraSelecionada.operadoresIds : (obraSelecionada.equipe || []).map(e => e.operatorId))
    : [];
  const operadoresDaObra = operadores.filter(o => idsEquipe.includes(o.id));

  const setFoto = (file: File) => {
    if (fotoPreview?.startsWith('blob:')) URL.revokeObjectURL(fotoPreview);
    setFotoFile(file);
    setFotoPreview(URL.createObjectURL(file));
    setShowCamera(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!fotoFile) { setError('A foto do documento é obrigatória.'); return; }
    if (editingDoc && !isAdmin) { setError('Somente administradores podem editar lançamentos fiscais.'); return; }
    const valorNum = typeof valor === 'number' ? valor : NaN;
    if (!Number.isFinite(valorNum) || valorNum <= 0) { setError('Informe um valor válido.'); return; }
    if (!editingDoc && obraId && !obrasDisponiveis.some(o => o.id === obraId)) {
      setError('Esta obra foi concluída e está arquivada para novos lançamentos.');
      return;
    }

    setLoading(true);
    setSavingStep('Enviando foto...');
    try {
      const uploaded = fotoFile.size > 0 ? await uploadFiscalPhoto(fotoFile) : null;
      const fotoPayload = uploaded
        ? {
          fotoUrl: uploaded.fotoUrl || '',
          fotoPath: uploaded.fotoPath,
          thumbnailPath: uploaded.thumbnailPath,
          fotoSizeBytes: uploaded.fotoSizeBytes,
          fotoStorageSizeBytes: uploaded.fotoStorageSizeBytes,
          thumbnailSizeBytes: uploaded.thumbnailSizeBytes,
        }
        : {
          fotoUrl: editingDoc?.fotoUrl || '',
          fotoPath: editingDoc?.fotoPath || '',
          thumbnailPath: editingDoc?.thumbnailPath || '',
          fotoSizeBytes: editingDoc?.fotoSizeBytes || 0,
          fotoStorageSizeBytes: editingDoc?.fotoStorageSizeBytes || 0,
          thumbnailSizeBytes: editingDoc?.thumbnailSizeBytes || 0,
        };
      const obraSel = obras.find(o => o.id === obraId);
      const presentes = operadores
        .filter(o => operadoresPresentes.includes(o.id))
        .map(o => ({ id: o.id, nome: `${o.nome} ${o.sobrenome || ''}`.trim() }));

      if (editingDoc) {
        await updateDoc(doc(db, 'fiscal_docs', editingDoc.id), {
          tipo,
          ...fotoPayload,
          valor: valorNum,
          data: data ? new Date(`${data}T12:00:00`).toISOString() : serverTimestamp(),
          fornecedor: fornecedor.trim(),
          cartaoFinal: cartaoFinal.replace(/\D/g, '').slice(-4),
          observacoes: observacoes.trim(),
          obraId: obraId || '',
          obraNome: obraSel?.nome || '',
          operadoresPresentes: presentes,
          updatedAt: serverTimestamp(),
        });
        if (uploaded) {
          try {
            await deleteFiscalPhotos([editingDoc.fotoPath, editingDoc.thumbnailPath]);
          } catch {
            // O lançamento já foi salvo; uma falha de limpeza no Storage não deve bloquear o usuário.
          }
        }
        if (fotoPreview?.startsWith('blob:')) URL.revokeObjectURL(fotoPreview);
        onSaved(true);
        return;
      }

      await addDoc(collection(db, 'fiscal_docs'), {
        tipo,
        ...fotoPayload,
        valor: valorNum,
        data: data ? new Date(`${data}T12:00:00`).toISOString() : serverTimestamp(),
        fornecedor: fornecedor.trim(),
        cartaoFinal: cartaoFinal.replace(/\D/g, '').slice(-4),
        observacoes: observacoes.trim(),
        obraId: obraId || '',
        obraNome: obraSel?.nome || '',
        operadoresPresentes: presentes,
        criadoPorNome: userName,
        criadoPorId: userId,
        createdAt: serverTimestamp(),
      });
      limparRascunhoFiscal();
      if (fotoPreview?.startsWith('blob:')) URL.revokeObjectURL(fotoPreview);
      onSaved(false);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar.');
      handleFirestoreError(err, OperationType.WRITE, 'fiscal_docs');
    } finally {
      setLoading(false);
      setSavingStep('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
      <div className="bg-white w-full sm:max-w-lg rounded-3xl shadow-2xl max-h-[92dvh] overflow-y-auto">
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-bold">{editingDoc ? 'Editar Lançamento Fiscal' : 'Novo Lançamento Fiscal'}</h3>
          <button type="button" onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs font-bold">
              <AlertCircle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}
          {(obrasError || operadoresError) && (
            <FiscalLoadError
              title="Erro ao carregar dados do lançamento"
              message={(obrasError || operadoresError)?.message}
            />
          )}

          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            {(['Cupom', 'NF'] as const).map(t => (
              <button key={t} type="button" onClick={() => setTipo(t)}
                className={cn('py-2.5 rounded-xl text-sm font-bold border transition-all',
                  tipo === t ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100')}>
                {t === 'NF' ? 'Nota Fiscal' : 'Cupom Fiscal'}
              </button>
            ))}
          </div>

          {/* Foto obrigatória */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Foto do documento (obrigatório)</label>
            {fotoPreview ? (
              <div className="space-y-2">
                <div className="relative w-full aspect-video rounded-2xl overflow-hidden border-2 border-zinc-200">
                  <img src={fotoPreview} className="w-full h-full object-cover" alt="Pré-visualização" />
                  {!fotoPreview.startsWith('blob:') && (
                    <button
                      type="button"
                      onClick={() => downloadFiscalImage(fotoPreview, previewDownloadName)}
                      className="absolute top-3 right-3 flex items-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-xs font-bold text-zinc-700 shadow-sm border border-white/60 hover:bg-white hover:text-zinc-900 transition-colors"
                      title="Baixar imagem"
                    >
                      <Download className="w-4 h-4" />
                      Baixar
                    </button>
                  )}
                </div>
                <button type="button" onClick={() => setShowCamera(true)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600 hover:bg-zinc-100"><Camera className="w-4 h-4" /> Trocar foto</button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowCamera(true)} className="w-full flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 hover:bg-zinc-100 hover:border-zinc-400 transition-all">
                <Camera className="w-6 h-6 text-zinc-500" /><span className="text-xs font-bold text-zinc-700">Tirar Foto</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Valor</label>
              <CurrencyInput value={valor} onChange={setValor} required
                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-bold focus:outline-none focus:border-zinc-900" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Data</label>
              <input type="date" required className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:border-zinc-900"
                value={data} onChange={e => setData(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Despesas</label>
              <select
                value={fornecedor}
                onChange={e => setFornecedor(e.target.value)}
                className="w-full min-h-12 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:border-zinc-900"
              >
                <option value="">Selecione a despesa</option>
                {fornecedor && !DESPESAS_OPTIONS.includes(fornecedor) && (
                  <option value={fornecedor}>{fornecedor}</option>
                )}
                {DESPESAS_OPTIONS.map(opcao => (
                  <option key={opcao} value={opcao}>{opcao}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Cartão (4 últimos)</label>
              <input type="text" inputMode="numeric" maxLength={4}
                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-mono tracking-widest focus:outline-none focus:border-zinc-900"
                placeholder="1234" value={cartaoFinal}
                onChange={e => setCartaoFinal(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Observacao</label>
            <textarea
              rows={3}
              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:border-zinc-900 resize-none"
              placeholder="Ex: motivo da despesa, detalhes da compra ou informacoes complementares..."
              value={observacoes}
              onChange={e => setObservacoes(e.target.value)}
            />
          </div>

          {/* Obra vinculada */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Obra vinculada</label>
            <button
              type="button"
              onClick={() => setObraPickerOpen(true)}
              className={cn(
                "w-full min-h-14 rounded-2xl border px-4 py-3 text-left transition-all flex items-center gap-3",
                obraId ? "bg-white border-zinc-300 shadow-sm" : "bg-zinc-50 border-zinc-200 hover:bg-zinc-100"
              )}
            >
              <span className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                obraId ? "bg-blue-50 text-blue-600" : "bg-zinc-100 text-zinc-400"
              )}>
                <HardHat className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400">
                  {obraId ? 'Selecionada' : 'Sem obra vinculada'}
                </span>
                <span className={cn(
                  "block text-sm font-bold leading-snug break-words",
                  obraId ? "text-zinc-900" : "text-zinc-500"
                )}>
                  {obraSelecionada?.nome || 'Nenhuma'}
                </span>
              </span>
              <ChevronDown className="w-5 h-5 text-zinc-400 shrink-0" />
            </button>
          </div>

          {/* Operadores presentes (multi-seleção) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1 flex items-center gap-1"><Users className="w-3.5 h-3.5" />Quem estava presente</label>
              {operadoresPresentes.length > 0 && <span className="text-[10px] font-bold text-zinc-500">{operadoresPresentes.length} selecionado(s)</span>}
            </div>
            {!obraId ? (
              <p className="text-xs text-zinc-400 px-1">Selecione uma obra acima para ver a equipe.</p>
            ) : operadoresDaObra.length === 0 ? (
              <p className="text-xs text-zinc-400 px-1">Nenhum operador atribuído a esta obra. Atribua a equipe em Obras &gt; Equipe Atribuída.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {operadoresDaObra.map(o => {
                  const nome = `${o.nome} ${o.sobrenome || ''}`.trim();
                  const sel = operadoresPresentes.includes(o.id);
                  return (
                    <button key={o.id} type="button"
                      onClick={() => setOperadoresPresentes(prev => prev.includes(o.id) ? prev.filter(x => x !== o.id) : [...prev, o.id])}
                      className={cn('px-3 py-1.5 rounded-full text-xs font-bold border transition-all',
                        sel ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100')}>
                      {nome}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button type="submit" disabled={loading}
            className={cn('w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg',
              loading ? 'bg-zinc-100 text-zinc-300' : 'bg-zinc-900 text-white hover:bg-zinc-800')}>
            {loading ? (savingStep || 'Salvando...') : <>{editingDoc ? 'Salvar Alterações' : 'Lançar'} <CheckCircle2 className="w-5 h-5" /></>}
          </button>
        </form>
      </div>

      {showCamera && (
        <CameraCapture
          onCapture={setFoto}
          onClose={() => setShowCamera(false)}
          quality={0.96}
          idealWidth={2560}
          idealHeight={1440}
          documentMode
        />
      )}

      {obraPickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-zinc-950/55 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[84dvh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-zinc-100 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-lg font-black text-zinc-950">Obra vinculada</h4>
                  <p className="text-xs text-zinc-500">Escolha uma obra ativa para relacionar ao lançamento.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setObraPickerOpen(false)}
                  className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-500 hover:bg-zinc-200 flex items-center justify-center transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={obraSearch}
                  onChange={e => setObraSearch(e.target.value)}
                  placeholder="Buscar obra..."
                  className="w-full h-12 pl-11 pr-4 rounded-2xl border border-zinc-200 bg-zinc-50 text-sm font-semibold focus:outline-none focus:border-zinc-900"
                  autoFocus
                />
              </div>
            </div>

            <div className="overflow-y-auto p-3 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setObraId('');
                  setOperadoresPresentes([]);
                  setObraPickerOpen(false);
                  setObraSearch('');
                }}
                className={cn(
                  "w-full rounded-2xl border p-4 text-left flex items-center gap-3 transition-all",
                  !obraId ? "border-zinc-900 bg-zinc-950 text-white" : "border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700"
                )}
              >
                <span className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                  !obraId ? "bg-white/10 text-white" : "bg-zinc-100 text-zinc-400"
                )}>
                  <HardHat className="w-5 h-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black">Nenhuma</span>
                  <span className={cn("block text-xs", !obraId ? "text-white/70" : "text-zinc-400")}>
                    Lançamento fiscal sem vínculo com obra
                  </span>
                </span>
                {!obraId && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
              </button>

              {obrasFiltradas.map(o => {
                const selected = o.id === obraId;
                const codigo = (o.nome || '').split('-')[0]?.trim();
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setObraId(o.id);
                      setOperadoresPresentes([]);
                      setObraPickerOpen(false);
                      setObraSearch('');
                    }}
                    className={cn(
                      "w-full rounded-2xl border p-4 text-left flex items-start gap-3 transition-all",
                      selected ? "border-blue-500 bg-blue-50 shadow-sm" : "border-zinc-200 bg-white hover:bg-zinc-50"
                    )}
                  >
                    <span className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
                      selected ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-500"
                    )}>
                      <HardHat className="w-5 h-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      {codigo && (
                        <span className={cn(
                          "inline-flex max-w-full rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest mb-1",
                          selected ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-500"
                        )}>
                          {codigo}
                        </span>
                      )}
                      <span className="block text-sm font-black text-zinc-900 leading-snug break-words">
                        {o.nome}
                      </span>
                    </span>
                    {selected && <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-2" />}
                  </button>
                );
              })}

              {obrasFiltradas.length === 0 && (
                <div className="py-10 text-center">
                  <HardHat className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                  <p className="text-sm font-bold text-zinc-500">Nenhuma obra encontrada.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FiscalLoadError({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-red-700">
      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-black">{title}</p>
        {message && <p className="text-xs font-semibold mt-1 break-words opacity-80">{message}</p>}
      </div>
    </div>
  );
}

