import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { X, HelpCircle, ArrowLeft, ArrowRight, Check } from 'lucide-react';

// Sobe a versão para reapresentar o tour depois de mudar os passos.
const TOUR_VERSION = 'v2';
const PAD = 8; // respiro do recorte do spotlight ao redor do elemento

type Step = { selector?: string; title: string; text: string };

// Passo a passo de CADA aba — cada passo aponta para uma seção REAL da tela
// (via data-tour="..."). Quando o elemento não existe, o balão aparece
// centralizado só com a explicação.
const TOURS: Record<string, Step[]> = {
  '/': [
    { selector: '[data-tour="dash-header"]', title: 'Bem-vindo 👋', text: 'Esta é a tela inicial. Aqui aparece com quem você está logado (seu papel) e a data de hoje.' },
    { selector: '[data-tour="dash-kpis"]', title: 'Indicadores do dia', text: 'Um resumo rápido em cartões: obras ativas, materiais, ferramentas e progresso geral.' },
    { selector: '[data-tour="dash-charts"]', title: 'Gráficos', text: 'À esquerda, as entregas de materiais da semana. À direita, o progresso geral da mão de obra em %.' },
    { selector: '[data-tour="dash-entregas"]', title: 'Últimas entregas', text: 'A lista das entregas de materiais mais recentes registradas no sistema.' },
  ],
  '/ferramentas': [
    { selector: '[data-tour="tools-header"]', title: 'Gestão de Ferramentas', text: 'Aqui você controla a retirada e a devolução de equipamentos, com foto e QR code.' },
    { selector: '[data-tour="tools-scan"]', title: 'Escanear código', text: 'Toque aqui e aponte a câmera para o QR da ferramenta — o app já abre a retirada ou a devolução automaticamente.' },
    { selector: '[data-tour="tools-add"]', title: 'Nova ferramenta', text: 'Admin e encarregado cadastram novas ferramentas no estoque por aqui.' },
    { selector: '[data-tour="tools-inventory"]', title: 'Inventário', text: 'Todas as ferramentas cadastradas. Cada cartão mostra o status (disponível / em uso) e permite retirar, devolver e ver o histórico.' },
    { selector: '[data-tour="tools-history"]', title: 'Atividade recente', text: 'O histórico das últimas movimentações: quem pegou, quando, e quando devolveu.' },
  ],
  '/obras': [
    { selector: '[data-tour="obras-header"]', title: 'Cadastro de Obras', text: 'Aqui ficam todas as obras, ativas e concluídas. Toque numa obra para abrir os detalhes.' },
    { selector: '[data-tour="obras-new"]', title: 'Nova obra', text: 'O administrador cadastra uma nova obra: cliente, endereço, centro de custo e status.' },
    { selector: '[data-tour="obras-filters"]', title: 'Busca e filtros', text: 'Procure por nome ou cliente e filtre pelo status (Ativa, Concluída, Pausada).' },
    { selector: '[data-tour="obras-list"]', title: 'Lista de obras', text: 'Cada cartão é uma obra. Ao abrir, há 3 abas: Progresso, Equipe Atribuída (defina os operadores da obra) e Informações.' },
  ],
  '/materiais': [
    { selector: '[data-tour="mat-header"]', title: 'Materiais Entregues', text: 'Controle de tudo que chega nas obras.' },
    { selector: '[data-tour="mat-new"]', title: 'Registrar entrega', text: 'Lance uma entrega: descrição, quantidade, fornecedor, valor e foto.' },
    { selector: '[data-tour="mat-search"]', title: 'Busca', text: 'Encontre rápido por material, código ou fornecedor.' },
    { selector: '[data-tour="mat-list"]', title: 'Lista de entregas', text: 'Cada item mostra o status de conferência (Conferido, Divergente ou Pendente). Os valores aparecem só para quem tem acesso financeiro.' },
  ],
  '/checklist': [
    { selector: '[data-tour="check-header"]', title: 'Checklist Diário', text: 'A rotina de campo em 4 passos — o número aceso mostra em qual etapa você está.' },
    { selector: '[data-tour="check-obra"]', title: 'Passo 1 — a obra', text: 'Escolha a obra do dia. Depois você confere os materiais (2), marca quem está presente (3) e lança o quanto foi executado (4).' },
  ],
  '/operadores': [
    { selector: '[data-tour="ops-header"]', title: 'Gerenciar Equipe', text: 'Cadastro das pessoas: operadores de campo e encarregados de obra.' },
    { selector: '[data-tour="ops-tabs"]', title: 'Operadores e Encarregados', text: 'Alterne entre as duas tabelas. Lembre: cadastrar aqui não cria o login — a pessoa cria a conta com o mesmo e-mail.' },
  ],
  '/progresso': [
    { selector: '[data-tour="prog-header"]', title: 'Mão de Obra e Progresso Físico', text: 'Acompanhe a execução e a produtividade dos serviços em tempo real.' },
    { selector: '[data-tour="prog-new"]', title: 'Adicionar atividade', text: 'Admin e encarregado cadastram novas atividades (serviços de mão de obra).' },
    { selector: '[data-tour="prog-filters"]', title: 'Busca e obra', text: 'Busque a atividade e filtre por obra.' },
    { selector: '[data-tour="prog-list"]', title: 'Atividades', text: 'Cada cartão mostra previsto x executado e o % concluído; admin e encarregado atualizam o avanço.' },
  ],
  '/financeiro': [
    { selector: '[data-tour="fin-header"]', title: 'Painel Financeiro', text: 'Consolidação de custos e auditoria das entregas. Acesso só de administrador.' },
    { selector: '[data-tour="fin-stats"]', title: 'Indicadores', text: 'Custo total executado, materiais conferidos x pendentes e o total de entregas.' },
  ],
  '/relatorios': [
    { selector: '[data-tour="rel-header"]', title: 'Relatórios', text: 'Relatórios e indicadores gerenciais — e dá para exportar para Excel.' },
    { selector: '[data-tour="rel-tabs"]', title: 'Tipos de relatório', text: 'Alterne entre Relatórios Diários, Ferramentas, Frota e o Dashboard BI.' },
  ],
  '/frota': [
    { selector: '[data-tour="frota-header"]', title: 'Controle de Frota', text: 'Retirada e devolução de veículos, com foto do painel e localização.' },
    { selector: '[data-tour="frota-scan"]', title: 'Escanear QR', text: 'Aponte a câmera para o QR do veículo e retire ou devolva rápido.' },
    { selector: '[data-tour="frota-add"]', title: 'Novo veículo', text: 'Admin e encarregado cadastram veículos da frota.' },
    { selector: '[data-tour="frota-list"]', title: 'Veículos', text: 'Cada cartão permite retirar, devolver, editar e ver o histórico do veículo.' },
    { selector: '[data-tour="frota-history"]', title: 'Atividade recente', text: 'As últimas movimentações da frota.' },
  ],
  '/equipamentos': [
    { selector: '[data-tour="equip-header"]', title: 'Equipamentos', text: 'Cada máquina como centro de custo e receita. Acesso só de administrador.' },
    { selector: '[data-tour="equip-new"]', title: 'Novo equipamento', text: 'Cadastre o ativo: nome, código, categoria, valor de aquisição, status e foto.' },
    { selector: '[data-tour="equip-kpis"]', title: 'Totais', text: 'Receita, custo e resultado somados de todos os equipamentos.' },
    { selector: '[data-tour="equip-rankings"]', title: 'Rankings', text: 'Os ativos mais lucrativos e os de maior custo de manutenção.' },
    { selector: '[data-tour="equip-list"]', title: 'Ativos cadastrados', text: 'Toque num equipamento para lançar manutenções e locações e ver KPIs, gráfico custo × receita e histórico.' },
  ],
  '/notas-fiscais': [
    { selector: '[data-tour="nf-header"]', title: 'NF / Cupom Fiscal', text: 'Lançamento de notas e cupons das compras feitas em campo.' },
    { selector: '[data-tour="nf-new"]', title: 'Novo lançamento', text: 'Foto do documento tirada na hora, valor, fornecedor, cartão, a obra e quem estava presente.' },
    { selector: '[data-tour="nf-search"]', title: 'Busca', text: 'Procure por fornecedor, cartão ou tipo de documento.' },
    { selector: '[data-tour="nf-total"]', title: 'Total', text: 'A soma dos lançamentos que estão sendo exibidos.' },
  ],
  '/settings': [
    { selector: '[data-tour="set-header"]', title: 'Configurações', text: 'Suas preferências e a segurança da sua conta.' },
    { selector: '[data-tour="set-notif"]', title: 'Notificações', text: 'Ative os avisos push neste aparelho e escolha o que quer receber.' },
    { selector: '[data-tour="set-senha"]', title: 'Alterar senha', text: 'Troque a sua senha de acesso quando precisar.' },
    { title: 'Administradores', text: 'Se você for um administrador autorizado, aparece também uma seção para gerenciar quem é admin (adicionar, ativar e remover).' },
  ],
};

type Rect = { top: number; left: number; width: number; height: number };

export function PageIntro() {
  const { pathname } = useLocation();
  const steps = TOURS[pathname];

  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tipPos, setTipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const tipRef = useRef<HTMLDivElement>(null);

  const seenKey = `tour-seen-${TOUR_VERSION}:${pathname}`;

  // Abre automaticamente apenas na 1ª visita de cada página.
  useEffect(() => {
    if (!steps || steps.length === 0) { setActive(false); return; }
    if (window.matchMedia('(max-width: 767px)').matches) { setActive(false); return; }
    let seen = false;
    try { seen = localStorage.getItem(`tour-seen-${TOUR_VERSION}:${pathname}`) === '1'; } catch {}
    setIdx(0);
    setActive(!seen);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = active && steps ? steps[idx] : null;

  // Mede o elemento-alvo (e mantém atualizado em scroll/resize).
  const measure = useCallback(() => {
    if (!step?.selector) { setRect(null); return; }
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => {
    if (!step) return;
    if (step.selector) {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    }
    measure();
    const onMove = () => measure();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [step, measure]);

  // Posiciona o balão perto do alvo (abaixo, ou acima se não couber).
  useLayoutEffect(() => {
    if (!active) return;
    const tip = tipRef.current;
    const tw = tip?.offsetWidth || 320;
    const th = tip?.offsetHeight || 180;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!rect) {
      setTipPos({ top: Math.max(16, vh / 2 - th / 2), left: Math.max(16, vw / 2 - tw / 2) });
      return;
    }
    let top = rect.top + rect.height + 12 + PAD;
    if (top + th > vh - 12) top = rect.top - th - 12 - PAD;
    if (top < 12) top = 12;
    let left = rect.left;
    if (left + tw > vw - 12) left = vw - tw - 12;
    if (left < 12) left = 12;
    setTipPos({ top, left });
  }, [rect, active, idx]);

  if (!steps || steps.length === 0) return null;

  const finish = () => {
    try { localStorage.setItem(seenKey, '1'); } catch {}
    setActive(false);
  };
  const next = () => { if (idx < steps.length - 1) setIdx(idx + 1); else finish(); };
  const prev = () => { if (idx > 0) setIdx(idx - 1); };
  const start = () => { setIdx(0); setActive(true); };

  return (
    <>
      {/* Botão "?" flutuante — (re)inicia o tour da página atual.
          z abaixo dos modais (z-50) para não cobrir telas em uso. */}
      <button
        type="button"
        onClick={start}
        title="Fazer o tour desta tela"
        aria-label="Fazer o tour desta tela"
        className="fixed bottom-4 left-4 z-30 w-11 h-11 rounded-full bg-zinc-900 text-white shadow-lg flex items-center justify-center hover:bg-zinc-800 active:scale-95 transition-all"
      >
        <HelpCircle className="w-5 h-5" />
      </button>

      {active && step && (
        <div className="fixed inset-0 z-[9994]">
          {/* Spotlight (recorte no elemento) ou escurecimento total se não houver alvo */}
          {rect ? (
            <div
              style={{
                position: 'fixed',
                top: rect.top - PAD,
                left: rect.left - PAD,
                width: rect.width + PAD * 2,
                height: rect.height + PAD * 2,
                borderRadius: 14,
                boxShadow: '0 0 0 9999px rgba(24,24,27,0.6)',
                border: '2px solid #ffffff',
                transition: 'all .2s ease',
                pointerEvents: 'none',
              }}
            />
          ) : (
            <div className="absolute inset-0 bg-zinc-900/60" />
          )}

          {/* Balão explicativo */}
          <div
            ref={tipRef}
            style={{ position: 'fixed', top: tipPos.top, left: tipPos.left, width: 320, maxWidth: 'calc(100vw - 24px)' }}
            className="bg-white rounded-2xl shadow-2xl p-4 z-[9997] animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-bold text-zinc-900 text-sm">{step.title}</h4>
              <button type="button" onClick={finish} className="p-1 -mt-1 -mr-1 text-zinc-400 hover:text-zinc-700" aria-label="Fechar"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed mt-1">{step.text}</p>
            <div className="flex items-center justify-between mt-3">
              <span className="text-[10px] font-bold text-zinc-400">{idx + 1} / {steps.length}</span>
              <div className="flex items-center gap-2">
                {idx > 0 && (
                  <button type="button" onClick={prev} className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-600 hover:bg-zinc-100 flex items-center gap-1">
                    <ArrowLeft className="w-3 h-3" />Voltar
                  </button>
                )}
                <button type="button" onClick={next} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-900 text-white hover:bg-zinc-800 flex items-center gap-1">
                  {idx === steps.length - 1 ? <>Concluir <Check className="w-3 h-3" /></> : <>Próximo <ArrowRight className="w-3 h-3" /></>}
                </button>
              </div>
            </div>
            {idx < steps.length - 1 && (
              <button type="button" onClick={finish} className="mt-2 w-full text-[10px] text-zinc-400 hover:text-zinc-600">Pular tour</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
