import React, { useState, useEffect, useRef } from 'react';
import { useCollection } from '../lib/supabaseHooks';
import { collection, serverTimestamp, query, where, doc, writeBatch, increment } from '../lib/supabaseDb';
import { db, auth } from '../lib/supabase';
import { Obra, Material, Atividade, Operator } from '../types';
import { useNavigate } from 'react-router-dom';
import { 
  ClipboardCheck, 
  ChevronRight, 
  CheckCircle2, 
  MapPin, 
  User, 
  Package, 
  Activity,
  AlertCircle,
  Save,
  Camera,
  Paperclip,
  X,
  Users,
  UserPlus
} from 'lucide-react';
import { cn } from '../lib/utils';
import { uploadPhoto, sendBrowserNotification } from '../lib/services';
import { useAuth } from '../App';
import { useAutoSaveForm } from '../hooks/useAutoSaveForm';
import { usePhotoCapture } from '../hooks/usePhotoCapture';
import { refreshDailyProgressSnapshot } from '../lib/progress';

export default function ChecklistPage() {
  const { notify, isAdmin, userProfile } = useAuth();
  const navigate = useNavigate();
  const [activeStep, setActiveStep, limparRascunhoEtapa] = useAutoSaveForm('rascunho-checklist-etapa', 1);
  const [selectedObraId, setSelectedObraId, limparRascunhoObraChecklist] = useAutoSaveForm('rascunho-checklist-obra', '');
  
  const [obrasSnap, , obrasError] = useCollection(collection(db, 'obras'));
  const [operadoresSnap, , operadoresError] = useCollection(collection(db, 'operadores_diretorio'));
  const [adminAccessSnap, , adminAccessError] = useCollection(collection(db, 'admin_access'));
  const [encarregadosSnap, , encarregadosError] = useCollection(collection(db, 'encarregados'));
  const [materiaisSnap, , materiaisError] = useCollection(
    selectedObraId 
      ? query(collection(db, 'materiais'), where('obraId', '==', selectedObraId), where('statusConferencia', '==', 'Pendente'))
      : null
  );
  const [atividadesSnap, , atividadesError] = useCollection(
    selectedObraId 
      ? query(collection(db, 'atividades'), where('obraId', '==', selectedObraId))
      : null
  );

  const [conferencias, setConferencias, limparRascunhoConferencias] = useAutoSaveForm<Record<string, number>>('rascunho-checklist-conferencias', {});
  const [avancos, setAvancos, limparRascunhoAvancos] = useAutoSaveForm<Record<string, number>>('rascunho-checklist-avancos', {});
  const [selectedEquipeIds, setSelectedEquipeIds, limparRascunhoEquipe] = useAutoSaveForm<string[]>('rascunho-checklist-equipe', []);
  const [obs, setObs, limparRascunhoObs] = useAutoSaveForm('rascunho-checklist-observacoes', '');
  const [uploading, setUploading] = useState(false);
  const { photoFile, photoPreview, applyPhotoFile, clearPhoto } = usePhotoCapture(
    () => notify('warning', 'Arquivo Muito Grande', 'A foto deve ter no máximo 5MB.')
  );
  const [showCamera, setShowCamera] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const todasObras = (obrasSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Obra[]) || [];
  const obras = todasObras.filter(o => o.status === 'Ativa');
  const materiais = (materiaisSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]) || [];
  const atividades = (atividadesSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Atividade[]) || [];
  const todosOperadores = (operadoresSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Operator[]) || [];
  const encarregados = (encarregadosSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Operator[]) || [];
  const loadError = obrasError || operadoresError || adminAccessError || encarregadosError || materiaisError || atividadesError;

  const adminEmails = new Set(
    (adminAccessSnap?.docs || [])
      .map(d => d.id)
      .filter(id => id.startsWith('email:'))
      .map(id => id.replace('email:', '').toLowerCase())
  );

  const encarregadoIds = new Set(encarregados.map(e => e.id));
  const currentUserEmail = auth.currentUser?.email?.toLowerCase() || '';

  const isAdminOp = (op: Operator) =>
    op.role === 'admin' || adminEmails.has((op.email || '').toLowerCase());

  const isCurrentUser = (op: Operator) =>
    (!!userProfile?.id && op.id === userProfile.id) ||
    (!!currentUserEmail && (op.email || '').toLowerCase() === currentUserEmail);

  // Operadores puros: não são encarregados, não são admins, não são o usuário logado
  const pureOperators = todosOperadores.filter(op =>
    !encarregadoIds.has(op.id) && !isAdminOp(op) && !isCurrentUser(op)
  );

  // Encarregados: não são admins, não são o usuário logado
  const filteredEncarregados = encarregados.filter(enc =>
    !isAdminOp(enc) && !isCurrentUser(enc)
  );

  const todosParaEquipe: Operator[] = [...pureOperators, ...filteredEncarregados];

  const selectedObra = obras.find(o => o.id === selectedObraId);
  const operadores = selectedObra?.operadoresIds?.length
    ? todosParaEquipe.filter(op => selectedObra.operadoresIds?.includes(op.id))
    : todosParaEquipe;

  const handleFinish = async () => {
    if (!selectedObraId) return notify('warning', 'Atenção', 'Selecione uma obra antes de finalizar.');

    setUploading(true);
    try {
      let photoUrl = '';
      if (photoFile) {
        photoUrl = await uploadPhoto(photoFile, 'checklists');
      }

      const batch = writeBatch(db);

      // 1. Create Checklist record
      const checklistData = {
        obraId: selectedObraId,
        operatorId: auth.currentUser?.id || 'anonymous',
        data: serverTimestamp(),
        nomeResponsavel: (auth.currentUser?.user_metadata?.name || auth.currentUser?.email) || 'Sistema',
        observacoes: obs,
        photoUrl: photoUrl || '',
        equipeIds: selectedEquipeIds,
        attachments: [],
        materiais: Object.entries(conferencias).map(([id, qty]) => ({
          materialId: id,
          qtdConferida: Number(qty) || 0
        })),
        progresso: Object.entries(avancos).map(([id, qty]) => ({
          atividadeId: id,
          qtdExecutadaNoDia: Number(qty) || 0
        }))
      };

      const checklistRef = doc(collection(db, 'checklists'));
      batch.set(checklistRef, checklistData);

      // 2. Update Materials status
      Object.entries(conferencias).forEach(([id, qty]) => {
        const mat = materiais.find(m => m.id === id);
        if (mat) {
          const matRef = doc(db, 'materiais', id);
          const conferredQty = Number(qty) || 0;
          batch.update(matRef, {
            statusConferencia: conferredQty >= mat.quantidade ? 'Conferido' : 'Divergente'
          });
        }
      });

      // 3. Update Atividades progress
      Object.entries(avancos).forEach(([id, qty]) => {
        const ativ = atividades.find(a => a.id === id);
        if (ativ) {
          const ativRef = doc(db, 'atividades', id);
          const addedQty = Number(qty) || 0;
          batch.update(ativRef, {
            quantidadeExecutada: increment(addedQty),
            updatedAt: serverTimestamp()
          });
        }
      });

      await batch.commit();

      // Atualiza snapshot de progresso diário com os totais já salvos no banco
      try {
        await refreshDailyProgressSnapshot();
      } catch (_) {
        // Não-crítico: não falha o checklist se o snapshot falhar
      }

      sendBrowserNotification('Checklist Enviado!', `Relatório da obra ${todasObras.find(o => o.id === selectedObraId)?.nome} finalizado.`);

      notify('success', 'Relatório Concluído', 'Checklist finalizado e enviado com sucesso!');
      limparRascunhoEtapa();
      limparRascunhoObraChecklist();
      limparRascunhoConferencias();
      limparRascunhoAvancos();
      limparRascunhoEquipe();
      limparRascunhoObs();
      navigate(isAdmin ? '/relatorios' : '/progresso');
    } catch (err: any) {
      const errorMessage = err?.message || err?.details || 'Tente novamente.';
      notify('error', 'Erro ao Finalizar', `Não foi possível concluir o checklist: ${errorMessage}`);
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) applyPhotoFile(file);
    e.target.value = '';
  };

  const handleCameraCapture = (file: File) => {
    setShowCamera(false);
    applyPhotoFile(file);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-24 animate-in fade-in duration-500">
      <div data-tour="check-header" className="flex items-center justify-between border-b border-zinc-200 pb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 sm:w-12 sm:h-12 bg-zinc-900 rounded-xl flex items-center justify-center text-white shadow-lg shrink-0">
            <ClipboardCheck className="w-4 h-4 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-2xl font-bold tracking-tight text-zinc-900 truncate">Checklist Diário</h2>
            <p className="text-zinc-500 text-xs truncate">Conferência e avanço de campo.</p>
          </div>
        </div>
        <div className="flex gap-1.5 sm:gap-2">
          {[1, 2, 3, 4].map(step => (
            <div
              key={step}
              className={cn(
                "w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all border-2",
                activeStep >= step ? "bg-zinc-900 border-zinc-900 text-white" : "bg-white border-zinc-200 text-zinc-400"
              )}
            >
              {step}
            </div>
          ))}
        </div>
      </div>

      {loadError && (
        <ChecklistLoadError
          title="Erro ao carregar checklist"
          message={loadError.message}
        />
      )}

      {activeStep === 1 && (
        <section className="space-y-4 animate-in slide-in-from-right duration-300">
          <div data-tour="check-obra" className="bg-white p-4 sm:p-8 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
            <div className="text-center space-y-1">
              <h3 className="text-base sm:text-xl font-bold text-zinc-900 tracking-tight">Qual obra estamos acompanhando hoje?</h3>
              <p className="text-zinc-500 text-xs sm:text-sm">Selecione a obra para carregar os materiais e atividades.</p>
            </div>
            <div className="grid gap-3">
              {obras.map(obra => (
                <button
                  key={obra.id}
                  onClick={() => setSelectedObraId(obra.id)}
                  className={cn(
                    "w-full overflow-hidden p-3 sm:p-5 rounded-xl border text-left transition-all flex items-center gap-3",
                    selectedObraId === obra.id
                      ? "bg-zinc-900 border-zinc-900 text-white shadow-lg"
                      : "bg-zinc-50 border-zinc-200 hover:border-zinc-400 text-zinc-900"
                  )}
                >
                  <div className={cn("p-1.5 rounded-lg shrink-0", selectedObraId === obra.id ? "bg-zinc-800" : "bg-white border border-zinc-200")}>
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold tracking-tight text-sm break-words">{obra.nome}</p>
                    <p className={cn("text-xs break-words", selectedObraId === obra.id ? "text-zinc-400" : "text-zinc-500")}>
                      {obra.cliente} • CC: {obra.centroCusto}
                    </p>
                  </div>
                  {selectedObraId === obra.id && <CheckCircle2 className="w-4 h-4 text-white shrink-0" />}
                </button>
              ))}
            </div>
            <button
              disabled={!selectedObraId}
              onClick={() => setActiveStep(2)}
              className="w-full py-3.5 bg-zinc-900 text-white rounded-xl font-bold uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 text-sm"
            >
              Próximo Passo
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {activeStep === 2 && (
        <section className="space-y-4 animate-in slide-in-from-right duration-300">
          <div>
            <h3 className="text-base sm:text-xl font-bold text-zinc-900 flex items-center gap-2">
              <Package className="w-5 h-5 text-zinc-400" />
              Conferência de Materiais ({materiais.length})
            </h3>
            <p className="text-zinc-500 text-xs sm:text-sm">Informe as quantidades recebidas e conferidas.</p>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="divide-y divide-zinc-100">
              {materiais.length > 0 ? materiais.map(mat => (
                <div key={mat.id} className="p-3 sm:p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">#{mat.codigoEntrega}</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">{mat.categoria}</span>
                    </div>
                    <p className="text-sm font-bold text-zinc-900 break-words">{mat.descricao}</p>
                    <p className="text-xs text-zinc-500">Esperado: <b>{mat.quantidade} {mat.unidade}</b></p>
                  </div>
                  <div className="flex items-center gap-1.5 bg-zinc-50 p-1.5 rounded-xl border border-zinc-200 shrink-0">
                    <button
                      onClick={() => setConferencias(prev => ({ ...prev, [mat.id]: Math.max(0, (prev[mat.id] || 0) - 1) }))}
                      className="w-8 h-8 flex items-center justify-center bg-white border border-zinc-200 rounded-lg hover:bg-zinc-100 font-bold text-lg"
                    >-</button>
                    <input
                      type="number"
                      className="w-14 bg-transparent text-center font-bold text-sm focus:outline-none"
                      value={!conferencias[mat.id] ? '' : conferencias[mat.id]}
                      min="0"
                      onKeyDown={(e) => ['-', '+', 'e', 'E'].includes(e.key) && e.preventDefault()}
                      onChange={(e) => {
                        const val = Math.max(0, parseInt(e.target.value) || 0);
                        setConferencias(prev => ({ ...prev, [mat.id]: val }));
                      }}
                    />
                    <button
                      onClick={() => setConferencias(prev => ({ ...prev, [mat.id]: (prev[mat.id] || 0) + 1 }))}
                      className="w-8 h-8 flex items-center justify-center bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 font-bold text-lg"
                    >+</button>
                  </div>
                </div>
              )) : (
                <div className="p-10 text-center space-y-3">
                  <AlertCircle className="w-8 h-8 text-zinc-300 mx-auto" />
                  <p className="text-zinc-500 font-medium text-sm">Não há materiais pendentes para esta obra.</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setActiveStep(1)} className="flex-1 py-3.5 bg-white text-zinc-600 rounded-xl font-bold border border-zinc-200 hover:bg-zinc-50 transition-all uppercase tracking-widest text-sm">
              Voltar
            </button>
            <button onClick={() => setActiveStep(3)} className="flex-[2] py-3.5 bg-zinc-900 text-white rounded-xl font-bold uppercase tracking-widest hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 text-sm">
              Próximo Passo
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {activeStep === 3 && (
        <section className="space-y-4 animate-in slide-in-from-right duration-300">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base sm:text-xl font-bold text-zinc-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-zinc-400" />
                Equipe em Campo
              </h3>
              <p className="text-zinc-500 text-xs sm:text-sm">Quem está trabalhando na obra agora?</p>
            </div>
            <button
              onClick={() => {
                if (selectedEquipeIds.length === operadores.length) {
                  setSelectedEquipeIds([]);
                } else {
                  setSelectedEquipeIds(operadores.map(o => o.id));
                }
              }}
              className="text-xs font-bold text-zinc-900 bg-zinc-100 px-3 py-2 rounded-lg hover:bg-zinc-200 transition-colors uppercase tracking-widest flex items-center gap-1.5"
            >
              <UserPlus className="w-3 h-3" />
              <span className="hidden sm:inline">{selectedEquipeIds.length === operadores.length ? 'Remover Todos' : 'Adicionar Todos'}</span>
              <span className="sm:hidden">{selectedEquipeIds.length === operadores.length ? 'Remover' : 'Todos'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-2 gap-2 sm:gap-4">
            {operadores.map(op => {
              const isSelected = selectedEquipeIds.includes(op.id);
              return (
                <button
                  key={op.id}
                  onClick={() => {
                    setSelectedEquipeIds(prev =>
                      isSelected ? prev.filter(id => id !== op.id) : [...prev, op.id]
                    );
                  }}
                  className={cn(
                    "p-3 sm:p-4 rounded-2xl border transition-all flex items-center gap-2 sm:gap-4 text-left",
                    isSelected
                      ? "bg-zinc-900 border-zinc-900 text-white shadow-lg"
                      : "bg-white border-zinc-200 hover:border-zinc-400 text-zinc-900"
                  )}
                >
                  <div className={cn(
                    "w-9 h-9 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-sm sm:text-lg shrink-0",
                    isSelected ? "bg-zinc-800" : "bg-zinc-100 text-zinc-400"
                  )}>
                    {op.nome?.[0] || '?'}{op.sobrenome?.[0] || ''}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold break-words text-sm">{op.nome} {op.sobrenome}</p>
                    <p className={cn("text-[10px] uppercase tracking-widest font-bold", isSelected ? "text-zinc-400" : "text-zinc-500")}>
                      {op.funcao || 'Operador'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {operadores.length === 0 && (
            <div className="p-10 text-center bg-white rounded-2xl border border-dashed border-zinc-200">
              <Users className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
              <p className="text-zinc-500 font-medium text-sm">Nenhum operador {selectedObra?.operadoresIds?.length ? 'atribuído a esta obra' : 'cadastrado'}.</p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setActiveStep(2)} className="flex-1 py-3.5 bg-white text-zinc-600 rounded-xl font-bold border border-zinc-200 hover:bg-zinc-50 transition-all uppercase tracking-widest text-sm">
              Voltar
            </button>
            <button onClick={() => setActiveStep(4)} className="flex-[2] py-3.5 bg-zinc-900 text-white rounded-xl font-bold uppercase tracking-widest hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 text-sm">
              Próximo Passo
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {activeStep === 4 && (
        <section className="space-y-4 animate-in slide-in-from-right duration-300">
          <div>
            <h3 className="text-base sm:text-xl font-bold text-zinc-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-zinc-400" />
              Avanço de Mão de Obra
            </h3>
            <p className="text-zinc-500 text-xs sm:text-sm">Registre o quanto foi executado de cada serviço no dia.</p>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="divide-y divide-zinc-100">
              {atividades.length > 0 ? atividades.map(ativ => (
                <div key={ativ.id} className="p-3 sm:p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-900 break-words">{ativ.descricao}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full transition-all duration-500",
                            ativ.percentual < 50 ? "bg-red-400" : ativ.percentual < 100 ? "bg-amber-400" : "bg-green-500"
                          )}
                          style={{ width: `${ativ.percentual}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-zinc-400 shrink-0">
                        {ativ.quantidadeExecutada}/{ativ.quantidadePrevista} {ativ.unidade} · {Math.round(ativ.percentual)}%
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      placeholder="0"
                      className="w-16 bg-zinc-50 border border-zinc-200 px-2 py-1.5 rounded-xl text-sm font-bold text-center focus:ring-2 focus:ring-zinc-900/10 outline-none"
                      value={!avancos[ativ.id] ? '' : avancos[ativ.id]}
                      min="0"
                      onKeyDown={(e) => ['-', '+', 'e', 'E'].includes(e.key) && e.preventDefault()}
                      onChange={(e) => {
                        const val = Math.max(0, parseFloat(e.target.value) || 0);
                        setAvancos(prev => ({ ...prev, [ativ.id]: val }));
                      }}
                    />
                    <span className="text-xs font-bold text-zinc-400 w-6">{ativ.unidade}</span>
                  </div>
                </div>
              )) : (
                 <div className="p-12 text-center flex flex-col items-center gap-4">
                  <AlertCircle className="w-8 h-8 text-zinc-300" />
                  <p className="text-zinc-500 font-medium">Nenhuma atividade cadastrada para esta obra.</p>
                  <button onClick={() => navigate('/progresso')} className="text-sm font-bold text-zinc-900 underline active:opacity-50">Cadastrar Atividades</button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 pl-1">
              <label className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Foto de Evidência / Ocorrência</label>
              <span className="text-[10px] font-bold text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full uppercase tracking-widest">Opcional</span>
            </div>
            {photoPreview ? (
              <div className="relative w-full aspect-video rounded-xl overflow-hidden border-2 border-dashed border-zinc-300">
                <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                <button
                  onClick={clearPhoto}
                  className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full shadow-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCamera(true)}
                  className="flex-1 flex flex-col items-center justify-center gap-1.5 py-4 bg-white border-2 border-dashed border-zinc-200 rounded-2xl hover:border-zinc-400 hover:bg-zinc-50 transition-all"
                >
                  <Camera className="w-6 h-6 text-zinc-400" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Tirar Foto</span>
                </button>
                <label className="flex-1 flex flex-col items-center justify-center gap-1.5 py-4 bg-white border-2 border-dashed border-zinc-200 rounded-2xl hover:border-zinc-400 hover:bg-zinc-50 transition-all cursor-pointer">
                  <Paperclip className="w-6 h-6 text-zinc-400" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Da Galeria</span>
                  <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                </label>
              </div>
            )}
          </div>
          {showCamera && (
            <ChecklistCamera onCapture={handleCameraCapture} onClose={() => setShowCamera(false)} />
          )}

          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-600 uppercase tracking-widest pl-1">Observações do Fechamento</label>
            <textarea
              className="w-full h-24 sm:h-32 p-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none text-sm resize-none"
              placeholder="Alguma divergência ou aviso importante?"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
            />
          </div>

          <div className="p-4 sm:p-6 bg-zinc-900 rounded-2xl border border-zinc-800 text-white space-y-4 shadow-2xl">
            <div>
              <h4 className="text-base font-bold tracking-tight">Finalizar Relatório</h4>
              <p className="text-zinc-400 text-xs sm:text-sm mt-0.5">Os dados serão consolidados e enviados para o financeiro.</p>
            </div>

            <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl border border-zinc-700">
              <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
                {auth.currentUser?.user_metadata?.avatar_url ? (
                  <img src={auth.currentUser.user_metadata.avatar_url} className="w-9 h-9 rounded-full" />
                ) : <User className="w-4 h-4 text-zinc-400" />}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Assinado por:</p>
                <p className="text-sm font-bold break-all">{(auth.currentUser?.user_metadata?.name || auth.currentUser?.email)}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setActiveStep(3)}
                className="flex-1 py-3.5 bg-zinc-800 text-white rounded-xl font-bold border border-zinc-700 hover:bg-zinc-700 transition-all uppercase tracking-widest text-sm"
              >
                Voltar
              </button>
              <button
                onClick={handleFinish}
                disabled={uploading}
                className="flex-[2] py-3.5 bg-white text-zinc-900 rounded-xl font-bold uppercase tracking-widest hover:bg-zinc-100 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 text-sm"
              >
                <Save className="w-4 h-4" />
                {uploading ? 'Enviando...' : 'Finalizar Checklist'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function ChecklistLoadError({ title, message }: { title: string; message?: string }) {
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

function ChecklistCamera({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [focusMessage, setFocusMessage] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);

  const applyFocus = async (stream: MediaStream, point?: { x: number; y: number }) => {
    const track = stream.getVideoTracks()[0];
    if (!track?.applyConstraints) return false;

    const capabilities = (track.getCapabilities?.() || {}) as any;
    const advanced: Record<string, unknown>[] = [];

    if (Array.isArray(capabilities.focusMode)) {
      if (capabilities.focusMode.includes('continuous')) advanced.push({ focusMode: 'continuous' });
      else if (capabilities.focusMode.includes('single-shot')) advanced.push({ focusMode: 'single-shot' });
      else if (capabilities.focusMode.includes('auto')) advanced.push({ focusMode: 'auto' });
    }

    if (point && 'pointsOfInterest' in capabilities) {
      advanced.push({ pointsOfInterest: [point] });
    }

    if (advanced.length === 0) return false;

    try {
      await track.applyConstraints({ advanced } as MediaTrackConstraints);
      return true;
    } catch {
      return false;
    }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Câmera não disponível neste navegador. Use a opção de escolher foto.');
      return;
    }

    stopStream();
    setReady(false);
    setCamError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      void applyFocus(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        try {
          await videoRef.current.play();
          setReady(true);
        } catch {
          setReady(false);
        }
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setCamError(err?.name === 'NotAllowedError' ? 'Permissão de câmera negada. Libere nas configurações.' : 'Câmera não disponível neste dispositivo.');
    }
  };

  const handleTapToFocus = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (!streamRef.current || captured || camError) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const focused = await applyFocus(streamRef.current, { x, y });
    setFocusMessage(focused ? 'Foco ajustado' : 'Autofoco do navegador');
    window.setTimeout(() => setFocusMessage(null), 1200);
  };

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      stopStream();
    };
  }, []);

  const handleCapture = () => {
    if (!videoRef.current || !ready) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      stopStream();
      const file = new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setCapturedFile(file);
      setCaptured(URL.createObjectURL(blob));
    }, 'image/jpeg', 0.88);
  };

  const handleConfirm = () => {
    if (capturedFile) { onCapture(capturedFile); if (captured) URL.revokeObjectURL(captured); }
  };

  const handleFileFallback = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onCapture(file);
    event.target.value = '';
  };

  const handleRetake = () => {
    if (captured) URL.revokeObjectURL(captured);
    setCaptured(null); setCapturedFile(null);
    void startCamera();
  };

  const handleClose = () => { stopStream(); if (captured) URL.revokeObjectURL(captured); onClose(); };

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col" style={{ touchAction: 'none' }}>
      <div className="flex items-center justify-between p-4 shrink-0">
        <button type="button" onClick={handleClose} className="p-2 text-white hover:bg-white/10 rounded-xl transition-colors">
          <X className="w-6 h-6" />
        </button>
        <span className="text-white text-sm font-bold uppercase tracking-widest">{captured ? 'Confirmar Foto' : 'Tirar Foto'}</span>
        <div className="w-10" />
      </div>
      <div className="flex-1 relative overflow-hidden bg-black" onPointerDown={handleTapToFocus}>
        {camError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <AlertCircle className="w-16 h-16 text-red-400" />
            <p className="text-white text-sm">{camError}</p>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="px-6 py-3 bg-white text-black rounded-xl font-bold text-sm">Escolher Foto</button>
            <button type="button" onClick={handleClose} className="px-6 py-3 border border-white/20 text-white rounded-xl font-bold text-sm">Fechar</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileFallback}
            />
          </div>
        ) : captured ? (
          <img src={captured} className="w-full h-full object-contain" alt="Captura" />
        ) : (
          <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
        )}
        {!captured && !camError && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/45 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-white">
            {focusMessage || 'Toque na tela para focar'}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center justify-center gap-6 p-8 bg-black">
        {captured ? (
          <>
            <button type="button" onClick={handleRetake} className="flex-1 py-4 rounded-2xl border-2 border-white/20 text-white font-bold text-sm hover:bg-white/10 transition-all">Tirar Novamente</button>
            <button type="button" onClick={handleConfirm} className="flex-1 py-4 rounded-2xl bg-white text-black font-bold text-sm hover:bg-zinc-100 transition-all flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5" /> Usar Esta Foto
            </button>
          </>
        ) : (
          <button type="button" onClick={handleCapture} disabled={!ready} className="w-20 h-20 rounded-full bg-white border-4 border-zinc-400 shadow-2xl hover:scale-95 active:scale-90 transition-transform disabled:opacity-40" aria-label="Capturar foto" />
        )}
      </div>
    </div>
  );
}
