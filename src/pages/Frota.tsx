import React, { useState, useEffect, useRef } from 'react';
import { useCollection } from '../lib/supabaseHooks';
import { collection, addDoc, updateDoc, doc, serverTimestamp, query, orderBy, limit, writeBatch, where, getDocs, deleteDoc } from '../lib/supabaseDb';
import { db, handleFirestoreError, OperationType, auth } from '../lib/supabase';
import { Vehicle, VehicleLog, GeoPoint } from '../types';
import {
  Truck,
  Car,
  MapPin,
  ArrowUpRight,
  ArrowDownLeft,
  User,
  Calendar,
  Camera,
  Images,
  CheckCircle2,
  Clock,
  Plus,
  History,
  X,
  AlertCircle,
  AlertTriangle,
  QrCode,
  Edit2,
  Trash2,
  Wrench,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { uploadPhoto } from '../lib/services';
import { Html5Qrcode } from 'html5-qrcode';
import { useAuth } from '../App';
import { capturarLocalizacao, mapsUrl, formatGeo } from '../lib/geo';
import { parseDate } from '../lib/dateUtils';
import { CameraCapture } from '../components/CameraCapture';

// Reaproveita o helper compartilhado (antes havia uma cópia local idêntica).
const parseMovementDate = parseDate;

const createMovementActivityId = (prefix = 'mov') => {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now()}_${randomPart}`;
};

const normalizeHashValue = (value: any) => {
  if (value === undefined || value === null) return '';
  const parsedDate = parseMovementDate(value);
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

const statusBadgeClass = (status: Vehicle['status']) => {
  if (status === 'Disponível') return 'bg-green-100 text-green-700';
  if (status === 'Manutenção') return 'bg-red-100 text-red-700';
  return 'bg-orange-100 text-orange-700';
};

export default function Frota() {
  const { isAdmin, notify } = useAuth();

  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [showHistory, setShowHistory] = useState<Vehicle | null>(null);
  const [showCheckOut, setShowCheckOut] = useState<Vehicle | null>(null);
  const [showCheckIn, setShowCheckIn] = useState<VehicleLog | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  const anyModalOpen = !!(showAddVehicle || editingVehicle || showHistory || showCheckOut || showCheckIn || showScanner);

  const [vehiclesSnap, , vehiclesError] = useCollection(query(collection(db, 'vehicles'), orderBy('placa', 'asc')), anyModalOpen);
  const [logsSnap, , logsError] = useCollection(query(collection(db, 'vehicleLogs'), orderBy('dataSaida', 'desc'), limit(50)), anyModalOpen);

  const vehicles = (vehiclesSnap?.docs.map(d => ({ id: d.id, ...d.data() })) as Vehicle[]) || [];
  const logs = (logsSnap?.docs.map(d => ({ id: d.id, ...d.data() })) as VehicleLog[]) || [];
  const loadError = vehiclesError || logsError;

  const handleScanSuccess = React.useCallback((decodedText: string) => {
    const code = decodedText.trim();
    const vehicle = vehicles.find(v =>
      v.codigo === code ||
      v.id === code ||
      (v.codigo && v.codigo.toUpperCase() === code.toUpperCase()) ||
      (v.placa && v.placa.toUpperCase() === code.toUpperCase())
    );
    if (vehicle) {
      setShowScanner(false);
      const activeLog = logs.find(l => l.id === vehicle.lastLogId && l.statusLog === 'Aberta');
      if (activeLog) {
        setShowCheckIn(activeLog);
      } else if (vehicle.status === 'Disponível') {
        setShowCheckOut(vehicle);
      } else if (vehicle.status === 'Manutenção') {
        notify('warning', 'Veículo em Manutenção', `O veículo "${vehicle.placa}" está em manutenção e não pode ser retirado.`);
      } else {
        notify('warning', 'Veículo Indisponível', `O veículo "${vehicle.placa}" já está em uso por outro colaborador.`);
      }
    } else {
      notify('error', 'Não Encontrado', `Veículo com código "${code}" não cadastrado no sistema.`);
    }
  }, [vehicles, logs]);

  return (
    <>
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <div data-tour="frota-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Controle de Frota</h2>
          <p className="text-zinc-500">Retirada e devolução de veículos com foto e localização.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            data-tour="frota-scan"
            onClick={() => setShowScanner(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-white border border-zinc-200 text-zinc-600 rounded-xl text-sm font-bold hover:bg-zinc-50 transition-all shadow-sm active:scale-95"
          >
            <QrCode className="w-4 h-4" />
            Escanear QR
          </button>
          {isAdmin && (
            <button
              data-tour="frota-add"
              onClick={() => setShowAddVehicle(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Novo Veículo
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <FrotaLoadError
          title="Erro ao carregar frota"
          message={loadError.message}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Frota */}
        <div data-tour="frota-list" className="lg:col-span-2 space-y-4">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Veículos Cadastrados</h3>
          {vehicles.length === 0 ? (
            <div className="py-20 text-center bg-white rounded-3xl border-2 border-dashed border-zinc-100">
              <Truck className="w-14 h-14 text-zinc-200 mx-auto mb-3" />
              <p className="text-sm font-bold text-zinc-500">Nenhum veículo cadastrado</p>
              <p className="text-xs text-zinc-400">Cadastre o primeiro veículo da frota para começar.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {vehicles.map((vehicle) => (
                <VehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  onCheckOut={() => setShowCheckOut(vehicle)}
                  activeLog={logs.find(l => l.id === vehicle.lastLogId && l.statusLog === 'Aberta')}
                  onCheckIn={(log) => setShowCheckIn(log)}
                  onEdit={() => setEditingVehicle(vehicle)}
                  onViewHistory={() => setShowHistory(vehicle)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Histórico recente */}
        <div data-tour="frota-history" className="space-y-4">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Atividade Recente</h3>
          <div className="bg-white rounded-3xl border border-zinc-200 overflow-hidden shadow-sm">
            <div className="p-4 bg-zinc-50 border-b border-zinc-200 flex items-center gap-2">
              <History className="w-4 h-4 text-zinc-400" />
              <span className="text-xs font-bold text-zinc-600">Logs de Movimentação</span>
            </div>
            <div className="divide-y divide-zinc-100 max-h-[40vh] sm:max-h-[600px] overflow-y-auto">
              {logs.length === 0 ? (
                <div className="p-8 text-center text-zinc-400 text-xs font-bold uppercase tracking-widest">
                  Nenhuma movimentação recente
                </div>
              ) : logs.map((log) => (
                <LogItem
                  key={log.id}
                  log={log}
                  vehicle={vehicles.find(v => v.id === log.vehicleId)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>

    <AnimatePresence>
      {(showAddVehicle || editingVehicle) && (
        <AddVehicleModal
          vehicle={editingVehicle || undefined}
          onClose={() => { setShowAddVehicle(false); setEditingVehicle(null); }}
        />
      )}
      {showHistory && (
        <VehicleHistoryModal
          vehicle={showHistory}
          onClose={() => setShowHistory(null)}
        />
      )}
      {showCheckOut && (
        <CheckOutModal
          vehicle={showCheckOut}
          onClose={() => setShowCheckOut(null)}
        />
      )}
      {showCheckIn && (
        <CheckInModal
          log={showCheckIn}
          vehicle={vehicles.find(v => v.id === showCheckIn.vehicleId) || {
            id: showCheckIn.vehicleId,
            placa: 'Veículo removido',
            modelo: '---',
            status: 'Em Uso',
          } as Vehicle}
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

// ── Scanner QR ────────────────────────────────────────────────────────────────
function FrotaLoadError({ title, message }: { title: string; message?: string }) {
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

function ScannerModal({ onSuccess, onClose }: { onSuccess: (text: string) => void, onClose: () => void }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const { notify } = useAuth();

  useEffect(() => {
    const html5QrCode = new Html5Qrcode("reader-frota");
    scannerRef.current = html5QrCode;

    const onScan = async (text: string) => {
      try {
        if (html5QrCode.getState() === 2) {
          await html5QrCode.stop();
          await html5QrCode.clear();
        }
      } catch (e) {
        console.error("Erro ao parar scanner no sucesso:", e);
      }
      onSuccess(text);
    };

    const startScanner = async () => {
      try {
        try {
          await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 }, onScan, () => {});
        } catch (firstErr) {
          console.warn("Câmera traseira não encontrada, tentando qualquer câmera...", firstErr);
          await html5QrCode.start({ facingMode: "user" }, { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 }, onScan, () => {});
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
        scanner.stop().then(() => scanner.clear()).catch(err => console.error("Erro ao parar scanner:", err));
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
            <h3 className="text-lg font-bold">Escanear Veículo</h3>
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
              <button onClick={onClose} className="px-6 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-all">
                Voltar
              </button>
            </div>
          ) : (
            <>
              <div className="relative aspect-square w-full rounded-2xl overflow-hidden border border-zinc-200 bg-black">
                <div id="reader-frota" className="w-full h-full" />
                <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none">
                  <div className="w-full h-full border-2 border-white/50 border-dashed rounded-lg" />
                </div>
              </div>
              <div className="mt-6 flex flex-col items-center text-center space-y-2">
                <p className="text-sm font-medium text-zinc-600">Posicione o código QR no centro do quadro.</p>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest leading-relaxed">
                  Sistema identificará automaticamente o veículo cadastrado.
                </p>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Card do veículo ─────────────────────────────────────────────────────────
function VehicleCard({ vehicle, onCheckOut, activeLog, onCheckIn, onEdit, onViewHistory }: {
  key?: string | number,
  vehicle: Vehicle,
  onCheckOut: () => void,
  activeLog?: VehicleLog,
  onCheckIn: (log: VehicleLog) => void,
  onEdit?: () => void,
  onViewHistory?: () => void
}) {
  const { isAdmin, isEncarregado, notify } = useAuth();
  const isAvailable = vehicle.status === 'Disponível';
  const isMaintenance = vehicle.status === 'Manutenção';
  const canReturn = isAdmin || isEncarregado || (!!activeLog?.responsavelId && auth.currentUser?.id === activeLog.responsavelId);

  return (
    <div className="bg-white p-5 rounded-3xl border border-zinc-200 shadow-sm hover:shadow-md transition-all group relative">
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-2xl bg-zinc-50 flex items-center justify-center text-zinc-900 group-hover:scale-110 transition-transform overflow-hidden shrink-0">
          {vehicle.fotoVeiculo
            ? <img src={vehicle.fotoVeiculo} className="w-full h-full object-cover" alt={vehicle.placa} />
            : (vehicle.modelo || '').toLowerCase().match(/caminh|truck|van/) ? <Truck className="w-6 h-6" /> : <Car className="w-6 h-6" />
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
              <button
                onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
                className="p-2 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Editar Veículo"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
            {isAdmin && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm(`Deseja remover o veículo "${vehicle.placa}"?`)) {
                    try {
                      await deleteDoc(doc(db, 'vehicles', vehicle.id));
                      notify('success', 'Sucesso', 'Veículo removido da frota.');
                    } catch (err: any) {
                      notify('error', 'Erro ao Excluir', err.message || 'Não foi possível remover o veículo.');
                      handleFirestoreError(err, OperationType.DELETE, 'vehicles');
                    }
                  }
                }}
                className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Excluir Veículo"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", statusBadgeClass(vehicle.status))}>
            {vehicle.status}
          </div>
        </div>
      </div>

      <div className="space-y-1 mb-6 overflow-hidden">
        <h4 className="font-bold text-zinc-900 break-words text-lg tracking-tight">{vehicle.placa}</h4>
        {vehicle.codigo && (
          <p className="text-[10px] text-zinc-400 font-mono bg-zinc-50 border border-zinc-100 rounded-md px-2 py-0.5 truncate inline-block" title={vehicle.codigo}>
            {vehicle.codigo}
          </p>
        )}
        <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-zinc-600">
          {vehicle.modelo && <p className="break-words"><span className="font-bold text-zinc-700">Modelo:</span> {vehicle.modelo}</p>}
          {vehicle.observacoes && <p className="break-words text-zinc-500"><span className="font-bold text-zinc-700">Obs.:</span> {vehicle.observacoes}</p>}
        </div>
      </div>

      {activeLog ? (
        <div className="space-y-4">
          <div className="p-3 bg-zinc-50 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold uppercase">
              <User className="w-3 h-3" />
              {activeLog.responsavelNome}
            </div>
          </div>
          {canReturn ? (
            <button
              onClick={() => onCheckIn(activeLog)}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-100 text-zinc-900 rounded-xl text-xs font-bold hover:bg-zinc-200 transition-all"
            >
              <ArrowDownLeft className="w-4 h-4" />
              Devolver
            </button>
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
            isAvailable ? "bg-zinc-900 text-white hover:bg-zinc-800"
              : isMaintenance ? "bg-red-50 text-red-400 cursor-not-allowed"
              : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
          )}
        >
          {isMaintenance ? <><Wrench className="w-4 h-4" />Em Manutenção</> : <><ArrowUpRight className="w-4 h-4" />Retirar</>}
        </button>
      )}
    </div>
  );
}

// ── Item de log ───────────────────────────────────────────────────────────────
function LogItem({ log, vehicle, showVehicleInfo = true }: { key?: string | number, log: VehicleLog, vehicle?: Vehicle, showVehicleInfo?: boolean }) {
  const isPending = log.statusLog === 'Aberta';
  const outDate = parseMovementDate(log.dataSaida) || new Date();
  const inDate = parseMovementDate(log.dataDevolucao);
  const saidaMaps = mapsUrl(log.localSaida);
  const devolMaps = mapsUrl(log.localDevolucao);

  return (
    <div className="p-5 hover:bg-zinc-50 transition-colors border-b border-zinc-100 last:border-0">
      <div className="flex flex-col gap-3">
        {showVehicleInfo && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className={cn("w-2 h-2 rounded-full shrink-0", isPending ? "bg-orange-500 animate-pulse" : "bg-green-500")} />
            <span className="text-sm font-bold text-zinc-900 break-words">{vehicle?.placa || 'Veículo Removido'}</span>
            {vehicle?.modelo && (
              <span className="text-[10px] text-zinc-400 break-words">{vehicle.modelo}</span>
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
              <Calendar className="w-3.5 h-3.5 text-zinc-500" />
            </div>
            <div>
              <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-tight">Saída em</p>
              <p className="text-xs font-bold text-zinc-900">{format(outDate, "dd/MM/yyyy")} às {format(outDate, "HH:mm")}</p>
            </div>
          </div>

          {saidaMaps && (
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0 mt-0.5">
                <MapPin className="w-3.5 h-3.5 text-zinc-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-tight">Local da Retirada</p>
                <a href={saidaMaps} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-600 hover:underline break-words">
                  {formatGeo(log.localSaida)}
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Fotos */}
        <div className="flex flex-wrap gap-2">
          {log.fotoPainelSaida && <PhotoThumb url={log.fotoPainelSaida} label="Painel (saída)" />}
          {log.fotoPainelDevolucao && <PhotoThumb url={log.fotoPainelDevolucao} label="Painel (devolução)" />}
          {(log.fotosAvaria || []).map((url, i) => <PhotoThumb key={i} url={url} label="Avaria" danger />)}
        </div>

        {log.observacaoDevolucao && (
          <div className={cn(
            "rounded-xl px-3 py-2 text-[11px] font-medium border",
            /sem avaria/i.test(log.observacaoDevolucao)
              ? "bg-green-50 border-green-100 text-green-700"
              : "bg-amber-50 border-amber-100 text-amber-800"
          )}>
            {!/sem avaria/i.test(log.observacaoDevolucao) && <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />}
            {log.observacaoDevolucao}
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
          <span className={cn(
            "text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tight flex items-center gap-1",
            isPending ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"
          )}>
            {isPending ? (<><Clock className="w-2.5 h-2.5" />Em uso</>) : (<><CheckCircle2 className="w-2.5 h-2.5" />Devolvido</>)}
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

        {devolMaps && (
          <a href={devolMaps} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Local da devolução: {formatGeo(log.localDevolucao)}
          </a>
        )}
      </div>
    </div>
  );
}

function PhotoThumb({ url, label, danger = false }: { key?: string | number, url: string, label: string, danger?: boolean }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="relative w-16 h-16 rounded-xl overflow-hidden border border-zinc-200 shrink-0 group/photo" title={label}>
      <img src={url} className="w-full h-full object-cover" alt={label} />
      <span className={cn(
        "absolute inset-x-0 bottom-0 text-[7px] font-bold uppercase tracking-tight text-white px-1 py-0.5 truncate text-center",
        danger ? "bg-red-600/80" : "bg-black/60"
      )}>
        {label}
      </span>
    </a>
  );
}

// ── Histórico do veículo ──────────────────────────────────────────────────────
function VehicleHistoryModal({ vehicle, onClose }: { vehicle: Vehicle, onClose: () => void }) {
  const [historySnap, loading] = useCollection(
    query(collection(db, 'vehicleLogs'), where('vehicleId', '==', vehicle.id), orderBy('dataSaida', 'desc'), limit(30))
  );
  const history = historySnap?.docs.map(d => ({ id: d.id, ...d.data() })) as VehicleLog[] || [];

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
              <h3 className="font-bold">Histórico do Veículo</h3>
              <p className="text-xs text-zinc-400">{vehicle.placa} • {vehicle.modelo}</p>
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
                <p className="text-xs">Este veículo ainda não possui movimentações registradas.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {history.map((log) => (
                <LogItem key={log.id} log={log} showVehicleInfo={false} />
              ))}
            </div>
          )}
        </div>

        <div className="p-6 bg-zinc-50 border-t border-zinc-100">
          <button onClick={onClose} className="w-full py-3 bg-zinc-200 text-zinc-900 rounded-xl text-xs font-bold hover:bg-zinc-300 transition-all">
            Fechar Histórico
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Cadastro / edição ─────────────────────────────────────────────────────────
function AddVehicleModal({ vehicle, onClose }: { vehicle?: Vehicle, onClose: () => void }) {
  const { isAdmin } = useAuth();
  const [placa, setPlaca] = useState(vehicle?.placa || '');
  const [modelo, setModelo] = useState(vehicle?.modelo || '');
  const [codigo, setCodigo] = useState(vehicle?.codigo || '');
  const [status, setStatus] = useState<Vehicle['status']>(vehicle?.status || 'Disponível');
  const [observacoes, setObservacoes] = useState(vehicle?.observacoes || '');
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(vehicle?.fotoVeiculo || null);
  const [showFotoCamera, setShowFotoCamera] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const fotoGaleriaRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => { if (fotoPreview?.startsWith('blob:')) URL.revokeObjectURL(fotoPreview); };
  }, []);

  const setFotoFromFile = (file: File) => {
    setFotoPreview(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    setFoto(file);
  };

  const clearFoto = () => {
    setFotoPreview(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return null; });
    setFoto(null);
    if (fotoGaleriaRef.current) fotoGaleriaRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedPlaca = placa.trim().toUpperCase();
    const trimmedModelo = modelo.trim();
    const trimmedCodigo = codigo.trim().toUpperCase();

    if (!trimmedPlaca || !trimmedModelo) {
      setError('Placa e modelo são obrigatórios.');
      return;
    }

    setLoading(true);
    try {
      // Código único (se informado e alterado)
      if (trimmedCodigo && trimmedCodigo !== (vehicle?.codigo || '').toUpperCase()) {
        const q = query(collection(db, 'vehicles'), where('codigo', '==', trimmedCodigo));
        const snap = await getDocs(q);
        if (!snap.empty) {
          setError(`Já existe um veículo com o código "${trimmedCodigo}".`);
          setLoading(false);
          return;
        }
      }

      let fotoUrl = vehicle?.fotoVeiculo || '';
      if (foto) {
        fotoUrl = await uploadPhoto(foto, 'frota/veiculos');
      } else if (!fotoPreview) {
        fotoUrl = '';
      }

      if (vehicle) {
        await updateDoc(doc(db, 'vehicles', vehicle.id), {
          placa: trimmedPlaca,
          modelo: trimmedModelo,
          codigo: trimmedCodigo,
          status,
          observacoes: observacoes.trim(),
          fotoVeiculo: fotoUrl,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'vehicles'), {
          placa: trimmedPlaca,
          modelo: trimmedModelo,
          codigo: trimmedCodigo,
          status,
          observacoes: observacoes.trim(),
          fotoVeiculo: fotoUrl,
          createdAt: serverTimestamp(),
        });
      }
      onClose();
    } catch (err: any) {
      if (err?.message?.includes('permission')) {
        setError('Você não tem permissão para realizar esta operação. Contate o administrador.');
      } else {
        setError(err?.message || 'Ocorreu um erro ao salvar o veículo. Tente novamente.');
      }
      console.error("Erro em vehicles:", err);
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
          <h3 className="text-lg font-bold">{vehicle ? 'Editar Veículo' : 'Cadastrar Veículo'}</h3>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Placa</label>
              <input
                required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none uppercase placeholder:normal-case font-mono"
                placeholder="Ex: ABC1D23"
                value={placa}
                onChange={e => setPlaca(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Modelo</label>
              <input
                required
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none"
                placeholder="Ex: Fiat Strada 2022"
                value={modelo}
                onChange={e => setModelo(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              Código Interno / QR Code <span className="font-normal normal-case text-zinc-400">(opcional)</span>
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none uppercase placeholder:normal-case font-mono"
                placeholder="Ex: FROTA-001"
                value={codigo}
                onChange={e => setCodigo(e.target.value.toUpperCase())}
              />
              <button type="button" onClick={() => setShowScanner(true)} className="px-4 bg-zinc-100 rounded-xl hover:bg-zinc-200 transition-colors" title="Escanear Código">
                <QrCode className="w-5 h-5 text-zinc-600" />
              </button>
            </div>
          </div>

          {isAdmin && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Status</label>
              <select
                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none"
                value={status}
                onChange={e => setStatus(e.target.value as Vehicle['status'])}
              >
                <option value="Disponível">Disponível</option>
                <option value="Manutenção">Manutenção</option>
                {vehicle?.status === 'Em Uso' && <option value="Em Uso">Em Uso</option>}
              </select>
              <p className="text-[10px] text-zinc-400">Use "Manutenção" para bloquear a retirada temporariamente.</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              Foto do Veículo <span className="font-normal normal-case text-zinc-400">(opcional)</span>
            </label>
            <input ref={fotoGaleriaRef} type="file" accept="image/*" className="sr-only" id="foto-veiculo-galeria"
              onChange={e => { const f = e.target.files?.[0]; if (f) setFotoFromFile(f); }} />
            {fotoPreview ? (
              <div className="space-y-2">
                <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-zinc-200">
                  <img src={fotoPreview} className="w-full h-full object-cover" alt="Foto do veículo" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowFotoCamera(true)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600 hover:bg-zinc-100 transition-all">
                    <Camera className="w-4 h-4" /> Nova foto
                  </button>
                  <label htmlFor="foto-veiculo-galeria"
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600 cursor-pointer hover:bg-zinc-100 transition-all">
                    <Images className="w-4 h-4" /> Da galeria
                  </label>
                  <button type="button" onClick={clearFoto}
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
                <label htmlFor="foto-veiculo-galeria"
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

          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              Observações <span className="font-normal normal-case text-zinc-400">(opcional)</span>
            </label>
            <textarea
              rows={3}
              className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none resize-none"
              placeholder="Ex: Veículo com adesivo da empresa, possui engate."
              value={observacoes}
              onChange={e => setObservacoes(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:grayscale"
          >
            {loading ? 'Salvando...' : vehicle ? 'Salvar Alterações' : 'Cadastrar'}
          </button>
        </form>
      </motion.div>

      <AnimatePresence>
        {showFotoCamera && (
          <CameraCapture onCapture={f => setFotoFromFile(f)} onClose={() => setShowFotoCamera(false)} />
        )}
        {showScanner && (
          <ScannerModal onSuccess={(text) => { setCodigo(text.toUpperCase()); setShowScanner(false); }} onClose={() => setShowScanner(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Retirada ───────────────────────────────────────────────────────────────────
function CheckOutModal({ vehicle, onClose }: { vehicle: Vehicle, onClose: () => void }) {
  const { userProfile, notify } = useAuth();
  const userName = userProfile ? `${userProfile.nome} ${userProfile.sobrenome || ''}`.trim() : ((auth.currentUser?.user_metadata?.name || auth.currentUser?.email) || 'Usuário');
  const [responsavel] = useState(userName);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => { if (photoPreview) URL.revokeObjectURL(photoPreview); };
  }, [photoPreview]);

  const handleCapture = (file: File) => {
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
  };

  const handleCheckOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (!photoFile) {
      setError('A foto do painel é obrigatória para registrar a retirada.');
      return;
    }

    setLoading(true);
    try {
      setProgressMsg('Obtendo localização...');
      const localSaida: GeoPoint | null = await capturarLocalizacao();

      setProgressMsg('Enviando foto...');
      const fotoUrl = await uploadPhoto(photoFile, `frota/${vehicle.id}/saidas`);

      setProgressMsg('Registrando...');
      const batch = writeBatch(db);
      const retiradaEm = serverTimestamp();
      const logRef = doc(collection(db, 'vehicleLogs'));
      const activityId = createMovementActivityId('vehicle_activity');
      const movementHash = createMovementScopeHash([activityId, logRef.id, vehicle.id, retiradaEm, null, 'Aberta']);

      batch.set(logRef, {
        id: logRef.id,
        activityId,
        movementHash,
        vehicleId: vehicle.id,
        responsavelNome: responsavel,
        responsavelId: userProfile?.id || auth.currentUser?.id || '',
        dataSaida: retiradaEm,
        fotoPainelSaida: fotoUrl,
        localSaida,
        dataDevolucao: null,
        statusLog: 'Aberta',
      });

      batch.update(doc(db, 'vehicles', vehicle.id), {
        status: 'Em Uso',
        lastLogId: logRef.id,
        updatedAt: retiradaEm,
      });

      await batch.commit();
      notify('success', 'Retirada Concluída', `O veículo "${vehicle.placa}" foi registrado como Em Uso.${localSaida ? '' : ' (sem localização — GPS indisponível)'}`);
      clearPhoto();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível registrar a saída.');
      handleFirestoreError(err, OperationType.WRITE, 'vehicle-checkout');
    } finally {
      setLoading(false);
      setProgressMsg('');
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
              <h3 className="font-bold">Retirada de Veículo</h3>
              <p className="text-xs text-zinc-400">{vehicle.placa} • {vehicle.modelo}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={loading} className="p-2 hover:bg-white/10 rounded-xl transition-colors disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleCheckOut} className="p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs font-bold animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Quem está retirando?</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input readOnly className="w-full pl-11 pr-4 py-3 bg-zinc-100 border border-zinc-200 rounded-xl outline-none cursor-not-allowed text-zinc-500 font-medium" value={responsavel} />
            </div>
          </div>

          <PhotoPicker
            label="Foto do Painel (Obrigatório)"
            preview={photoPreview}
            onPick={() => setShowCamera(true)}
            onClear={clearPhoto}
            disabled={loading}
            hint="Registre o painel/odômetro no momento da retirada."
          />

          <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl flex items-start gap-3">
            <MapPin className="w-5 h-5 text-orange-500 shrink-0" />
            <p className="text-[11px] text-orange-700 font-medium leading-relaxed">
              A data/hora e a localização serão coletadas automaticamente ao confirmar a retirada.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg",
              loading ? "bg-zinc-100 text-zinc-300 cursor-not-allowed" : "bg-zinc-900 text-white hover:bg-zinc-800"
            )}
          >
            {loading ? (progressMsg || 'Processando...') : (<>Confirmar Retirada<CheckCircle2 className="w-5 h-5" /></>)}
          </button>
        </form>
      </motion.div>

      <AnimatePresence>
        {showCamera && <CameraCapture onCapture={handleCapture} onClose={() => setShowCamera(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ── Devolução ────────────────────────────────────────────────────────────────
function CheckInModal({ log, vehicle, onClose }: { log: VehicleLog, vehicle: Vehicle, onClose: () => void }) {
  const { notify } = useAuth();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<'painel' | 'avaria'>('painel');
  const [semAvarias, setSemAvarias] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [avariaFiles, setAvariaFiles] = useState<{ file: File; preview: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      avariaFiles.forEach(a => URL.revokeObjectURL(a.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCapture = (file: File) => {
    if (cameraTarget === 'painel') {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
      setError(null);
    } else {
      setAvariaFiles(prev => [...prev, { file, preview: URL.createObjectURL(file) }]);
    }
    setShowCamera(false);
  };

  const removeAvaria = (index: number) => {
    setAvariaFiles(prev => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  };

  const handleCheckIn = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    if (loading) return;
    setError(null);

    if (!photoFile) {
      setError('A foto do painel é obrigatória para registrar a devolução.');
      return;
    }
    if (!semAvarias && !observacao.trim()) {
      setError('Descreva a avaria ou marque "Sem avarias".');
      return;
    }

    setLoading(true);
    try {
      setProgressMsg('Obtendo localização...');
      const localDevolucao: GeoPoint | null = await capturarLocalizacao();

      setProgressMsg('Enviando fotos...');
      const fotoPainelUrl = await uploadPhoto(photoFile, `frota/${vehicle.id}/devolucoes`);
      const fotosAvaria: string[] = [];
      for (const a of avariaFiles) {
        fotosAvaria.push(await uploadPhoto(a.file, `frota/${vehicle.id}/avarias`));
      }

      setProgressMsg('Registrando...');
      const devolucaoEm = serverTimestamp();
      const activityId = log.activityId || createMovementActivityId('vehicle_activity');
      const movementHash = createMovementScopeHash([activityId, log.id, log.vehicleId, log.dataSaida, devolucaoEm, 'Concluída']);
      const obsFinal = semAvarias ? 'Sem avarias' : observacao.trim();

      const batch = writeBatch(db);
      batch.update(doc(db, 'vehicleLogs', log.id), {
        activityId,
        movementHash,
        dataDevolucao: devolucaoEm,
        fotoPainelDevolucao: fotoPainelUrl,
        localDevolucao,
        observacaoDevolucao: obsFinal,
        fotosAvaria,
        statusLog: 'Concluída',
      });

      batch.update(doc(db, 'vehicles', vehicle.id), {
        status: 'Disponível',
        lastLogId: null,
        updatedAt: devolucaoEm,
      });
      await batch.commit();

      notify('success', 'Devolução Concluída', `O veículo "${vehicle.placa}" está disponível novamente.${localDevolucao ? '' : ' (sem localização — GPS indisponível)'}`);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao processar devolução.');
      handleFirestoreError(err, OperationType.WRITE, 'vehicle-checkin');
    } finally {
      setLoading(false);
      setProgressMsg('');
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
              <h3 className="font-bold">Devolução de Veículo</h3>
              <p className="text-xs text-zinc-400">{vehicle.placa} • {vehicle.modelo}</p>
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

          <PhotoPicker
            label="Foto do Painel (Obrigatório)"
            preview={photoPreview}
            onPick={() => { setCameraTarget('painel'); setShowCamera(true); }}
            onClear={() => { if (photoPreview) URL.revokeObjectURL(photoPreview); setPhotoPreview(null); setPhotoFile(null); }}
            disabled={loading}
            hint="Registre o painel/odômetro no momento da devolução."
            error={!!error && !photoFile}
          />

          {/* Estado do veículo */}
          <div className="space-y-3">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Estado do Veículo</span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={loading} onClick={() => setSemAvarias(true)}
                className={cn("flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold border transition-all",
                  semAvarias ? "bg-green-50 border-green-300 text-green-700" : "bg-zinc-50 border-zinc-200 text-zinc-500 hover:bg-zinc-100")}>
                <CheckCircle2 className="w-4 h-4" /> Sem avarias
              </button>
              <button type="button" disabled={loading} onClick={() => setSemAvarias(false)}
                className={cn("flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold border transition-all",
                  !semAvarias ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-zinc-50 border-zinc-200 text-zinc-500 hover:bg-zinc-100")}>
                <AlertTriangle className="w-4 h-4" /> Com avaria
              </button>
            </div>

            {!semAvarias && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-1">
                <textarea
                  rows={3}
                  disabled={loading}
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900/10 outline-none resize-none text-sm"
                  placeholder="Descreva: amassado na porta, arranhado, pneu baixo, etc."
                  value={observacao}
                  onChange={e => setObservacao(e.target.value)}
                />
                {/* Fotos de avaria */}
                <div className="flex flex-wrap gap-2">
                  {avariaFiles.map((a, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-zinc-200">
                      <img src={a.preview} className="w-full h-full object-cover" alt={`Avaria ${i + 1}`} />
                      <button type="button" disabled={loading} onClick={() => removeAvaria(i)}
                        className="absolute top-1 right-1 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button type="button" disabled={loading} onClick={() => { setCameraTarget('avaria'); setShowCamera(true); }}
                    className="w-20 h-20 rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 flex flex-col items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:border-zinc-400 transition-all">
                    <Camera className="w-5 h-5" />
                    <span className="text-[8px] font-bold mt-0.5">Foto avaria</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl flex items-start gap-3">
            <MapPin className="w-5 h-5 text-orange-500 shrink-0" />
            <p className="text-[11px] text-orange-700 font-medium leading-relaxed">
              A data/hora e a localização da devolução serão coletadas automaticamente ao confirmar.
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => handleCheckIn(e)}
            disabled={loading}
            className={cn(
              "w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg",
              loading ? "bg-zinc-100 text-zinc-300 cursor-not-allowed" : "bg-zinc-900 text-white hover:bg-zinc-800"
            )}
          >
            {loading ? (progressMsg || 'Finalizando...') : (<>Confirmar Devolução<CheckCircle2 className="w-5 h-5" /></>)}
          </button>
        </div>
      </motion.div>

      {showCamera && <CameraCapture onCapture={handleCapture} onClose={() => setShowCamera(false)} />}
    </div>
  );
}

// ── Seletor de foto reutilizável (câmera obrigatória) ──────────────────────────
function PhotoPicker({ label, preview, onPick, onClear, disabled, hint, error }: {
  label: string,
  preview: string | null,
  onPick: () => void,
  onClear: () => void,
  disabled?: boolean,
  hint?: string,
  error?: boolean,
}) {
  return (
    <div className="space-y-3">
      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">{label}</span>
      {preview ? (
        <div className="space-y-3">
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden border-2 border-zinc-200">
            <img src={preview} className="w-full h-full object-cover" alt="Pré-visualização" />
            <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
              <span className="text-white text-xs font-bold">Foto selecionada ✓</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onPick} disabled={disabled}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600 hover:bg-zinc-100 transition-all disabled:opacity-50">
              <Camera className="w-4 h-4" /> Nova foto
            </button>
            <button type="button" onClick={onClear} disabled={disabled}
              className="px-3 py-2.5 rounded-xl border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 transition-all disabled:opacity-50">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={onPick} disabled={disabled}
          className={cn(
            'w-full flex flex-col items-center justify-center gap-3 py-8 rounded-2xl border-2 border-dashed transition-all group disabled:opacity-50',
            error ? 'border-red-200 bg-red-50/40' : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100 hover:border-zinc-400'
          )}>
          <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform', error ? 'bg-red-100' : 'bg-white')}>
            <Camera className={cn('w-6 h-6', error ? 'text-red-400' : 'text-zinc-500')} />
          </div>
          <div className="text-center">
            <p className={cn('text-xs font-bold', error ? 'text-red-500' : 'text-zinc-700')}>Tirar Foto</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">Câmera no app</p>
          </div>
        </button>
      )}
      {hint && (
        <div className="flex items-start gap-2 text-zinc-400">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <p className="text-[10px] leading-tight">{hint}</p>
        </div>
      )}
    </div>
  );
}
