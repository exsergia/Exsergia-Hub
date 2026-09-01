import { supabase } from './supabase';

// Chave VAPID pública (pode ser pública — identifica o servidor de push).
export const VAPID_PUBLIC_KEY = 'BKypXGMIjVO2r_XesWUjok4ZXIHlN6VhCCgT7NuSWA5xOgp_0vY1Ql4svCUb1RmlMAi54-D5zoi18o5PH-S97es';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Garante que o dispositivo do usuário esteja inscrito para receber Web Push.
 * Idempotente: pode ser chamada toda vez que o usuário entra no app.
 * Retorna true se a inscrição está ativa e salva.
 */
export type RegisterPushOptions = {
  requestPermission?: boolean;
};

async function subscribe(reg: ServiceWorkerRegistration) {
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
}

/**
 * Registra o aparelho no servidor. A solicitação de permissão só acontece
 * quando `requestPermission` é true, pois celulares exigem que o pedido seja
 * iniciado por um toque do usuário.
 */
export async function registerPushForUser(
  userId: string,
  options: RegisterPushOptions = {},
): Promise<boolean> {
  try {
    if (!userId) return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return false;
    }
    if (Notification.permission === 'denied') return false;
    if (Notification.permission === 'default') {
      if (!options.requestPermission) return false;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return false;
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await subscribe(reg);

    const saveSubscription = async (subscription: PushSubscription) => {
      const json = subscription.toJSON();
      return supabase.from('push_subscriptions').upsert({
        id: subscription.endpoint,
        data: {
          userId,
          endpoint: subscription.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
          updatedAt: new Date().toISOString(),
        },
      });
    };

    let { error } = await saveSubscription(sub);

    // Em aparelhos compartilhados, uma inscrição antiga pode pertencer a
    // outro login e ser recusada pela RLS. Recria o endpoint para o usuário
    // atual sem expor nem alterar o cadastro anterior.
    if (error) {
      await sub.unsubscribe().catch(() => false);
      sub = await subscribe(reg);
      ({ error } = await saveSubscription(sub));
    }

    if (error) throw error;

    return true;
  } catch (e) {
    console.warn('Falha ao registrar push:', e);
    return false;
  }
}
