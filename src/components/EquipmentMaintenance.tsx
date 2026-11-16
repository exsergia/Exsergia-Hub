import { format } from 'date-fns';
import { AlertCircle, Calendar, CheckCircle2, Clock, Plus, Wrench } from 'lucide-react';
import type { Equipamento, EquipamentoManutencao, ManutencaoPeriodicidade, ManutencaoResultado } from '../types';
import {
  AUTHORIZATION_ITEM_ID, GENERATOR_MAINTENANCE_PLANS, getLatestMaintenance, getMaintenanceDate,
  getMaintenanceSchedule, isGeneratorEquipment, lastMaintenanceForItem, maintenanceChecklistCounts,
  maintenanceDescription, maintenanceLabel,
} from '../lib/equipmentMaintenance';
import { cn } from '../lib/utils';

const dateLabel = (record: EquipamentoManutencao) => {
  const date = getMaintenanceDate(record);
  return date ? format(date, 'dd/MM/yyyy') : 'Data não informada';
};

export function MaintenanceCardSummary({ latest, loading, error }: {
  latest?: EquipamentoManutencao | null; loading?: boolean; error?: boolean;
}) {
  return (
    <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-left">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-700"><Wrench className="h-3 w-3" /> Última manutenção</p>
      {error ? <p className="mt-1 text-xs text-red-600">Histórico indisponível.</p>
        : loading ? <p className="mt-1 text-xs text-zinc-500">Carregando histórico...</p>
          : latest ? <>
            <p className="mt-1 text-xs font-bold text-zinc-800">{maintenanceLabel(latest)} · {dateLabel(latest)}</p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{maintenanceDescription(latest)}</p>
          </> : <p className="mt-1 text-xs text-zinc-500">Nenhuma manutenção registrada.</p>}
    </div>
  );
}

export function EquipmentMaintenanceOverview({ equipamento, records, loading, error, onAdd }: {
  equipamento: Equipamento; records: EquipamentoManutencao[]; loading?: boolean; error?: boolean; onAdd: () => void;
}) {
  const latest = getLatestMaintenance(records);
  const schedule = getMaintenanceSchedule(records);
  return (
    <section className="space-y-4 rounded-3xl border border-blue-100 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900"><Wrench className="h-4 w-4 text-blue-600" /> Histórico e verificações do equipamento</h3>
        <button type="button" onClick={onAdd} className="flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-bold text-white"><Plus className="h-4 w-4" /> Registrar manutenção</button>
      </div>
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Não foi possível consultar o histórico de manutenção. Atualize a página para tentar novamente.</p>
        : loading ? <p className="text-sm text-zinc-500">Carregando histórico de manutenção...</p> : <>
          {latest ? (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700">Última manutenção realizada</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-base font-bold text-zinc-900">{maintenanceLabel(latest)} <span className="flex items-center gap-1 text-sm"><Calendar className="h-4 w-4" /> {dateLabel(latest)}</span></p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">{maintenanceDescription(latest)}</p>
              {latest.responsavelNome && <p className="mt-2 text-xs text-zinc-500">Responsável: {latest.responsavelNome}</p>}
              {latest.horimetro != null && <p className="mt-1 text-xs text-zinc-500">Horímetro: {latest.horimetro.toLocaleString('pt-BR')} h</p>}
            </div>
          ) : <p className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-500">Ainda não há manutenção registrada para este equipamento. Registre a execução para iniciar o histórico.</p>}
          {isGeneratorEquipment(equipamento) && <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {schedule.map(item => (
              <div key={item.period} className={cn('rounded-2xl border p-4', item.state === 'atrasada' ? 'border-red-200 bg-red-50' : item.state === 'hoje' ? 'border-amber-200 bg-amber-50' : 'border-zinc-200 bg-zinc-50')}>
                <p className="text-xs font-bold text-zinc-800">{item.label}</p>
                <p className="mt-2 text-[11px] text-zinc-500">Última completa: {item.lastDate ? format(item.lastDate, 'dd/MM/yyyy') : 'sem registro'}</p>
                <p className="mt-1 text-[11px] font-semibold text-zinc-700">Próxima prevista: {item.nextDate ? format(item.nextDate, 'dd/MM/yyyy') : 'aguardando histórico'}</p>
                <p className={cn('mt-3 flex items-center gap-1 text-[10px] font-bold', item.state === 'atrasada' ? 'text-red-700' : item.state === 'hoje' ? 'text-amber-700' : 'text-zinc-500')}>
                  {item.state === 'atrasada' ? <AlertCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  {item.state === 'atrasada' ? 'Verificação em atraso' : item.state === 'hoje' ? 'Verificação prevista para hoje' : item.state === 'em_dia' ? 'Dentro do prazo' : 'Sem verificação completa registrada'}
                </p>
              </div>
            ))}
          </div>}
          <p className="text-[11px] leading-relaxed text-zinc-400">A última manutenção considera todo o histórico, independentemente do filtro financeiro. Verificações parciais ficam registradas e não reiniciam o prazo da rotina.</p>
        </>}
    </section>
  );
}

export function MaintenanceChecklist({ periodicidade, resultados, onChange, records, autorizado, onAuthorizationChange }: {
  periodicidade: ManutencaoPeriodicidade;
  resultados: Record<string, ManutencaoResultado>;
  onChange: (results: Record<string, ManutencaoResultado>) => void;
  records: EquipamentoManutencao[];
  autorizado: boolean;
  onAuthorizationChange: (authorized: boolean) => void;
}) {
  if (periodicidade === 'avulsa') return null;
  const plan = GENERATOR_MAINTENANCE_PLANS[periodicidade];
  const performed = plan.items.filter(item => resultados[item.id] === 'realizado').length;
  const showAuthorization = resultados[AUTHORIZATION_ITEM_ID] === 'realizado' && periodicidade === 'mensal';
  return (
    <fieldset className="space-y-3 rounded-2xl border border-zinc-200 p-4">
      <legend className="px-2 text-xs font-bold text-zinc-800">{plan.label}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-zinc-500">{performed} de {plan.items.length} serviços realizados</p>
        <button type="button" onClick={() => onChange({ ...resultados, ...Object.fromEntries(plan.items.map(item => [item.id, 'realizado' as const])) })} className="text-[11px] font-bold text-blue-600 hover:underline">Marcar todos como realizados</button>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">Marque somente o que foi executado. Use “Não se aplica” quando necessário; os demais itens ficam pendentes.</p>
      <div className="max-h-[45vh] space-y-2 overflow-y-auto overscroll-contain pr-1">
        {plan.items.map(item => {
          const last = lastMaintenanceForItem(records, item.id);
          const result = resultados[item.id] || 'pendente';
          return <div key={item.id} className={cn('rounded-xl border p-3', result === 'realizado' ? 'border-emerald-100 bg-emerald-50/50' : 'border-zinc-100 bg-white')}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={result === 'realizado'} onChange={event => onChange({ ...resultados, [item.id]: event.target.checked ? 'realizado' : 'pendente' })} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
              <span className="text-xs font-medium leading-relaxed text-zinc-700">{item.descricao}</span>
            </label>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-7">
              <span className="text-[10px] text-zinc-400">Última realização: {last ? dateLabel(last) : 'sem registro'}</span>
              <button type="button" aria-pressed={result === 'nao_aplicavel'} onClick={() => onChange({ ...resultados, [item.id]: result === 'nao_aplicavel' ? 'pendente' : 'nao_aplicavel' })} className={cn('rounded-lg px-2 py-1 text-[10px] font-bold', result === 'nao_aplicavel' ? 'bg-zinc-200 text-zinc-800' : 'bg-zinc-50 text-zinc-400')}>Não se aplica</button>
            </div>
          </div>;
        })}
      </div>
      {showAuthorization && <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
        <input type="checkbox" checked={autorizado} onChange={event => onAuthorizationChange(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600" />
        Confirmo que os testes de proteção e alarmes foram executados mediante autorização da contratante.
      </label>}
    </fieldset>
  );
}

export function MaintenanceChecklistHistory({ record }: { record: EquipamentoManutencao }) {
  const counts = maintenanceChecklistCounts(record);
  if (!counts.total) return null;
  return (
    <details className="mt-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
      <summary className="cursor-pointer text-[11px] font-bold text-zinc-600">Checklist: {counts.realizados} realizado(s), {counts.naoAplicaveis} não aplicável(is), {counts.pendentes} pendente(s)</summary>
      <ul className="mt-3 space-y-2">
        {record.checklist!.map(item => <li key={item.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
          {item.resultado === 'realizado' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />}
          <span className="text-zinc-600">{item.descricao} <strong className={item.resultado === 'realizado' ? 'text-emerald-700' : 'text-zinc-400'}>— {item.resultado === 'realizado' ? 'Realizado' : item.resultado === 'nao_aplicavel' ? 'Não se aplica' : 'Pendente'}</strong></span>
        </li>)}
      </ul>
    </details>
  );
}
