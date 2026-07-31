// Service worker mínimo: solo habilita que el navegador reconozca
// la app como "instalable" de verdad. No cachea nada todavía.
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  // dejamos pasar todas las peticiones normalmente
});
