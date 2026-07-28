import React, { useState, useMemo, useCallback } from 'react';
import { useCollection } from '../lib/supabaseHooks';
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy } from '../lib/supabaseDb';
import { db, handleFirestoreError, OperationType } from '../lib/supabase';
import { Equipamento, EquipamentoManutencao, EquipamentoLocacao, EquipamentoStatus, ManutencaoTipo, CustoItem } from '../types';
import { useAuth } from '../App';
import { uploadPhoto } from '../lib/services';
import { CameraCapture } from '../components/CameraCapture';
import { CurrencyInput } from '../components/CurrencyInput';
import { parseDate } from '../lib/dateUtils';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  Boxes, Plus, X, ArrowLeft, Wrench, DollarSign, TrendingUp, TrendingDown,
  Camera, Images, Trash2, Edit2, Calendar, Building2, AlertCircle, CheckCircle2,
  Trophy, Percent, Clock, ShieldCheck,
} from 'lucide-react';

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const fator = (v: number | null) => v === null ? 'Sem dados' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const calcFatorLocacao = (custo: number, receita: number) => custo > 0 ? (1 - (receita / custo)) * 100 : null;

const statusBadge = (s: EquipamentoStatus) => ({
  'Ativo': 'bg-green-100 text-green-700',
  'Locado': 'bg-blue-100 text-blue-700',
  'Em Manutenção': 'bg-orange-100 text-orange-700',
  'Inativo': 'bg-zinc-100 text-zinc-500',
  'Vendido': 'bg-red-100 text-red-700',
}[s] || 'bg-zinc-100 text-zinc-500');

interface Finance {
  custoManutencao: number; custoAquisicao: number; receita: number;
  custoTotal: number; resultado: number; fatorLocacao: number | null; nManut: number; nLoc: number;
}

function calcFinance(eq: Equipamento, manuts: EquipamentoManutencao[], locs: EquipamentoLocacao[]): Finance {
  const custoManutencao = manuts.reduce((a, m) => a + (m.custoTotal || 0), 0);
  const custoAquisicao = eq.valorAquisicao || 0;
  const receita = locs.reduce((a, l) => a + (l.valorLocacao || 0), 0);
  const custoTotal = custoManutencao + custoAquisicao;
  const resultado = receita - custoTotal;
  const fatorLocacao = calcFatorLocacao(custoTotal, receita);
  return { custoManutencao, custoAquisicao, receita, custoTotal, resultado, fatorLocacao, nManut: manuts.length, nLoc: locs.length };
}

export default function Equipamentos() {
  const { notify, isAdmin } = useAuth();
  const equipamentosQuery = useMemo(() => (
    isAdmin ? query(collection(db, 'equipamentos'), orderBy('nome', 'asc')) : null
  ), [isAdmin]);
  const manutencoesQuery = useMemo(() => (
    isAdmin ? collection(db, 'equipamento_manutencoes') : null
  ), [isAdmin]);
  const locacoesQuery = useMemo(() => (
    isAdmin ? collection(db, 'equipamento_locacoes') : null
  ), [isAdmin]);

  const [equipSnap, loading, equipError, refetchEquip] = useCollection(equipamentosQuery);
  const [manutSnap, , manutError, refetchManut] = useCollection(manutencoesQuery);
  const [locSnap, , locError, refetchLoc] = useCollection(locacoesQuery);

  // Recarrega tudo na hora após uma gravação local (sem esperar o Realtime).
  const reload = useCallback(() => { refetchEquip(); refetchManut(); refetchLoc(); }, [refetchEquip, refetchManut, refetchLoc]);

  const [selected, setSelected] = useState<Equipamento | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Equipamento | null>(null);

  const equipamentos = (equipSnap?.docs.map(d => ({ id: d.id, ...d.data() })) as Equipamento[]) || [];
  const manutencoes = (manutSnap?.docs.map(d => ({ id: d.id, ...d.data() })) as EquipamentoManutencao[]) || [];
  const locacoes = (locSnap?.docs.map(d => ({ id: d.id, ...d.data() })) as EquipamentoLocacao[]) || [];
  const loadError = equipError || manutError || locError;
  const agora = useMemo(() => new Date(), []);

  const financeById = useMemo(() => {
    const map: Record<string, Finance> = {};
    for (const eq of equipamentos) {
      map[eq.id] = calcFinance(
        eq,
        manutencoes.filter(m => m.equipamentoId === eq.id),
        locacoes.filter(l => l.equipamentoId === eq.id),
      );
    }
    return map;
  }, [equipamentos, manutencoes, locacoes]);

  const totals = useMemo(() => {
    const vals: Finance[] = Object.values(financeById);
    const receita = vals.reduce((a, f) => a + f.receita, 0);
    const custo = vals.reduce((a, f) => a + f.custoTotal, 0);
    return {
      receita,
      custo,
      resultado: vals.reduce((a, f) => a + f.resultado, 0),
      fatorLocacao: calcFatorLocacao(custo, receita),
    };
  }, [financeById]);

  const fatorPeriodos = useMemo(() => {
    const custoAquisicao = equipamentos.reduce((a, e) => a + (e.valorAquisicao || 0), 0);
    const custoManutencaoMes = manutencoes.reduce((acc, manut) => {
      const data = parseDate(manut.data);
      if (!data || data.getFullYear() !== agora.getFullYear() || data.getMonth() !== agora.getMonth()) return acc;
      return acc + (manut.custoTotal || 0);
    }, 0);
    const custoManutencaoAno = manutencoes.reduce((acc, manut) => {
      const data = parseDate(manut.data);
      if (!data || data.getFullYear() !== agora.getFullYear()) return acc;
      return acc + (manut.custoTotal || 0);
    }, 0);
    const receitaMes = locacoes.reduce((acc, loc) => {
      const data = parseDate(loc.dataInicio);
      if (!data || data.getFullYear() !== agora.getFullYear() || data.getMonth() !== agora.getMonth()) return acc;
      return acc + (loc.valorLocacao || 0);
    }, 0);
    const receitaAno = locacoes.reduce((acc, loc) => {
      const data = parseDate(loc.dataInicio);
      if (!data || data.getFullYear() !== agora.getFullYear()) return acc;
      return acc + (loc.valorLocacao || 0);
    }, 0);

    return {
      receitaMes,
      receitaAno,
      fatorMes: calcFatorLocacao(custoAquisicao + custoManutencaoMes, receitaMes),
      fatorAno: calcFatorLocacao(custoAquisicao + custoManutencaoAno, receitaAno),
    };
  }, [equipamentos, manutencoes, locacoes, agora]);

  const rankLucrativos = [...equipamentos].sort((a, b) => (financeById[b.id]?.resultado || 0) - (financeById[a.id]?.resultado || 0)).slice(0, 5);
  const rankCusto = [...equipamentos].sort((a, b) => (financeById[b.id]?.custoManutencao || 0) - (financeById[a.id]?.custoManutencao || 0)).slice(0, 5);

  const handleDelete = async (eq: Equipamento) => {
    if (!isAdmin) {
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar equipamentos.');
      return;
    }
    if (!confirm(`Excluir o equipamento "${eq.nome}" e todo o seu histórico financeiro?`)) return;
    try {
      await deleteDoc(doc(db, 'equipamentos', eq.id));
      for (const m of manutencoes.filter(m => m.equipamentoId === eq.id)) await deleteDoc(doc(db, 'equipamento_manutencoes', m.id));
      for (const l of locacoes.filter(l => l.equipamentoId === eq.id)) await deleteDoc(doc(db, 'equipamento_locacoes', l.id));
      notify('success', 'Excluído', 'Equipamento removido.');
    } catch (err: any) {
      notify('error', 'Erro ao excluir', err.message || 'Falha.');
      handleFirestoreError(err, OperationType.DELETE, 'equipamentos');
    }
  };

  if (!isAdmin) return <AdminOnlyNotice />;

  // ── Detalhe de um equipamento ──────────────────────────────────────────────
  if (selected) {
    const current = equipamentos.find(e => e.id === selected.id) || selected;
    return (
      <>
        <EquipamentoDetalhe
          equipamento={current}
          manutencoes={manutencoes.filter(m => m.equipamentoId === current.id)}
          locacoes={locacoes.filter(l => l.equipamentoId === current.id)}
          onBack={() => setSelected(null)}
          onEdit={() => setEditing(current)}
          onChanged={reload}
        />
        {/* O modal precisa ser renderizado aqui também: nesta branch o return acontece
            antes da lista, então o modal lá embaixo nunca apareceria no detalhe. */}
        {editing && (
          <EquipamentoModal
            equipamento={editing}
            onClose={() => setEditing(null)}
            onSaved={reload}
            onDeleted={() => { handleDelete(editing); setEditing(null); setSelected(null); }}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <div data-tour="equip-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Equipamentos</h2>
          <p className="text-zinc-500">Custo e rentabilidade por ativo — cada máquina como centro de custo e receita.</p>
        </div>
        <button data-tour="equip-new" onClick={() => setShowAdd(true)} className="flex items-center justify-center gap-2 px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all shadow-lg active:scale-95">
          <Plus className="w-4 h-4" /> Novo Equipamento
        </button>
      </div>

      {loadError && (
        <EquipamentosLoadError
          title="Erro ao carregar equipamentos"
          message={loadError.message}
        />
      )}

      {/* KPIs gerais */}
      <div data-tour="equip-kpis" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <KPI label="Receita Total" value={brl(totals.receita)} icon={<TrendingUp className="w-5 h-5" />} tone="green" />
        <KPI label="Custo Total" value={brl(totals.custo)} icon={<TrendingDown className="w-5 h-5" />} tone="red" />
        <KPI label="Resultado" value={brl(totals.resultado)} icon={<DollarSign className="w-5 h-5" />} tone={totals.resultado >= 0 ? 'green' : 'red'} />
        <KPI label="Fator locação ano" value={fator(fatorPeriodos.fatorAno)} icon={<Percent className="w-5 h-5" />} tone="zinc" />
        <KPI label="Fator locação mês" value={fator(fatorPeriodos.fatorMes)} icon={<Percent className="w-5 h-5" />} tone="zinc" />
      </div>

      {/* Rankings */}
      {equipamentos.length > 0 && (
        <div data-tour="equip-rankings" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RankCard title="Mais lucrativos" icon={<Trophy className="w-4 h-4 text-amber-500" />}
            items={rankLucrativos.map(e => ({ nome: e.nome, valor: financeById[e.id]?.resultado || 0 }))} positive />
          <RankCard title="Maior custo de manutenção" icon={<Wrench className="w-4 h-4 text-orange-500" />}
            items={rankCusto.map(e => ({ nome: e.nome, valor: financeById[e.id]?.custoManutencao || 0 }))} />
        </div>
      )}

      {/* Lista */}
      <div data-tour="equip-list" className="space-y-3">
        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Ativos cadastrados</h3>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array(3).fill(0).map((_, i) => <div key={i} className="h-44 bg-white rounded-2xl border border-zinc-100 animate-pulse" />)}</div>
        ) : equipamentos.length === 0 ? (
          <div className="py-20 text-center bg-white rounded-3xl border-2 border-dashed border-zinc-100">
            <Boxes className="w-14 h-14 text-zinc-200 mx-auto mb-3" />
            <p className="text-sm font-bold text-zinc-500">Nenhum equipamento cadastrado</p>
            <p className="text-xs text-zinc-400">Cadastre o primeiro ativo para acompanhar custo e rentabilidade.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {equipamentos.map(eq => {
              const f = financeById[eq.id];
              return (
                <button key={eq.id} onClick={() => setSelected(eq)} className="text-left bg-white p-5 rounded-3xl border border-zinc-200 shadow-sm hover:shadow-md transition-all group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 rounded-2xl bg-zinc-50 overflow-hidden flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                      {eq.fotoUrl ? <img src={eq.fotoUrl} className="w-full h-full object-cover" alt={eq.nome} /> : <Boxes className="w-6 h-6 text-zinc-400" />}
                    </div>
                    <span className={cn('px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider', statusBadge(eq.status))}>{eq.status}</span>
                  </div>
                  <h4 className="font-bold text-zinc-900 break-words">{eq.nome}</h4>
                  {eq.codigo && <p className="text-[10px] text-zinc-400 font-mono">{eq.codigo}</p>}
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                    <div><p className="text-[9px] font-bold text-zinc-400 uppercase">Receita</p><p className="text-xs font-black text-green-600">{brl(f?.receita || 0)}</p></div>
                    <div><p className="text-[9px] font-bold text-zinc-400 uppercase">Custo</p><p className="text-xs font-black text-red-500">{brl(f?.custoTotal || 0)}</p></div>
                    <div><p className="text-[9px] font-bold text-zinc-400 uppercase">Result.</p><p className={cn('text-xs font-black', (f?.resultado || 0) >= 0 ? 'text-green-600' : 'text-red-600')}>{brl(f?.resultado || 0)}</p></div>
                    <div><p className="text-[9px] font-bold text-zinc-400 uppercase">Fator</p><p className="text-xs font-black text-zinc-700">{fator(f?.fatorLocacao ?? null)}</p></div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {(showAdd || editing) && (
        <EquipamentoModal
          equipamento={editing || undefined}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={reload}
          onDeleted={editing ? () => { handleDelete(editing); setEditing(null); } : undefined}
        />
      )}
    </div>
  );
}

// ── Detalhe ───────────────────────────────────────────────────────────────────
function EquipamentoDetalhe({ equipamento, manutencoes, locacoes, onBack, onEdit, onChanged }: {
  equipamento: Equipamento; manutencoes: EquipamentoManutencao[]; locacoes: EquipamentoLocacao[];
  onBack: () => void; onEdit: () => void; onChanged: () => void;
}) {
  const { notify, isAdmin } = useAuth();
  const [periodo, setPeriodo] = useState<'mes' | 'ano' | 'tudo'>('tudo');
  const [showManut, setShowManut] = useState(false);
  const [showLoc, setShowLoc] = useState(false);

  const agora = new Date();
  const dentroPeriodo = (d: Date | null) => {
    if (!d) return false;
    if (periodo === 'tudo') return true;
    if (periodo === 'ano') return d.getFullYear() === agora.getFullYear();
    return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth();
  };

  const manutFiltradas = manutencoes.filter(m => dentroPeriodo(parseDate(m.data)));
  const locFiltradas = locacoes.filter(l => dentroPeriodo(parseDate(l.dataInicio)));
  const f = calcFinance(equipamento, manutFiltradas, locFiltradas);
  const custoManutencaoMes = manutencoes.reduce((acc, manut) => {
    const data = parseDate(manut.data);
    if (!data || data.getFullYear() !== agora.getFullYear() || data.getMonth() !== agora.getMonth()) return acc;
    return acc + (manut.custoTotal || 0);
  }, 0);
  const custoManutencaoAno = manutencoes.reduce((acc, manut) => {
    const data = parseDate(manut.data);
    if (!data || data.getFullYear() !== agora.getFullYear()) return acc;
    return acc + (manut.custoTotal || 0);
  }, 0);
  const receitaMes = locacoes.reduce((acc, loc) => {
      const data = parseDate(loc.dataInicio);
      if (!data || data.getFullYear() !== agora.getFullYear() || data.getMonth() !== agora.getMonth()) return acc;
      return acc + (loc.valorLocacao || 0);
  }, 0);
  const receitaAno = locacoes.reduce((acc, loc) => {
      const data = parseDate(loc.dataInicio);
      if (!data || data.getFullYear() !== agora.getFullYear()) return acc;
      return acc + (loc.valorLocacao || 0);
  }, 0);
  const fatorMes = calcFatorLocacao((equipamento.valorAquisicao || 0) + custoManutencaoMes, receitaMes);
  const fatorAno = calcFatorLocacao((equipamento.valorAquisicao || 0) + custoManutencaoAno, receitaAno);

  // Gráfico: custo x receita por mês (últimos 12 meses)
  const chartData = useMemo(() => {
    const map: Record<string, { mes: string; Custo: number; Receita: number }> = {};
    const meses: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      const k = monthKey(d);
      map[k] = { mes: format(d, 'MM/yy'), Custo: 0, Receita: 0 };
      meses.push(k);
    }
    for (const m of manutencoes) { const d = parseDate(m.data); if (d && map[monthKey(d)]) map[monthKey(d)].Custo += m.custoTotal || 0; }
    for (const l of locacoes) { const d = parseDate(l.dataInicio); if (d && map[monthKey(d)]) map[monthKey(d)].Receita += l.valorLocacao || 0; }
    return meses.map(k => map[k]);
  }, [manutencoes, locacoes]);

  const handleDelManut = async (id: string) => {
    if (!isAdmin) {
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar equipamentos.');
      return;
    }
    if (!confirm('Excluir esta manutenção?')) return;
    try { await deleteDoc(doc(db, 'equipamento_manutencoes', id)); onChanged(); notify('success', 'Excluído', 'Manutenção removida.'); }
    catch (err: any) { handleFirestoreError(err, OperationType.DELETE, 'equipamento_manutencoes'); }
  };
  const handleDelLoc = async (id: string) => {
    if (!isAdmin) {
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar equipamentos.');
      return;
    }
    if (!confirm('Excluir esta locação?')) return;
    try { await deleteDoc(doc(db, 'equipamento_locacoes', id)); onChanged(); notify('success', 'Excluído', 'Locação removida.'); }
    catch (err: any) { handleFirestoreError(err, OperationType.DELETE, 'equipamento_locacoes'); }
  };

  // Histórico combinado ordenado por data desc
  const historico = [
    ...manutencoes.map(m => ({ kind: 'manut' as const, date: parseDate(m.data), item: m })),
    ...locacoes.map(l => ({ kind: 'loc' as const, date: parseDate(l.dataInicio), item: l })),
  ].filter(h => h.date).sort((a, b) => (b.date!.getTime() - a.date!.getTime()));

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <button onClick={onBack} className="flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      {/* Header */}
      <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm p-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-zinc-50 overflow-hidden flex items-center justify-center shrink-0">
          {equipamento.fotoUrl ? <img src={equipamento.fotoUrl} className="w-full h-full object-cover" alt={equipamento.nome} /> : <Boxes className="w-8 h-8 text-zinc-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-zinc-900 break-words">{equipamento.nome}</h2>
            <span className={cn('px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider', statusBadge(equipamento.status))}>{equipamento.status}</span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            {equipamento.codigo && <span className="font-mono">{equipamento.codigo} · </span>}
            {equipamento.categoria || 'Sem categoria'}
            {equipamento.valorAquisicao ? ` · Aquisição: ${brl(equipamento.valorAquisicao)}` : ''}
            {equipamento.dataAquisicao ? ` (${format(new Date(`${equipamento.dataAquisicao}T00:00:00`), 'dd/MM/yyyy')})` : ''}
          </p>
        </div>
        {isAdmin && <button onClick={onEdit} className="p-2 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors shrink-0" title="Editar"><Edit2 className="w-4 h-4" /></button>}
      </div>

      {/* Filtro de período */}
      <div className="flex items-center gap-2">
        {([['mes', 'Este mês'], ['ano', 'Este ano'], ['tudo', 'Tudo']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setPeriodo(id)} className={cn('px-4 py-2 rounded-xl text-xs font-bold border transition-all', periodo === id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50')}>{label}</button>
        ))}
      </div>

      {/* KPIs do período */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPI label="Receita" value={brl(f.receita)} icon={<TrendingUp className="w-4 h-4" />} tone="green" small />
        <KPI label="Custo manut." value={brl(f.custoManutencao)} icon={<Wrench className="w-4 h-4" />} tone="red" small />
        <KPI label="Custo aquisição" value={brl(f.custoAquisicao)} icon={<DollarSign className="w-4 h-4" />} tone="zinc" small />
        <KPI label="Resultado" value={brl(f.resultado)} icon={<DollarSign className="w-4 h-4" />} tone={f.resultado >= 0 ? 'green' : 'red'} small />
        <KPI label="Fator locação ano" value={fator(fatorAno)} icon={<Percent className="w-4 h-4" />} tone="zinc" small />
        <KPI label="Fator locação mês" value={fator(fatorMes)} icon={<Percent className="w-4 h-4" />} tone="zinc" small />
      </div>
      <div className="-mt-3 space-y-1">
        {periodo !== 'tudo' && <p className="text-[11px] text-zinc-400">* Custo de aquisição é total (não filtrado por período).</p>}
        <p className="text-[11px] text-zinc-400">
          Fator de locação = (1 - receita / custo) × 100, usando receita de locação e custos do ano ou mês atual.
        </p>
      </div>

      {/* Gráfico */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4">
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Custo × Receita (12 meses)</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={40} />
            <Tooltip formatter={(v: number) => brl(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Custo" fill="#ef4444" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Receita" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Manutenções */}
      <Section title={`Manutenções (${manutFiltradas.length})`} icon={<Wrench className="w-4 h-4 text-zinc-400" />}
        action={isAdmin ? <button onClick={() => setShowManut(true)} className="text-xs font-bold text-zinc-900 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Adicionar</button> : undefined}
        scrollable>
        {manutFiltradas.length === 0 ? <Empty texto="Nenhuma manutenção no período." /> : (
          <div className="divide-y divide-zinc-100">
            {manutFiltradas.sort((a, b) => (parseDate(b.data)?.getTime() || 0) - (parseDate(a.data)?.getTime() || 0)).map(m => (
              <div key={m.id} className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('px-2 py-0.5 rounded text-[9px] font-bold uppercase',
                      m.tipo === 'Corretiva' ? 'bg-red-50 text-red-600' : m.tipo === 'Preditiva' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600')}>{m.tipo}</span>
                    <span className="text-[11px] text-zinc-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{parseDate(m.data) ? format(parseDate(m.data)!, 'dd/MM/yyyy') : '—'}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    {m.horasEquipe || 0}h × {brl(m.custoHora || 0)} = {brl(m.valorMaoObra || 0)} mão de obra
                    {(m.pecas?.length || 0) > 0 && ` · peças ${brl(m.pecas.reduce((a, p) => a + (p.valor || 0), 0))}`}
                    {(m.outrosCustos?.length || 0) > 0 && ` · outros ${brl(m.outrosCustos.reduce((a, p) => a + (p.valor || 0), 0))}`}
                  </p>
                  {m.observacoes && <p className="text-[11px] text-zinc-400 mt-0.5 break-words">{m.observacoes}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-black text-red-500">{brl(m.custoTotal || 0)}</span>
                  {isAdmin && <button onClick={() => handleDelManut(m.id)} className="p-1.5 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Locações */}
      <Section title={`Locações / Receitas (${locFiltradas.length})`} icon={<DollarSign className="w-4 h-4 text-zinc-400" />}
        action={isAdmin ? <button onClick={() => setShowLoc(true)} className="text-xs font-bold text-zinc-900 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Adicionar</button> : undefined}
        scrollable>
        {locFiltradas.length === 0 ? <Empty texto="Nenhuma locação no período." /> : (
          <div className="divide-y divide-zinc-100">
            {locFiltradas.sort((a, b) => (parseDate(b.dataInicio)?.getTime() || 0) - (parseDate(a.dataInicio)?.getTime() || 0)).map(l => (
              <div key={l.id} className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-zinc-900 break-words flex items-center gap-1"><Building2 className="w-3.5 h-3.5 text-zinc-400" />{l.cliente}</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {parseDate(l.dataInicio) ? format(parseDate(l.dataInicio)!, 'dd/MM/yyyy') : '—'}
                    {l.dataFim ? ` → ${format(new Date(`${l.dataFim}T00:00:00`), 'dd/MM/yyyy')}` : ''}
                  </p>
                  {l.observacoes && <p className="text-[11px] text-zinc-400 mt-0.5 break-words">{l.observacoes}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-black text-green-600">{brl(l.valorLocacao || 0)}</span>
                  {isAdmin && <button onClick={() => handleDelLoc(l.id)} className="p-1.5 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Histórico completo */}
      <Section title="Histórico financeiro completo" icon={<Clock className="w-4 h-4 text-zinc-400" />} scrollable>
        {historico.length === 0 ? <Empty texto="Sem lançamentos ainda." /> : (
          <div className="divide-y divide-zinc-100">
            {historico.map((h, i) => (
              <div key={i} className="p-3 flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={cn('w-2 h-2 rounded-full shrink-0', h.kind === 'manut' ? 'bg-red-500' : 'bg-green-500')} />
                  <span className="text-zinc-400">{h.date ? format(h.date, 'dd/MM/yyyy') : '—'}</span>
                  <span className="font-bold text-zinc-700 truncate">
                    {h.kind === 'manut' ? `Manutenção ${(h.item as EquipamentoManutencao).tipo}` : `Locação — ${(h.item as EquipamentoLocacao).cliente}`}
                  </span>
                </span>
                <span className={cn('font-black shrink-0', h.kind === 'manut' ? 'text-red-500' : 'text-green-600')}>
                  {h.kind === 'manut' ? `- ${brl((h.item as EquipamentoManutencao).custoTotal || 0)}` : `+ ${brl((h.item as EquipamentoLocacao).valorLocacao || 0)}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {isAdmin && showManut && <ManutencaoModal equipamentoId={equipamento.id} onSaved={onChanged} onClose={() => setShowManut(false)} />}
      {isAdmin && showLoc && <LocacaoModal equipamentoId={equipamento.id} onSaved={onChanged} onClose={() => setShowLoc(false)} />}
    </div>
  );
}

// ── Componentes auxiliares ──────────────────────────────────────────────────
function AdminOnlyNotice() {
  return (
    <div className="min-h-[calc(100vh-7rem)] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl shadow-sm p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-zinc-900 text-white flex items-center justify-center mx-auto">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-zinc-900">Acesso restrito</h2>
        <p className="text-sm text-zinc-500">
          A aba de Equipamentos e seus lancamentos financeiros sao exclusivos para administradores.
        </p>
      </div>
    </div>
  );
}

function EquipamentosLoadError({ title, message }: { title: string; message?: string }) {
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

function KPI({ label, value, icon, tone, small }: { label: string; value: string; icon: React.ReactNode; tone: 'green' | 'red' | 'dark' | 'zinc'; small?: boolean }) {
  const toneCls = { green: 'text-green-600', red: 'text-red-500', dark: 'text-zinc-900', zinc: 'text-zinc-600' }[tone];
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 flex items-center gap-3">
      <div className={cn('w-9 h-9 rounded-xl bg-zinc-50 flex items-center justify-center shrink-0', toneCls)}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">{label}</p>
        <p className={cn('font-black truncate', small ? 'text-sm' : 'text-lg', toneCls)}>{value}</p>
      </div>
    </div>
  );
}

function RankCard({ title, icon, items, positive }: { title: string; icon: React.ReactNode; items: { nome: string; valor: number }[]; positive?: boolean }) {
  const top = items.filter(i => i.valor !== 0);
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4">
      <p className="text-xs font-bold text-zinc-600 flex items-center gap-2 mb-3">{icon}{title}</p>
      {top.length === 0 ? <p className="text-xs text-zinc-400">Sem dados ainda.</p> : (
        <div className="space-y-2">
          {top.map((it, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 min-w-0"><span className="text-zinc-300 font-black w-4">{i + 1}</span><span className="font-bold text-zinc-700 truncate">{it.nome}</span></span>
              <span className={cn('font-black shrink-0', positive ? (it.valor >= 0 ? 'text-green-600' : 'text-red-600') : 'text-red-500')}>{brl(it.valor)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, action, children, scrollable = false }: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  scrollable?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="p-4 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
        <span className="text-xs font-bold text-zinc-600 flex items-center gap-2">{icon}{title}</span>
        {action}
      </div>
      <div className={scrollable ? 'max-h-[60vh] md:max-h-[520px] overflow-y-auto overscroll-contain' : undefined}>
        {children}
      </div>
    </div>
  );
}

const Empty = ({ texto }: { texto: string }) => <div className="p-8 text-center text-zinc-400 text-xs">{texto}</div>;

// ── Modal: equipamento ──────────────────────────────────────────────────────
function EquipamentoModal({ equipamento, onClose, onSaved, onDeleted }: { equipamento?: Equipamento; onClose: () => void; onSaved?: () => void; onDeleted?: () => void }) {
  const { notify, isAdmin } = useAuth();
  const [nome, setNome] = useState(equipamento?.nome || '');
  const [codigo, setCodigo] = useState(equipamento?.codigo || '');
  const [categoria, setCategoria] = useState(equipamento?.categoria || '');
  const [dataAquisicao, setDataAquisicao] = useState(equipamento?.dataAquisicao || '');
  const [valorAquisicao, setValorAquisicao] = useState<number | ''>(equipamento?.valorAquisicao ?? '');
  const [status, setStatus] = useState<EquipamentoStatus>(equipamento?.status || 'Ativo');
  const [observacoes, setObservacoes] = useState(equipamento?.observacoes || '');
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(equipamento?.fotoUrl || null);
  const [showCamera, setShowCamera] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setFoto = (file: File) => {
    setFotoPreview(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    setFotoFile(file); setShowCamera(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!isAdmin) {
      setError('Somente administradores podem alterar equipamentos.');
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar equipamentos.');
      return;
    }
    if (!nome.trim()) { setError('Informe o nome do equipamento.'); return; }
    setLoading(true);
    try {
      let fotoUrl = equipamento?.fotoUrl || '';
      if (fotoFile) fotoUrl = await uploadPhoto(fotoFile, 'equipamentos');
      else if (!fotoPreview) fotoUrl = '';

      const payload = {
        nome: nome.trim(), codigo: codigo.trim(), categoria: categoria.trim(),
        dataAquisicao, valorAquisicao: typeof valorAquisicao === 'number' ? valorAquisicao : 0,
        status, observacoes: observacoes.trim(), fotoUrl,
      };
      if (equipamento) await updateDoc(doc(db, 'equipamentos', equipamento.id), { ...payload, updatedAt: serverTimestamp() });
      else await addDoc(collection(db, 'equipamentos'), { ...payload, createdAt: serverTimestamp() });
      onSaved?.();
      notify('success', 'Salvo', equipamento ? 'Equipamento atualizado.' : 'Equipamento cadastrado.');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar.');
      handleFirestoreError(err, OperationType.WRITE, 'equipamentos');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
      <div className="bg-white w-full sm:max-w-lg rounded-3xl shadow-2xl max-h-[92dvh] overflow-y-auto">
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-bold">{equipamento ? 'Editar Equipamento' : 'Novo Equipamento'}</h3>
          <button type="button" onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs font-bold"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}

          <Field label="Nome"><input required className={inputCls} placeholder="Ex: Escavadeira CAT 320" value={nome} onChange={e => setNome(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Código"><input className={inputCls} placeholder="Opcional" value={codigo} onChange={e => setCodigo(e.target.value)} /></Field>
            <Field label="Categoria"><input className={inputCls} placeholder="Ex: Escavação" value={categoria} onChange={e => setCategoria(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data de aquisição"><input type="date" className={inputCls} value={dataAquisicao} onChange={e => setDataAquisicao(e.target.value)} /></Field>
            <Field label="Valor de aquisição"><CurrencyInput value={valorAquisicao} onChange={setValorAquisicao} className={inputCls} /></Field>
          </div>
          <Field label="Status">
            <select className={inputCls} value={status} onChange={e => setStatus(e.target.value as EquipamentoStatus)}>
              {(['Ativo', 'Locado', 'Em Manutenção', 'Inativo', 'Vendido'] as EquipamentoStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          <Field label="Foto (opcional)">
            <input id="equip-galeria" type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) setFoto(f); e.target.value = ''; }} />
            {fotoPreview ? (
              <div className="space-y-2">
                <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-zinc-200"><img src={fotoPreview} className="w-full h-full object-cover" alt="foto" /></div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowCamera(true)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600 hover:bg-zinc-100"><Camera className="w-4 h-4" /> Nova</button>
                  <label htmlFor="equip-galeria" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-600 cursor-pointer hover:bg-zinc-100"><Images className="w-4 h-4" /> Galeria</label>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setShowCamera(true)} className="flex flex-col items-center justify-center gap-2 py-5 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 hover:bg-zinc-100"><Camera className="w-5 h-5 text-zinc-500" /><span className="text-xs font-bold text-zinc-700">Tirar Foto</span></button>
                <label htmlFor="equip-galeria" className="flex flex-col items-center justify-center gap-2 py-5 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 hover:bg-zinc-100 cursor-pointer"><Images className="w-5 h-5 text-zinc-500" /><span className="text-xs font-bold text-zinc-700">Galeria</span></label>
              </div>
            )}
          </Field>

          <Field label="Observações"><textarea rows={2} className={cn(inputCls, 'resize-none')} value={observacoes} onChange={e => setObservacoes(e.target.value)} /></Field>

          <div className="flex gap-2">
            {onDeleted && <button type="button" onClick={onDeleted} className="px-4 py-3 rounded-2xl border border-red-100 bg-red-50 text-red-600 text-sm font-bold hover:bg-red-100"><Trash2 className="w-4 h-4" /></button>}
            <button type="submit" disabled={loading} className={cn('flex-1 py-3 rounded-2xl font-bold transition-all', loading ? 'bg-zinc-100 text-zinc-300' : 'bg-zinc-900 text-white hover:bg-zinc-800')}>
              {loading ? 'Salvando...' : equipamento ? 'Salvar Alterações' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
      {showCamera && <CameraCapture onCapture={setFoto} onClose={() => setShowCamera(false)} />}
    </div>
  );
}

// ── Modal: manutenção ───────────────────────────────────────────────────────
function ManutencaoModal({ equipamentoId, onClose, onSaved }: { equipamentoId: string; onClose: () => void; onSaved?: () => void }) {
  const { notify, isAdmin } = useAuth();
  const [data, setData] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [tipo, setTipo] = useState<ManutencaoTipo>('Preventiva');
  const [horas, setHoras] = useState<number | ''>('');
  const [custoHora, setCustoHora] = useState<number | ''>('');
  const [pecas, setPecas] = useState<CustoItem[]>([]);
  const [outros, setOutros] = useState<CustoItem[]>([]);
  const [observacoes, setObservacoes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maoObra = (typeof horas === 'number' ? horas : 0) * (typeof custoHora === 'number' ? custoHora : 0);
  const somaPecas = pecas.reduce((a, p) => a + (p.valor || 0), 0);
  const somaOutros = outros.reduce((a, p) => a + (p.valor || 0), 0);
  const custoTotal = maoObra + somaPecas + somaOutros;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!isAdmin) {
      setError('Somente administradores podem alterar equipamentos.');
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar equipamentos.');
      return;
    }
    if (custoTotal <= 0) { setError('Informe ao menos um custo (mão de obra, peças ou outros).'); return; }
    setLoading(true);
    try {
      await addDoc(collection(db, 'equipamento_manutencoes'), {
        equipamentoId,
        data: data ? new Date(`${data}T12:00:00`).toISOString() : serverTimestamp(),
        tipo,
        horasEquipe: typeof horas === 'number' ? horas : 0,
        custoHora: typeof custoHora === 'number' ? custoHora : 0,
        valorMaoObra: maoObra,
        pecas: pecas.filter(p => p.descricao.trim() || p.valor),
        outrosCustos: outros.filter(p => p.descricao.trim() || p.valor),
        custoTotal,
        observacoes: observacoes.trim(),
        createdAt: serverTimestamp(),
      });
      onSaved?.();
      notify('success', 'Registrada', 'Manutenção lançada.');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar.');
      handleFirestoreError(err, OperationType.WRITE, 'equipamento_manutencoes');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
      <div className="bg-white w-full sm:max-w-lg rounded-3xl shadow-2xl max-h-[92dvh] overflow-y-auto">
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-bold">Nova Manutenção</h3>
          <button type="button" onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs font-bold"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Data"><input type="date" required className={inputCls} value={data} onChange={e => setData(e.target.value)} /></Field>
            <Field label="Tipo">
              <select className={inputCls} value={tipo} onChange={e => setTipo(e.target.value as ManutencaoTipo)}>
                {(['Preventiva', 'Corretiva', 'Preditiva'] as ManutencaoTipo[]).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Horas da equipe"><input type="number" min="0" step="0.5" className={inputCls} placeholder="0" value={horas}
              onKeyDown={(e) => ['-', '+', 'e', 'E'].includes(e.key) && e.preventDefault()}
              onChange={e => setHoras(e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0))} /></Field>
            <Field label="Custo/hora"><CurrencyInput value={custoHora} onChange={setCustoHora} className={inputCls} /></Field>
          </div>
          <div className="text-xs text-zinc-500 -mt-2">Mão de obra: <span className="font-bold text-zinc-800">{brl(maoObra)}</span></div>

          <ItemList titulo="Peças e materiais" itens={pecas} setItens={setPecas} />
          <ItemList titulo="Outros custos (deslocamento, combustível, terceiros)" itens={outros} setItens={setOutros} />

          <Field label="Observações"><textarea rows={2} className={cn(inputCls, 'resize-none')} value={observacoes} onChange={e => setObservacoes(e.target.value)} /></Field>

          <div className="p-3 bg-zinc-900 text-white rounded-2xl flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Custo total da intervenção</span>
            <span className="text-lg font-black">{brl(custoTotal)}</span>
          </div>

          <button type="submit" disabled={loading} className={cn('w-full py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-2', loading ? 'bg-zinc-100 text-zinc-300' : 'bg-zinc-900 text-white hover:bg-zinc-800')}>
            {loading ? 'Salvando...' : <>Registrar Manutenção <CheckCircle2 className="w-5 h-5" /></>}
          </button>
        </form>
      </div>
    </div>
  );
}

function ItemList({ titulo, itens, setItens }: { titulo: string; itens: CustoItem[]; setItens: (v: CustoItem[]) => void }) {
  const add = () => setItens([...itens, { descricao: '', valor: 0 }]);
  const upd = (i: number, patch: Partial<CustoItem>) => setItens(itens.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  const rem = (i: number) => setItens(itens.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{titulo}</label>
        <button type="button" onClick={add} className="text-xs font-bold text-zinc-900 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Item</button>
      </div>
      {itens.map((it, i) => (
        <div key={i} className="flex gap-2">
          <input className={cn(inputCls, 'flex-1')} placeholder="Descrição" value={it.descricao} onChange={e => upd(i, { descricao: e.target.value })} />
          <CurrencyInput value={it.valor || ''} onChange={v => upd(i, { valor: typeof v === 'number' ? v : 0 })} className={cn(inputCls, 'w-32')} placeholder="R$ 0,00" />
          <button type="button" onClick={() => rem(i)} className="px-3 rounded-xl bg-red-50 text-red-500 hover:bg-red-100"><X className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
}

// ── Modal: locação ──────────────────────────────────────────────────────────
function LocacaoModal({ equipamentoId, onClose, onSaved }: { equipamentoId: string; onClose: () => void; onSaved?: () => void }) {
  const { notify, isAdmin } = useAuth();
  const [cliente, setCliente] = useState('');
  const [dataInicio, setDataInicio] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dataFim, setDataFim] = useState('');
  const [valor, setValor] = useState<number | ''>('');
  const [observacoes, setObservacoes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!isAdmin) {
      setError('Somente administradores podem alterar equipamentos.');
      notify('warning', 'Acesso restrito', 'Somente administradores podem alterar equipamentos.');
      return;
    }
    if (!cliente.trim()) { setError('Informe o cliente.'); return; }
    const valorNum = typeof valor === 'number' ? valor : NaN;
    if (!Number.isFinite(valorNum) || valorNum <= 0) { setError('Informe o valor da locação.'); return; }
    setLoading(true);
    try {
      await addDoc(collection(db, 'equipamento_locacoes'), {
        equipamentoId, cliente: cliente.trim(), dataInicio, dataFim: dataFim || '', valorLocacao: valorNum,
        observacoes: observacoes.trim(), createdAt: serverTimestamp(),
      });
      onSaved?.();
      notify('success', 'Registrada', 'Locação lançada.');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar.');
      handleFirestoreError(err, OperationType.WRITE, 'equipamento_locacoes');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
      <div className="bg-white w-full sm:max-w-md rounded-3xl shadow-2xl max-h-[92dvh] overflow-y-auto">
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-bold">Nova Locação</h3>
          <button type="button" onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs font-bold"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
          <Field label="Cliente"><input required className={inputCls} placeholder="Ex: Construtora Y" value={cliente} onChange={e => setCliente(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Início"><input type="date" required className={inputCls} value={dataInicio} onChange={e => setDataInicio(e.target.value)} /></Field>
            <Field label="Fim"><input type="date" className={inputCls} value={dataFim} onChange={e => setDataFim(e.target.value)} /></Field>
          </div>
          <Field label="Valor da locação"><CurrencyInput value={valor} onChange={setValor} required className={inputCls} /></Field>
          <Field label="Observações"><textarea rows={2} className={cn(inputCls, 'resize-none')} value={observacoes} onChange={e => setObservacoes(e.target.value)} /></Field>
          <button type="submit" disabled={loading} className={cn('w-full py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-2', loading ? 'bg-zinc-100 text-zinc-300' : 'bg-zinc-900 text-white hover:bg-zinc-800')}>
            {loading ? 'Salvando...' : <>Registrar Locação <CheckCircle2 className="w-5 h-5" /></>}
          </button>
        </form>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:border-zinc-900';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">{label}</label>
      {children}
    </div>
  );
}
