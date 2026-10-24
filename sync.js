// ============================================================
// ALMACENAMIENTO Y SINCRONIZACIÓN
// Todo se guarda primero en el dispositivo: la app sigue siendo
// instantánea y funciona sin conexión. Si hay servidor configurado,
// los cambios se suben solos en segundo plano y se traen los de los
// demás dispositivos. Gana siempre la versión más reciente de cada
// dato (una partida, un apunte, una lista de ramificaciones…).
// ============================================================

// Dirección del servidor (el Worker de Cloudflare, ver backend/).
// Vacía: la app funciona igual, pero solo guarda en este dispositivo.
const SYNC_ENDPOINT = '';

const Store = (() => {
  // Preferencias de cada dispositivo: no viajan a la nube.
  const LOCAL_ONLY = new Set([
    'chess-theme', 'chess-look', 'chess-type-scale', 'chess-board-flipped',
    'chess-board-coords', 'chess-notation-lang', 'chess-keep-awake',
    'chess-teacher-mode', 'chess-seeded', 'chess-eval-bar', 'chess-piece-set',
    'chess-install-hint-closed'
  ]);
  const DIRTY_KEY = 'sync-dirty';    // { clave: cuándo cambió } pendiente de subir
  const TOKEN_KEY = 'sync-token';
  const CURSOR_KEY = 'sync-cursor';
  const LAST_KEY = 'sync-last';
  const QUIET_KEY = 'sync-quiet';
  const TOKEN_RE = /^[a-km-np-z2-9]{32}$/;
  const BATCH_MAX = 200;
  const BATCH_BYTES = 900000;
  const KEEPALIVE_BYTES = 60000;     // tope del navegador al cerrar la app

  const isSynced = (k) => k.startsWith('chess-') && !LOCAL_ONLY.has(k);

  function get(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function rawSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }
  function rawRemove(k) {
    try { localStorage.removeItem(k); } catch (e) {}
  }
  function keys(prefix) {
    try { return Object.keys(localStorage).filter(k => k.startsWith(prefix)); } catch (e) { return []; }
  }

  let dirty = {};
  try { dirty = JSON.parse(get(DIRTY_KEY) || '{}') || {}; } catch (e) { dirty = {}; }
  const saveDirty = () => rawSet(DIRTY_KEY, JSON.stringify(dirty));

  // Datos que puso la app por su cuenta y nadie ha tocado todavía.
  let quiet = [];
  try { quiet = JSON.parse(get(QUIET_KEY) || '[]') || []; } catch (e) { quiet = []; }
  const saveQuiet = () => rawSet(QUIET_KEY, JSON.stringify(quiet));

  function markDirty(k, t) {
    if (!isSynced(k)) return;
    dirty[k] = t;
    saveDirty();
    if (quiet.includes(k)) { quiet = quiet.filter(q => q !== k); saveQuiet(); }
    scheduleSync();
  }

  function set(k, v) {
    if (!rawSet(k, v)) return false;
    markDirty(k, Date.now());
    return true;
  }
  function remove(k) {
    rawRemove(k);
    markDirty(k, Date.now());
  }
  // Para datos que la app genera o retira sola (la partida de ejemplo,
  // el formato antiguo de la biblioteca): no cuentan como un cambio que
  // haya que subir.
  function setQuiet(k, v) {
    if (!rawSet(k, v)) return false;
    if (isSynced(k) && !quiet.includes(k)) { quiet.push(k); saveQuiet(); }
    return true;
  }
  function removeQuiet(k) { rawRemove(k); }

  // ---------- Estado visible para Ajustes ----------
  let status = SYNC_ENDPOINT ? 'idle' : 'off';
  const statusListeners = [];
  const remoteListeners = [];
  function setStatus(s) {
    status = s;
    statusListeners.forEach(fn => { try { fn(s); } catch (e) {} });
  }

  // ---------- Red ----------
  const endpoint = () => SYNC_ENDPOINT.replace(/\/+$/, '');
  const token = () => get(TOKEN_KEY);

  async function request(path, body, auth, keepalive) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (auth) headers.Authorization = 'Bearer ' + auth;
      const res = await fetch(endpoint() + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
        keepalive: !!keepalive,
        credentials: 'omit',
        cache: 'no-store'
      });
      let data = {};
      try { data = await res.json(); } catch (e) {}
      return { status: res.status, data: data || {} };
    } finally {
      clearTimeout(timer);
    }
  }

  // Lo pendiente de subir, en tandas que el servidor acepte de una vez.
  function takeBatch(maxBytes) {
    const batch = [];
    let bytes = 0;
    for (const k of Object.keys(dirty)) {
      const v = get(k);
      const size = k.length + (v ? v.length : 0) + 24;
      if (batch.length && (batch.length >= BATCH_MAX || bytes + size > maxBytes)) break;
      batch.push({ k, v, t: dirty[k] });
      bytes += size;
    }
    return batch;
  }

  function clearSent(batch) {
    batch.forEach(c => { if (dirty[c.k] === c.t) delete dirty[c.k]; });
    saveDirty();
  }

  function applyRemote(changes) {
    if (!Array.isArray(changes) || !changes.length) return;
    const touched = new Set();
    changes.forEach(c => {
      if (!c || typeof c.k !== 'string' || !isSynced(c.k)) return;
      if (c.v !== null && typeof c.v !== 'string') return;
      const t = Number(c.t) || 0;
      // Si aquí hay un cambio más nuevo sin subir, manda el de aquí.
      if (dirty[c.k] && dirty[c.k] > t) return;
      if (dirty[c.k]) delete dirty[c.k];
      if (get(c.k) === c.v) return;
      if (c.v === null) rawRemove(c.k); else rawSet(c.k, c.v);
      touched.add(c.k);
    });
    saveDirty();
    if (touched.size) remoteListeners.forEach(fn => { try { fn(touched); } catch (e) {} });
  }

  function markAllDirty(t) {
    keys('chess-').filter(isSynced).forEach(k => {
      if (!dirty[k] || dirty[k] < t) dirty[k] = t;
    });
    saveDirty();
  }

  let creationRefused = false;

  async function ensureSpace() {
    if (token()) return true;
    if (creationRefused) { setStatus('full'); return false; }
    const { status: code, data } = await request('/spaces', {}, null, false);
    if (code === 200 && TOKEN_RE.test(data.token || '')) {
      rawSet(TOKEN_KEY, data.token);
      rawSet(CURSOR_KEY, '0');
      // Lo que ya había en el dispositivo es lo bueno: se sube todo.
      markAllDirty(Date.now());
      return true;
    }
    if (code === 403) { creationRefused = true; setStatus('full'); }
    else setStatus('error');
    return false;
  }

  let syncTimer = null;
  let running = false;
  let again = false;

  function scheduleSync(delay) {
    if (!SYNC_ENDPOINT) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(run, delay === undefined ? 1500 : delay);
  }

  async function run() {
    clearTimeout(syncTimer);
    if (!SYNC_ENDPOINT) { setStatus('off'); return; }
    if (running) { again = true; return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    running = true;
    const leaving = document.visibilityState === 'hidden';
    setStatus('syncing');
    try {
      if (!(await ensureSpace())) return;
      for (let round = 0; round < 40; round++) {
        const pending = Object.keys(dirty).length;
        const batch = takeBatch(leaving ? KEEPALIVE_BYTES : BATCH_BYTES);
        const cursor = Number(get(CURSOR_KEY)) || 0;
        const { status: code, data } = await request('/sync', { cursor, changes: batch }, token(), leaving);
        if (code === 401) {
          rawRemove(TOKEN_KEY);
          rawRemove(CURSOR_KEY);
          creationRefused = true;
          setStatus('unlinked');
          return;
        }
        if (code !== 200) { setStatus('error'); return; }
        clearSent(batch);
        applyRemote(data.changes);
        if (Number.isFinite(data.cursor) && data.cursor > cursor) rawSet(CURSOR_KEY, String(data.cursor));
        if (!data.more && pending <= batch.length) break;
      }
      rawSet(LAST_KEY, String(Date.now()));
      setStatus('ok');
    } catch (e) {
      setStatus(navigator.onLine ? 'error' : 'offline');
    } finally {
      running = false;
      if (again) { again = false; scheduleSync(); }
    }
  }

  // Vincular este dispositivo a la nube de otro. Lo que haya aquí se
  // junta con lo de allí; si un dato existe en los dos, gana el de allí.
  async function link(code) {
    const clean = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!TOKEN_RE.test(clean)) return 'invalid';
    if (!SYNC_ENDPOINT) return 'off';
    try {
      const { status: res } = await request('/sync', { cursor: 0, changes: [] }, clean, false);
      if (res === 401) return 'invalid';
      if (res !== 200) return 'error';
    } catch (e) {
      return 'error';
    }
    rawSet(TOKEN_KEY, clean);
    rawSet(CURSOR_KEY, '0');
    creationRefused = false;
    // Lo que la app puso por su cuenta aquí (la partida de ejemplo) no se
    // lleva a la otra nube: se retira y manda lo que haya allí.
    const placeholders = quiet.filter(k => !dirty[k]);
    placeholders.forEach(rawRemove);
    quiet = [];
    saveQuiet();
    if (placeholders.length) remoteListeners.forEach(fn => { try { fn(new Set(placeholders)); } catch (e) {} });
    markAllDirty(1);
    await run();
    return 'ok';
  }

  if (SYNC_ENDPOINT) {
    document.addEventListener('visibilitychange', () => {
      // Al salir se sube lo pendiente; al volver se trae lo de fuera.
      if (document.visibilityState === 'hidden') { if (Object.keys(dirty).length) run(); }
      else run();
    });
    window.addEventListener('online', () => run());
    setInterval(() => { if (document.visibilityState === 'visible') run(); }, 45000);
  }

  return {
    get, set, remove, setQuiet, removeQuiet, keys,
    sync: run,
    link,
    token,
    status: () => status,
    lastSync: () => Number(get(LAST_KEY)) || 0,
    configured: () => !!SYNC_ENDPOINT,
    onStatus: (fn) => statusListeners.push(fn),
    onRemoteChange: (fn) => remoteListeners.push(fn)
  };
})();
