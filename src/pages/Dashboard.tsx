import { useMemo } from 'react';
import { useCollection } from '../lib/supabaseHooks';
import { collection, query, limit, orderBy } from '../lib/supabaseDb';
import { db } from '../lib/supabase';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';
import {
  Activity,
  HardHat,
  Package,
  CheckCircle2,
  ArrowUpRight,
  AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { Atividade, Checklist, Material } from '../types';
import { parseDate } from '../lib/dateUtils';
import { getLocalDateKey } from '../lib/progress';

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  encarregado: 'Encarregado',
  operator: 'Operador',
};

function inicioDaSemanaAtual() {
  const hoje = new Date();
  const dia = hoje.getDay();
  const diferencaParaSegunda = dia === 0 ? -6 : 1 - dia;
  const segunda = new Date(hoje);
  segunda.setDate(hoje.getDate() + diferencaParaSegunda);
  segunda.setHours(0, 0, 0, 0);
  return segunda;
}

function getDiaIndex(date: Date, inicioSemana: Date) {
  const start = new Date(inicioSemana);
  start.setHours(0, 0, 0, 0);
  const current = new Date(date);
  current.setHours(0, 0, 0, 0);
  return Math.floor((current.getTime() - start.getTime()) / 86400000);
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function saudacaoPorHorario() {
  const hora = new Date().getHours();
  if (hora >= 5 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

export default function Dashboard() {
  const { user, userProfile, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [obrasSnap, loading, obrasError] = useCollection(collection(db, 'obras'));
  const [materiaisSnap, , materiaisError] = useCollection(collection(db, 'materiais'));
  const [atividadesSnap, , atividadesError] = useCollection(collection(db, 'atividades'));
  const [checklistsSnap, , checklistsError] = useCollection(collection(db, 'checklists'));
  const [progressoDiarioSnap, , progressoDiarioError] = useCollection(collection(db, 'progresso_diario'));
  const [ultimasEntregasSnap, , ultimasEntregasError] = useCollection(query(collection(db, 'materiais'), orderBy('dataEntrega', 'desc'), limit(5)));
  const [ultimosChecklistsSnap, , ultimosChecklistsError] = useCollection(query(collection(db, 'checklists'), orderBy('data', 'desc'), limit(5)));

  const materiais = (materiaisSnap?.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) as Material[]) || [];
  const atividades = (atividadesSnap?.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) as Atividade[]) || [];
  const checklists = (checklistsSnap?.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) as Checklist[]) || [];
  const progressoDiario = (progressoDiarioSnap?.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))) || [];
  const loadError = obrasError || materiaisError || atividadesError || checklistsError || progressoDiarioError || ultimasEntregasError || ultimosChecklistsError;
  const canOpenReports = isAdmin || (userProfile?.email || user?.email || '').trim().toLowerCase() === 'contasapagar@exsergia.eng.br';

  const goToMaterials = () => {
    navigate('/materiais');
  };

  const goToReports = (checklistId?: string) => {
    try {
      localStorage.setItem('tab-relatorios', 'diarios');
      if (checklistId) sessionStorage.setItem('relatorio-checklist-id', checklistId);
    } catch {
      // Storage pode falhar em alguns navegadores privados; a navegacao ainda funciona.
    }
    navigate('/relatorios');
  };

  const chartData = useMemo(() => {
    const inicioSemana = inicioDaSemanaAtual();
    const hojeIndex = getDiaIndex(new Date(), inicioSemana);

    const entregasPorDia: { name: string; entregas: number; progresso: number | null }[] =
      DIAS_SEMANA.map((name) => ({ name, entregas: 0, progresso: null as number | null }));

    materiais.forEach((material) => {
      const dataEntrega = parseDate(material.dataEntrega);
      if (!dataEntrega) return;
      const diaIndex = getDiaIndex(dataEntrega, inicioSemana);
      if (diaIndex < 0 || diaIndex >= DIAS_SEMANA.length) return;
      entregasPorDia[diaIndex].entregas += Number(material.quantidade || 0);
    });

    const totalPrevisto = atividades.reduce((sum, a) => sum + Number(a.quantidadePrevista || 0), 0);
    const progressoChecklist = checklists.flatMap((checklist) => {
      const dataChecklist = parseDate(checklist.data);
      return (checklist.progresso || []).map((item) => ({ ...item, data: dataChecklist }));
    }).filter((item) => item.data && Number(item.qtdExecutadaNoDia || 0) > 0);

    const progressoAtual = totalPrevisto > 0
      ? Math.min(100, (atividades.reduce((sum, a) => sum + Number(a.quantidadeExecutada || 0), 0) / totalPrevisto) * 100)
      : 0;

    // Snapshots desta semana (tabela progresso_diario): evolução real dia a dia
    const snapshotsSemana = progressoDiario.filter((p: any) => {
      const d = new Date(p.id || p.data || '');
      const idx = getDiaIndex(d, inicioSemana);
      return idx >= 0 && idx <= 5;
    });

    let lastKnown = 0;

    entregasPorDia.forEach((dia, index) => {
      if (!totalPrevisto) { dia.progresso = 0; return; }
      if (index > hojeIndex) { dia.progresso = null; return; }

      if (progressoChecklist.length) {
        // Progresso via Checklist Diário: acumulado real por dia
        const fimDoDia = new Date(inicioSemana);
        fimDoDia.setDate(inicioSemana.getDate() + index);
        fimDoDia.setHours(23, 59, 59, 999);
        const executadoAteODia = progressoChecklist.reduce((sum, item) => {
          if (!item.data || item.data.getTime() > fimDoDia.getTime()) return sum;
          return sum + Number(item.qtdExecutadaNoDia || 0);
        }, 0);
        dia.progresso = Math.min(100, (executadoAteODia / totalPrevisto) * 100);
        lastKnown = dia.progresso;
      } else if (snapshotsSemana.length > 0) {
        // Progresso via snapshots diários: fill-forward com o último valor conhecido
        const dayDate = new Date(inicioSemana);
        dayDate.setDate(inicioSemana.getDate() + index);
        const dateStr = getLocalDateKey(dayDate);
        const snap = snapshotsSemana.find((p: any) => (p.id || p.data) === dateStr);
        if (snap) lastKnown = Number(snap.percentual || 0);
        dia.progresso = lastKnown;
      } else {
        // Fallback para registros sem snapshot: linha flat desde o dia do primeiro lançamento
        const primeiroIdx = (() => {
          let earliest: number | null = null;
          for (const a of atividades) {
            if (!Number(a.quantidadeExecutada || 0)) continue;
            const dt = parseDate((a as any).updatedAt);
            if (!dt) continue;
            const idx = getDiaIndex(dt, inicioSemana);
            if (idx >= 0 && idx <= hojeIndex) {
              if (earliest === null || idx < earliest) earliest = idx;
            }
          }
          return earliest !== null ? earliest : (progressoAtual > 0 ? 0 : hojeIndex);
        })();
        dia.progresso = index >= primeiroIdx ? progressoAtual : 0;
      }
    });

    return entregasPorDia.map((item) => ({
      ...item,
      entregas: Number(item.entregas.toFixed(2)),
      progresso: item.progresso !== null ? Number(item.progresso.toFixed(2)) : null,
    }));
  }, [materiais, atividades, checklists, progressoDiario]);

  const stats = [
    {
      label: 'Obras Ativas',
      value: obrasSnap?.docs.filter((d: any) => d.data().status === 'Ativa').length || 0,
      icon: HardHat,
      color: 'bg-blue-50 text-blue-600 border-blue-100'
    },
    {
      label: 'Materiais Entregues',
      value: formatNumber(materiais.reduce((sum, material) => sum + Number(material.quantidade || 0), 0)),
      icon: Package,
      color: 'bg-amber-50 text-amber-600 border-amber-100'
    },
    {
      label: 'Checklists',
      value: checklistsSnap?.size || 0,
      icon: CheckCircle2,
      color: 'bg-green-50 text-green-600 border-green-100'
    },
    {
      label: 'Atividades Pendentes',
      value: atividades.filter((atividade) => Number(atividade.percentual || 0) < 100).length,
      icon: Activity,
      color: 'bg-purple-50 text-purple-600 border-purple-100'
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div data-tour="dash-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
            {saudacaoPorHorario()}, {userProfile?.nome || user?.email?.split('@')[0] || 'Usuário'}
          </h2>
          <p className="text-zinc-500">
            Você está logado como <span className="font-bold text-zinc-900 uppercase text-xs">{ROLE_LABELS[userProfile?.role || ''] || 'Operador'}</span>.
          </p>
        </div>
        <div className="text-sm font-medium text-zinc-400 bg-zinc-100 px-3 py-1.5 rounded-lg border border-zinc-200 uppercase tracking-wider">
          {format(new Date(), "eeee, d 'de' MMMM", { locale: ptBR })}
        </div>
      </div>

      {loadError && (
        <DashboardLoadError
          title="Erro ao carregar dashboard"
          message={loadError.message}
        />
      )}

      <div data-tour="dash-kpis" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array(4).fill(0).map((_, i) => (
            <div key={i} className="bg-white p-5 rounded-xl border border-zinc-200 shadow-sm flex items-start gap-4 animate-pulse">
              <div className="w-12 h-12 rounded-lg bg-zinc-100" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 bg-zinc-100 rounded w-3/4" />
                <div className="h-6 bg-zinc-100 rounded w-1/2" />
              </div>
            </div>
          ))
        ) : stats.map((stat, i) => (
          <div key={i} className="bg-white p-5 rounded-xl border border-zinc-200 shadow-sm flex items-start gap-4 hover:shadow-md transition-shadow">
            <div className={`p-3 rounded-lg ${stat.color} border`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">{stat.label}</p>
              <p className="text-2xl font-bold text-zinc-900">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div data-tour="dash-charts" className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-zinc-900">Entregas da Semana</h3>
            <div className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Materiais</div>
          </div>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f1" />
                <XAxis dataKey="name" fontSize={11} axisLine={false} tickLine={false} />
                <YAxis fontSize={11} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(value: any) => [formatNumber(Number(value)), 'Qtd. entregue']}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e4e4e7', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  cursor={{ fill: '#fafafa' }}
                />
                <Bar dataKey="entregas" fill="#18181b" radius={[4, 4, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!materiais.length && (
            <p className="mt-3 text-xs text-zinc-400 text-center">Sem entregas registradas. O gráfico será atualizado quando materiais forem cadastrados.</p>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-zinc-900">Progresso Geral</h3>
            <div className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Mão de obra %</div>
          </div>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f1" />
                <XAxis dataKey="name" fontSize={11} axisLine={false} tickLine={false} />
                <YAxis fontSize={11} axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip
                  formatter={(value: any) => [`${formatNumber(Number(value))}%`, 'Progresso geral']}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e4e4e7' }}
                />
                <Line
                  type="monotone"
                  dataKey="progresso"
                  stroke="#18181b"
                  strokeWidth={2}
                  dot={{ r: 4, fill: '#fff', strokeWidth: 2, stroke: '#18181b' }}
                  activeDot={{ r: 6, fill: '#18181b' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {!atividades.length && (
            <p className="mt-3 text-xs text-zinc-400 text-center">Sem atividades cadastradas. O progresso será atualizado quando houver avanço físico.</p>
          )}
        </div>
      </div>

      <div data-tour="dash-entregas" className="grid lg:grid-cols-2 gap-6 pb-8">
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="font-semibold text-zinc-900">Últimas Entregas</h3>
            <button
              type="button"
              onClick={goToMaterials}
              className="text-xs font-semibold text-zinc-400 hover:text-zinc-900 transition-colors uppercase tracking-widest"
            >
              Ver Todas
            </button>
          </div>
          <div className="divide-y divide-zinc-100 flex-1">
            {ultimasEntregasSnap?.docs.length ? ultimasEntregasSnap.docs.map((doc: any) => {
              const data = doc.data();
              return (
                <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-zinc-50 group cursor-default">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center border border-zinc-200">
                      <Package className="w-5 h-5 text-zinc-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 tracking-tight">{data.descricao}</p>
                      <p className="text-xs text-zinc-500">{data.fornecedor} • {data.unidade}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-zinc-900">+{formatNumber(Number(data.quantidade || 0))}</p>
                    <p className="text-[10px] text-zinc-400">{data.codigoEntrega}</p>
                  </div>
                </div>
              );
            }) : (
              <div className="p-12 text-center">
                <p className="text-sm text-zinc-400">Nenhuma entrega registrada.</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="font-semibold text-zinc-900">Checklists Recentes</h3>
            {canOpenReports && (
              <button
                type="button"
                onClick={() => goToReports()}
                className="text-xs font-semibold text-zinc-400 hover:text-zinc-900 transition-colors uppercase tracking-widest"
              >
                Ver Todos
              </button>
            )}
          </div>
          <div className="divide-y divide-zinc-100 flex-1">
            {ultimosChecklistsSnap?.docs.length ? ultimosChecklistsSnap.docs.map((doc: any) => {
               const data = doc.data();
               return (
                <div
                  key={doc.id}
                  role={canOpenReports ? 'button' : undefined}
                  tabIndex={canOpenReports ? 0 : undefined}
                  onClick={canOpenReports ? () => goToReports(doc.id) : undefined}
                  onKeyDown={canOpenReports ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      goToReports(doc.id);
                    }
                  } : undefined}
                  className={`w-full p-4 flex items-center justify-between text-left group transition-colors ${canOpenReports ? 'hover:bg-zinc-50 cursor-pointer' : 'cursor-default'}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center border border-zinc-200">
                      <ClipboardCheck className="w-5 h-5 text-zinc-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 tracking-tight">Relatório de Conferência</p>
                      <p className="text-xs text-zinc-500">Resp: {data.nomeResponsavel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="text-xs font-medium text-zinc-600">Finalizado</span>
                    {canOpenReports && <ArrowUpRight className="w-4 h-4 text-zinc-300 group-hover:text-zinc-900 transition-colors ml-2" />}
                  </div>
                </div>
              );
            }) : (
              <div className="p-12 text-center">
                <p className="text-sm text-zinc-400">Nenhum checklist registrado.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardLoadError({ title, message }: { title: string; message?: string }) {
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

function ClipboardCheck(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  );
}
