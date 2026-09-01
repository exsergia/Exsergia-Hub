import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Loader2, Settings, Smartphone, X } from 'lucide-react';
import { registerPushForUser } from '../lib/push';

type SetupState = 'checking' | 'permission' | 'install-ios' | 'blocked' | 'error' | 'enabled';

type Props = {
  userId: string;
  userEmail?: string;
  notify: (type: 'error' | 'success' | 'info' | 'warning', title: string, message?: string) => void;
};

const SNOOZE_KEY = 'push-setup-remind-after';

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function PushNotificationSetup({ userId, userEmail, notify }: Props) {
  const [state, setState] = useState<SetupState>('checking');
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const ios = useMemo(() => isIosDevice(), []);
  const receivesFiscalPush = userEmail?.trim().toLowerCase() === 'contasapagar@exsergia.eng.br';

  const check = useCallback(async () => {
    if (!userId) return;
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) {
      setState(ios && !isStandaloneApp() ? 'install-ios' : 'error');
      return;
    }
    if (ios && !isStandaloneApp()) {
      setState('install-ios');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }
    if (Notification.permission === 'granted') {
      const registered = await registerPushForUser(userId);
      setState(registered ? 'enabled' : 'error');
      return;
    }
    setState('permission');
  }, [ios, userId]);

  useEffect(() => {
    const remindAfter = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    if (remindAfter > Date.now()) setHidden(true);
    check();
  }, [check]);

  const activate = async () => {
    setBusy(true);
    try {
      const registered = await registerPushForUser(userId, { requestPermission: true });
      if (!registered) {
        setState('Notification' in window && Notification.permission === 'denied' ? 'blocked' : 'error');
        notify('warning', 'Notificações não ativadas', 'Confira a permissão de notificações deste aparelho.');
        return;
      }
      setState('enabled');
      setHidden(true);
      localStorage.removeItem(SNOOZE_KEY);
      notify(
        'success',
        'Notificações ativadas',
        receivesFiscalPush
          ? 'As novas notas fiscais chegarão neste aparelho mesmo com o aplicativo fechado.'
          : 'Os atrasos de ferramentas chegarão neste aparelho mesmo com o aplicativo fechado.',
      );
    } finally {
      setBusy(false);
    }
  };

  const remindLater = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
    setHidden(true);
  };

  if (hidden || state === 'checking' || state === 'enabled') return null;

  const content = state === 'install-ios'
    ? {
        icon: <Smartphone className="h-5 w-5" />,
        title: 'Instale para receber avisos',
        body: 'No iPhone, toque em Compartilhar e depois em “Adicionar à Tela de Início”. Abra o ícone instalado para ativar as notificações.',
      }
    : state === 'blocked'
      ? {
          icon: <Settings className="h-5 w-5" />,
          title: 'Notificações bloqueadas',
          body: 'Libere as notificações do Exsergia nas configurações do navegador ou do celular para receber os atrasos.',
        }
      : state === 'error'
        ? {
            icon: <BellRing className="h-5 w-5" />,
            title: 'Não foi possível registrar este aparelho',
            body: 'Verifique a conexão e tente ativar novamente.',
          }
        : {
            icon: <BellRing className="h-5 w-5" />,
            title: receivesFiscalPush ? 'Receba notas fiscais no celular' : 'Receba atrasos no celular',
            body: receivesFiscalPush
              ? 'Ative uma vez para ser avisado quando uma nova nota fiscal for lançada, mesmo sem abrir o aplicativo.'
              : 'Ative uma vez para receber avisos das suas ferramentas mesmo sem abrir o aplicativo.',
          };

  return (
    <div className="fixed inset-x-3 bottom-3 z-[9998] mx-auto max-w-lg rounded-2xl border border-amber-200 bg-white p-4 shadow-2xl shadow-zinc-900/20 sm:bottom-5">
      <button
        type="button"
        onClick={remindLater}
        className="absolute right-3 top-3 rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        aria-label="Lembrar depois"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-3 pr-7">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          {content.icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-zinc-900">{content.title}</p>
          <p className="mt-1 text-xs font-medium leading-relaxed text-zinc-600">{content.body}</p>
          {(state === 'permission' || state === 'error') && (
            <button
              type="button"
              onClick={activate}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
              {busy ? 'Ativando...' : 'Ativar notificações'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
