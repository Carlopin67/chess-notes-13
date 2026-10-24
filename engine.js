// ============================================================
// MOTOR DE ANÁLISIS — Stockfish 18 compilado a WebAssembly
// (https://github.com/official-stockfish/Stockfish, versión web de
// https://github.com/nmrugg/stockfish.js, licencia GPLv3: ver
// engine/COPYING.txt).
//
// Corre en un hilo aparte (Web Worker): la app no se frena mientras
// piensa. Solo se carga la primera vez que hace falta, y lo ya analizado
// se recuerda: volver a una jugada vista es instantáneo.
// ============================================================

const Engine = (() => {
  const SRC = 'engine/stockfish-18-lite-single.js';
  const DEPTH = 18;          // suficiente para una barra fiable
  const MOVETIME = 1500;     // y nunca más de 1,5 s por posición
  const CACHE_MAX = 3000;

  let worker = null;
  let ready = false;
  let failed = false;
  let current = null;        // { fen, onUpdate } que se está analizando
  let queued = null;         // la siguiente, si llega otra antes de acabar
  let stopping = false;
  const cache = new Map();   // fen -> { cp, mate, winner, depth }
  const failListeners = [];

  function send(cmd) { if (worker) worker.postMessage(cmd); }

  function fail() {
    failed = true;
    ready = false;
    if (worker) { try { worker.terminate(); } catch (e) {} }
    worker = null;
    current = queued = null;
    failListeners.forEach(fn => { try { fn(); } catch (e) {} });
  }

  function boot() {
    if (worker || failed) return;
    if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') { fail(); return; }
    try {
      worker = new Worker(SRC);
    } catch (e) {
      fail();
      return;
    }
    worker.onmessage = (e) => handle(String(e.data));
    worker.onerror = fail;
    send('uci');
    send('setoption name Hash value 16');
    send('isready');
  }

  // La puntuación llega desde el punto de vista del bando que mueve; se
  // pasa siempre al de las blancas.
  function parseScore(line, whiteToMove) {
    const m = / score (cp|mate) (-?\d+)/.exec(line);
    if (!m) return null;
    const value = parseInt(m[2], 10);
    const depth = parseInt((/ depth (\d+)/.exec(line) || [])[1] || '0', 10);
    if (m[1] === 'cp') return { cp: whiteToMove ? value : -value, mate: null, winner: null, depth };
    // mate 0: el bando que mueve ya está mateado.
    const stmWins = value > 0;
    const winner = stmWins === whiteToMove ? 'w' : 'b';
    return { cp: null, mate: Math.abs(value), winner, depth };
  }

  function remember(fen, result) {
    const prev = cache.get(fen);
    if (prev && prev.depth > result.depth) return prev;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(fen, result);
    return result;
  }

  function handle(line) {
    if (line === 'readyok') { ready = true; pump(); return; }
    if (line.startsWith('info') && current && line.includes(' score ') && !line.includes(' multipv 2')) {
      if (line.includes('bound')) return;  // valores provisionales de la búsqueda
      const whiteToMove = current.fen.split(' ')[1] === 'w';
      const result = parseScore(line, whiteToMove);
      if (result) current.onUpdate(remember(current.fen, result));
      return;
    }
    if (line.startsWith('bestmove')) {
      current = null;
      stopping = false;
      pump();
    }
  }

  function pump() {
    if (!ready || current || !queued) return;
    current = queued;
    queued = null;
    send('position fen ' + current.fen);
    send(`go depth ${DEPTH} movetime ${MOVETIME}`);
  }

  // Analiza una posición. onUpdate recibe el resultado cada vez que mejora.
  function analyze(fen, onUpdate) {
    const known = cache.get(fen);
    if (known) onUpdate(known);
    if (known && (known.depth >= DEPTH || known.mate !== null)) return;
    boot();
    if (failed) return;
    queued = { fen, onUpdate };
    if (current && !stopping) { stopping = true; send('stop'); }
    pump();
  }

  // Deja de pensar (al salir de la partida o de la app): ahorra batería.
  function stop() {
    queued = null;
    if (current && !stopping) { stopping = true; send('stop'); }
  }

  return {
    analyze,
    stop,
    cached: (fen) => cache.get(fen) || null,
    available: () => !failed,
    onFail: (fn) => failListeners.push(fn)
  };
})();
