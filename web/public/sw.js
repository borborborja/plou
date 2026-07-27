/* Service worker de Plou: avisos push y caché mínima del armazón de la app. */

const CACHE = 'plou-shell-v2';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  // La tipografía va en la caché del armazón: sin ella la app se ve con la
  // fuente del sistema al abrirla sin conexión.
  '/fonts/roboto-latin.woff2',
  '/fonts/roboto-latin-ext.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Estrategia de red: las peticiones a la API nunca se cachean (los datos
 * meteorológicos caducan enseguida); el resto usa "red primero, caché si falla"
 * para que la app abra aunque no haya conexión.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Plou', body: event.data ? event.data.text() : '' };
  }

  const payload = data.data || {};
  const title = data.title || 'Plou';
  const options = {
    body: data.body || '',
    tag: data.tag || 'plou',
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: data.vibrate || undefined,
    requireInteraction: Boolean(data.requireInteraction),
    timestamp: Date.now(),
    data: payload,
    actions:
      payload.kind === 'test'
        ? []
        : [
            { action: 'open', title: 'Ver radar' },
            { action: 'snooze', title: 'Posponer' },
          ],
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Si la app está abierta se le avisa para que haga sonar la alarma.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'plou-alarm', title, body: options.body, payload });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  const payload = event.notification.data || {};
  event.notification.close();

  if (event.action === 'snooze' && payload.locationId) {
    event.waitUntil(
      fetch(`/api/locations/${payload.locationId}/snooze`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-device-id': payload.deviceId || '',
        },
        body: JSON.stringify({ minutes: payload.snoozeMinutes || 30 }),
      }).catch(() => undefined),
    );
    return;
  }

  const target = payload.locationId ? `/?tab=radar&location=${payload.locationId}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'plou-open', payload });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'plou-skip-waiting') self.skipWaiting();
});
