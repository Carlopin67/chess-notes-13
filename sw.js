// Cambiar la versión cada vez que se publique una actualización: así los
// dispositivos descargan los archivos nuevos y borran los viejos.
const CACHE_NAME = 'ajedrez-pgn-v14';
// El motor (7 MB) va aparte y no se borra al actualizar la app: se
// descarga una sola vez, la primera vez que se abre una partida.
const ENGINE_CACHE = 'ajedrez-stockfish-18';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './pieces.js',
  './icons.js',
  './sync.js',
  './engine.js',
  './app.js',
  './manifest.json',
  './icon-96x96.png',
  './icon-180x180.png',
  './icon-192x192.png'
];

// Los diseños de piezas (unos 150 KB en total) se guardan todos: así se
// puede cambiar de diseño también sin conexión.
const PIECE_SETS = ['cburnett', 'merida', 'chessnut', 'papercut', 'kiwen-suwi', 'fantasy'];
PIECE_SETS.forEach((set) => ['w', 'b'].forEach((c) => ['K', 'Q', 'R', 'B', 'N', 'P'].forEach((t) =>
  ASSETS.push(`./pieces/${set}/${c}${t}.svg`))));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== ENGINE_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// La app se sirve siempre desde la caché: abre al instante y sin red.
// Solo los archivos de la propia app; lo demás (la sincronización con la
// nube) va directo a la red y nunca se guarda aquí.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const cacheName = new URL(request.url).pathname.includes('/engine/') ? ENGINE_CACHE : CACHE_NAME;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(cacheName).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
