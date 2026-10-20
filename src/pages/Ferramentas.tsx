import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useCollection } from '../lib/supabaseHooks';
import { collection, addDoc, updateDoc, doc, serverTimestamp, query, orderBy, limit, writeBatch, where, getDocs, deleteDoc } from '../lib/supabaseDb';
import { db, handleFirestoreError, OperationType, auth } from '../lib/supabase';
import { Tool, ToolLog, Obra } from '../types';
import {
  Hammer,
  Wrench,
  ArrowUpRight,
  ArrowDownLeft,
  User,
  Building2,
  Calendar,
  Camera,
  Images,
  CheckCircle2,
  Clock,
  Plus,
  History,
  X,
  AlertCircle,
  QrCode,
  Edit2,
  Trash2,
  Search,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { uploadPhoto, requestNotificationPermission, sendBrowserNotification } from '../lib/services';
import { Html5Qrcode } from 'html5-qrcode';
import { useAuth } from '../App';
import { registerPushForUser } from '../lib/push';
import { parseDate } from '../lib/dateUtils';
import { CameraCapture } from '../components/CameraCapture';


// Reaproveita o helper compartilhado (antes havia uma cópia local idêntica).
const parseMovementDateForScope = parseDate;

const createMovementActivityId = (prefix = 'mov') => {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

  return `${prefix}_${Date.now()}_${randomPart}`;
};

const normalizeHashValue = (value: any) => {
  if (value === undefined || value === null) return '';
  const parsedDate = parseMovementDateForScope(value);
  if (parsedDate) return parsedDate.toISOString();
  return String(value).trim();
};

const createMovementScopeHash = (parts: any[]) => {
  const source = parts.map(normalizeHashValue).join('|');
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }

  return `mov_${Math.abs(hash).toString(36)}`;
};

const DIA_MS = 86400000;

const TOOL_CATEGORY_SUGGESTIONS = [
  'Medição e Teste',
  'Ferramentas Manuais',
  'Ferramentas Elétricas',
  'SPDA / Aterramento',
  'Escadas e Acesso',
  'Segurança / EPI',
  'Cabos e Extensões',
  'Solda / Corte',
  'Limpeza / Apoio',
  'Outros',
];

const sortToolCategories = (categories: string[]) => (
  [...categories].sort((a, b) => {
    if (a === 'Outros') return 1;
    if (b === 'Outros') return -1;
    return a.localeCompare(b);
  })
);

// Previsão de devolução: usa o campo salvo ou calcula a partir de dataSaida + diasUso.
const getPrevisaoDevolucao = (log?: ToolLog | null): Date | null => {
  if (!log) return null;
  if (log.previsaoDevolucao) {
    const p = parseMovementDateForScope(log.previsaoDevolucao);
    if (p) return p;
  }
  const saida = parseMovementDateForScope(log.dataSaida);
  if (saida && typeof log.diasUso === 'number' && log.diasUso > 0) {
    return new Date(saida.getTime() + log.diasUso * DIA_MS);
  }
  return null;
};

// Atrasada: log aberto cuja previsão de devolução já passou.
const isLogAtrasado = (log?: ToolLog | null): boolean => {
  if (!log || log.statusLog !== 'Aberta') return false;
  const prev = getPrevisaoDevolucao(log);
  return !!prev && Date.now() > prev.getTime();
};

export default function Ferramentas() {
  const { isAdmin, userProfile, notify } = useAuth();

  // Estado dos modais declarado ANTES dos hooks de coleção para que anyModalOpen
  // esteja disponível ao configurar o Realtime (hooks devem seguir a mesma ordem).
  const [showAddTool, setShowAddTool] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [showHistory, setShowHistory] = useState<Tool | null>(null);
  const [showCheckOut, setShowCheckOut] = useState<Tool | null>(null);
  const [showCheckIn, setShowCheckIn] = useState<ToolLog | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const meuId = userProfile?.id || auth.currentUser?.id || '';

  // Quando qualquer modal está aberto, congela atualizações do Realtime para não
  // causar re-renders visíveis durante captura de foto no mobile.
  const anyModalOpen = !!(showAddTool || editingTool || showHistory || showCheckOut || showCheckIn || showScanner);

  const [toolsSnap, , toolsError] = useCollection(query(collection(db, 'tools'), orderBy('nome', 'asc')), anyModalOpen);
  const [logsSnap, , logsError] = useCollection(query(collection(db, 'toolLogs'), orderBy('dataSaida', 'desc'), limit(50)), anyModalOpen);
  const [myOpenLogsSnap, , myOpenLogsError] = useCollection(
    meuId
      ? query(collection(db, 'toolLogs'), where('responsavelId', '==', meuId), where('statusLog', '==', 'Aberta'), orderBy('dataSaida', 'desc'), limit(100))
      : null,
    anyModalOpen
  );
  const [obrasSnap, , obrasError] = useCollection(query(collection(db, 'obras'), orderBy('nome', 'asc')), anyModalOpen);

  const tools = (toolsSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Tool[]) || [];
  const logs = (logsSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ToolLog[]) || [];
  const minhasRetiradas = (myOpenLogsSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ToolLog[]) || [];

  const obras = (obrasSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Obra[]) || [];
  const toolCategories = useMemo(() => {
    const values = new Set(TOOL_CATEGORY_SUGGESTIONS);
    tools.forEach(tool => {
      const categoria = tool.categoria?.trim();
      if (categoria) values.add(categoria);
    });
    return sortToolCategories(Array.from(values));
  }, [tools]);

  const filteredTools = tools.filter(tool => {
    const q = search.trim().toLowerCase();
    const matchesCategory = categoryFilter === 'Todas' || (tool.categoria || '') === categoryFilter;
    if (!matchesCategory) return false;
    if (!q) return true;
    return [
      tool.nome,
      tool.codigo,
      tool.modelo,
      tool.categoria,
      tool.descricao,
      tool.status,
    ].some(value => String(value || '').toLowerCase().includes(q));
  });

  // Inscreve o dispositivo para receber push de atraso (idempotente).
  useEffect(() => {
    const uid = userProfile?.id || auth.currentUser?.id;
    if (uid) registerPushForUser(uid);
  }, [userProfile?.id]);

  // ── Ferramentas atrasadas do usuário logado ──────────────────────────────────
  const meusAtrasados = minhasRetiradas.filter(l => isLogAtrasado(l));
  // Assinatura estável: só dispara quando o conjunto de atrasados muda.
  const atrasadosKey = useMemo(
    () => meusAtrasados.map(l => l.id).sort().join(','),
    [meusAtrasados.map(l => l.id).sort().join(',')] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!atrasadosKey) return;
    requestNotificationPermission();

    const avisar = () => {
      meusAtrasados.forEach(l => {
        const t = tools.find(tt => tt.id === l.toolId);
        notify(
          'warning',
          'Ferramenta em atraso',
          `"${t?.nome || 'Ferramenta'}" passou do prazo de devolução. Renove ou devolva o quanto antes.`
        );
      });
      sendBrowserNotification(
        'Ferramenta em atraso',
        `Você tem ${meusAtrasados.length} ferramenta(s) fora do prazo. Renove ou devolva.`
      );
    };

    avisar();
    const id = setInterval(avisar, 1000 * 60 * 5); // "spam" a cada 5 minutos enquanto houver atraso
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atrasadosKey]);

  const handleScanSuccess = React.useCallback((decodedText: string) => {
    const tool = tools.find(t => t.codigo === decodedText || t.id === decodedText);
    if (tool) {
      setShowScanner(false);
      const activeLog = logs.find(l => l.id === tool.lastLogId && l.statusLog === 'Aberta');
      if (activeLog) {
        setShowCheckIn(activeLog);
      } else if (tool.status === 'Disponível') {
        setShowCheckOut(tool);
      } else {
        notify('warning', 'Material Indisponível', `A ferramenta "${tool.nome}" já está sendo utilizada por outro colaborador.`);
      }
    } else {
      notify('error', 'Não Encontrado', `Equipamento com código "${decodedText}" não cadastrado no sistema.`);
    }
  }, [tools, logs]);

  const loadError = toolsError || logsError || myOpenLogsError || obrasError;

  return (
    <>
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <div data-tour="tools-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Gestão de Ferramentas</h2>
          <p className="text-zinc-500">Controle de retirada e devolução de equipamentos.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            data-tour="tools-scan"
            onClick={() => setShowScanner(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-white border border-zinc-200 text-zinc-600 rounded-xl text-sm font-bold hover:bg-zinc-50 transition-all shadow-sm active:scale-95"
          >
            <QrCode className="w-4 h-4" />
            Escanear Código
          </button>
          {isAdmin && (
            <button
              data-tour="tools-add"
              onClick={() => setShowAddTool(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Nova Ferramenta
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <DataLoadError
          title="Erro ao carregar ferramentas"
          message={loadError.message}
        />
      )}

      <div className="lg:hidden">
        <MyToolsPanel
          logs={minhasRetiradas}
          tools={tools}
          obras={obras}
          onReturn={(log) => setShowCheckIn(log)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tool Inventory */}
        <div data-tour="tools-inventory" className="lg:col-span-2 space-y-4">
          <div className="flex min-h-[46px] flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Inventário de Equipamentos</h3>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Buscar ferramenta..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 shadow-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="w-full sm:w-56 px-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 shadow-sm"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="Todas">Todas as categorias</option>
                {toolCategories.map(categoria => (
                  <option key={categoria} value={categoria}>{categoria}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredTools.map((tool) => (
              <ToolCard 
                key={tool.id} 
                tool={tool} 
                onCheckOut={() => setShowCheckOut(tool)} 
                activeLog={logs.find(l => l.id === tool.lastLogId && l.statusLog === 'Aberta')}
                onCheckIn={(log) => setShowCheckIn(log)}
                onEdit={() => setEditingTool(tool)}
                onViewHistory={() => setShowHistory(tool)}
              />
            ))}
            {filteredTools.length === 0 && (
              <div className="sm:col-span-2 bg-white rounded-2xl border border-dashed border-zinc-200 p-10 text-center">
                <Hammer className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                <p className="text-sm font-semibold text-zinc-400">Nenhuma ferramenta encontrada.</p>
              </div>
            )}
          </div>
        </div>

        {/* My tools */}
        <div data-tour="tools-history" className="space-y-4">
          <div className="hidden lg:block space-y-3">
            <div className="flex min-h-[46px] items-center">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Ferramentas comigo</h3>
            </div>
            <div className="bg-white rounded-3xl border border-zinc-200 overflow-hidden shadow-sm">
              <div className="p-4 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <User className="w-4 h-4 text-zinc-400 shrink-0" />
                  <span className="text-xs font-bold text-zinc-600 truncate">Retiradas abertas</span>
                </div>
                <span className="text-[10px] font-black px-2 py-1 rounded-full bg-zinc-900 text-white">
                  {minhasRetiradas.length}
                </span>
              </div>
              <div className="divide-y divide-zinc-100 max-h-[52vh] sm:max-h-[520px] lg:max-h-[calc(100dvh-260px)] overflow-y-auto">
                {minhasRetiradas.length === 0 ? (
                  <div className="p-8 text-center">
                    <Wrench className="w-8 h-8 text-zinc-200 mx-auto mb-3" />
                    <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Nenhuma ferramenta com você</p>
                  </div>
                ) : minhasRetiradas.map((log) => (
                  <MyToolItem
                    key={log.id}
                    log={log}
                    tool={tools.find(t => t.id === log.toolId)}
                    obra={obras.find(o => o.id === log.obraId)}
                    onReturn={() => setShowCheckIn(log)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
    <AnimatePresence>
      {(showAddTool || editingTool) && (
        <AddToolModal
          tool={editingTool || undefined}
          categories={toolCategories}
          onClose={() => { setShowAddTool(false); setEditingTool(null); }}
        />
      )}
      {showHistory && (
        <ToolHistoryModal
          tool={showHistory}
          obras={obras}
          onClose={() => setShowHistory(null)}
        />
      )}
      {showCheckOut && (
        <CheckOutModal
          tool={showCheckOut}
          obras={obras}
          onClose={() => setShowCheckOut(null)}
        />
      )}
      {showCheckIn && (
        <CheckInModal
          log={showCheckIn}
          tool={tools.find(t => t.id === showCheckIn.toolId) || {
            id: showCheckIn.toolId,
            nome: 'Ferramenta removida',
            codigo: '---',
            status: 'Em Uso'
          } as Tool}
          onClose={() => setShowCheckIn(null)}
        />
      )}
      {showScanner && (
        <ScannerModal
          onSuccess={handleScanSuccess}
          onClose={() => setShowScanner(false)}
        />
      )}
    </AnimatePresence>
    </>
  );
}

function DataLoadError({ title, message }: { title: string; message?: string }) {
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

function ScannerModal({ onSuccess, onClose }: { onSuccess: (text: string) => void, onClose: () => void }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const { notify } = useAuth();

  useEffect(() => {
    const html5QrCode = new Html5Qrcode("reader");
    scannerRef.current = html5QrCode;

    const startScanner = async () => {
      try {
        // Try environment first, then fallback to any camera
        try {
          await html5QrCode.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
              aspectRatio: 1.0
            },
            async (text) => {
              try {
                if (html5QrCode.getState() === 2) {
                  await html5QrCode.stop();
                  await html5QrCode.clear();
                }
              } catch (e) {
                console.error("Erro ao parar scanner no sucesso:", e);
              }
              onSuccess(text);
            },
            () => {} 
          );
        } catch (firstErr: any) {
          console.warn("Câmera traseira não encontrada, tentando qualquer câmera...", firstErr);
          // Fallback: Use any available camera
          await html5QrCode.start(
            { facingMode: "user" }, // Try front as second option or just {}
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
              aspectRatio: 1.0
            },
            async (text) => {
              try {
                if (html5QrCode.getState() === 2) {
                  await html5QrCode.stop();
                  await html5QrCode.clear();
                }
              } catch (e) {
                console.error("Erro ao parar scanner no sucesso:", e);
              }
              onSuccess(text);
            },
            () => {}
          );
        }
      } catch (err: any) {
        console.error("Erro fatal ao iniciar câmera:", err);
        let msg = "Não foi possível acessar a câmera.";
        if (err?.name === "NotAllowedError") msg = "Permissão de câmera negada pelo navegador.";
        if (err?.name === "NotFoundError") msg = "Nenhuma câmera encontrada neste dispositivo.";
        setCameraError(msg);
        notify('error', 'Erro de Câmera', msg);
      }
    };

    const timer = setTimeout(startScanner, 300);

    return () => {
      clearTimeout(timer);
      const scanner = scannerRef.current;
      if (scanner && scanner.getState() === 2) { 
        scanner.stop().then(() => {
          scanner.clear();
        }).catch(err => console.error("Erro ao parar scanner:", err));
      }
    };
  }, [onSuccess, notify]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full sm:max-w-2xl rounded-3xl overflow-hidden shadow-2xl max-h-[90dvh] overflow-y-auto"
      >
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-zinc-900" />
            <h3 className="text-lg font-bold">Escanear Equipamento</h3>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">
          {cameraError ? (
            <div className="flex flex-col items-center justify-center aspect-square w-full rounded-2xl bg-red-50 border border-red-100 p-8 text-center gap-4">
              <AlertCircle className="w-12 h-12 text-red-500" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-red-600">{cameraError}</p>
                <p className="text-[10px] text-red-400 uppercase tracking-widest leading-relaxed">
                  Verifique as permissões do navegador ou tente usar outro dispositivo.
                </p>
              </div>
              <button 
                onClick={onClose}
                className="px-6 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-all"
              >
                Voltar
              </button>
            </div>
          ) : (
            <>
              <div className="relative aspect-square w-full rounded-2xl overflow-hidden border border-zinc-200 bg-black">
                <div id="reader" className="w-full h-full" />
                <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none">
                  <div className="w-full h-full border-2 border-white/50 border-dashed rounded-lg" />
                </div>
              </div>
              <div className="mt-6 flex flex-col items-center text-center space-y-2">
                <p className="text-sm font-medium text-zinc-600">Posicione o código QR no centro do quadro.</p>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest leading-relaxed">
                  Sistema identificará automaticamente a ferramenta cadastrada.
                </p>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function ToolCard({ tool, onCheckOut, activeLog, onCheckIn, onEdit, onViewHistory }: { 
  key?: string | number,
  tool: Tool, 
  onCheckOut: () => void, 
  activeLog?: ToolLog,
  onCheckIn: (log: ToolLog) => void,
  onEdit?: () => void,
  onViewHistory?: () => void
}) {
  const { isAdmin, isEncarregado, notify } = useAuth();
  const isAvailable = tool.status === 'Disponível';
  const canReturn = isAdmin || isEncarregado || (!!activeLog?.responsavelId && auth.currentUser?.id === activeLog.responsavelId);
  const atrasado = isLogAtrasado(activeLog);
  const previsao = getPrevisaoDevolucao(activeLog);
  const [renovando, setRenovando] = useState(false);

  const handleRenovar = async () => {
    if (!activeLog || renovando) return;
    const entrada = prompt('Renovar por quantos dias a mais?', '1');
    if (entrada === null) return;
    const extra = Math.floor(Number(entrada) || 0);
    if (extra < 1) {
      notify('warning', 'Atenção', 'Informe um número de dias válido (mínimo 1).');
      return;
    }
    setRenovando(true);
    try {
      const base = previsao && previsao.getTime() > Date.now() ? previsao.getTime() : Date.now();
      const novaPrevisao = new Date(base + extra * DIA_MS).toISOString();
      await updateDoc(doc(db, 'toolLogs', activeLog.id), {
        previsaoDevolucao: novaPrevisao,
        diasUso: (activeLog.diasUso || 0) + extra,
      });
      notify('success', 'Prazo Renovado', `Novo prazo de devolução: ${format(new Date(novaPrevisao), "dd/MM/yyyy 'às' HH:mm")}.`);
    } catch (err: any) {
      notify('error', 'Erro ao Renovar', err.message || 'Não foi possível renovar o prazo.');
      handleFirestoreError(err, OperationType.WRITE, 'tool-renew');
    } finally {
      setRenovando(false);
    }
  };

  return (
    <div className="bg-white p-5 rounded-3xl border border-zinc-200 shadow-sm hover:shadow-md transition-all group relative h-full flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-full bg-zinc-50 flex items-center justify-center text-zinc-900 group-hover:scale-110 transition-transform overflow-hidden shrink-0">
          {tool.fotoModelo
            ? <img src={tool.fotoModelo} className="w-full h-full object-cover" alt={tool.nome} />
            : (tool.nome || '').toLowerCase().includes('furadeira') ? <Wrench className="w-6 h-6" /> : <Hammer className="w-6 h-6" />
          }
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button 
              onClick={(e) => { e.stopPropagation(); onViewHistory?.(); }}
              className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
              title="Ver Histórico"
            >
              <History className="w-4 h-4" />
            </button>
            {isAdmin && (
              <>
                <button 
                  onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
                  className="p-2 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Editar Ferramenta"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={async (e) => { 
                    e.stopPropagation(); 
                    if (confirm(`Deseja remover a ferramenta "${tool.nome}"?`)) {
                      try {
                        await deleteDoc(doc(db, 'tools', tool.id));
                        notify('success', 'Sucesso', 'Ferramenta removida do estoque.');
                      } catch (err: any) {
                        notify('error', 'Erro ao Excluir', err.message || 'Não foi possível remover a ferramenta.');
                        handleFirestoreError(err, OperationType.DELETE, 'tools');
                      }
                    }
                  }}
                  className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Excluir Ferramenta"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
          <div className={cn(
            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
            atrasado ? "bg-red-100 text-red-700"
              : isAvailable ? "bg-green-100 text-green-700"
              : "bg-orange-100 text-orange-700"
          )}>
            {atrasado ? 'Atraso' : tool.status}
          </div>
        </div>
      </div>
      
      <div className="space-y-1 mb-6 overflow-hidden">
        <h4 className="font-bold text-zinc-900 break-words">{tool.nome}</h4>
        {tool.codigo && (
          <p
            className="text-[10px] text-zinc-400 font-mono bg-zinc-50 border border-zinc-100 rounded-md px-2 py-0.5 truncate"
            title={tool.codigo}
          >
            {tool.codigo}
          </p>
        )}
        <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-zinc-600">
          {tool.categoria && <p className="break-words"><span className="font-bold text-zinc-700">Categoria:</span> {tool.categoria}</p>}
          {tool.modelo && <p className="break-words"><span className="font-bold text-zinc-700">Modelo:</span> {tool.modelo}</p>}
          <p><span className="font-bold text-zinc-700">Valor:</span> {typeof tool.valor === 'number' ? tool.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Não informado'}</p>
          <p><span className="font-bold text-zinc-700">Compra:</span> {tool.dataCompra ? new Date(`${tool.dataCompra}T00:00:00`).toLocaleDateString('pt-BR') : 'Não informado'}</p>
        </div>
      </div>

      <div className="mt-auto">
      {activeLog ? (
        <div className="space-y-4">
          <div className={cn(
            "p-3 rounded-xl space-y-2 border",
            atrasado ? "bg-red-50 border-red-100" : "bg-zinc-50 border-transparent"
          )}>
            <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold uppercase">
              <User className="w-3 h-3" />
              {activeLog.responsavelNome}
            </div>
            {previsao && (
              <div className={cn(
                "flex items-center gap-2 text-[10px] font-bold",
                atrasado ? "text-red-600" : "text-zinc-500"
              )}>
                {atrasado ? <AlertCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                {atrasado ? 'Atrasada desde' : 'Devolver até'} {format(previsao, "dd/MM 'às' HH:mm")}
              </div>
            )}
          </div>
          {canReturn ? (
            <div className="flex gap-2">
              <button
                onClick={() => onCheckIn(activeLog)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-zinc-100 text-zinc-900 rounded-xl text-xs font-bold hover:bg-zinc-200 transition-all"
              >
                <ArrowDownLeft className="w-4 h-4" />
                Devolver
              </button>
              <button
                onClick={handleRenovar}
                disabled={renovando}
                className={cn(
                  "flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border disabled:opacity-50",
                  atrasado ? "bg-red-600 text-white border-red-600 hover:bg-red-700" : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                )}
                title="Renovar prazo de uso"
              >
                <Clock className="w-4 h-4" />
                {renovando ? '...' : 'Renovar'}
              </button>
            </div>
          ) : (
            <div className="w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-50 text-zinc-400 rounded-xl text-xs font-bold cursor-not-allowed border border-dashed border-zinc-200">
              <ArrowDownLeft className="w-4 h-4" />
              Só quem retirou pode devolver
            </div>
          )}
        </div>
      ) : (
        <button 
          onClick={onCheckOut}
          disabled={!isAvailable}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all",
            isAvailable ? "bg-zinc-900 text-white hover:bg-zinc-800" : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
          )}
        >
          <ArrowUpRight className="w-4 h-4" />
          Retirar
        </button>
      )}
      </div>
    </div>
  );
}

function MyToolsPanel({ logs, tools, obras, onReturn }: { logs: ToolLog[], tools: Tool[], obras: Obra[], onReturn: (log: ToolLog) => void }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Ferramentas comigo</h3>
      <div className="bg-white rounded-3xl border border-zinc-200 overflow-hidden shadow-sm">
        <div className="p-4 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <User className="w-4 h-4 text-zinc-400 shrink-0" />
            <span className="text-xs font-bold text-zinc-600 truncate">Retiradas abertas</span>
          </div>
          <span className="text-[10px] font-black px-2 py-1 rounded-full bg-zinc-900 text-white">
            {logs.length}
          </span>
        </div>
        <div className="divide-y divide-zinc-100 max-h-[56vh] sm:max-h-[520px] overflow-y-auto">
          {logs.length === 0 ? (
            <div className="p-8 text-center">
              <Wrench className="w-8 h-8 text-zinc-200 mx-auto mb-3" />
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Nenhuma ferramenta com você</p>
            </div>
          ) : logs.map((log) => (
            <MyToolItem
              key={log.id}
              log={log}
              tool={tools.find(t => t.id === log.toolId)}
              obra={obras.find(o => o.id === log.obraId)}
              onReturn={() => onReturn(log)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MyToolItem({ log, tool, obra, onReturn }: { log: ToolLog, tool?: Tool, obra?: Obra, onReturn: () => void }) {
  const outDate = parseMovementDateForScope(log.dataSaida) || new Date();
  const previsao = getPrevisaoDevolucao(log);
  const atrasado = isLogAtrasado(log);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={cn("w-2 h-2 rounded-full shrink-0", atrasado ? "bg-red-500 animate-pulse" : "bg-orange-500")} />
            <p className="text-sm font-black text-zinc-900 break-words">{tool?.nome || 'Ferramenta removida'}</p>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1 break-words">
            {tool?.codigo ? `#${tool.codigo} · ` : ''}{obra?.nome || 'Obra removida'}
          </p>
        </div>
        <span className={cn(
          "text-[9px] font-black px-2 py-1 rounded-full uppercase tracking-tight shrink-0",
          atrasado ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"
        )}>
          {atrasado ? 'Atrasada' : 'Em uso'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 text-xs">
        <div className="flex items-center gap-2 text-zinc-500">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold">Retirada em {format(outDate, "dd/MM/yyyy 'às' HH:mm")}</span>
        </div>
        {previsao && (
          <div className={cn("flex items-center gap-2", atrasado ? "text-red-600" : "text-zinc-500")}>
            {atrasado ? <AlertCircle className="w-3.5 h-3.5 shrink-0" /> : <Clock className="w-3.5 h-3.5 shrink-0" />}
            <span className="font-bold">Devolver até {format(previsao, "dd/MM/yyyy 'às' HH:mm")}</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onReturn}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-900 text-white text-xs font-black hover:bg-zinc-800 transition-colors"
      >
        <ArrowDownLeft className="w-4 h-4" />
        Devolver
      </button>
    </div>
  );
}

function LogItem({ log, tool, obra, showToolInfo = true }: { key?: string | number, log: ToolLog, tool?: Tool, obra?: Obra, showToolInfo?: boolean }) {
  const isPending = log.statusLog === 'Aberta';
  const outDate = parseMovementDateForScope(log.dataSaida) || new Date();
  const inDate = parseMovementDateForScope(log.dataDevolucao);
  const previsao = getPrevisaoDevolucao(log);
  const atrasado = isLogAtrasado(log);

  return (
    <div className="p-5 hover:bg-zinc-50 transition-colors border-b border-zinc-100 last:border-0">
      <div className="flex flex-col gap-3">
        {showToolInfo && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className={cn("w-2 h-2 rounded-full shrink-0", isPending ? "bg-orange-500 animate-pulse" : "bg-green-500")} />
            <span className="text-sm font-bold text-zinc-900 break-words">{tool?.nome || 'Ferramenta Removida'}</span>
            {tool?.codigo && (
              <span className="text-[10px] text-zinc-400 font-mono bg-zinc-100 rounded px-1.5 py-0.5 shrink-0" title={tool.codigo}>
                #{tool.codigo.length > 10 ? tool.codigo.slice(0, 10) + '…' : tool.codigo}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2">
          <div className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0 mt-0.5">
              <User className="w-3.5 h-3.5 text-zinc-500" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-tight">Responsável</p>
              <p className="text-xs font-bold text-zinc-900 break-words">{log.responsavelNome}</p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0 mt-0.5">
              <Building2 className="w-3.5 h-3.5 text-zinc-500" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-tight">Obra / Local</p>
              <p className="text-xs font-bold text-zinc-900 break-words">{obra?.nome || 'Obra Removida'}</p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0 mt-0.5">
              <Calendar className="w-3.5 h-3.5 text-zinc-500" />
            </div>
            <div>
              <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-tight">Saída em</p>
              <p className="text-xs font-bold text-zinc-900">{format(outDate, "dd/MM/yyyy")} às {format(outDate, "HH:mm")}</p>
            </div>
          </div>

          {previsao && (
            <div className="flex items-start gap-2">
              <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5", atrasado ? "bg-red-100" : "bg-zinc-100")}>
                {atrasado ? <AlertCircle className="w-3.5 h-3.5 text-red-500" /> : <Clock className="w-3.5 h-3.5 text-zinc-500" />}
              </div>
              <div>
                <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-tight">{isPending ? 'Devolver até' : 'Previsão era'}</p>
                <p className={cn("text-xs font-bold", atrasado ? "text-red-600" : "text-zinc-900")}>
                  {format(previsao, "dd/MM/yyyy")} às {format(previsao, "HH:mm")}
                  {log.diasUso ? <span className="text-[9px] font-medium text-zinc-400"> ({log.diasUso} dia{log.diasUso > 1 ? 's' : ''})</span> : null}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
          <span className={cn(
            "text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tight flex items-center gap-1",
            atrasado ? "bg-red-100 text-red-700" : isPending ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"
          )}>
            {atrasado ? (
              <><AlertCircle className="w-2.5 h-2.5" />Atraso</>
            ) : isPending ? (
              <><Clock className="w-2.5 h-2.5" />Pendente</>
            ) : (
              <><CheckCircle2 className="w-2.5 h-2.5" />Concluído</>
            )}
          </span>

          {!isPending && inDate && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 rounded-xl border border-green-100">
              <ArrowDownLeft className="w-3 h-3 text-green-600" />
              <div className="text-left">
                <span className="block text-[8px] font-bold text-green-600 uppercase tracking-tighter leading-none">Devolvido em</span>
                <span className="text-[10px] font-bold text-green-700">{format(inDate, "dd/MM HH:mm")}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolHistoryModal({ tool, obras, onClose }: { tool: Tool, obras: Obra[], onClose: () => void }) {
  const [historySnap, loading] = useCollection(
    query(
      collection(db, 'toolLogs'), 
      where('toolId', '==', tool.id), 
      orderBy('dataSaida', 'desc'),
      limit(20)
    )
  );
  
  const history = historySnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ToolLog[] || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full sm:max-w-2xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85dvh]"
      >
        <div className="p-6 bg-zinc-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold">Histórico de Movimentação</h3>
              <p className="text-xs text-zinc-400">{tool.nome} • {tool.codigo}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-12 flex flex-col items-center justify-center text-zinc-400 gap-3">
              <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
              <p className="text-xs font-bold uppercase tracking-widest">Carregando histórico...</p>
            </div>
          ) : history.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-zinc-400 gap-4">
              <div className="w-16 h-16 rounded-full bg-zinc-50 flex items-center justify-center">
                <History className="w-8 h-8 opacity-20" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-zinc-900">Nenhum registro encontrado</p>
                <p className="text-xs">Esta ferramenta ainda não possui movimentações registradas.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {history.map((log) => (
                <LogItem 
                  key={log.id} 
                  log={log} 
                  obra={obras.find(o => o.id === log.obraId)} 
                  showToolInfo={false} 
                />
              ))}
            </div>
          )}
        </div>

        <div className="p-6 bg-zinc-50 border-t border-zinc-100">
          <button 
            onClick={onClose}
            className="w-full py-3 bg-zinc-200 text-zinc-900 rounded-xl text-xs font-bold hover:bg-zinc-300 transition-all"
          >
            Fechar Histórico
          </button>
        </div>
      </motion.div>
    </div>
  );
}

const formatBRLCurrencyInput = (input: string | number | undefined | null): string => {
  const rawValue = String(input ?? '');
  const onlyDigits = rawValue.replace(/\D/g, '');
  const cents = Number(onlyDigits || '0');

  if (!cents) return '';

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
};

const formatBRLFromNumber = (value: number | undefined): string => {
  if (value === undefined || value === null || Number.isNaN(value)) return '';

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const parseBRLCurrencyToNumber = (formattedValue: string): number => {
  const onlyDigits = formattedValue.replace(/\D/g, '');
  return Number(onlyDigits || '0') / 100;
};

function AddToolModal({ tool, categories, onClose }: { tool?: Tool, categories: string[], onClose: () => void }) {
  const [nome, setNome] = useState(tool?.nome || '');
  const [codigo, setCodigo] = useState(tool?.codigo || '');
  const [modelo, setModelo] = useState(tool?.modelo || '');
  const [categoria, setCategoria] = useState(tool?.categoria || '');
  const [valor, setValor] = useState(formatBRLFromNumber(tool?.valor));
  const [dataCompra, setDataCompra] = useState(tool?.dataCompra || '');
  const [descricao, setDescricao] = useState(tool?.descricao || '');
  const [fotoModelo, setFotoModelo] = useState<File | null>(null);
  const [fotoModeloPreview, setFotoModeloPreview] = useState<string | null>(tool?.fotoModelo || null);
  const [showFotoCamera, setShowFotoCamera] = useState(false);
  const fotoGaleriaRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const draftLoadedRef = useRef(Boolean(tool));
  const skipFirstSaveRef = useRef(!tool);

  useEffect(() => {
    if (tool) return;
    try {
      const saved = localStorage.getItem('rascunho-nova-ferramenta');
      if (!saved) { draftLoadedRef.current = true; return; }
      const draft = JSON.parse(saved);
      if (typeof draft.nome === 'string') setNome(draft.nome);
      if (typeof draft.codigo === 'string') setCodigo(draft.codigo);
      if (typeof draft.modelo === 'string') setModelo(draft.modelo);
      if (typeof draft.categoria === 'string') setCategoria(draft.categoria);
      if (typeof draft.valor === 'string') setValor(draft.valor);
      if (typeof draft.dataCompra === 'string') setDataCompra(draft.dataCompra);
      if (typeof draft.descricao === 'string') setDescricao(draft.descricao);
      draftLoadedRef.current = true;
    } catch {
      draftLoadedRef.current = true;
      // Ignora rascunhos inválidos.
    }
  }, [tool]);

  useEffect(() => {
    if (tool || !draftLoadedRef.current) return;
    if (skipFirstSaveRef.current) { skipFirstSaveRef.current = false; return; }
    try {
      localStorage.setItem('rascunho-nova-ferramenta', JSON.stringify({ nome, codigo, modelo, categoria, valor, dataCompra, descricao }));
    } catch {
      // Ignora bloqueio de localStorage.
    }
  }, [tool, nome, codigo, modelo, categoria, valor, dataCompra, descricao]);

  useEffect(() => {
    return () => { if (fotoModeloPreview?.startsWith('blob:')) URL.revokeObjectURL(fotoModeloPreview); };
  }, []);

  const setFotoFromFile = (file: File) => {
    setFotoModeloPreview(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    setFotoModelo(file);
  };

  const clearFotoModelo = () => {
    setFotoModeloPreview(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return null; });
    setFotoModelo(null);
    if (fotoGaleriaRef.current) fotoGaleriaRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedNome = nome.trim();
    const trimmedCodigo = codigo.trim();
    const trimmedModelo = modelo.trim();
    const trimmedCategoria = categoria.trim();
    const parsedValor = parseBRLCurrencyToNumber(valor);

    if (!trimmedNome || !trimmedCodigo || !trimmedModelo || !trimmedCategoria || !valor || !dataCompra) {
      setError('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    setLoading(true);
    try {
      if (Number.isNaN(parsedValor) || parsedValor < 0) {
        setError('Informe um valor válido para a ferramenta.');
        setLoading(false);
        return;
      }

      const standardizedCodigo = trimmedCodigo.toUpperCase();
      
      // Check for unique code (only if changed)
      if (standardizedCodigo !== tool?.codigo?.toUpperCase()) {
        const q = query(collection(db, 'tools'), where('codigo', '==', standardizedCodigo));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          setError(`Já existe uma ferramenta cadastrada com o código "${standardizedCodigo}".`);
          setLoading(false);
          return;
        }
      }

      const trimmedDescricao = descricao.trim();

      let fotoModeloUrl = tool?.fotoModelo || '';
      if (fotoModelo) {
        fotoModeloUrl = await uploadPhoto(fotoModelo, 'ferramentas/modelos');
      } else if (!fotoModeloPreview) {
        fotoModeloUrl = '';
      }

      if (tool) {
        await updateDoc(doc(db, 'tools', tool.id), {
          nome: trimmedNome,
          codigo: standardizedCodigo,
          modelo: trimmedModelo,
          categoria: trimmedCategoria,
          valor: parsedValor,
          dataCompra,
          descricao: trimmedDescricao,
          fotoModelo: fotoModeloUrl,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'tools'), {
          nome: trimmedNome,
          codigo: standardizedCodigo,
          modelo: trimmedModelo,
          categoria: trimmedCategoria,
          valor: parsedValor,
          dataCompra,
          descricao: trimmedDescricao,
          fotoModelo: fotoModeloUrl,
          status: 'Disponível',
          createdAt: serverTimestamp()
        });
      }
      if (!tool) localStorage.removeItem('rascunho-nova-ferramenta');
      onClose();
    } catch (err: any) {
      if (err?.message?.includes('permission')) {
        setError('Você não tem permissão para realizar esta operação. Contate o administrador.');
      } else {
        setError(err?.message || 'Ocorreu um erro ao salvar a ferramenta. Tente novamente.');
      }
      console.error("Erro em tools:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full sm:max-w-2xl rounded-3xl overflow-hidden shadow-2xl max-h-[90dvh] overflow-y-auto"
      >
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-lg font-bold">{tool ? 'Editar Ferramenta' : 'Cadastrar Ferramenta'}</h3>
          <button type="button" onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs font-bold animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Nome da Ferramenta</label>
            <input 
              required
              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none"
              placeholder="Ex: Furadeira Makita 18V"
              value={nome}
              onChange={e => setNome(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Código de Identificação (QR/Barras)</label>
            <div className="flex gap-2">
              <input 
                required
                className="flex-1 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none uppercase placeholder:normal-case font-mono"
                placeholder="Ex: FR-001"
                value={codigo}
                onChange={e => setCodigo(e.target.value.toUpperCase())}
              />
              <button 
                type="button"
                onClick={() => setShowScanner(true)}
                className="px-4 bg-zinc-100 rounded-xl hover:bg-zinc-200 transition-colors"
                title="Escanear Código"
              >
                <QrCode className="w-5 h-5 text-zinc-600" />
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Modelo</label>
            <input
              required
              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none"
              placeholder="Ex: DHP482Z 18V"
              value={modelo}
              onChange={e => setModelo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Categoria</label>
            <select
              required
              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none"
              value={categoria}
              onChange={e => setCategoria(e.target.value)}
            >
              <option value="">Selecione uma categoria...</option>
              {categories.map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              Descrição <span className="font-normal normal-case text-zinc-400">(opcional)</span>
            </label>
            <textarea
              rows={3}
              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none resize-none"
              placeholder="Ex: Furadeira de impacto para concreto, possui 2 baterias."
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              Foto de Referência <span className="font-normal normal-case text-zinc-400">(opcional)</span>
            </label>
            <input ref={fotoGaleriaRef} id="foto-modelo-galeria" type="file" accept="image/*" className="sr-only"
              onChange={e => { const f = e.target.files?.[0]; if (f) setFotoFromFile(f); }} />
            {fotoModeloPreview ? (
              <div className="space-y-2">
                <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-zinc-200">
                  <img src={fotoModeloPreview} className="w-full h-full object-cover" alt="Foto modelo" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowFotoCamera(true)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600 hover:bg-zinc-100 transition-all">
                    <Camera className="w-4 h-4" /> Nova foto
                  </button>
                  <label htmlFor="foto-modelo-galeria"
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600 cursor-pointer hover:bg-zinc-100 transition-all">
                    <Images className="w-4 h-4" /> Da galeria
                  </label>
                  <button type="button" onClick={clearFotoModelo}
                    className="px-3 py-2.5 rounded-xl border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 transition-all">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setShowFotoCamera(true)}
                  className="flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 hover:bg-zinc-100 hover:border-zinc-400 transition-all group">
                  <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                    <Camera className="w-5 h-5 text-zinc-500" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-bold text-zinc-700">Tirar Foto</p>
                    <p className="text-[10px] text-zinc-400">Câmera no app</p>
                  </div>
                </button>
                <label htmlFor="foto-modelo-galeria"
                  className="flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 hover:bg-zinc-100 hover:border-zinc-400 transition-all cursor-pointer group">
                  <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                    <Images className="w-5 h-5 text-zinc-500" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-bold text-zinc-700">Da Galeria</p>
                    <p className="text-[10px] text-zinc-400">Foto já tirada</p>
                  </div>
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Valor da Ferramenta</label>
              <input
                required
                type="text"
                inputMode="numeric"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none"
                placeholder="R$ 0,00"
                value={valor}
                onKeyDown={(e) => ['-', '+', 'e', 'E', '.'].includes(e.key) && e.preventDefault()}
                onChange={e => setValor(formatBRLCurrencyInput(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Data da Compra</label>
              <input
                required
                type="date"
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none"
                value={dataCompra}
                onChange={e => setDataCompra(e.target.value)}
              />
            </div>
          </div>
          <button 
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:grayscale"
          >
            {loading ? 'Salvando...' : tool ? 'Salvar Alterações' : 'Cadastrar'}
          </button>
        </form>
      </motion.div>

      <AnimatePresence>
        {showFotoCamera && (
          <CameraCapture onCapture={f => setFotoFromFile(f)} onClose={() => setShowFotoCamera(false)} />
        )}
        {showScanner && (
          <ScannerModal
            onSuccess={(text) => { setCodigo(text); setShowScanner(false); }}
            onClose={() => setShowScanner(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CheckOutModal({ tool, obras, onClose }: { tool: Tool, obras: Obra[], onClose: () => void }) {
  const { userProfile, notify } = useAuth();
  const [obraId, setObraId] = useState('');
  const [isObraPickerOpen, setIsObraPickerOpen] = useState(false);
  const [obraSearch, setObraSearch] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const userName = userProfile ? `${userProfile.nome} ${userProfile.sobrenome || ''}`.trim() : ((auth.currentUser?.user_metadata?.name || auth.currentUser?.email) || 'Usuário');
  const [responsavel] = useState(userName);
  const [dias, setDias] = useState<number | ''>(1);
  const diasNum = typeof dias === 'number' ? dias : NaN;
  const [loading, setLoading] = useState(false);
  const obrasDisponiveis = obras.filter(obra => obra.status !== 'Concluída');
  const selectedObra = obrasDisponiveis.find(obra => obra.id === obraId);
  const normalizedObraSearch = obraSearch
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  const obrasFiltradas = obrasDisponiveis.filter(obra => {
    if (!normalizedObraSearch) return true;

    return [obra.nome, obra.centroCusto]
      .filter(Boolean)
      .some(value => String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes(normalizedObraSearch));
  });

  const handleCheckOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!obraId) {
      notify('warning', 'Atenção', 'Selecione uma obra de destino antes de confirmar.');
      return;
    }
    if (!Number.isFinite(diasNum) || diasNum < 1) {
      notify('warning', 'Atenção', 'Informe por quantos dias a ferramenta será utilizada.');
      return;
    }
    setLoading(true);

    try {
      const batch = writeBatch(db);
      const retiradaEm = serverTimestamp();
      const previsaoDevolucao = new Date(Date.now() + diasNum * 86400000).toISOString();
      const logRef = doc(collection(db, 'toolLogs'));
      const activityId = createMovementActivityId('tool_activity');
      const movementHash = createMovementScopeHash([
        activityId,
        logRef.id,
        tool.id,
        obraId,
        retiradaEm,
        null,
        'Aberta'
      ]);

      batch.set(logRef, {
        id: logRef.id,
        activityId,
        movementHash,
        toolId: tool.id,
        obraId,
        responsavelNome: responsavel,
        responsavelId: userProfile?.id || auth.currentUser?.id || '',
        dataSaida: retiradaEm,
        dataDevolucao: null,
        diasUso: diasNum,
        previsaoDevolucao,
        statusLog: 'Aberta'
      });

      // 2. Update Tool
      const toolRef = doc(db, 'tools', tool.id);
      batch.update(toolRef, {
        status: 'Em Uso',
        lastLogId: logRef.id,
        updatedAt: retiradaEm
      });

      await batch.commit();
      notify('success', 'Retirada Concluída', `O material "${tool.nome}" foi registrado para a obra selecionada.`);
      onClose();
    } catch (err: any) {
      notify('error', 'Erro na Retirada', err.message || 'Não foi possível registrar a saída.');
      handleFirestoreError(err, OperationType.WRITE, 'tool-checkout');
    } finally {
      setLoading(false);
    }
  };

  const handleScanObra = (text: string) => {
    const foundObra = obrasDisponiveis.find(o =>
      o.id === text || 
      (o.centroCusto && o.centroCusto.toUpperCase() === text.toUpperCase())
    );
    if (foundObra) {
      setObraId(foundObra.id);
      notify('success', 'Obra Identificada', foundObra.nome);
      setShowScanner(false);
    } else {
      notify('error', 'Obra Não Encontrada', 'O código lido não corresponde a nenhuma obra ativa.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full sm:max-w-2xl rounded-3xl overflow-hidden shadow-2xl max-h-[90dvh] overflow-y-auto"
      >
        <div className="p-6 bg-zinc-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold">Retirada de Material</h3>
              <p className="text-xs text-zinc-400">{tool.nome}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleCheckOut} className="p-6 space-y-5">
          {tool.fotoModelo && (
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Foto de Referência</span>
              <div className="relative w-full rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-100">
                <img src={tool.fotoModelo} className="w-full h-auto object-contain" alt={`Referência: ${tool.nome}`} />
                <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent">
                  <span className="text-white text-xs font-bold">Estado esperado de devolução</span>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Quem está retirando?</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input 
                readOnly
                className="w-full pl-11 pr-4 py-3 bg-zinc-100 border border-zinc-200 rounded-xl outline-none cursor-not-allowed text-zinc-500 font-medium"
                value={responsavel}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Destinado para qual obra?</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <button
                  type="button"
                  onClick={() => {
                    setIsObraPickerOpen(open => {
                      if (!open) setObraSearch('');
                      return !open;
                    });
                  }}
                  className="w-full min-h-[50px] pl-11 pr-10 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none text-left"
                >
                  {selectedObra ? (
                    <span className="block leading-tight">
                      <span className="block text-sm font-bold text-zinc-900 whitespace-normal break-words">{selectedObra.nome}</span>
                      <span className="block mt-1 text-xs text-zinc-500 whitespace-normal break-words">
                        {selectedObra.centroCusto ? `Projeto: ${selectedObra.centroCusto} • ` : ''}
                        Cliente: {(selectedObra.cliente || '').trim() || 'Não informado'}
                      </span>
                    </span>
                  ) : (
                    <span className="text-zinc-900">Selecione a obra...</span>
                  )}
                </button>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                  <ArrowDownLeft className="w-3 h-3 text-zinc-400 rotate-45" />
                </div>
                {isObraPickerOpen && (
                  <div className="absolute z-50 left-0 right-0 top-[calc(100%+6px)] max-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-xl">
                    <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white p-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                        <input
                          type="search"
                          autoFocus
                          value={obraSearch}
                          onChange={event => setObraSearch(event.target.value)}
                          placeholder="Pesquisar por nome ou número..."
                          aria-label="Pesquisar projeto por nome ou número"
                          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10"
                        />
                      </div>
                    </div>
                    {obrasDisponiveis.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-zinc-500">Nenhuma obra ativa disponível.</div>
                    ) : obrasFiltradas.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-zinc-500">Nenhum projeto encontrado para essa pesquisa.</div>
                    ) : (
                      obrasFiltradas.map(obra => (
                        <button
                          key={obra.id}
                          type="button"
                          onClick={() => {
                            setObraId(obra.id);
                            setObraSearch('');
                            setIsObraPickerOpen(false);
                          }}
                          className={cn(
                            'w-full px-4 py-3 text-left border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 transition-colors',
                            obra.id === obraId && 'bg-zinc-900 text-white hover:bg-zinc-900'
                          )}
                        >
                          <span className="block text-sm font-bold whitespace-normal break-words">{obra.nome}</span>
                          <span className={cn(
                            'block mt-1 text-xs whitespace-normal break-words',
                            obra.id === obraId ? 'text-zinc-300' : 'text-zinc-500'
                          )}>
                            {obra.centroCusto ? `Projeto: ${obra.centroCusto} • ` : ''}
                            Cliente: {(obra.cliente || '').trim() || 'Não informado'}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <button 
                type="button"
                onClick={() => setShowScanner(true)}
                className="aspect-square w-[50px] bg-zinc-100 rounded-xl flex items-center justify-center hover:bg-zinc-200 transition-colors shadow-sm"
                title="Escanear QR da Obra"
              >
                <QrCode className="w-5 h-5 text-zinc-700" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Tempo de uso (dias)</label>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 7, 15, 30].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDias(d)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-xs font-bold border transition-all',
                    dias === d ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'
                  )}
                >
                  {d} {d === 1 ? 'dia' : 'dias'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] text-zinc-500 font-medium">Ou digite:</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                className="w-24 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-bold text-center focus:ring-2 focus:ring-zinc-900/10 outline-none"
                value={dias}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => ['-', '+', 'e', 'E', '.', ','].includes(e.key) && e.preventDefault()}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '') { setDias(''); return; }
                  const n = Math.floor(Number(v));
                  setDias(Number.isFinite(n) && n > 0 ? n : '');
                }}
                onBlur={() => { if (dias === '') setDias(1); }}
              />
              <span className="text-[11px] text-zinc-500 font-medium">dia(s)</span>
            </div>
          </div>

          <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl flex items-start gap-3">
            <Clock className="w-5 h-5 text-orange-500 shrink-0" />
            <p className="text-[11px] text-orange-700 font-medium leading-relaxed">
              {Number.isFinite(diasNum) && diasNum >= 1 ? (
                <>A devolução está prevista para <span className="font-bold">{format(new Date(Date.now() + diasNum * 86400000), "dd/MM/yyyy 'às' HH:mm")}</span>. Após esse prazo a ferramenta é marcada como atrasada.</>
              ) : (
                <>Informe por quantos dias a ferramenta será utilizada.</>
              )}
            </p>
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 shadow-lg"
          >
            {loading ? 'Processando...' : (
              <>
                Confirmar Retirada
                <CheckCircle2 className="w-5 h-5" />
              </>
            )}
          </button>
        </form>
      </motion.div>

      <AnimatePresence>
        {showScanner && (
          <ScannerModal 
            onSuccess={handleScanObra}
            onClose={() => setShowScanner(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CheckInModal({ log, tool, onClose }: { log: ToolLog, tool: Tool, onClose: () => void }) {
  const { notify } = useAuth();
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const handleCameraCapture = (file: File) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setError(null);
    setShowCamera(false);
  };

  const clearPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPhotoFile(null);
    setError(null);
  };

  const handleCheckIn = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    setError(null);

    if (loading) return;

    if (!photoFile) {
      setError('A foto da devolução é obrigatória para comprovar o estado do material.');
      return;
    }

    setLoading(true);
    setUploadProgress(0);

    try {
      const photoUrl = await uploadPhoto(
        photoFile,
        `tools/${tool.id}/returns`,
        (progress) => setUploadProgress(progress)
      );

      const devolucaoEm = serverTimestamp();
      const activityId = log.activityId || createMovementActivityId('tool_activity');
      const movementHash = createMovementScopeHash([
        activityId,
        log.id,
        log.toolId,
        log.obraId,
        log.dataSaida,
        devolucaoEm,
        'Concluída'
      ]);

      await updateDoc(doc(db, 'toolLogs', log.id), {
        activityId,
        movementHash,
        dataDevolucao: devolucaoEm,
        fotoDevolucaoUrl: photoUrl,
        statusLog: 'Concluída'
      });

      await updateDoc(doc(db, 'tools', tool.id), {
        status: 'Disponível',
        lastLogId: null,
        updatedAt: devolucaoEm
      });

      notify('success', 'Devolução Concluída', 'Material entregue e já está disponível para retirada.');
      clearPhoto();
      onClose();
    } catch (err: any) {
      const errorMsg = err?.message || err?.error_description || 'Falha ao processar devolução.';
      setError(errorMsg);
      handleFirestoreError(err, OperationType.WRITE, 'tool-checkin');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full sm:max-w-2xl rounded-3xl overflow-hidden shadow-2xl max-h-[90dvh] overflow-y-auto"
      >
        <div className="p-6 bg-zinc-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold">Devolução de Material</h3>
              <p className="text-xs text-zinc-400">{tool.nome}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={loading} className="p-2 hover:bg-white/10 rounded-xl transition-colors disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs font-bold animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-3">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">
              Foto do Estado do Material (Obrigatório)
            </span>

            {photoPreview ? (
              /* ── Preview da foto selecionada ── */
              <div className="space-y-3">
                <div className="relative w-full aspect-video rounded-2xl overflow-hidden border-2 border-zinc-200">
                  <img src={photoPreview} className="w-full h-full object-cover" alt="Pré-visualização" />
                  <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
                    <span className="text-white text-xs font-bold">Foto selecionada ✓</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowCamera(true)} disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600 hover:bg-zinc-100 transition-all disabled:opacity-50">
                    <Camera className="w-4 h-4" /> Nova foto
                  </button>
                  <button type="button" onClick={clearPhoto} disabled={loading}
                    className="px-3 py-2.5 rounded-xl border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 transition-all disabled:opacity-50">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              /* ── Seleção inicial ── */
              <div className="space-y-2">
                <div className={cn(loading && 'opacity-50 pointer-events-none')}>
                  <button type="button" onClick={() => setShowCamera(true)} disabled={loading}
                    className={cn(
                      'w-full flex flex-col items-center justify-center gap-3 py-8 rounded-2xl border-2 border-dashed transition-all group',
                      error ? 'border-red-200 bg-red-50/40' : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100 hover:border-zinc-400'
                    )}
                  >
                    <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform', error ? 'bg-red-100' : 'bg-white')}>
                      <Camera className={cn('w-6 h-6', error ? 'text-red-400' : 'text-zinc-500')} />
                    </div>
                    <div className="text-center">
                      <p className={cn('text-xs font-bold', error ? 'text-red-500' : 'text-zinc-700')}>Tirar Foto</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">Câmera no app</p>
                    </div>
                  </button>
                </div>
                {error && <p className="text-[10px] font-bold text-red-500 text-center">{error}</p>}
              </div>
            )}

            <div className="flex items-start gap-2 text-zinc-400">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <p className="text-[10px] leading-tight">Certifique-se que o equipamento está visível e em bom estado.</p>
            </div>
          </div>

          <button
            type="button"
            onClick={(event) => handleCheckIn(event)}
            disabled={loading}
            className={cn(
              'w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg',
              loading ? 'bg-zinc-100 text-zinc-300 cursor-not-allowed' : 'bg-zinc-900 text-white hover:bg-zinc-800'
            )}
          >
            {loading ? (
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] uppercase tracking-widest">{uploadProgress > 0 && uploadProgress < 100 ? `Enviando Foto... ${uploadProgress.toFixed(0)}%` : 'Finalizando...'}</span>
                <div className="w-32 h-1 bg-zinc-300 rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-zinc-900 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            ) : (
              <>
                Devolver Ferramenta
                <CheckCircle2 className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* Câmera in-browser — sobrepõe tudo sem sair do app */}
      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}
