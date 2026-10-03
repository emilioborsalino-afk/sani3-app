// Service worker con cache de la "app shell" (las pantallas en sí: HTML,
// íconos, manifest) — para que la app pueda ABRIR sin nada de señal,
// usando la última copia guardada en el celular. Esto es lo que le
// faltaba: antes, sin wifi NI datos, el celular ni siquiera lograba
// cargar la página para empezar, así que la lógica de "sacar fotos sin
// conexión y subirlas después" (ya armada en app.js, con su cola de
// pendientes) nunca llegaba a arrancar.
//
// OJO: esto NO cachea los pedidos al backend (Apps Script) ni nada de
// Google — esos siempre van directo a la red. app.js ya sabe manejar
// solo cuando esos pedidos fallan por falta de señal (guarda la foto
// pendiente, la sube sola después) — este archivo solo se encarga de que
// la PANTALLA misma pueda abrir sin depender de internet.

const CACHE_NAME = 'sani3-cache-v1';

// Las páginas principales y archivos chicos que no cambian de nombre
// (sin "?v=" al final) — los precargamos apenas se instala esto, la
// primera vez que se usa la app con señal.
const ARCHIVOS_APP_SHELL = [
  './empleado.html',
  './index.html',
  './manifest.json',
  './manifest-empleado.json',
  './icon-192.png',
  './icon-512.png',
  './logo.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Si alguno de estos archivos falla al guardar (por ejemplo, si no
      // existiera), no hacemos que falle toda la instalación — guardamos
      // los que sí se puedan.
      return Promise.all(
        ARCHIVOS_APP_SHELL.map((url) => cache.add(url).catch(() => {}))
      );
    })
  );
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
  // Borramos copias de versiones viejas del cache (si en el futuro se
  // sube un CACHE_NAME distinto), para no ir acumulando basura.
  e.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Nunca tocamos pedidos a otro sitio (el backend de Apps Script, las
  // fuentes de Google, etc.) — esos siempre van directo a la red, sin
  // cache de por medio.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Para los archivos propios de la app (HTML, app.js con su "?v=...",
  // íconos, manifests): mostramos lo que ya tengamos guardado AL
  // INSTANTE, para que la pantalla abra sin esperar nada — y en paralelo
  // pedimos una copia fresca a internet para la PRÓXIMA vez, así con
  // señal la app se va actualizando sola. Esto también es lo que hace
  // que "app.js?v=94" quede guardado automáticamente la primera vez que
  // se carga con señal, sin tener que listarlo a mano acá arriba (la
  // parte del "?v=" cambia cada vez que subimos una versión nueva).
  e.respondWith(
    caches.match(e.request).then((respuestaGuardada) => {
      const pedidoDeRed = fetch(e.request)
        .then((respuestaFresca) => {
          if (respuestaFresca && respuestaFresca.ok) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, respuestaFresca.clone());
            });
          }
          return respuestaFresca;
        })
        .catch(() => null); // sin señal: no hay red, usamos lo guardado nomás

      return respuestaGuardada || pedidoDeRed;
    })
  );
});
