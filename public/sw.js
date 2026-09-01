const CACHE_NAME = 'exsergia-app-v10';
const CACHE_PREFIX = 'exsergia-app';
const CORE_ASSETS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

// Ao instalar, já coloca o HTML principal no cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Ao ativar, remove caches antigos e assume controle imediatamente
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Não cacheia chamadas externas (Supabase API, Storage, etc.)
  if (url.origin !== self.location.origin) return;

  // Navegação (HTML) — tenta rede primeiro, usa cache como fallback
  // Garante que ao voltar da câmera / recarregar por evicção do iOS,
  // o app carrega instantaneamente do cache sem precisar de rede.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => {
              c.put(event.request, clone);
              c.put('/', response.clone());
            });
          }
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Assets do Vite (nomes com hash) — cache-first: nunca mudam enquanto o hash é o mesmo
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Demais recursos locais (ícones, manifest, etc.) — rede com fallback em cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Web Push ─────────────────────────────────────────────────────────────────
// Recebe a notificação enviada pelo servidor (funciona com o app fechado).
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'Exsergia Hub', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Exsergia Hub';
  const options = {
    body: payload.body || '',
    // Sem `icon` (ícone grande): no Android ele fica à direita e quebra/corta o
    // texto do corpo. Mantemos só o `badge` (ícone monocromático da barra de status).
    badge: '/icon-192.png',
    tag: payload.tag || 'exsergia-notif',
    renotify: true,
    requireInteraction: true,
    timestamp: Date.now(),
    data: { url: payload.url || '/' },
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch(error => {
      console.warn('Notificacao nao exibida neste navegador:', error);
    })
  );
});

// Ao tocar na notificação, foca uma janela aberta ou abre o app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) { try { client.navigate(targetUrl); } catch (e) {} }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
