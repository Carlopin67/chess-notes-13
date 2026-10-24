// ============================================================
// MOTOR DE AJEDREZ (parser SAN + estado del tablero)
// ============================================================

function createInitialBoard() {
  const empty = () => new Array(8).fill(null);
  const board = [empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty()];
  const backRank = ['R','N','B','Q','K','B','N','R'];
  for (let f = 0; f < 8; f++) {
    board[0][f] = { type: backRank[f], color: 'b' };
    board[1][f] = { type: 'P', color: 'b' };
    board[6][f] = { type: 'P', color: 'w' };
    board[7][f] = { type: backRank[f], color: 'w' };
  }
  return board;
}

function newGameState() {
  return {
    board: createInitialBoard(),
    turn: 'w',
    enPassantTarget: null,
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    moveHistory: [],
    positions: [],
    fens: [],                // cada posición en FEN, para el motor
    halfmove: 0,             // jugadas desde la última captura o peón
    lastMoveSquares: [null], // {from, to} por posición, para resaltar
    result: null
  };
}

function squareToCoords(square) {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = 8 - parseInt(square[1], 10);
  return { file, rank };
}
function coordsToSquare(file, rank) {
  return String.fromCharCode('a'.charCodeAt(0) + file) + (8 - rank);
}
function inBounds(file, rank) { return file >= 0 && file < 8 && rank >= 0 && rank < 8; }
function pieceAt(board, file, rank) { return inBounds(file, rank) ? board[rank][file] : null; }

function isPathClear(board, fromFile, fromRank, toFile, toRank) {
  const dFile = Math.sign(toFile - fromFile);
  const dRank = Math.sign(toRank - fromRank);
  let f = fromFile + dFile, r = fromRank + dRank;
  while (f !== toFile || r !== toRank) {
    if (pieceAt(board, f, r)) return false;
    f += dFile; r += dRank;
  }
  return true;
}

function canPieceReach(state, piece, fromFile, fromRank, toFile, toRank, isCapture) {
  const board = state.board;
  const dFile = toFile - fromFile;
  const dRank = toRank - fromRank;
  switch (piece.type) {
    case 'N':
      return (Math.abs(dFile) === 1 && Math.abs(dRank) === 2) ||
             (Math.abs(dFile) === 2 && Math.abs(dRank) === 1);
    case 'B':
      if (Math.abs(dFile) !== Math.abs(dRank)) return false;
      return isPathClear(board, fromFile, fromRank, toFile, toRank);
    case 'R':
      if (dFile !== 0 && dRank !== 0) return false;
      return isPathClear(board, fromFile, fromRank, toFile, toRank);
    case 'Q':
      if (dFile !== 0 && dRank !== 0 && Math.abs(dFile) !== Math.abs(dRank)) return false;
      return isPathClear(board, fromFile, fromRank, toFile, toRank);
    case 'K':
      return Math.abs(dFile) <= 1 && Math.abs(dRank) <= 1 && (dFile !== 0 || dRank !== 0);
    case 'P': {
      const direction = piece.color === 'w' ? -1 : 1;
      const startRank = piece.color === 'w' ? 6 : 1;
      if (isCapture) {
        return dRank === direction && Math.abs(dFile) === 1;
      } else {
        if (dFile !== 0) return false;
        if (dRank === direction && !pieceAt(board, toFile, toRank)) return true;
        if (dRank === 2 * direction && fromRank === startRank &&
            !pieceAt(board, toFile, fromRank + direction) &&
            !pieceAt(board, toFile, toRank)) return true;
        return false;
      }
    }
  }
  return false;
}

function findSourceSquares(state, pieceType, color, toFile, toRank, isCapture, hintFile, hintRank) {
  const board = state.board;
  const candidates = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = pieceAt(board, f, r);
      if (!p || p.color !== color || p.type !== pieceType) continue;
      if (hintFile !== null && f !== hintFile) continue;
      if (hintRank !== null && r !== hintRank) continue;
      if (canPieceReach(state, p, f, r, toFile, toRank, isCapture)) {
        candidates.push({ file: f, rank: r });
      }
    }
  }
  return candidates;
}

const SAN_REGEX = /^([NBRQK]?)([a-h]?)([1-8]?)(x?)([a-h][1-8])(=([NBRQ]))?[+#]*$/;

function parseSANToken(token) {
  if (token === 'O-O' || token === '0-0') return { castle: 'K' };
  if (token === 'O-O-O' || token === '0-0-0') return { castle: 'Q' };
  const match = SAN_REGEX.exec(token);
  if (!match) return null;
  const [, pieceLetter, hintFileChar, hintRankChar, captureFlag, destSquare, , promotion] = match;
  return {
    pieceType: pieceLetter || 'P',
    hintFile: hintFileChar ? hintFileChar.charCodeAt(0) - 'a'.charCodeAt(0) : null,
    hintRank: hintRankChar ? 8 - parseInt(hintRankChar, 10) : null,
    isCapture: captureFlag === 'x',
    dest: squareToCoords(destSquare),
    promotion: promotion || null
  };
}

// Foto de la posición. Las piezas nunca se modifican (al moverse cambian
// de casilla y al coronar se crea otra), así que basta con copiar las
// filas: mucho más rápido que serializar el tablero entero en cada jugada.
function snapshotBoard(board) {
  return board.map(row => row.slice());
}

function applyMove(state, token) {
  const board = state.board;
  const color = state.turn;
  const parsed = parseSANToken(token);
  if (!parsed) { console.warn('No se pudo parsear:', token); return false; }

  let movedFrom = null, movedTo = null;
  let resetsClock = false;

  if (parsed.castle) {
    const rank = color === 'w' ? 7 : 0;
    if (parsed.castle === 'K') {
      board[rank][6] = board[rank][4]; board[rank][4] = null;
      board[rank][5] = board[rank][7]; board[rank][7] = null;
      movedFrom = coordsToSquare(4, rank); movedTo = coordsToSquare(6, rank);
    } else {
      board[rank][2] = board[rank][4]; board[rank][4] = null;
      board[rank][3] = board[rank][0]; board[rank][0] = null;
      movedFrom = coordsToSquare(4, rank); movedTo = coordsToSquare(2, rank);
    }
    state.castling[color + 'K'] = false;
    state.castling[color + 'Q'] = false;
  } else {
    const { file: toFile, rank: toRank } = parsed.dest;
    let candidates = findSourceSquares(
      state, parsed.pieceType, color, toFile, toRank,
      parsed.isCapture, parsed.hintFile, parsed.hintRank
    );
    if (candidates.length === 0) {
      if (!parsingQuiet) console.warn('Sin origen válido para:', token);
      return false;
    }
    // Si dos piezas iguales llegan a la misma casilla pero una está
    // clavada, el PGN no las distingue (no hace falta): la que se mueve
    // es la que puede moverse legalmente.
    if (candidates.length > 1) {
      const enPassant = parsed.pieceType === 'P' && parsed.isCapture && !pieceAt(board, toFile, toRank);
      const legal = candidates.filter(c =>
        !wouldLeaveKingInCheck(board, c.file, c.rank, toFile, toRank, color, enPassant));
      if (legal.length) candidates = legal;
    }
    const { file: fromFile, rank: fromRank } = candidates[0];
    const movingPiece = board[fromRank][fromFile];
    resetsClock = movingPiece.type === 'P' || !!board[toRank][toFile];

    if (parsed.pieceType === 'P' && parsed.isCapture && !pieceAt(board, toFile, toRank)) {
      const capturedRank = toRank + (color === 'w' ? 1 : -1);
      board[capturedRank][toFile] = null;
    }

    board[toRank][toFile] = movingPiece;
    board[fromRank][fromFile] = null;

    if (parsed.promotion) board[toRank][toFile] = { type: parsed.promotion, color };

    if (movingPiece.type === 'K') {
      state.castling[color + 'K'] = false;
      state.castling[color + 'Q'] = false;
    }
    if (movingPiece.type === 'R') {
      if (fromFile === 0) state.castling[color + 'Q'] = false;
      if (fromFile === 7) state.castling[color + 'K'] = false;
    }

    movedFrom = coordsToSquare(fromFile, fromRank);
    movedTo = coordsToSquare(toFile, toRank);

    if (parsed.pieceType === 'P' && Math.abs(toRank - fromRank) === 2) {
      state.enPassantTarget = { file: toFile, rank: (toRank + fromRank) / 2 };
    } else {
      state.enPassantTarget = null;
    }
  }

  if (parsed.castle) state.enPassantTarget = null;
  state.halfmove = resetsClock ? 0 : state.halfmove + 1;
  state.turn = color === 'w' ? 'b' : 'w';
  state.moveHistory.push(token);
  state.positions.push(snapshotBoard(board));
  state.fens.push(positionFen(state));
  state.lastMoveSquares.push({ from: movedFrom, to: movedTo });
  return true;
}

// ---------- La posición en FEN, el idioma que entiende el motor ----------
const FEN_LETTER = { K: 'k', Q: 'q', R: 'r', B: 'b', N: 'n', P: 'p' };

function placementFen(board) {
  return board.map(row => {
    let out = '', empty = 0;
    row.forEach(p => {
      if (!p) { empty++; return; }
      if (empty) { out += empty; empty = 0; }
      out += p.color === 'w' ? p.type : FEN_LETTER[p.type];
    });
    return out + (empty || '');
  }).join('/');
}

// Solo los enroques que de verdad son posibles: si la torre ya no está
// en su esquina (la capturaron), no se anuncia aunque nunca se moviera.
function castlingFen(board, rights) {
  const has = (r, f, type, color) => {
    const p = board[r][f];
    return !!p && p.type === type && p.color === color;
  };
  let out = '';
  if (has(7, 4, 'K', 'w')) {
    if (rights.wK && has(7, 7, 'R', 'w')) out += 'K';
    if (rights.wQ && has(7, 0, 'R', 'w')) out += 'Q';
  }
  if (has(0, 4, 'K', 'b')) {
    if (rights.bK && has(0, 7, 'R', 'b')) out += 'k';
    if (rights.bQ && has(0, 0, 'R', 'b')) out += 'q';
  }
  return out || '-';
}

// La casilla de captura al paso solo cuenta si hay un peón que pueda usarla.
function enPassantFen(state) {
  const ep = state.enPassantTarget;
  if (!ep) return '-';
  const pawnRank = ep.rank + (state.turn === 'w' ? 1 : -1);
  const canTake = [ep.file - 1, ep.file + 1].some(f => {
    const p = pieceAt(state.board, f, pawnRank);
    return p && p.type === 'P' && p.color === state.turn;
  });
  return canTake ? coordsToSquare(ep.file, ep.rank) : '-';
}

// null si la posición no tiene sentido (un PGN mal leído): al motor solo
// se le dan posiciones legales.
function positionFen(state) {
  const board = state.board;
  let kings = 0;
  board.forEach(row => row.forEach(p => { if (p && p.type === 'K') kings++; }));
  if (kings !== 2 || !findKingSquare(board, 'w') || !findKingSquare(board, 'b')) return null;
  if (isKingInCheck(board, state.turn === 'w' ? 'b' : 'w')) return null;
  const fullmove = Math.floor(state.moveHistory.length / 2) + 1;
  return [placementFen(board), state.turn, castlingFen(board, state.castling),
          enPassantFen(state), state.halfmove, fullmove].join(' ');
}

// ============================================================
// LECTURA DE PGN REAL
// Los archivos que se descargan de lichess o chess.com traen
// cabeceras, comentarios, variantes y anotaciones. Se limpian antes
// de leer las jugadas, y de paso las cabeceras rellenan los datos
// de la partida sin tener que escribirlos a mano.
// ============================================================

function parsePgnHeaders(text) {
  const headers = {};
  const re = /\[\s*(\w+)\s*"([^"]*)"\s*\]/g;
  let m;
  while ((m = re.exec(text || ''))) headers[m[1]] = m[2].trim();
  return headers;
}

function stripPgnDecorations(text) {
  let t = text || '';
  t = t.replace(/\[[^\]]*\]/g, ' ');   // cabeceras
  t = t.replace(/\{[^}]*\}/g, ' ');     // comentarios entre llaves
  t = t.replace(/;[^\n]*/g, ' ');       // comentarios de línea
  t = t.replace(/\$\d+/g, ' ');         // anotaciones tipo $1
  let prev;                             // variantes, que pueden anidarse
  do { prev = t; t = t.replace(/\([^()]*\)/g, ' '); } while (t !== prev);
  return t;
}

function yearFromPgnDate(value) {
  const m = /(\d{4})/.exec(value || '');
  return m ? m[1] : '';
}

// Datos que se pueden deducir de un PGN pegado tal cual.
function metadataFromPgn(text) {
  const h = parsePgnHeaders(text);
  return {
    white: h.White && h.White !== '?' ? h.White : '',
    black: h.Black && h.Black !== '?' ? h.Black : '',
    event: h.Event && h.Event !== '?' ? h.Event : '',
    year: yearFromPgnDate(h.Date || h.UTCDate || ''),
    result: h.Result || ''
  };
}

// ============================================================
// NOTACIÓN ESPAÑOLA
// En español las piezas son Rey, Dama, Torre, Alfil y Caballo.
// El problema es que la R española es el Rey y la R inglesa es la
// Torre: traducir a ciegas estropearía las partidas en inglés. Por eso
// se deduce el idioma por las letras que solo existen en uno u otro,
// y si aun así alguna jugada no cuadra, se prueba con el otro y se
// queda la lectura que funciona.
// ============================================================

let parsingQuiet = false;

const PIEZAS_ES_A_EN = { R: 'K', D: 'Q', T: 'R', A: 'B', C: 'N' };
const PIEZAS_EN_A_ES = { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' };
const SOLO_ES = 'TACD';   // letras que en inglés no son piezas
const SOLO_EN = 'KNB';    // letras que en español no son piezas

function translateSpanishToken(token) {
  let t = token;
  if (PIEZAS_ES_A_EN[t[0]]) t = PIEZAS_ES_A_EN[t[0]] + t.slice(1);
  return t.replace(/=([RDTAC])/, (_, p) => '=' + PIEZAS_ES_A_EN[p]);
}

function detectNotationLanguage(tokens) {
  let es = 0, en = 0;
  tokens.forEach(t => {
    const first = t[0];
    if (SOLO_ES.includes(first)) es++;
    if (SOLO_EN.includes(first)) en++;
    const promo = /=([A-Z])/.exec(t);
    if (promo) {
      if (SOLO_ES.includes(promo[1])) es++;
      if (SOLO_EN.includes(promo[1])) en++;
    }
  });
  return es > en ? 'es' : 'en';
}

// Reproduce la lista de jugadas y cuenta las que no ha sabido aplicar.
function buildGameFromTokens(tokens, result) {
  parsingQuiet = true;
  const state = newGameState();
  state.positions.push(snapshotBoard(state.board));
  state.fens.push(positionFen(state));
  let failures = 0;
  for (const token of tokens) {
    if (!applyMove(state, token)) failures++;
  }
  if (result) state.result = result;
  parsingQuiet = false;
  return { state, failures };
}

function loadGame(pgnText, forcedLang) {
  const headerResult = parsePgnHeaders(pgnText).Result || '';
  let text = stripPgnDecorations(pgnText);

  let result = '';
  const resultMatch = text.match(/(1-0|0-1|1\/2-1\/2|\*)\s*$/);
  if (resultMatch) {
    result = resultMatch[1];
    text = text.slice(0, resultMatch.index);
  } else if (headerResult && headerResult !== '*') {
    result = headerResult;
  }

  const rawTokens = text
    .replace(/\d+\s*\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);

  const asSpanish = () => rawTokens.map(translateSpanishToken);
  const lang = (forcedLang === 'es' || forcedLang === 'en')
    ? forcedLang
    : detectNotationLanguage(rawTokens);

  let best = buildGameFromTokens(lang === 'es' ? asSpanish() : rawTokens, result);
  // Si se eligió idioma a mano se respeta. Sin elección, y solo si algo
  // no cuadra, se prueba el otro: cubre las partidas ya guardadas.
  if (!forcedLang && best.failures > 0) {
    const alternative = buildGameFromTokens(lang === 'es' ? rawTokens : asSpanish(), result);
    if (alternative.failures < best.failures) best = alternative;
  }
  return best.state;
}

// Reescribe la partida en notación inglesa numerada, que es el estándar
// PGN. Al guardar siempre se normaliza: así dentro de la app solo existe
// un idioma y todo lo demás se simplifica.
function toStandardPgn(state) {
  const out = [];
  state.moveHistory.forEach((san, i) => {
    if (i % 2 === 0) out.push((i / 2 + 1) + '.');
    out.push(san);
  });
  if (state.result) out.push(state.result);
  return out.join(' ');
}

function normalizePgnToStandard(text, lang) {
  const state = loadGame(text, lang);
  if (!state.moveHistory.length) return text;  // ilegible: se guarda tal cual
  return toStandardPgn(state);
}

// ============================================================
// LEGALIDAD DE MOVIMIENTOS — necesario solo para la edición manual
// de ramificaciones (el resto de la app se limita a reproducir SAN
// ya escrito, donde esto no hace falta).
// ============================================================

function findKingSquare(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p && p.type === 'K' && p.color === color) return { file: f, rank: r };
    }
  }
  return null;
}

function isSquareAttacked(board, file, rank, byColor) {
  const state = { board };
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p || p.color !== byColor) continue;
      if (canPieceReach(state, p, f, r, file, rank, true)) return true;
    }
  }
  return false;
}

function isKingInCheck(board, color) {
  const king = findKingSquare(board, color);
  if (!king) return false;
  return isSquareAttacked(board, king.file, king.rank, color === 'w' ? 'b' : 'w');
}

function wouldLeaveKingInCheck(board, fromFile, fromRank, toFile, toRank, color, isEnPassant) {
  const copy = board.map(row => row.slice());
  if (isEnPassant) {
    const capturedRank = toRank + (color === 'w' ? 1 : -1);
    copy[capturedRank][toFile] = null;
  }
  copy[toRank][toFile] = copy[fromRank][fromFile];
  copy[fromRank][fromFile] = null;
  return isKingInCheck(copy, color);
}

// Todas las casillas a las que la pieza en (fromFile,fromRank) puede moverse
// legalmente ahora mismo (respetando jaques, enroque y captura al paso).
function getLegalDestinations(state, fromFile, fromRank) {
  const board = state.board;
  const piece = board[fromRank][fromFile];
  if (!piece) return [];
  const color = piece.color;
  const enemyColor = color === 'w' ? 'b' : 'w';
  const results = [];

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      if (f === fromFile && r === fromRank) continue;
      const target = board[r][f];
      if (target && target.color === color) continue;

      const isCapture = !!target;
      let isEnPassant = false;
      let reachable;

      if (piece.type === 'P' && !target && Math.abs(f - fromFile) === 1 &&
          state.enPassantTarget && state.enPassantTarget.file === f && state.enPassantTarget.rank === r) {
        reachable = canPieceReach(state, piece, fromFile, fromRank, f, r, true);
        isEnPassant = reachable;
      } else {
        reachable = canPieceReach(state, piece, fromFile, fromRank, f, r, isCapture);
      }
      if (!reachable) continue;
      if (wouldLeaveKingInCheck(board, fromFile, fromRank, f, r, color, isEnPassant)) continue;

      results.push({ file: f, rank: r, isCapture: isCapture || isEnPassant, isEnPassant });
    }
  }

  if (piece.type === 'K' && !isKingInCheck(board, color)) {
    const rank = fromRank;
    const rights = state.castling;
    if (rights[color + 'K'] && !pieceAt(board, 5, rank) && !pieceAt(board, 6, rank)) {
      const rook = pieceAt(board, 7, rank);
      if (rook && rook.type === 'R' && rook.color === color &&
          !isSquareAttacked(board, 5, rank, enemyColor) && !isSquareAttacked(board, 6, rank, enemyColor)) {
        results.push({ file: 6, rank, isCastle: 'K' });
      }
    }
    if (rights[color + 'Q'] && !pieceAt(board, 1, rank) && !pieceAt(board, 2, rank) && !pieceAt(board, 3, rank)) {
      const rook = pieceAt(board, 0, rank);
      if (rook && rook.type === 'R' && rook.color === color &&
          !isSquareAttacked(board, 3, rank, enemyColor) && !isSquareAttacked(board, 2, rank, enemyColor)) {
        results.push({ file: 2, rank, isCastle: 'Q' });
      }
    }
  }

  return results;
}

// Construye la notación SAN de un movimiento hecho a mano en el tablero.
function buildSANForUserMove(state, fromFile, fromRank, toFile, toRank, dest, promotionType) {
  const board = state.board;
  const piece = board[fromRank][fromFile];
  const color = piece.color;

  if (dest.isCastle === 'K') return 'O-O';
  if (dest.isCastle === 'Q') return 'O-O-O';

  let disambiguation = '';
  if (piece.type !== 'P' && piece.type !== 'K') {
    const others = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (f === fromFile && r === fromRank) continue;
        const p = board[r][f];
        if (p && p.type === piece.type && p.color === color &&
            canPieceReach(state, p, f, r, toFile, toRank, dest.isCapture) &&
            !wouldLeaveKingInCheck(board, f, r, toFile, toRank, color, false)) {
          others.push({ file: f, rank: r });
        }
      }
    }
    if (others.length > 0) {
      const sameFile = others.some(o => o.file === fromFile);
      const sameRank = others.some(o => o.rank === fromRank);
      if (!sameFile) disambiguation = String.fromCharCode('a'.charCodeAt(0) + fromFile);
      else if (!sameRank) disambiguation = String(8 - fromRank);
      else disambiguation = coordsToSquare(fromFile, fromRank);
    }
  }

  const pieceLetter = piece.type === 'P' ? '' : piece.type;
  let san = pieceLetter + disambiguation;
  if (piece.type === 'P' && dest.isCapture) san += String.fromCharCode('a'.charCodeAt(0) + fromFile);
  if (dest.isCapture) san += 'x';
  san += coordsToSquare(toFile, toRank);
  if (promotionType) san += '=' + promotionType;
  return san;
}


// ============================================================
// BIBLIOTECA DE PARTIDAS — la pantalla de inicio
// Cada partida se guarda en su propia clave: así dos dispositivos
// pueden añadir o editar partidas a la vez sin pisarse en la nube.
// Se leen una sola vez y se quedan en memoria hasta que algo cambia.
// ============================================================

const LEGACY_LIBRARY_KEY = 'chess-library';  // formato antiguo: todas en una lista
const GAME_PREFIX = 'chess-game:';
const SEEDED_KEY = 'chess-seeded';

const SAMPLE_GAME_PGN = `1. d4 d5 2. e3 c5 3. c3 e6 4. Bd3 Nc6 5. f4 Nf6 6. Nd2 Qc7 7. Ngf3
cxd4 8. cxd4 Nb4 9. Bb1 Bd7 10. a3 Rc8 11. O-O Bb5 12. Re1 Nc2
13. Bxc2 Qxc2 14. Qxc2 Rxc2 15. h3 Bd6 16. Nb1 Ne4 17. Nfd2
Bd3 18. Nxe4 Bxe4 19. Nd2 Kd7 20. Nxe4 dxe4 21. Rb1 Rhc8 22.
b4 R8c3 23. Kf1 Kc6 24. Bb2 Rb3 25. Re2 Rxe2 26. Kxe2 Kb5 27.
Kd2 Ka4 28. Ke2 a5 29. Kf2 axb4 30. axb4 Kxb4 31. Ke2 Kb5 32.
Kd2 Ba3 33. Kc2 Rxb2+ 34. Rxb2+ Bxb2 35. Kxb2 Kc4 36. g4 Kd3
37. g5 Kxe3 0-1`;

let libraryCache = null;

function parseJSON(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

function loadLibrary() {
  if (!libraryCache) {
    libraryCache = Store.keys(GAME_PREFIX)
      .map(k => parseJSON(Store.get(k)))
      .filter(g => g && g.id);
  }
  return libraryCache;
}

function findGame(id) {
  return loadLibrary().find(g => g.id === id) || null;
}

function saveGame(record) {
  Store.set(GAME_PREFIX + record.id, JSON.stringify(record));
  libraryCache = null;
}

// Las bibliotecas guardadas con la versión anterior (una sola lista) se
// pasan al formato nuevo la primera vez que se abre la app actualizada.
function migrateLegacyLibrary(rawList) {
  const list = parseJSON(rawList);
  if (!Array.isArray(list)) return;
  list.forEach(g => {
    if (!g || !g.id || Store.get(GAME_PREFIX + g.id) !== null) return;
    Store.set(GAME_PREFIX + g.id, JSON.stringify(g));
  });
  libraryCache = null;
}

function ensureLibrarySeeded() {
  const legacy = Store.get(LEGACY_LIBRARY_KEY);
  if (legacy !== null) {
    migrateLegacyLibrary(legacy);
    Store.removeQuiet(LEGACY_LIBRARY_KEY);
    Store.setQuiet(SEEDED_KEY, '1');
  }
  if (Store.get(SEEDED_KEY)) return;
  // La partida de ejemplo no cuenta como un cambio: si ya se borró en
  // otro dispositivo, no debe resucitar al vincular este.
  if (!loadLibrary().length) {
    Store.setQuiet(GAME_PREFIX + 'sample-game-v1', JSON.stringify({
      id: 'sample-game-v1',
      title: 'Partida de ejemplo',
      pgn: SAMPLE_GAME_PGN,
      createdAt: Date.now()
    }));
    libraryCache = null;
  }
  Store.setQuiet(SEEDED_KEY, '1');
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(t => String(t).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
}

// Acepta un objeto con todos los datos, o la forma antigua (título, pgn, carpeta).
function addGameToLibrary(dataOrTitle, pgn, folderId) {
  const d = typeof dataOrTitle === 'string'
    ? { title: dataOrTitle, pgn: pgn, folderId: folderId }
    : (dataOrTitle || {});
  const record = {
    id: simpleHash((d.title || '') + '|' + (d.pgn || '') + '|' + Date.now()),
    title: (d.title || '').trim(),
    white: (d.white || '').trim(),
    black: (d.black || '').trim(),
    event: (d.event || '').trim(),
    year: (d.year || '').trim(),
    tags: normalizeTags(d.tags),
    pgn: (d.pgn || '').trim(),
    folderId: d.folderId || null,
    createdAt: Date.now()
  };
  saveGame(record);
  return record;
}

function updateGameInLibrary(id, patch) {
  const target = findGame(id);
  if (!target) return null;
  const updated = Object.assign({}, target, patch, { tags: normalizeTags(patch.tags) });
  saveGame(updated);
  return updated;
}

// El título es opcional: si no lo hay, la partida se llama como se
// llaman las partidas de ajedrez, por sus dos jugadores.
function gameDisplayTitle(record) {
  const t = (record.title || '').trim();
  if (t) return t;
  const w = (record.white || '').trim();
  const b = (record.black || '').trim();
  if (w || b) return `${w || '?'} – ${b || '?'}`;
  return 'Partida sin título';
}

function gameMetaParts(record, folderNameOf, showFolder) {
  const parts = [];
  if (record.year) parts.push(record.year);
  if (record.event) parts.push(record.event);
  // Si el título es propio, los jugadores aún aportan información.
  if ((record.title || '').trim() && (record.white || record.black)) {
    parts.push(`${record.white || '?'} – ${record.black || '?'}`);
  }
  if (showFolder && record.folderId) {
    const n = folderNameOf(record.folderId);
    if (n) parts.push(n);
  }
  if (!parts.length) parts.push(formatDate(record.createdAt));
  return parts;
}

function allTags() {
  const seen = new Map();
  loadLibrary().forEach(g => normalizeTags(g.tags).forEach(t => {
    const k = t.toLowerCase();
    if (!seen.has(k)) seen.set(k, t);
  }));
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

// Texto sobre el que busca el buscador de la pantalla de inicio.
// En español buscar "peon" tiene que encontrar "peón", y "Ruiz" a "ruiz".
function foldText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Se calcula una vez por partida y se recuerda: buscar mientras se
// escribe no vuelve a normalizar toda la biblioteca en cada letra.
const searchBlobs = new WeakMap();
function gameSearchBlob(record) {
  let blob = searchBlobs.get(record);
  if (blob === undefined) {
    blob = foldText([record.title, record.white, record.black, record.event,
                     record.year, normalizeTags(record.tags).join(' ')].join(' '));
    searchBlobs.set(record, blob);
  }
  return blob;
}

function deleteGameFromLibrary(id) {
  // Con la partida se van sus apuntes, su marcador de última jugada y
  // todas sus ramificaciones. Si no, quedan huérfanos ocupando sitio.
  loadBranches(id).forEach(b => deleteBranchAndData(id, b.id));
  Store.remove(branchesKey(id));
  Store.remove(`chess-lastply:${id}`);
  Store.keys(`chess-notes:${id}:`).forEach(k => Store.remove(k));
  Store.remove(GAME_PREFIX + id);
  libraryCache = null;
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function resultBadge(pgn) {
  const m = pgn.match(/(1-0|0-1|1\/2-1\/2|\*)\s*$/);
  if (!m) return null;
  return { '1-0': { label: '1–0', cls: 'result-white' },
           '0-1': { label: '0–1', cls: 'result-black' },
           '1/2-1/2': { label: '½–½', cls: 'result-draw' },
           '*': null }[m[1]] || null;
}

// ---------- Carpetas ----------
const FOLDERS_KEY = 'chess-folders';

function loadFolders() {
  const list = parseJSON(Store.get(FOLDERS_KEY));
  return Array.isArray(list) ? list : [];
}

function saveFolders(folders) {
  Store.set(FOLDERS_KEY, JSON.stringify(folders));
}

function addFolder(name) {
  const folders = loadFolders();
  const folder = { id: simpleHash('folder-' + name + '-' + Date.now()), name: name.trim() };
  folders.push(folder);
  saveFolders(folders);
  return folder;
}

function renameFolder(id, name) {
  const folders = loadFolders();
  const target = folders.find(f => f.id === id);
  if (!target || !name.trim()) return null;
  target.name = name.trim();
  saveFolders(folders);
  return target;
}

function deleteFolder(id) {
  const folders = loadFolders().filter(f => f.id !== id);
  saveFolders(folders);
  // las partidas de esa carpeta pasan a "sin carpeta", no se borran
  loadLibrary()
    .filter(g => g.folderId === id)
    .forEach(g => saveGame({ ...g, folderId: null }));
}

// ============================================================
// RAMIFICACIONES — versiones alternativas de una partida, creadas
// moviendo piezas a mano a partir de una jugada concreta.
// ============================================================

function branchesKey(gameId) {
  return `chess-branches:${gameId}`;
}

function loadBranches(gameId) {
  const list = parseJSON(Store.get(branchesKey(gameId)));
  return Array.isArray(list) ? list : [];
}

function saveBranches(gameId, branches) {
  Store.set(branchesKey(gameId), JSON.stringify(branches));
}

// El nombre por defecto se calcula sobre los que ya existen, no sobre
// cuántos hay: si borras una, la siguiente no repite nombre.
function uniqueBranchName(branches, proposed) {
  const taken = new Set(branches.map(b => (b.name || '').trim().toLowerCase()));
  const base = (proposed || '').trim() || 'Variante';
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

function defaultBranchName(gameId) {
  const taken = new Set(loadBranches(gameId).map(b => (b.name || '').trim().toLowerCase()));
  let n = 1;
  while (taken.has(`variante ${n}`)) n++;
  return `Variante ${n}`;
}

function createBranch(gameId, fromPly, name) {
  const branches = loadBranches(gameId);
  const record = {
    id: simpleHash('branch-' + Date.now() + '-' + Math.random()),
    name: uniqueBranchName(branches, name || defaultBranchName(gameId)),
    fromPly,
    moves: [],
    createdAt: Date.now()
  };
  branches.push(record);
  saveBranches(gameId, branches);
  return record;
}

function renameBranch(gameId, branchId, name) {
  const branches = loadBranches(gameId);
  const target = branches.find(b => b.id === branchId);
  if (!target) return null;
  const others = branches.filter(b => b.id !== branchId);
  target.name = uniqueBranchName(others, name);
  saveBranches(gameId, branches);
  return target;
}

function persistBranchMoves(gameId, branch) {
  const branches = loadBranches(gameId);
  const target = branches.find(b => b.id === branch.id);
  if (target) { target.moves = branch.moves; saveBranches(gameId, branches); }
}

function deleteBranchAndData(gameId, branchId) {
  saveBranches(gameId, loadBranches(gameId).filter(b => b.id !== branchId));
  Store.keys(`chess-notes:branch:${branchId}:`).forEach(k => Store.remove(k));
  Store.remove(`chess-lastply:branch:${branchId}`);
}

// ============================================================
// UI / REPRODUCTOR
// ============================================================

let gameState = null;
let currentPly = 0;
let currentLibraryRecord = null;

const boardEl = document.getElementById('board');

// ---------- Coordenadas del tablero (a-h arriba y abajo, 1-8 a los lados) ----------
// Al girar el tablero las coordenadas también dan la vuelta.
let boardFlipped = false;

function renderBoardCoordinates() {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
  const f = boardFlipped ? files.slice().reverse() : files;
  const r = boardFlipped ? ranks.slice().reverse() : ranks;

  function fillRow(id, labels) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    labels.forEach(label => {
      const span = document.createElement('span');
      span.textContent = label;
      el.appendChild(span);
    });
  }

  fillRow('coordTop', f);
  fillRow('coordBottom', f);
  fillRow('coordLeft', r);
  fillRow('coordRight', r);
}
renderBoardCoordinates();

// Traduce una casilla real a su hueco en pantalla, que cambia al girar.
function displayIndex(file, rank) {
  return boardFlipped ? (7 - rank) * 8 + (7 - file) : rank * 8 + file;
}
const statusEl = document.getElementById('status');
const startBtnEl = document.getElementById('startBtn');
const prevBtnEl = document.getElementById('prevBtn');
const nextBtnEl = document.getElementById('nextBtn');
const moveStripEl = document.getElementById('moveStrip');
const pgnInput = document.getElementById('pgnInput');
const titleInput = document.getElementById('titleInput');
const libraryListEl = document.getElementById('libraryList');
const libraryEmptyEl = document.getElementById('libraryEmpty');
const gameTitleLabelEl = document.getElementById('gameTitleLabel');

// ---------- Edición interactiva de ramificaciones (mover piezas a mano) ----------
let mainGameState = null;
let viewingBranch = null;
let branchEditMode = false;
let selectedSquare = null;
let legalDestinations = [];
let pendingPromotion = null;

// Una pieza: lleva el glifo (para el diseño tipográfico) y su código, que
// el CSS usa para ponerle el dibujo del diseño elegido en Ajustes.
function createPieceEl(color, type) {
  const el = document.createElement('span');
  el.className = 'piece ' + (color === 'w' ? 'white-piece' : 'black-piece');
  el.dataset.p = color + type;
  el.textContent = getPieceGlyph(type);
  return el;
}

// Las 64 casillas se crean una sola vez. En cada jugada solo se toca lo
// que ha cambiado: las piezas que no se mueven no se vuelven a pintar,
// que es lo caro (cada pieza lleva su contorno dibujado con filtros).
const squareEls = [];
const squareClass = [];
const squareContent = [];

(function buildBoardSquares() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 64; i++) {
    const sq = document.createElement('div');
    squareEls.push(sq);
    squareClass.push('');
    squareContent.push(null);
    frag.appendChild(sq);
  }
  boardEl.appendChild(frag);
})();

function renderBoard(boardArray, highlight) {
  for (let dr = 0; dr < 8; dr++) {
    for (let df = 0; df < 8; df++) {
      // dr/df es el hueco en pantalla; r/f la casilla real del tablero.
      const i = dr * 8 + df;
      const r = boardFlipped ? 7 - dr : dr;
      const f = boardFlipped ? 7 - df : df;
      const square = coordsToSquare(f, r);
      let cls = (r + f) % 2 === 0 ? 'square light' : 'square dark';
      if (highlight) {
        if (highlight.from === square) cls += ' highlight-from';
        if (highlight.to === square) cls += ' highlight-to';
      }
      let dest = null;
      if (branchEditMode) {
        if (selectedSquare && selectedSquare.file === f && selectedSquare.rank === r) cls += ' selected';
        dest = legalDestinations.find(d => d.file === f && d.rank === r);
        if (dest) cls += dest.isCapture ? ' legal-move capture' : ' legal-move';
      }

      // Al girar el tablero el mismo hueco pasa a ser otra casilla real
      // aunque su color no cambie: por eso la firma lleva la casilla.
      const sq = squareEls[i];
      const sig = cls + '|' + square;
      if (squareClass[i] !== sig) {
        sq.className = cls;
        sq.dataset.file = f;
        sq.dataset.rank = r;
        squareClass[i] = sig;
      }

      const piece = boardArray[r][f];
      const content = (dest ? 'dot' : '') + (piece ? piece.color + piece.type : '');
      if (squareContent[i] === content) continue;
      squareContent[i] = content;
      sq.textContent = '';
      if (dest) {
        const marker = document.createElement('span');
        marker.className = 'legalDot';
        sq.appendChild(marker);
      }
      if (piece) sq.appendChild(createPieceEl(piece.color, piece.type));
    }
  }
}

function refreshBoardOnly() {
  renderBoard(gameState.positions[currentPly], gameState.lastMoveSquares[currentPly]);
}

boardEl.addEventListener('click', (e) => {
  // Sin rama activa no se mueve nada: el tablero de la partida principal
  // es solo de lectura.
  if (!branchEditMode || !viewingBranch || pendingPromotion) return;
  const sq = e.target.closest('.square');
  if (!sq) return;
  handleBoardSquareClick(parseInt(sq.dataset.file, 10), parseInt(sq.dataset.rank, 10));
});

function handleBoardSquareClick(file, rank) {
  const board = gameState.board;
  const piece = board[rank][file];

  if (selectedSquare) {
    const dest = legalDestinations.find(d => d.file === file && d.rank === rank);
    if (dest) {
      const fromFile = selectedSquare.file, fromRank = selectedSquare.rank;
      const movingPiece = board[fromRank][fromFile];
      const lastRank = movingPiece.color === 'w' ? 0 : 7;
      if (movingPiece.type === 'P' && rank === lastRank) {
        pendingPromotion = { fromFile, fromRank, toFile: file, toRank: rank, dest };
        selectedSquare = null;
        legalDestinations = [];
        refreshBoardOnly();
        openPromotionPicker(movingPiece.color);
        return;
      }
      commitUserMove(fromFile, fromRank, file, rank, dest, null);
      return;
    }
    if (piece && piece.color === gameState.turn) {
      selectedSquare = { file, rank };
      legalDestinations = getLegalDestinations(gameState, file, rank);
    } else {
      selectedSquare = null;
      legalDestinations = [];
    }
  } else if (piece && piece.color === gameState.turn) {
    selectedSquare = { file, rank };
    legalDestinations = getLegalDestinations(gameState, file, rank);
  }
  refreshBoardOnly();
}

function commitUserMove(fromFile, fromRank, toFile, toRank, dest, promotionType) {
  if (!viewingBranch) return;
  let san = buildSANForUserMove(gameState, fromFile, fromRank, toFile, toRank, dest, promotionType);
  viewingBranch.moves.push(san);
  gameState = buildBranchGameState(viewingBranch);
  if (isKingInCheck(gameState.board, gameState.turn)) {
    san += '+';
    viewingBranch.moves[viewingBranch.moves.length - 1] = san;
    gameState.moveHistory[gameState.moveHistory.length - 1] = san;
  }
  persistBranchMoves(currentLibraryRecord.id, viewingBranch);
  selectedSquare = null;
  legalDestinations = [];
  buildMoveStrip();
  goToPly(gameState.positions.length - 1);
}

// ---------- Selector de coronación de peón ----------
const promotionOverlayEl = document.getElementById('promotionOverlay');

function openPromotionPicker(color) {
  document.querySelectorAll('.promoBtn').forEach(btn => {
    btn.textContent = '';
    btn.appendChild(createPieceEl(color, btn.dataset.piece));
  });
  promotionOverlayEl.classList.add('open');
}

function closePromotionPicker() {
  promotionOverlayEl.classList.remove('open');
  pendingPromotion = null;
}

document.querySelectorAll('.promoBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!pendingPromotion) return;
    const { fromFile, fromRank, toFile, toRank, dest } = pendingPromotion;
    const pieceType = btn.dataset.piece;
    closePromotionPicker();
    commitUserMove(fromFile, fromRank, toFile, toRank, dest, pieceType);
  });
});

function renderStatus() {
  const total = gameState.positions.length - 1;
  let text = `Jugada ${currentPly} / ${total}`;
  if (viewingBranch) {
    text = `${viewingBranch.name} · ${text}`;
  } else if (currentPly === total && gameState.result) {
    const resultLabel = { '1-0': 'Ganan blancas', '0-1': 'Ganan negras', '1/2-1/2': 'Tablas' }[gameState.result] || gameState.result;
    text += ` · ${resultLabel}`;
  }
  statusEl.textContent = text;
  startBtnEl.disabled = currentPly === 0;
  prevBtnEl.disabled = currentPly === 0;
  nextBtnEl.disabled = currentPly === total;
}

// ---------- Tira de notación: se puede deslizar libremente para ojear,
// pero la posición del tablero SOLO cambia al tocar una jugada concreta ----------
// Por dentro las jugadas se guardan siempre en notación inglesa, que es
// el estándar de los archivos PGN. Esto solo cambia cómo se ven.
let notationLang = 'es';

function displayMove(san) {
  if (notationLang !== 'es' || !san) return san;
  let t = san;
  if (PIEZAS_EN_A_ES[t[0]]) t = PIEZAS_EN_A_ES[t[0]] + t.slice(1);
  return t.replace(/=([KQRBN])/, (_, p) => '=' + PIEZAS_EN_A_ES[p]);
}

function moveLabel(ply) {
  if (ply === 0) return 'Inicio';
  const moveNumber = Math.ceil(ply / 2);
  const san = displayMove(gameState.moveHistory[ply - 1]);
  const isWhiteMove = ply % 2 === 1;
  return isWhiteMove ? `${moveNumber}.${san}` : `${san}`;
}

let moveChipEls = [];
const moveStripInner = document.getElementById('moveStripInner');
let stripOffset = 0;

// La tira se mueve con transform en vez de con el desplazamiento del
// navegador. Así se comporta igual en Safari que en cualquier otro, y la
// dirección es un único signo: el contenido acompaña al dedo.
function applyStripOffset(px, animate) {
  stripOffset = px;
  moveStripInner.style.transition = animate
    ? 'transform .26s cubic-bezier(.22,.61,.36,1)' : 'none';
  moveStripInner.style.transform = `translateX(${px}px)`;
  if (lensActive) stripLensInner.style.transform = `translateX(${px}px)`;
}

// ---------- Lupa de cristal (estética Liquid Glass) ----------
// Mientras se recorre la partida, una lente fija en el centro de la tira
// amplía la jugada que pasa por debajo, como la lente de la barra de
// pestañas de iOS. Lo que se ve dentro es una copia de la tira, colocada
// justo encima de la original y ampliada desde el centro de la lente.
const stripLensEl = document.getElementById('stripLens');
const stripLensInner = document.getElementById('stripLensInner');
let lensActive = false;
let lensHideTimer = null;

function showStripLens() {
  if (document.documentElement.dataset.look !== 'glass' || prefersReducedMotion()) return;
  clearTimeout(lensHideTimer);
  stripLensInner.innerHTML = moveStripInner.innerHTML;
  stripLensInner.style.left = (moveStripInner.offsetLeft - stripLensEl.offsetLeft) + 'px';
  stripLensInner.style.top = (moveStripInner.offsetTop - stripLensEl.offsetTop) + 'px';
  stripLensInner.style.transform = `translateX(${stripOffset}px)`;
  lensActive = true;
  stripLensEl.classList.add('open');
}

function hideStripLens() {
  if (!lensActive) return;
  lensActive = false;
  stripLensEl.classList.remove('open');
  lensHideTimer = setTimeout(() => { stripLensInner.innerHTML = ''; }, 320);
}

// Dónde queda el centro de cada jugada cuando la tira está sin mover. Se
// mide una sola vez: hacerlo en cada movimiento del dedo iría a tirones.
let chipCenters = null;

let chipWidths = null;

function measureChips() {
  const strip = moveStripEl.getBoundingClientRect();
  const mid = strip.left + strip.width / 2;
  chipCenters = moveChipEls.map(ch => {
    const r = ch.getBoundingClientRect();
    return (r.left + r.width / 2) - mid - stripOffset;
  });
  chipWidths = moveChipEls.map(ch => ch.offsetWidth);
}

function ensureChipCenters() {
  if (!chipCenters || chipCenters.length !== moveChipEls.length) measureChips();
}

function offsetCentering(ply) {
  ensureChipCenters();
  return chipCenters[ply] === undefined ? stripOffset : -chipCenters[ply];
}

function stripBounds() {
  const last = moveChipEls.length - 1;
  if (last < 0) return { min: 0, max: 0 };
  ensureChipCenters();
  return { max: -chipCenters[0], min: -chipCenters[last] };
}

// Qué jugada está ahora mismo en el centro de la tira. Búsqueda binaria
// sobre la medición, así que cuesta lo mismo con 10 jugadas que con 200.
function plyAtCenter() {
  ensureChipCenters();
  if (!chipCenters.length) return 0;
  const target = -stripOffset;
  let lo = 0, hi = chipCenters.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (chipCenters[mid] < target) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(chipCenters[lo - 1] - target) < Math.abs(chipCenters[lo] - target)) lo--;
  return lo;
}

function clampStrip(px) {
  const { min, max } = stripBounds();
  return Math.max(min, Math.min(px, max));
}
let scrubbingNow = false;
let stripFollowsFinger = false;
let notedPlies = new Set();

// Qué jugadas tienen apuntes. Se calcula una vez y se refresca al
// escribir, en vez de preguntarlo por cada chip en cada movimiento.
function refreshNotedPlies() {
  notedPlies = new Set();
  if (!gameState) return;
  for (let i = 0; i < gameState.positions.length; i++) {
    if (hasNote(i)) notedPlies.add(i);
  }
}

// Se reconstruye solo cuando se carga una partida (no en cada jugada).
function buildMoveStrip() {
  refreshNotedPlies();
  moveStripInner.innerHTML = '';
  nearChips = [];
  chipCenters = null;
  applyStripOffset(0, false);
  moveChipEls = [];
  const total = gameState.positions.length - 1;
  const branchStartPlies = new Set(
    (currentLibraryRecord ? loadBranches(currentLibraryRecord.id) : []).map(b => b.fromPly)
  );

  const frag = document.createDocumentFragment();
  for (let ply = 0; ply <= total; ply++) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'moveChip';
    if (branchStartPlies.has(ply)) chip.classList.add('hasBranch');
    if (viewingBranch && ply > viewingBranch.fromPly) chip.classList.add('branchMove');
    chip.dataset.ply = ply;
    chip.textContent = moveLabel(ply);
    frag.appendChild(chip);
    moveChipEls.push(chip);
  }
  moveStripInner.appendChild(frag);
}

// Un solo oyente para todas las jugadas, en vez de uno por chip.
moveStripInner.addEventListener('click', (e) => {
  const chip = e.target.closest('.moveChip');
  if (chip) goToPly(parseInt(chip.dataset.ply, 10));
});

// Se llama en cada jugada: solo actualiza el resaltado y centra la vista,
// nunca cambia la jugada por sí sola.
function updateMoveStripActive() {
  moveChipEls.forEach((chip, ply) => {
    chip.classList.toggle('current', ply === currentPly);
    chip.classList.toggle('hasNote', notedPlies.has(ply));
  });
  markNearChips();
  if (!stripExpanded) positionStripTrack();
  // Si el dedo está llevando la tira, manda él: recolocarla aquí sería
  // justo lo que hacía que fuese a trompicones.
  if (stripFollowsFinger) return;
  if (moveChipEls[currentPly]) {
    applyStripOffset(clampStrip(offsetCentering(currentPly)), !scrubbingNow);
  }
}

// ---------- La rueda en reposo: solo cinco jugadas ----------
// La actual, marcada, y dos a cada lado cada vez más tenues. Al tocarla
// se despliega entera; a los 10 s sin tocarla vuelve a quedarse en cinco.
const stripTrackEl = document.getElementById('stripTrack');
const STRIP_NEAR = 2;
const STRIP_COLLAPSE_MS = 10000;
let nearChips = [];          // las cinco de alrededor, con su distancia a la actual
let stripExpanded = false;
let stripCollapseTimer = null;
let rippleChips = [];

function markNearChips() {
  nearChips.forEach(ch => ch.removeAttribute('data-d'));
  nearChips = [];
  for (let d = -STRIP_NEAR; d <= STRIP_NEAR; d++) {
    const ch = moveChipEls[currentPly + d];
    if (!ch) continue;
    ch.dataset.d = Math.abs(d);
    nearChips.push(ch);
  }
}

// La cápsula de detrás abarca justo lo que se ve: las cinco jugadas en
// reposo (menos al principio o al final de la partida) o la tira entera.
function positionStripTrack() {
  if (stripExpanded || !moveChipEls.length) {
    stripTrackEl.style.left = '0px';
    stripTrackEl.style.width = '100%';
    return;
  }
  ensureChipCenters();
  const center = chipCenters[currentPly];
  let left = Infinity, right = -Infinity;
  for (let d = -STRIP_NEAR; d <= STRIP_NEAR; d++) {
    const i = currentPly + d;
    if (chipCenters[i] === undefined) continue;
    left = Math.min(left, chipCenters[i] - center - chipWidths[i] / 2);
    right = Math.max(right, chipCenters[i] - center + chipWidths[i] / 2);
  }
  const PAD = 6;
  stripTrackEl.style.left = 'calc(50% + ' + (left - PAD) + 'px)';
  stripTrackEl.style.width = (right - left + PAD * 2) + 'px';
}

function expandStrip() {
  clearTimeout(stripCollapseTimer);
  if (stripExpanded || !moveChipEls.length) return;
  stripExpanded = true;
  // Las demás jugadas aparecen en onda, desde la actual hacia fuera.
  rippleChips.forEach(ch => ch.style.removeProperty('--chip-delay'));
  rippleChips = [];
  if (!prefersReducedMotion()) {
    for (let d = STRIP_NEAR + 1; d <= 16; d++) {
      [currentPly - d, currentPly + d].forEach(i => {
        const ch = moveChipEls[i];
        if (!ch) return;
        ch.style.setProperty('--chip-delay', ((d - STRIP_NEAR) * 26) + 'ms');
        rippleChips.push(ch);
      });
    }
  }
  moveStripEl.classList.remove('collapsed');
  positionStripTrack();
}

function scheduleStripCollapse() {
  clearTimeout(stripCollapseTimer);
  stripCollapseTimer = setTimeout(collapseStrip, STRIP_COLLAPSE_MS);
}

function collapseStrip(instant) {
  clearTimeout(stripCollapseTimer);
  rippleChips.forEach(ch => ch.style.removeProperty('--chip-delay'));
  rippleChips = [];
  stripExpanded = false;
  moveStripEl.classList.add('collapsed');
  if (!moveChipEls.length) return;
  // Si se había desplazado a mano, vuelve a centrarse en la jugada actual.
  applyStripOffset(clampStrip(offsetCentering(currentPly)), !instant);
  positionStripTrack();
}

// ---------- Mantener pulsada la tira para recorrer la partida ----------
// Deslizar la tira solo la mueve, sin tocar el tablero. Pero si se
// mantiene pulsada un instante, pasa a mandar sobre la partida: al
// arrastrar, las jugadas se van reproduciendo en el tablero.
// ---------- La tira: desplazarla y recorrer la partida con ella ----------
// El navegador desplazaba la tira por su cuenta y peleaba con el
// recorrido de la partida, así que aquí se lleva el desplazamiento a
// mano: así la tira siempre acompaña al dedo.
(function enableStripControl() {
  const HOLD_MS = 230;        // cuánto hay que mantener para engancharla
  const MOVE_CANCEL = 10;     // moverse antes es un desplazamiento normal
  const EDGE_ZONE = 70;       // franja del extremo que sigue avanzando
  const EDGE_MIN = 1.5;       // px por fotograma al asomarse a la franja
  const EDGE_MAX = 20;        // px por fotograma pegado al extremo
  const FRAME = 16.7;         // fotograma de referencia, a 60 Hz

  let holdTimer = null, edgeRaf = null, inertia = null, pointerId = null;
  let scrubbing = false, dragging = false;
  let startX = 0, lastX = 0, lastT = 0, velocity = 0;
  let startOffset = 0, edgeDir = 0, edgeSpeed = 0, edgeLastT = 0;

  function stopEdge() {
    if (edgeRaf) cancelAnimationFrame(edgeRaf);
    edgeRaf = null;
    edgeDir = 0;
    edgeSpeed = 0;
    edgeLastT = 0;
  }

  function endGesture() {
    clearTimeout(holdTimer); holdTimer = null;
    stopEdge();
    if (scrubbing) {
      scrubbing = false;
      scrubbingNow = false;
      stripFollowsFinger = false;
      moveStripEl.classList.remove('scrubbing');
      hideStripLens();
    }
    dragging = false;
  }

  function syncPlyToStrip() {
    const ply = plyAtCenter();
    if (ply !== currentPly) goToPly(ply);
  }

  // Sin capturar el puntero el gesto muere en cuanto el dedo se sale de la
  // tira, que es más baja que un dedo. Pero solo se captura al empezar un
  // arrastre: en un toque simple el toque tiene que llegar a la jugada.
  function capturePointer() {
    if (pointerId === null) return;
    try { moveStripEl.setPointerCapture(pointerId); } catch (err) {}
  }

  function beginScrub() {
    capturePointer();
    scrubbing = true;
    scrubbingNow = true;
    stripFollowsFinger = true;
    // Se reancla aquí para que al enganchar la tira no dé un salto.
    startX = lastX;
    startOffset = stripOffset;
    moveStripEl.classList.add('scrubbing');
    showStripLens();
  }

  // En el extremo el dedo ya no puede seguir, así que la tira sigue
  // corriendo sola, fotograma a fotograma, mientras se mantenga ahí.
  function edgeStep(now) {
    if (!edgeDir) { edgeRaf = null; return; }
    // Se avanza por tiempo, no por fotograma: si no, en una pantalla de
    // 120 Hz la partida correría al doble de velocidad que en una de 60.
    const t = now || performance.now();
    const dt = edgeLastT ? Math.min(t - edgeLastT, 50) : FRAME;
    edgeLastT = t;
    const next = clampStrip(stripOffset - edgeSpeed * (dt / FRAME) * edgeDir);
    const topeAlcanzado = next === stripOffset;
    applyStripOffset(next, false);
    syncPlyToStrip();
    edgeRaf = topeAlcanzado ? null : requestAnimationFrame(edgeStep);
  }

  // Cuanto más hundido esté el dedo en la franja, más rápido corre: al
  // asomarse apenas se mueve y pegado al extremo va a toda velocidad. La
  // curva es cuadrática para que la parte lenta ocupe casi toda la franja
  // y sea fácil quedarse en la jugada exacta.
  function edgeAt(x) {
    const r = moveStripEl.getBoundingClientRect();
    let dir = 0, hondura = 0;
    // La partida va hacia donde va el dedo: pegado al borde izquierdo
    // sigue retrocediendo y pegado al derecho sigue avanzando.
    if (x < r.left + EDGE_ZONE) {
      dir = -1;
      hondura = (r.left + EDGE_ZONE - x) / EDGE_ZONE;
    } else if (x > r.right - EDGE_ZONE) {
      dir = 1;
      hondura = (x - (r.right - EDGE_ZONE)) / EDGE_ZONE;
    }
    hondura = Math.max(0, Math.min(hondura, 1));
    // Al cubo: la parte lenta ocupa casi toda la franja y solo se dispara
    // en el último tramo, pegado al extremo.
    const curva = hondura * hondura * hondura;
    return { dir, speed: dir ? EDGE_MIN + (EDGE_MAX - EDGE_MIN) * curva : 0 };
  }

  function updateEdge(x) {
    const { dir, speed } = edgeAt(x);
    if (!dir) { stopEdge(); return; }
    edgeDir = dir;
    edgeSpeed = speed;   // se recalcula en cada movimiento, no solo al entrar
    if (!edgeRaf) edgeRaf = requestAnimationFrame(edgeStep);
  }

  // El toque que despliega la rueda no elige jugada: lo que había debajo
  // aún no se veía. Las cinco que ya se veían sí se pueden tocar a la vez.
  let openingTap = false;

  moveStripEl.addEventListener('pointerdown', (e) => {
    if (!gameState) return;
    openingTap = !stripExpanded;
    expandStrip();
    if (inertia) { cancelAnimationFrame(inertia); inertia = null; }
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    lastT = performance.now();
    velocity = 0;
    startOffset = stripOffset;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(beginScrub, HOLD_MS);
  });

  moveStripEl.addEventListener('pointermove', (e) => {
    if (pointerId === null) return;
    const dx = e.clientX - startX;
    const now = performance.now();
    if (now > lastT) velocity = (e.clientX - lastX) / (now - lastT);
    lastX = e.clientX;
    lastT = now;

    if (scrubbing) {
      const veniaDelExtremo = edgeDir !== 0;
      updateEdge(e.clientX);
      if (edgeDir) { stripFollowsFinger = false; return; }

      // Mientras la tira corría sola en el extremo, el punto de anclaje se
      // quedó atrás. Si no se vuelve a fijar aquí, al regresar a la zona
      // neutra se calcula la posición desde un punto viejo y la partida
      // pega un salto enorme.
      if (veniaDelExtremo) {
        startOffset = stripOffset;
        startX = e.clientX;
      }

      stripFollowsFinger = true;
      // Al recorrer, la partida va hacia donde va el dedo: deslizar a la
      // izquierda la lleva hacia el principio y a la derecha hacia el
      // final. Por eso la tira se mueve al revés que el dedo, como un
      // cursor. El tablero cambia cuando una jugada pasa por el centro,
      // de forma continua, no a saltos de jugada en jugada.
      applyStripOffset(clampStrip(startOffset - (e.clientX - startX)), false);
      syncPlyToStrip();
      return;
    }

    if (!dragging && Math.abs(dx) > MOVE_CANCEL) {
      clearTimeout(holdTimer);
      holdTimer = null;
      dragging = true;
      capturePointer();
    }
    if (dragging) applyStripOffset(clampStrip(startOffset + dx), false);
  });

  function glide() {
    velocity *= 0.94;
    const next = clampStrip(stripOffset + velocity * 16);
    const stopped = next === stripOffset;
    applyStripOffset(next, false);
    if (!stopped && Math.abs(velocity) > 0.02) inertia = requestAnimationFrame(glide);
    else inertia = null;
  }

  moveStripEl.addEventListener('pointerup', () => {
    scheduleStripCollapse();
    const wasDragging = dragging && !scrubbing;
    const wasScrubbing = scrubbing;
    if (pointerId !== null) {
      try { moveStripEl.releasePointerCapture(pointerId); } catch (err) {}
      pointerId = null;
    }
    endGesture();
    if (wasScrubbing) {
      // Al soltar, la jugada se acomoda en el centro.
      applyStripOffset(clampStrip(offsetCentering(currentPly)), true);
      settleAfterScrub();
    }
    if (wasDragging && Math.abs(velocity) > 0.08) inertia = requestAnimationFrame(glide);
  });

  moveStripEl.addEventListener('pointercancel', () => {
    pointerId = null;
    endGesture();
    scheduleStripCollapse();
  });

  // Tras arrastrar, el dedo no debe además saltar a la jugada de debajo.
  moveStripEl.addEventListener('click', (e) => {
    const hiddenChip = openingTap && !e.target.closest('.moveChip[data-d]');
    if (dragging || scrubbing || hiddenChip) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  // Al girar el iPad cambia el ancho: se vuelve a medir y a centrar.
  window.addEventListener('resize', () => {
    if (!gameState || !moveChipEls.length) return;
    chipCenters = null;
    applyStripOffset(clampStrip(offsetCentering(currentPly)), false);
    positionStripTrack();
  });
})();

// ---------- Notas por jugada (persistentes, el alma de la app) ----------
const notesArea = document.getElementById('notesArea');
const notesLabelMoveEl = document.getElementById('notesLabelMove');
let notesSaveTimer = null;

function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash) + str.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

function currentGameId() {
  return simpleHash(gameState.moveHistory.join(' ') || 'partida-vacia');
}

function noteKey(ply) {
  if (viewingBranch && ply >= viewingBranch.fromPly) {
    return `chess-notes:branch:${viewingBranch.id}:${ply}`;
  }
  const baseId = currentLibraryRecord ? currentLibraryRecord.id : currentGameId();
  return `chess-notes:${baseId}:${ply}`;
}

function hasNote(ply) {
  return !!Store.get(noteKey(ply));
}

function loadNote(ply) {
  return Store.get(noteKey(ply)) || '';
}

function saveNote(ply, text) {
  if (text.trim()) Store.set(noteKey(ply), text);
  else if (Store.get(noteKey(ply)) !== null) Store.remove(noteKey(ply));
}

function renderNotesForCurrentPly() {
  notesLabelMoveEl.textContent = currentPly === 0 ? 'Inicio' : moveLabel(currentPly);
  notesArea.value = loadNote(currentPly);
}

notesArea.addEventListener('input', () => {
  clearTimeout(notesSaveTimer);
  const ply = currentPly;
  const text = notesArea.value;
  notesSaveTimer = setTimeout(() => { saveNote(ply, text); refreshNotedPlies(); updateMoveStripActive(); }, 350);
});

// ---------- Retomar la partida justo donde se dejó ----------
function lastPlyKey() {
  if (viewingBranch) return `chess-lastply:branch:${viewingBranch.id}`;
  return `chess-lastply:${currentLibraryRecord ? currentLibraryRecord.id : currentGameId()}`;
}
function saveLastPly(ply) {
  const key = lastPlyKey();
  if (Store.get(key) !== String(ply)) Store.set(key, String(ply));
}
function loadLastPly() {
  const raw = Store.get(lastPlyKey());
  return raw ? parseInt(raw, 10) || 0 : 0;
}

function goToPly(ply) {
  const total = gameState.positions.length - 1;
  const previousPly = currentPly;
  currentPly = Math.max(0, Math.min(ply, total));
  renderBoard(gameState.positions[currentPly], gameState.lastMoveSquares[currentPly]);
  renderStatus();
  updateMoveStripActive();

  // Mientras se recorre la partida con el dedo solo se dibuja el tablero
  // y la tira. Leer apuntes, mirar ramificaciones y guardar la posición
  // son accesos a disco que ahogarían el gesto; se hacen al soltar. La
  // barra de ventaja solo enseña lo que ya sabe, sin poner a pensar al motor.
  if (scrubbingNow) { updateEval(true); return; }

  animatePieceTravel(previousPly, currentPly);
  renderNotesForCurrentPly();
  saveLastPly(currentPly);
  renderBranchAction();
  updateEval(false);
}

function settleAfterScrub() {
  renderNotesForCurrentPly();
  saveLastPly(currentPly);
  renderBranchAction();
  updateEval(false);
}

// ---------- Barra de ventaja ----------
// Stockfish valora cada posición y la barra se inclina hacia el bando que
// va ganando: la parte blanca crece cuando ganan las blancas y la negra
// cuando ganan las negras. El número es la ventaja en peones (o "M3":
// mate en 3) y se lee en el lado del que va ganando.
const evalBarEl = document.getElementById('evalBar');
const evalLabelEl = document.getElementById('evalLabel');
let evalEnabled = true;
let evalTimer = null;

// Probabilidad de ganar a partir de la ventaja, como en lichess: una
// ventaja de un peón ya inclina bastante la barra, pero diez no la llenan.
function whiteShare(result) {
  if (result.mate !== null) return result.winner === 'w' ? 100 : 0;
  const chance = 2 / (1 + Math.exp(-0.00368208 * result.cp)) - 1;
  return Math.max(3, Math.min(97, 50 + 50 * chance));
}

function evalText(result) {
  if (result.mate !== null) return result.mate === 0 ? 'Mate' : 'M' + result.mate;
  const pawns = Math.round(result.cp) / 100;
  if (pawns === 0) return '0,00';
  return (pawns > 0 ? '+' : '−') + Math.abs(pawns).toFixed(2).replace('.', ',');
}

// La parte de las blancas va en --eval-share, de 0 a 1. El CSS la dibuja
// en horizontal o en vertical (al lado del tablero, con el iPad apaisado).
function renderEval(result) {
  evalBarEl.classList.toggle('pending', !result);
  if (!result) {
    evalBarEl.style.setProperty('--eval-share', '0.5');
    evalLabelEl.textContent = '';
    return;
  }
  const whiteAhead = result.mate !== null ? result.winner === 'w' : result.cp >= 0;
  evalBarEl.style.setProperty('--eval-share', String(whiteShare(result) / 100));
  evalLabelEl.textContent = evalText(result);
  evalBarEl.classList.toggle('blackAhead', !whiteAhead);
  evalBarEl.setAttribute('aria-label', 'Ventaja ' + evalText(result));
}

// fromCacheOnly: al recorrer la partida con el dedo no se analiza nada
// nuevo, solo se enseña lo ya calculado.
function updateEval(fromCacheOnly) {
  if (!evalEnabled || !gameState || analysisView.hidden) return;
  const fen = gameState.fens[currentPly];
  if (!fen) { renderEval(null); return; }
  const known = Engine.cached(fen);
  if (known) renderEval(known);
  if (fromCacheOnly) return;
  // Una pausa mínima: al mantener pulsada una flecha pasan muchas jugadas
  // por segundo y solo merece la pena pensar en la que se queda.
  clearTimeout(evalTimer);
  evalTimer = setTimeout(() => {
    Engine.analyze(fen, (result) => {
      if (gameState && gameState.fens[currentPly] === fen) renderEval(result);
    });
  }, 80);
}

function stopEval() {
  clearTimeout(evalTimer);
  Engine.stop();
}

Engine.onFail(() => {
  evalBarEl.hidden = true;
  document.getElementById('evalMeta').textContent = 'No disponible en este dispositivo';
});

// ---------- Las piezas viajan por el tablero ----------
// Al avanzar o retroceder una jugada, la pieza se desliza de casilla a
// casilla en vez de aparecer de golpe. Solo para pasos de una jugada:
// en los saltos largos el movimiento no significaría nada.
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function computeTravelLegs(previousPly, newPly) {
  let move, forward;
  if (newPly === previousPly + 1) { move = gameState.lastMoveSquares[newPly]; forward = true; }
  else if (newPly === previousPly - 1) { move = gameState.lastMoveSquares[previousPly]; forward = false; }
  else return null;
  if (!move || !move.from || !move.to) return null;

  const from = squareToCoords(move.from);
  const to = squareToCoords(move.to);
  const legs = forward
    ? [{ fromFile: from.file, fromRank: from.rank, toFile: to.file, toRank: to.rank }]
    : [{ fromFile: to.file, fromRank: to.rank, toFile: from.file, toRank: from.rank }];

  // En el enroque también se mueve la torre, y debe viajar con el rey.
  const board = gameState.positions[newPly];
  const landed = forward ? board[to.rank][to.file] : board[from.rank][from.file];
  const fileShift = to.file - from.file;
  if (landed && landed.type === 'K' && Math.abs(fileShift) === 2) {
    const rank = from.rank;
    const rookFrom = fileShift > 0 ? 7 : 0;
    const rookTo = fileShift > 0 ? 5 : 3;
    legs.push(forward
      ? { fromFile: rookFrom, fromRank: rank, toFile: rookTo, toRank: rank }
      : { fromFile: rookTo, fromRank: rank, toFile: rookFrom, toRank: rank });
  }
  return legs;
}

function animatePieceTravel(previousPly, newPly) {
  if (previousPly === newPly || prefersReducedMotion()) return;
  const legs = computeTravelLegs(previousPly, newPly);
  if (!legs) return;

  const cell = boardEl.clientWidth / 8;
  if (!cell) return; // el tablero aún no está medido: se dibuja sin animar

  legs.forEach(({ fromFile, fromRank, toFile, toRank }) => {
    const square = boardEl.children[displayIndex(toFile, toRank)];
    if (!square) return;
    const piece = square.querySelector('.piece');
    if (!piece) return;

    const sign = boardFlipped ? -1 : 1;
    const dx = (fromFile - toFile) * cell * sign;
    const dy = (fromRank - toRank) * cell * sign;

    piece.classList.add('traveling');
    piece.style.transition = 'none';
    piece.style.transform = `translate(${dx}px, ${dy}px)`;
    void piece.offsetWidth; // fuerza el reflow para que el punto de partida cuente
    piece.style.transition = 'transform .24s cubic-bezier(.22,.61,.36,1)';
    piece.style.transform = 'translate(0, 0)';

    setTimeout(() => {
      piece.classList.remove('traveling');
      piece.style.transition = '';
      piece.style.transform = '';
    }, 260);
  });
}

function stepForward() { goToPly(currentPly + 1); }
function stepBackward() { goToPly(currentPly - 1); }

// ---------- Mantener pulsado: avance/retroceso acelerado ----------
function bindHold(button, action, atBoundary) {
  let holdTimeout = null;
  let holdInterval = null;
  let steps = 0;
  let interval = 200;

  function tick() {
    action();
    steps++;
    if (atBoundary()) { stop(); return; }
    if (steps % 4 === 0 && interval > 55) {
      interval = Math.max(55, interval - 45);
      clearInterval(holdInterval);
      holdInterval = setInterval(tick, interval);
    }
  }

  function stop() {
    clearTimeout(holdTimeout);
    clearInterval(holdInterval);
    holdTimeout = null;
    holdInterval = null;
    steps = 0;
    interval = 200;
  }

  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    action();
    if (atBoundary()) return;
    holdTimeout = setTimeout(() => {
      holdInterval = setInterval(tick, interval);
    }, 320);
  });
  // En iOS el gesto de pulsación larga nace en touchstart: si no se
  // cancela ahí, el sistema empieza a seleccionar aunque el pointerdown
  // ya esté anulado.
  button.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  button.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  ['pointerup', 'pointerleave', 'pointercancel', 'touchend', 'touchcancel'].forEach(evt =>
    button.addEventListener(evt, stop)
  );
}

bindHold(prevBtnEl, stepBackward, () => currentPly === 0);
bindHold(nextBtnEl, stepForward, () => currentPly === gameState.positions.length - 1);

// Volver de golpe al inicio de la partida (o de la ramificación que se
// esté viendo: su inicio es la posición de partida, igual que la tira).
startBtnEl.addEventListener('click', () => goToPly(0));

// ---------- Navegación entre pantallas ----------
const homeView = document.getElementById('homeView');
const analysisView = document.getElementById('analysisView');
const settingsView = document.getElementById('settingsView');
const folderChipsEl = document.getElementById('folderChips');
const folderSelectEl = document.getElementById('folderSelect');

let activeFolderId = 'all'; // 'all' | 'none' | id de carpeta
let activeTag = null;       // etiqueta seleccionada, o null
let searchQuery = '';
let sortMode = 'recent';    // 'recent' | 'year' | 'title'

// ---------- Transiciones entre pantallas ----------
// Al entrar en una partida o en Ajustes la pantalla nueva llega desde la
// derecha y al volver desde la izquierda, en un solo movimiento suave de
// toda la pantalla (la API de transiciones de vista de Safari). Donde no
// existe, cada pantalla entra con su propia animación de siempre.
const canViewTransition = typeof document.startViewTransition === 'function';
if (canViewTransition) document.documentElement.classList.add('vt');

function navigate(update, direction) {
  if (!canViewTransition || prefersReducedMotion()) { update(); return; }
  const root = document.documentElement;
  root.dataset.nav = direction;
  document.startViewTransition(update).finished.finally(() => {
    if (root.dataset.nav === direction) delete root.dataset.nav;
  });
}

// Cambiar de tema o de estética funde una pantalla en la otra.
function crossfade(update) {
  if (!canViewTransition || prefersReducedMotion()) { update(); return; }
  document.startViewTransition(update);
}

function showHome() {
  stopEval();
  clearTimeout(stripCollapseTimer);
  renderFolderChips();
  renderLibraryList();
  homeView.hidden = false;
  analysisView.hidden = true;
  settingsView.hidden = true;
}

function showSettings() {
  stopEval();
  homeView.hidden = true;
  analysisView.hidden = true;
  settingsView.hidden = false;
  renderSyncStatus();
}

document.getElementById('settingsBtn').addEventListener('click', () => navigate(showSettings, 'forward'));
document.getElementById('settingsBackBtn').addEventListener('click', () => navigate(showHome, 'back'));

function showAnalysis(record) {
  // Cada partida se abre con la rueda en reposo: cinco jugadas.
  clearTimeout(stripCollapseTimer);
  stripExpanded = false;
  moveStripEl.classList.add('collapsed');
  currentLibraryRecord = record;
  mainGameState = loadGame(record.pgn);
  gameState = mainGameState;
  viewingBranch = null;
  branchEditMode = false;
  selectedSquare = null;
  legalDestinations = [];
  gameTitleLabelEl.textContent = gameDisplayTitle(record);
  homeView.hidden = true;
  analysisView.hidden = false;
  settingsView.hidden = true;
  applyBranchModeUI();
  buildMoveStrip();
  const total = gameState.positions.length - 1;
  const resumePly = Math.max(0, Math.min(loadLastPly(), total));
  currentPly = resumePly; // entrar en la partida no es "una jugada": sin deslizamiento
  goToPly(resumePly);
}

document.getElementById('backBtn').addEventListener('click', () => navigate(showHome, 'back'));

// ---------- Navegación entre la partida principal y sus ramas ----------
function buildBranchGameState(branch) {
  const prefix = mainGameState.moveHistory.slice(0, branch.fromPly);
  const combined = prefix.concat(branch.moves).join(' ');
  return loadGame(combined);
}

function applyBranchModeUI() {
  document.getElementById('boardFrame').classList.toggle('branch-editing', branchEditMode);
}

function loadBranchView(branch, editMode) {
  viewingBranch = branch;
  branchEditMode = !!editMode;
  selectedSquare = null;
  legalDestinations = [];
  gameState = buildBranchGameState(branch);
  applyBranchModeUI();
  buildMoveStrip();
  const total = gameState.positions.length - 1;
  const resumePly = editMode ? total : branch.fromPly;
  currentPly = resumePly;
  goToPly(resumePly);
}

function exitToMainLine() {
  viewingBranch = null;
  branchEditMode = false;
  selectedSquare = null;
  legalDestinations = [];
  gameState = mainGameState;
  applyBranchModeUI();
  buildMoveStrip();
  const total = gameState.positions.length - 1;
  const backPly = Math.max(0, Math.min(loadLastPly(), total));
  currentPly = backPly;
  goToPly(backPly);
}

// ---------- Hoja para nombrar una ramificación ----------
const branchNameOverlay = document.getElementById('branchNameSheetOverlay');
const branchNameInput = document.getElementById('branchNameInput');
const branchNameTitleEl = document.getElementById('branchNameSheetTitle');
const branchNameHintEl = document.getElementById('branchNameHint');
const saveBranchNameBtnEl = document.getElementById('saveBranchNameBtn');
let renamingBranchId = null;

function closeBranchNameSheet() {
  branchNameOverlay.classList.remove('open');
  renamingBranchId = null;
}

function enterBranchCreation() {
  if (viewingBranch) return;
  renamingBranchId = null;
  branchNameTitleEl.textContent = 'Nueva ramificación';
  branchNameHintEl.textContent =
    `Parte de ${currentPly === 0 ? 'la posición inicial' : 'la jugada ' + moveLabel(currentPly)}. ` +
    `A partir de ahí mueves las piezas tú.`;
  branchNameInput.value = defaultBranchName(currentLibraryRecord.id);
  saveBranchNameBtnEl.textContent = 'Crear ramificación';
  branchNameOverlay.classList.add('open');
}

function openRenameBranchSheet() {
  if (!viewingBranch) return;
  renamingBranchId = viewingBranch.id;
  branchNameTitleEl.textContent = 'Renombrar ramificación';
  branchNameHintEl.textContent = '';
  branchNameInput.value = viewingBranch.name || '';
  saveBranchNameBtnEl.textContent = 'Guardar nombre';
  branchNameOverlay.classList.add('open');
}

saveBranchNameBtnEl.addEventListener('click', () => {
  const name = branchNameInput.value.trim();
  const gameId = currentLibraryRecord.id;

  if (renamingBranchId) {
    const updated = renameBranch(gameId, renamingBranchId, name);
    if (updated && viewingBranch && viewingBranch.id === updated.id) {
      viewingBranch.name = updated.name;
    }
    closeBranchNameSheet();
    renderStatus();
    renderBranchAction();
    return;
  }

  const branch = createBranch(gameId, currentPly, name);
  closeBranchNameSheet();
  loadBranchView(branch, true);
});

document.getElementById('closeBranchNameBtn').addEventListener('click', closeBranchNameSheet);
branchNameOverlay.addEventListener('click', (e) => {
  if (e.target === branchNameOverlay) closeBranchNameSheet();
});

function toggleBranchEditMode() {
  if (!viewingBranch) return;
  branchEditMode = !branchEditMode;
  selectedSquare = null;
  legalDestinations = [];
  applyBranchModeUI();
  renderBranchAction();
  refreshBoardOnly();
  renderStatus();
}

// ---------- Zona contextual de ramificaciones ----------
const branchActionEl = document.getElementById('branchAction');
const newBranchBtnEl = document.getElementById('newBranchBtn');

function renderBranchAction() {
  branchActionEl.innerHTML = '';

  // ---- Dentro de una ramificación ----
  if (viewingBranch) {
    newBranchBtnEl.hidden = true;
    branchActionEl.hidden = false;

    // El nombre, con lápiz: se ve que se puede cambiar.
    const info = document.createElement('div');
    info.className = 'branchActionInfo';

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'branchNameBtn';
    const ico = document.createElement('span');
    ico.className = 'branchNameIcon';
    ico.innerHTML = iconButton('branch');
    nameBtn.appendChild(ico);
    const nameTxt = document.createElement('span');
    nameTxt.textContent = viewingBranch.name;
    nameBtn.appendChild(nameTxt);
    if (!teacherMode) {
      const pencil = document.createElement('span');
      pencil.className = 'branchNamePencil';
      pencil.innerHTML = iconButton('pencil');
      nameBtn.appendChild(pencil);
      nameBtn.setAttribute('aria-label', 'Renombrar la ramificación');
      nameBtn.addEventListener('click', openRenameBranchSheet);
    } else {
      nameBtn.disabled = true;
    }
    info.appendChild(nameBtn);

    if (branchEditMode) {
      const hint = document.createElement('span');
      hint.className = 'branchHint';
      hint.textContent = 'mueve las piezas para añadir jugadas';
      info.appendChild(hint);
    }
    branchActionEl.appendChild(info);

    const btnRow = document.createElement('div');
    btnRow.className = 'branchActionButtons';

    const backToGame = document.createElement('button');
    backToGame.type = 'button';
    backToGame.className = 'branchActionBtn';
    backToGame.textContent = 'Volver a la partida';
    backToGame.addEventListener('click', exitToMainLine);

    // En modo profesor solo queda salir: nada de editar ni borrar,
    // para no tocar la ramificación por error durante una clase.
    if (teacherMode) {
      backToGame.classList.add('primary', 'full');
      btnRow.appendChild(backToGame);
    } else {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'branchActionBtn' + (branchEditMode ? ' primary' : '');
      editBtn.textContent = branchEditMode ? 'Terminar' : 'Editar';
      editBtn.addEventListener('click', toggleBranchEditMode);
      btnRow.appendChild(editBtn);

      btnRow.appendChild(backToGame);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'branchActionBtn danger';
      delBtn.innerHTML = iconButton('trash');
      delBtn.setAttribute('aria-label', 'Eliminar rama');
      delBtn.addEventListener('click', () => {
        if (confirm(`¿Eliminar "${viewingBranch.name}"? Esta acción no se puede deshacer.`)) {
          const gameId = currentLibraryRecord.id;
          deleteBranchAndData(gameId, viewingBranch.id);
          exitToMainLine();
        }
      });
      btnRow.appendChild(delBtn);
    }

    branchActionEl.appendChild(btnRow);

    // Si hay más variantes desde la misma jugada, se puede saltar
    // directamente entre ellas para compararlas.
    const siblings = loadBranches(currentLibraryRecord.id)
      .filter(b => b.fromPly === viewingBranch.fromPly && b.id !== viewingBranch.id);
    if (siblings.length) {
      const sibLabel = document.createElement('div');
      sibLabel.className = 'branchSiblingLabel';
      sibLabel.textContent = 'Otras variantes desde esta jugada';
      branchActionEl.appendChild(sibLabel);
      branchActionEl.appendChild(buildBranchPills(siblings));
    }
    return;
  }

  // ---- En la partida principal, sobre una jugada ramificada ----
  // En clase no se crean ramificaciones: el botón desaparece.
  newBranchBtnEl.hidden = teacherMode;
  const branchesHere = loadBranches(currentLibraryRecord.id).filter(b => b.fromPly === currentPly);

  if (branchesHere.length === 0) {
    branchActionEl.hidden = true;
    return;
  }

  branchActionEl.hidden = false;

  const label = document.createElement('div');
  label.className = 'branchActionInfo';
  label.textContent = branchesHere.length === 1
    ? 'Ramificación desde esta jugada'
    : 'Ramificaciones desde esta jugada';
  branchActionEl.appendChild(label);

  branchActionEl.appendChild(buildBranchPills(branchesHere));
}

// Pastillas compactas en vez de un botón alargado: se leen de un
// vistazo y varias caben en la misma línea.
function buildBranchPills(list) {
  const row = document.createElement('div');
  row.className = 'branchPills';
  list.forEach(branch => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'branchPill';

    const ico = document.createElement('span');
    ico.className = 'branchPillIcon';
    ico.innerHTML = iconButton('branch');
    pill.appendChild(ico);

    const name = document.createElement('span');
    name.className = 'branchPillName';
    name.textContent = branch.name;
    pill.appendChild(name);

    const chev = document.createElement('span');
    chev.className = 'branchPillChevron';
    chev.innerHTML = iconButton('chevron');
    pill.appendChild(chev);

    pill.addEventListener('click', () => loadBranchView(branch, false));
    row.appendChild(pill);
  });
  return row;
}

newBranchBtnEl.addEventListener('click', enterBranchCreation);

// ---------- Chips de carpetas (filtro) ----------
function renderFolderChips() {
  const folders = loadFolders();
  folderChipsEl.innerHTML = '';

  const makeChip = (label, id, folder) => {
    const isActive = activeFolderId === id;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'folderChip' + (isActive ? ' active' : '');
    const txt = document.createElement('span');
    txt.textContent = label;
    chip.appendChild(txt);

    // La carpeta seleccionada muestra sus opciones: tocarla otra vez las
    // abre. Antes había que adivinar que se mantenía pulsada.
    if (folder && isActive) {
      const dots = document.createElement('span');
      dots.className = 'folderChipDots';
      dots.innerHTML = iconButton('more');
      chip.appendChild(dots);
      chip.setAttribute('aria-label', `Opciones de la carpeta ${label}`);
      chip.addEventListener('click', () => openFolderSheet(folder));
    } else {
      chip.addEventListener('click', () => {
        activeFolderId = id;
        renderFolderChips();
        renderLibraryList();
      });
    }
    return chip;
  };

  folderChipsEl.appendChild(makeChip('Todas', 'all', null));
  if (folders.length > 0) folderChipsEl.appendChild(makeChip('Sin carpeta', 'none', null));
  folders.forEach(f => folderChipsEl.appendChild(makeChip(f.name, f.id, f)));

  const addChip = document.createElement('button');
  addChip.className = 'folderChip folderChipAdd';
  addChip.innerHTML = iconButton('add');
  addChip.setAttribute('aria-label', 'Nueva carpeta');
  addChip.addEventListener('click', openNewFolderSheet);
  folderChipsEl.appendChild(addChip);

  renderTagChips();
}

// Con nodos y no con HTML: un nombre de carpeta con "<" no debe poder
// colarse como código en la página.
function populateFolderSelect() {
  folderSelectEl.textContent = '';
  folderSelectEl.appendChild(new Option('Sin carpeta', ''));
  loadFolders().forEach(f => folderSelectEl.appendChild(new Option(f.name, f.id)));
}

// ---------- Lista de la biblioteca ----------
// Las etiquetas se pintan en la misma fila que las carpetas, detrás de
// un separador: son otra forma de agrupar, no una carpeta más.
function renderTagChips() {
  const tags = allTags();
  if (!tags.length) return;

  const sep = document.createElement('span');
  sep.className = 'chipSeparator';
  folderChipsEl.appendChild(sep);

  tags.forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    const on = activeTag && activeTag.toLowerCase() === tag.toLowerCase();
    chip.className = 'folderChip tagChip' + (on ? ' active' : '');
    chip.textContent = '#' + tag;
    chip.addEventListener('click', () => {
      activeTag = on ? null : tag;
      renderFolderChips();
      renderLibraryList();
    });
    folderChipsEl.appendChild(chip);
  });
}

function filteredSortedGames() {
  const all = loadLibrary();
  const q = foldText(searchQuery).trim();

  // Buscar es buscar: cuando escribes algo se mira en toda la biblioteca,
  // no solo dentro de la carpeta o la etiqueta que tuvieras puesta.
  if (q) {
    const found = all.filter(g => gameSearchBlob(g).includes(q));
    return sortGames(found);
  }

  let games = activeFolderId === 'all' ? all
    : activeFolderId === 'none' ? all.filter(g => !g.folderId)
    : all.filter(g => g.folderId === activeFolderId);

  if (activeTag) {
    const t = activeTag.toLowerCase();
    games = games.filter(g => normalizeTags(g.tags).some(x => x.toLowerCase() === t));
  }

  return sortGames(games);
}

function sortGames(games) {
  const bySort = {
    recent: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    // Sin año no se puede ordenar por año: esas partidas van al final.
    year: (a, b) => (parseInt(b.year, 10) || -Infinity) - (parseInt(a.year, 10) || -Infinity),
    title: (a, b) => gameDisplayTitle(a).localeCompare(gameDisplayTitle(b), 'es')
  };
  return games.slice().sort(bySort[sortMode] || bySort.recent);
}

// animate: la entrada escalonada solo al llegar a la pantalla. Al
// escribir en el buscador o al llegar cambios de la nube, la lista se
// actualiza sin volver a animarse entera en cada letra.
function renderLibraryList(animate = true) {
  const games = filteredSortedGames();
  refreshSearchUI(games.length);
  const folders = loadFolders();
  const folderName = (id) => (folders.find(f => f.id === id) || {}).name;

  libraryListEl.textContent = '';
  const isEmpty = games.length === 0;
  libraryEmptyEl.style.display = isEmpty ? 'flex' : 'none';
  // Se oculta con el atributo, no con un estilo en línea: así el diseño
  // de dos columnas en horizontal no queda pisado.
  libraryListEl.hidden = isEmpty;
  const frag = document.createDocumentFragment();

  games.forEach((record, index) => {
    const row = document.createElement('div');
    row.className = 'libraryRow';
    // Entrada escalonada: la lista se compone, no aparece de golpe.
    if (animate) row.style.animationDelay = Math.min(index, 9) * 32 + 'ms';
    else row.classList.add('noEnter');

    const info = document.createElement('div');
    info.className = 'libraryInfo';
    const badge = resultBadge(record.pgn);
    const metaParts = gameMetaParts(record, folderName, activeFolderId === 'all');

    const titleEl = document.createElement('div');
    titleEl.className = 'libraryTitle';
    titleEl.textContent = gameDisplayTitle(record);
    const metaEl = document.createElement('div');
    metaEl.className = 'libraryMeta';
    metaEl.textContent = metaParts.join(' · ');
    info.appendChild(titleEl);
    info.appendChild(metaEl);

    const tags = normalizeTags(record.tags);
    if (tags.length) {
      const tagRow = document.createElement('div');
      tagRow.className = 'libraryTags';
      tags.slice(0, 4).forEach(t => {
        const el = document.createElement('span');
        el.className = 'libraryTag';
        el.textContent = '#' + t;
        tagRow.appendChild(el);
      });
      info.appendChild(tagRow);
    }

    row.appendChild(info);

    if (badge) {
      const dot = document.createElement('span');
      dot.className = 'resultDot ' + badge.cls;
      dot.textContent = badge.label;
      row.appendChild(dot);
    }

    // Tocar abre la partida; mantener pulsado, sus opciones (editar,
    // borrar), como el menú contextual de iOS.
    bindLongPress(row, () => openRowSheet(record));
    row.addEventListener('click', () => navigate(() => showAnalysis(record), 'forward'));
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', gameDisplayTitle(record) + '. Mantén pulsado para ver las opciones');

    frag.appendChild(row);
  });
  libraryListEl.appendChild(frag);
}

// ---------- Mantener pulsado ----------
// Al mantener el dedo, la fila se hunde un poco; al cumplirse el tiempo da
// un pequeño salto y abre lo que toque. Si el dedo se mueve (para desplazar
// la lista) o se suelta antes, no pasa nada y el toque sigue siendo un toque.
function bindLongPress(el, onLongPress) {
  const HOLD_MS = 450;
  const MOVE_TOLERANCE = 8;
  let timer = null, startX = 0, startY = 0, fired = false;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    el.classList.remove('holding');
  };

  // Si saltó la pulsación larga, el toque que la cierra no abre la partida.
  el.addEventListener('click', (e) => {
    if (!fired) return;
    fired = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    el.classList.add('holding');
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      el.classList.remove('holding');
      el.classList.add('held');
      setTimeout(() => el.classList.remove('held'), 180);
      onLongPress();
    }, HOLD_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
}

// ---------- Hoja para añadir partida nueva ----------
const addSheetOverlay = document.getElementById('addSheetOverlay');

let editingGameId = null;

const whiteInput = document.getElementById('whiteInput');
const blackInput = document.getElementById('blackInput');
const eventInput = document.getElementById('eventInput');
const yearInput = document.getElementById('yearInput');
const tagsInput = document.getElementById('tagsInput');
const addSheetTitleEl = document.getElementById('addSheetTitle');
const saveGameBtnEl = document.getElementById('saveGameBtn');

function fillSheet(record) {
  titleInput.value = record ? (record.title || '') : '';
  whiteInput.value = record ? (record.white || '') : '';
  blackInput.value = record ? (record.black || '') : '';
  eventInput.value = record ? (record.event || '') : '';
  yearInput.value  = record ? (record.year || '') : '';
  tagsInput.value  = record ? normalizeTags(record.tags).join(', ') : '';
  pgnInput.value   = record ? (record.pgn || '') : '';
  folderSelectEl.value = record ? (record.folderId || '') : '';
  // Lo ya guardado está normalizado a notación inglesa.
  setPgnLang('en');
}

function readSheet() {
  return {
    title: titleInput.value,
    white: whiteInput.value,
    black: blackInput.value,
    event: eventInput.value,
    year: yearInput.value.replace(/\D/g, '').slice(0, 4),
    tags: tagsInput.value,
    pgn: pgnInput.value,
    folderId: folderSelectEl.value || null
  };
}

// Al pegar un PGN con cabeceras se rellenan los huecos que estén vacíos.
// Nunca pisa lo que ya hayas escrito tú.
// ---------- Idioma de la partida que se pega ----------
const pgnLangSegEl = document.getElementById('pgnLangSeg');
let pgnLang = 'en';

function setPgnLang(lang) {
  pgnLang = lang === 'es' ? 'es' : 'en';
  setSegmented(pgnLangSegEl, b => b.dataset.lang === pgnLang);
}

onSegmented(pgnLangSegEl, btn => setPgnLang(btn.dataset.lang));

function autofillFromPgn() {
  // El selector se coloca solo en lo que parece la partida pegada, pero
  // queda a la vista para corregirlo si se equivoca.
  const tokens = stripPgnDecorations(pgnInput.value)
    .replace(/\d+\s*\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length) setPgnLang(detectNotationLanguage(tokens));

  const md = metadataFromPgn(pgnInput.value);
  if (!md.white && !md.black && !md.event && !md.year) return;
  if (!whiteInput.value.trim()) whiteInput.value = md.white;
  if (!blackInput.value.trim()) blackInput.value = md.black;
  if (!eventInput.value.trim()) eventInput.value = md.event;
  if (!yearInput.value.trim())  yearInput.value  = md.year;
}
pgnInput.addEventListener('input', autofillFromPgn);
pgnInput.addEventListener('paste', () => setTimeout(autofillFromPgn, 0));

function openEditSheet(record) {
  editingGameId = record.id;
  populateFolderSelect();
  fillSheet(record);
  addSheetTitleEl.textContent = 'Editar partida';
  saveGameBtnEl.textContent = 'Guardar cambios';
  setMoreFields(!!(record.event || record.year || record.folderId || normalizeTags(record.tags).length));
  addSheetOverlay.classList.add('open');
}

// El bloque de datos extra empieza plegado: casi siempre basta con
// pegar la partida y ponerle nombre.
const moreFieldsEl = document.getElementById('moreFields');
const moreFieldsBtnEl = document.getElementById('moreFieldsBtn');

function setMoreFields(open) {
  moreFieldsEl.hidden = !open;
  moreFieldsBtnEl.classList.toggle('open', open);
}
moreFieldsBtnEl.addEventListener('click', () => setMoreFields(moreFieldsEl.hidden));

function openAddSheet() {
  editingGameId = null;
  populateFolderSelect();
  fillSheet(null);
  addSheetTitleEl.textContent = 'Nueva partida';
  saveGameBtnEl.textContent = 'Guardar partida';
  // Si estás viendo una carpeta, la partida nueva nace dentro de ella.
  if (activeFolderId !== 'all' && activeFolderId !== 'none') folderSelectEl.value = activeFolderId;
  if (activeTag) tagsInput.value = activeTag;
  setMoreFields(!!(folderSelectEl.value || tagsInput.value));
  addSheetOverlay.classList.add('open');
}
function closeAddSheet() { addSheetOverlay.classList.remove('open'); }

document.getElementById('newGameBtn').addEventListener('click', openAddSheet);
document.getElementById('closeSheetBtn').addEventListener('click', closeAddSheet);
addSheetOverlay.addEventListener('click', (e) => { if (e.target === addSheetOverlay) closeAddSheet(); });

saveGameBtnEl.addEventListener('click', () => {
  if (!pgnInput.value.trim()) return;
  const data = readSheet();
  data.pgn = normalizePgnToStandard(data.pgn, pgnLang);

  if (editingGameId) {
    const updated = updateGameInLibrary(editingGameId, data);
    editingGameId = null;
    closeAddSheet();
    renderFolderChips();
    renderLibraryList();
    return;
  }

  const record = addGameToLibrary(data);
  closeAddSheet();
  renderFolderChips();
  navigate(() => showAnalysis(record), 'forward');
});

// ---------- Hoja de opciones, reutilizable ----------
const rowSheetOverlay = document.getElementById('rowSheetOverlay');
const rowSheetTitleEl = document.getElementById('rowSheetTitle');
const rowSheetActionsEl = document.getElementById('rowSheetActions');

function closeRowSheet() { rowSheetOverlay.classList.remove('open'); }

function openOptionsSheet(title, actions) {
  rowSheetTitleEl.textContent = title;
  rowSheetActionsEl.innerHTML = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sheetAction' + (a.danger ? ' danger' : '');
    btn.textContent = a.label;
    btn.addEventListener('click', () => { closeRowSheet(); a.run(); });
    rowSheetActionsEl.appendChild(btn);
  });
  rowSheetOverlay.classList.add('open');
}

document.getElementById('closeRowSheetBtn').addEventListener('click', closeRowSheet);
rowSheetOverlay.addEventListener('click', (e) => { if (e.target === rowSheetOverlay) closeRowSheet(); });

function openRowSheet(record) {
  openOptionsSheet(gameDisplayTitle(record), [
    { label: 'Editar datos', run: () => openEditSheet(record) },
    { label: 'Eliminar partida', danger: true, run: () => {
        const name = gameDisplayTitle(record);
        if (!confirm(`¿Eliminar "${name}"? Se borran también sus apuntes y ramificaciones.`)) return;
        deleteGameFromLibrary(record.id);
        renderFolderChips();
        renderLibraryList();
      } }
  ]);
}

function openFolderSheet(folder) {
  openOptionsSheet(folder.name, [
    { label: 'Renombrar carpeta', run: () => openRenameFolderSheet(folder) },
    { label: 'Eliminar carpeta', danger: true, run: () => {
        if (!confirm(`¿Eliminar la carpeta "${folder.name}"? Las partidas no se borran, pasan a "Sin carpeta".`)) return;
        deleteFolder(folder.id);
        activeFolderId = 'all';
        renderFolderChips();
        renderLibraryList();
      } }
  ]);
}

// ---------- Buscador y orden ----------
const searchInputEl = document.getElementById('searchInput');
const sortSelectEl = document.getElementById('sortSelect');

const searchClearBtnEl = document.getElementById('searchClearBtn');
const searchStatusEl = document.getElementById('searchStatus');

function refreshSearchUI(resultCount) {
  const active = searchQuery.trim().length > 0;
  searchClearBtnEl.hidden = !active;
  searchStatusEl.hidden = !active;
  if (active) {
    searchStatusEl.textContent = resultCount === 0
      ? 'Sin resultados en toda la biblioteca'
      : `${resultCount} ${resultCount === 1 ? 'partida' : 'partidas'} en toda la biblioteca`;
  }
}

searchInputEl.addEventListener('input', () => {
  searchQuery = searchInputEl.value;
  renderLibraryList(false);
});

searchClearBtnEl.addEventListener('click', () => {
  searchInputEl.value = '';
  searchQuery = '';
  renderLibraryList(false);
  searchInputEl.focus();
});
sortSelectEl.addEventListener('change', () => {
  sortMode = sortSelectEl.value;
  renderLibraryList(false);
});

// ---------- Hoja para crear carpeta nueva ----------
const newFolderSheetOverlay = document.getElementById('newFolderSheetOverlay');
const folderNameInput = document.getElementById('folderNameInput');

let renamingFolderId = null;
const folderSheetTitleEl = document.querySelector('#newFolderSheetCard .sheetHeader h2');
const saveFolderBtnEl = document.getElementById('saveFolderBtn');

function openNewFolderSheet() {
  renamingFolderId = null;
  folderNameInput.value = '';
  if (folderSheetTitleEl) folderSheetTitleEl.textContent = 'Nueva carpeta';
  saveFolderBtnEl.textContent = 'Crear carpeta';
  newFolderSheetOverlay.classList.add('open');
}

function openRenameFolderSheet(folder) {
  renamingFolderId = folder.id;
  folderNameInput.value = folder.name;
  if (folderSheetTitleEl) folderSheetTitleEl.textContent = 'Renombrar carpeta';
  saveFolderBtnEl.textContent = 'Guardar nombre';
  newFolderSheetOverlay.classList.add('open');
}

function closeNewFolderSheet() {
  newFolderSheetOverlay.classList.remove('open');
  renamingFolderId = null;
}

document.getElementById('closeFolderSheetBtn').addEventListener('click', closeNewFolderSheet);
newFolderSheetOverlay.addEventListener('click', (e) => { if (e.target === newFolderSheetOverlay) closeNewFolderSheet(); });

saveFolderBtnEl.addEventListener('click', () => {
  if (!folderNameInput.value.trim()) return;
  if (renamingFolderId) {
    renameFolder(renamingFolderId, folderNameInput.value);
    closeNewFolderSheet();
    renderFolderChips();
    renderLibraryList();
    return;
  }
  const folder = addFolder(folderNameInput.value);
  activeFolderId = folder.id;
  closeNewFolderSheet();
  renderFolderChips();
  renderLibraryList();
});

// ---------- Iconos de los botones (inyectados por JS, nada de emoji) ----------
startBtnEl.innerHTML = iconButton('start');
prevBtnEl.innerHTML = iconButton('prev');
nextBtnEl.innerHTML = iconButton('next');
document.getElementById('newGameBtn').innerHTML = iconButton('add');
document.getElementById('backBtn').innerHTML = iconButton('back');
document.getElementById('newBranchIcon').innerHTML = iconButton('branch');
// Todas las X de cerrar de una vez: si mañana se añade otra hoja,
// su botón recibe el icono sin tener que acordarse de nada.
document.querySelectorAll('[id^="close"].roundBtn').forEach(btn => {
  btn.innerHTML = iconButton('close');
});
document.getElementById('settingsBtn').innerHTML = iconButton('settings');
document.getElementById('settingsBackBtn').innerHTML = iconButton('back');
document.getElementById('syncIcon').innerHTML = iconButton('sync');
document.getElementById('syncCodeIcon').innerHTML = iconButton('key');
document.getElementById('syncLinkIcon').innerHTML = iconButton('link');
document.getElementById('syncCodeChevron').innerHTML = iconButton('chevron');
document.getElementById('syncLinkChevron').innerHTML = iconButton('chevron');
document.getElementById('lookIcon').innerHTML = iconButton('drop');
document.getElementById('themeIcon').innerHTML = iconButton('contrast');
document.getElementById('typeIcon').innerHTML = iconButton('textSize');
document.getElementById('teacherIcon').innerHTML = iconButton('teacher');
document.getElementById('searchIcon').innerHTML = iconButton('search');
document.getElementById('moreFieldsChevron').innerHTML = iconButton('chevron');
document.getElementById('orientIcon').innerHTML = iconButton('flip');
document.getElementById('coordsIcon').innerHTML = iconButton('coords');
document.getElementById('notationIcon').innerHTML = iconButton('piece');
document.getElementById('awakeIcon').innerHTML = iconButton('awake');
document.getElementById('flipBtn').innerHTML = iconButton('flip');
document.getElementById('evalIcon').innerHTML = iconButton('evalBar');
document.getElementById('piecesIcon').innerHTML = iconButton('knight');

// ---------- Controles segmentados ----------
// La opción elegida se marca con una pastilla que se desliza de una a
// otra, en vez de saltar de golpe.
document.querySelectorAll('.segmented').forEach(seg => {
  const thumb = document.createElement('span');
  thumb.className = 'segThumb';
  thumb.setAttribute('aria-hidden', 'true');
  seg.prepend(thumb);
  seg.style.setProperty('--seg-n', seg.querySelectorAll('button').length);
});

function setSegmented(seg, isActive) {
  let index = -1;
  seg.querySelectorAll('button').forEach((b, i) => {
    const on = isActive(b);
    b.classList.toggle('active', on);
    if (on) index = i;
  });
  seg.style.setProperty('--seg-i', Math.max(index, 0));
  seg.classList.toggle('hasActive', index >= 0);
}

// Se elige tocando una opción o arrastrando la pastilla con el dedo, como
// en iOS: la pastilla sigue al dedo y al soltar se queda en la más cercana.
function onSegmented(seg, handler) {
  // El toque que cierra un arrastre no cuenta como otro toque: lo resolvió el arrastre.
  let skipClick = false;
  seg.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    if (skipClick) { skipClick = false; return; }
    handler(btn);
  }));

  const DEAD_ZONE = 6;
  let pointerId = null, startX = 0, dragging = false;
  let buttons = [], segWidth = 0, originX = 0, lastIndex = 0;

  const indexAt = (x) => Math.max(0, Math.min(buttons.length - 1, Math.round(x / segWidth)));

  function finish(commit) {
    if (pointerId === null) return;
    const wasDragging = dragging;
    pointerId = null;
    dragging = false;
    if (!wasDragging) return;
    const thumb = seg.querySelector('.segThumb');
    seg.classList.remove('dragging');
    buttons.forEach(b => b.classList.remove('lit'));
    skipClick = true;
    if (commit) handler(buttons[lastIndex]);
    // Sin el desplazamiento a mano, la pastilla vuelve a su sitio animada.
    if (thumb) thumb.style.translate = '';
  }

  seg.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    buttons = [...seg.querySelectorAll('button')];
    const r = seg.getBoundingClientRect();
    const pad = buttons.length ? buttons[0].getBoundingClientRect().left - r.left : 0;
    segWidth = (r.width - pad * 2) / buttons.length;
    originX = r.left + pad;
    pointerId = e.pointerId;
    startX = e.clientX;
    dragging = false;
    skipClick = false;
  });

  seg.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.abs(e.clientX - startX) < DEAD_ZONE) return;
      dragging = true;
      try { seg.setPointerCapture(pointerId); } catch (err) {}
      seg.classList.add('dragging');
    }
    const x = Math.max(0, Math.min((buttons.length - 1) * segWidth, e.clientX - originX - segWidth / 2));
    const thumb = seg.querySelector('.segThumb');
    if (thumb) thumb.style.translate = x + 'px 0';
    lastIndex = indexAt(x);
    buttons.forEach((b, i) => b.classList.toggle('lit', i === lastIndex));
  });

  seg.addEventListener('pointerup', () => finish(true));
  seg.addEventListener('pointercancel', () => finish(false));
}

// Interruptores: se cambian tocando o arrastrando la bola de un lado a
// otro; al soltar, manda el lado en el que haya quedado.
function bindSwitch(el, isOn, setOn) {
  const knob = el.querySelector('span');
  let skipClick = false;
  el.addEventListener('click', () => {
    if (skipClick) { skipClick = false; return; }
    setOn(!isOn());
  });

  let pointerId = null, startX = 0, dragging = false, base = 0, travel = 0, pos = 0;

  function finish(commit) {
    if (pointerId === null) return;
    const wasDragging = dragging;
    pointerId = null;
    dragging = false;
    if (!wasDragging) return;
    el.classList.remove('dragging');
    knob.style.translate = '';
    skipClick = true;
    const on = pos > travel / 2;
    if (commit && on !== isOn()) setOn(on);
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const padding = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    travel = el.clientWidth - padding * 2 - knob.offsetWidth;
    base = isOn() ? travel : 0;
    pos = base;
    pointerId = e.pointerId;
    startX = e.clientX;
    dragging = false;
    skipClick = false;
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) < 4) return;
      dragging = true;
      try { el.setPointerCapture(pointerId); } catch (err) {}
      el.classList.add('dragging');
    }
    pos = Math.max(0, Math.min(travel, base + dx));
    knob.style.translate = pos + 'px 0';
  });

  el.addEventListener('pointerup', () => finish(true));
  el.addEventListener('pointercancel', () => finish(false));
}

// ============================================================
// APARIENCIA — estética, tema y tamaño del texto
// La escala solo afecta al texto: el tablero se mide en píxeles y
// proporción de pantalla, así que no se deforma al agrandar la letra.
// ============================================================

const THEME_KEY = 'chess-theme';
const LOOK_KEY = 'chess-look';
const TYPE_KEY = 'chess-type-scale';

function readPref(key, fallback) {
  return Store.get(key) || fallback;
}
function writePref(key, value) {
  Store.set(key, value);
}

// Paletas: grises (las cuatro primeras) y tres con algo de color. El tono
// (claro u oscuro) decide el cristal, la barra de estado y demás; los
// colores de cada una están en el CSS. Aquí solo lo necesario para pintar
// la muestra de cada paleta en Ajustes.
const THEMES = [
  { id: 'light',    name: 'Claro',      tone: 'light', bg: '#f4f4f4', card: '#ffffff', sq: ['#e7e7e7', '#b5b5b5'] },
  { id: 'mist',     name: 'Niebla',     tone: 'light', bg: '#e3e3e3', card: '#efefef', sq: ['#e1e1e1', '#a8a8a8'] },
  { id: 'graphite', name: 'Grafito',    tone: 'dark',  bg: '#2a2a2c', card: '#3d3d40', sq: ['#d6d6d6', '#a0a0a0'] },
  { id: 'dark',     name: 'Oscuro',     tone: 'dark',  bg: '#151515', card: '#272727', sq: ['#cfcfcf', '#969696'] },
  { id: 'paper',    name: 'Papel',      tone: 'light', bg: '#f1ece2', card: '#faf7f0', sq: ['#eadbbd', '#bf9f73'] },
  { id: 'navy',     name: 'Azul noche', tone: 'dark',  bg: '#111725', card: '#212a3b', sq: ['#c8d1de', '#7d8ca4'] },
  { id: 'forest',   name: 'Torneo',     tone: 'light', bg: '#eef1ec', card: '#fbfcfa', sq: ['#ebecd0', '#779556'] }
];
const themeSetsEl = document.getElementById('themeSets');

function applyTheme(id) {
  const theme = THEMES.find(t => t.id === id) || THEMES.find(t => t.id === 'dark');
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  root.setAttribute('data-tone', theme.tone);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.bg);
  themeSetsEl.querySelectorAll('.themeSet').forEach(b => {
    const on = b.dataset.theme === theme.id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

THEMES.forEach(theme => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'themeSet';
  btn.dataset.theme = theme.id;
  btn.setAttribute('role', 'radio');
  const swatch = document.createElement('span');
  swatch.className = 'themeSwatch';
  swatch.style.background = theme.bg;
  const card = document.createElement('span');
  card.className = 'themeSwatchCard';
  card.style.background = theme.card;
  swatch.appendChild(card);
  theme.sq.forEach(color => {
    const sq = document.createElement('span');
    sq.className = 'themeSwatchSq';
    sq.style.background = color;
    swatch.appendChild(sq);
  });
  const name = document.createElement('span');
  name.className = 'themeSetName';
  name.textContent = theme.name;
  btn.append(swatch, name);
  btn.addEventListener('click', () => {
    writePref(THEME_KEY, theme.id);
    crossfade(() => applyTheme(theme.id));
  });
  themeSetsEl.appendChild(btn);
});

// Minimal: plano, sin relieves ni sombras. Liquid Glass: los controles
// flotan sobre el contenido como el cristal de iOS 26.
function applyLook(look) {
  const value = look === 'glass' ? 'glass' : 'minimal';
  document.documentElement.setAttribute('data-look', value);
  setSegmented(document.getElementById('lookSeg'), b => b.dataset.look === value);
}

function applyTypeScale(scale) {
  document.documentElement.style.setProperty('--type-scale', scale);
  setSegmented(document.getElementById('typeSeg'), b => b.dataset.scale === scale);
}

onSegmented(document.getElementById('lookSeg'), btn => {
  writePref(LOOK_KEY, btn.dataset.look);
  crossfade(() => applyLook(btn.dataset.look));
});

onSegmented(document.getElementById('typeSeg'), btn => {
  writePref(TYPE_KEY, btn.dataset.scale);
  applyTypeScale(btn.dataset.scale);
});

// ---------- Tablero: orientación y coordenadas ----------
const FLIP_KEY = 'chess-board-flipped';
const COORDS_KEY = 'chess-board-coords';

const flipBtnEl = document.getElementById('flipBtn');
const orientSegEl = document.getElementById('orientSeg');
const coordsToggleEl = document.getElementById('coordsToggle');

function applyBoardFlip(flipped, redraw) {
  boardFlipped = !!flipped;
  flipBtnEl.classList.toggle('active', boardFlipped);
  // En vertical, la parte de las blancas sale del lado donde están ellas.
  evalBarEl.classList.toggle('flipped', boardFlipped);
  setSegmented(orientSegEl, b => (b.dataset.flip === '1') === boardFlipped);
  renderBoardCoordinates();
  if (redraw && gameState) refreshBoardOnly();
}

flipBtnEl.addEventListener('click', () => {
  writePref(FLIP_KEY, boardFlipped ? '0' : '1');
  applyBoardFlip(!boardFlipped, true);
});

onSegmented(orientSegEl, btn => {
  writePref(FLIP_KEY, btn.dataset.flip);
  applyBoardFlip(btn.dataset.flip === '1', true);
});

function applyCoordsVisible(on) {
  document.getElementById('boardFrame').classList.toggle('no-coords', !on);
  coordsToggleEl.classList.toggle('on', on);
  coordsToggleEl.setAttribute('aria-checked', on ? 'true' : 'false');
}

bindSwitch(coordsToggleEl, () => coordsToggleEl.classList.contains('on'), (on) => {
  writePref(COORDS_KEY, on ? '1' : '0');
  applyCoordsVisible(on);
});

applyBoardFlip(readPref(FLIP_KEY, '0') === '1', false);
applyCoordsVisible(readPref(COORDS_KEY, '1') === '1');

// ---------- Diseño de las piezas ----------
// Los dibujos se ponen desde el CSS con el código de cada pieza: cambiar
// de diseño no vuelve a construir el tablero.
const PIECES_KEY = 'chess-piece-set';
const PIECE_SETS = [
  { id: 'cburnett', name: 'Clásicas' },
  { id: 'merida', name: 'Mérida' },
  { id: 'chessnut', name: 'Chessnut' },
  { id: 'papercut', name: 'Papel', gray: true },
  { id: 'kiwen-suwi', name: 'Geométricas' },
  { id: 'fantasy', name: 'Fantasía', gray: true },
  { id: 'glyph', name: 'Tipográficas' }
];
const PIECE_CODES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
const pieceSetsEl = document.getElementById('pieceSets');

function applyPieceSet(id) {
  const set = PIECE_SETS.find(s => s.id === id) || PIECE_SETS[0];
  const root = document.documentElement;
  root.classList.toggle('pieces-image', set.id !== 'glyph');
  // Papel y Fantasía traen algo de color: se pasan a gris como el resto.
  root.classList.toggle('pieces-gray', !!set.gray);
  PIECE_CODES.forEach(code => root.style.setProperty('--piece-' + code,
    set.id === 'glyph' ? 'none' : `url("pieces/${set.id}/${code}.svg")`));
  pieceSetsEl.querySelectorAll('.pieceSet').forEach(b => {
    const on = b.dataset.set === set.id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

// Cada opción enseña su caballo blanco y su caballo negro, cada uno en su casilla.
PIECE_SETS.forEach(set => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pieceSet' + (set.gray ? ' gray' : '');
  btn.dataset.set = set.id;
  btn.setAttribute('role', 'radio');
  const tile = document.createElement('span');
  tile.className = 'pieceSetTile';
  ['w', 'b'].forEach(color => {
    const sq = document.createElement('span');
    sq.className = 'pieceSetSq ' + (color === 'w' ? 'light' : 'dark');
    if (set.id === 'glyph') {
      sq.appendChild(createPieceEl(color, 'N'));
    } else {
      const img = document.createElement('span');
      img.className = 'pieceSetImg';
      img.style.backgroundImage = `url("pieces/${set.id}/${color}N.svg")`;
      sq.appendChild(img);
    }
    tile.appendChild(sq);
  });
  const name = document.createElement('span');
  name.className = 'pieceSetName';
  name.textContent = set.name;
  btn.append(tile, name);
  btn.addEventListener('click', () => {
    writePref(PIECES_KEY, set.id);
    applyPieceSet(set.id);
  });
  pieceSetsEl.appendChild(btn);
});

applyPieceSet(readPref(PIECES_KEY, 'cburnett'));

// ---------- Barra de ventaja: encendida o apagada ----------
const EVAL_KEY = 'chess-eval-bar';
const evalToggleEl = document.getElementById('evalToggle');

function applyEvalBar(on) {
  evalEnabled = on;
  evalToggleEl.classList.toggle('on', on);
  evalToggleEl.setAttribute('aria-checked', on ? 'true' : 'false');
  evalBarEl.hidden = !on || !Engine.available();
  if (on) updateEval(false); else stopEval();
}

bindSwitch(evalToggleEl, () => evalEnabled, (on) => {
  writePref(EVAL_KEY, on ? '1' : '0');
  applyEvalBar(on);
});

applyEvalBar(readPref(EVAL_KEY, '1') === '1');

// Con la app en segundo plano el motor no piensa: ahorra batería.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopEval();
  else updateEval(false);
});

// ---------- Idioma de la notación en pantalla ----------
const NOTATION_KEY = 'chess-notation-lang';
const notationSegEl = document.getElementById('notationSeg');

function applyNotationLang(lang, redraw) {
  notationLang = lang === 'en' ? 'en' : 'es';
  setSegmented(notationSegEl, b => b.dataset.lang === notationLang);
  if (redraw && gameState) {
    buildMoveStrip();
    goToPly(currentPly);
  }
}

onSegmented(notationSegEl, btn => {
  writePref(NOTATION_KEY, btn.dataset.lang);
  applyNotationLang(btn.dataset.lang, true);
});

applyNotationLang(readPref(NOTATION_KEY, 'es'), false);

// ---------- Mantener la pantalla encendida durante la clase ----------
const AWAKE_KEY = 'chess-keep-awake';
const awakeToggleEl = document.getElementById('awakeToggle');
let wakeLock = null;
let keepAwake = false;

async function acquireWakeLock() {
  if (!keepAwake || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { /* el sistema puede negarlo; no es crítico */ }
}

function releaseWakeLock() {
  if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
}

// iOS suelta el bloqueo al cambiar de app: se vuelve a pedir al volver.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquireWakeLock();
});

function applyKeepAwake(on) {
  keepAwake = on;
  awakeToggleEl.classList.toggle('on', on);
  awakeToggleEl.setAttribute('aria-checked', on ? 'true' : 'false');
  if (on) acquireWakeLock(); else releaseWakeLock();
}

bindSwitch(awakeToggleEl, () => keepAwake, (on) => {
  writePref(AWAKE_KEY, on ? '1' : '0');
  applyKeepAwake(on);
});

applyKeepAwake(readPref(AWAKE_KEY, '0') === '1');

// ---------- Flechas del teclado, por si hay teclado conectado ----------
document.addEventListener('keydown', (e) => {
  if (analysisView.hidden) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); stepForward(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); stepBackward(); }
});

// ---------- Modo profesor ----------
const TEACHER_KEY = 'chess-teacher-mode';
let teacherMode = readPref(TEACHER_KEY, '0') === '1';

const teacherToggleEl = document.getElementById('teacherToggle');

function applyTeacherMode(on) {
  teacherMode = on;
  teacherToggleEl.classList.toggle('on', on);
  teacherToggleEl.setAttribute('aria-checked', on ? 'true' : 'false');
  // Si se activa estando dentro de una rama en edición, se cierra la
  // edición: en clase el tablero no debe quedar tocable.
  if (on && branchEditMode) {
    branchEditMode = false;
    selectedSquare = null;
    legalDestinations = [];
    applyBranchModeUI();
    refreshBoardOnly();
    renderStatus();
  }
  if (currentLibraryRecord && !analysisView.hidden) renderBranchAction();
}

bindSwitch(teacherToggleEl, () => teacherMode, (on) => {
  writePref(TEACHER_KEY, on ? '1' : '0');
  applyTeacherMode(on);
});

applyTeacherMode(teacherMode);

applyTheme(readPref(THEME_KEY, 'dark'));
applyLook(readPref(LOOK_KEY, 'minimal'));
applyTypeScale(readPref(TYPE_KEY, '1'));

// ---------- Nada seleccionable fuera de los campos de texto ----------
// Al mantener pulsado un botón, iOS intentaba iniciar una selección
// de texto o abrir el menú de copiar. Se corta en el propio evento
// (y en el CSS, que además lo prohíbe en todos los botones).
function isTextField(node) {
  return node && node.closest && node.closest('textarea, input');
}
document.addEventListener('selectstart', (e) => {
  if (!isTextField(e.target)) e.preventDefault();
});
document.addEventListener('contextmenu', (e) => {
  if (!isTextField(e.target)) e.preventDefault();
});
// Sin un oyente de toque, Safari en iOS no aplica :active a los botones.
document.addEventListener('touchstart', () => {}, { passive: true });

// ============================================================
// LIQUID GLASS — respuesta al tacto
// En la estética de cristal, lo que se pulsa crece un poco con un
// rebote elástico y se ilumina desde el punto donde está el dedo. En
// los grupos (cabecera, flechas) reacciona el grupo entero, como en iOS.
// ============================================================
const GLASS_GROUPS = '.controlsGroup, .headerActions';
const GLASS_SINGLE = '.roundBtn, .branchCreateBtn, .primaryBtn, .switch, .segmented, ' +
                     '.folderChip, .sheetAction, .promoBtn, .branchActionBtn, .branchPill';
let glassPressed = null;

function releaseGlass() {
  if (glassPressed) {
    glassPressed.classList.remove('lg-press');
    // Suelto, el cristal vuelve a su sitio con su rebote.
    glassPressed.style.removeProperty('--lg-dx');
    glassPressed.style.removeProperty('--lg-dy');
  }
  glassPressed = null;
}

// La luz va donde está el dedo, y mientras se mantiene pulsado le sigue.
// El cristal además se deja llevar unos píxeles hacia él, como un gel.
// Las medidas se pasan a la escala del control, que crece al pulsarlo.
function followFinger(el, e) {
  const r = el.getBoundingClientRect();
  const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
  const x = (e.clientX - r.left) / scale;
  const y = (e.clientY - r.top) / scale;
  el.style.setProperty('--lg-x', x + 'px');
  el.style.setProperty('--lg-y', y + 'px');
  const pull = (v, size) => size ? Math.max(-4, Math.min(4, (v / size - 0.5) * 8)) : 0;
  el.style.setProperty('--lg-dx', pull(x, el.offsetWidth) + 'px');
  el.style.setProperty('--lg-dy', pull(y, el.offsetHeight) + 'px');
}

document.addEventListener('pointerdown', (e) => {
  if (document.documentElement.dataset.look !== 'glass' || !e.target.closest) return;
  const el = e.target.closest(GLASS_GROUPS) || e.target.closest(GLASS_SINGLE);
  if (!el || el.disabled) return;
  releaseGlass();
  followFinger(el, e);
  el.classList.add('lg-press');
  glassPressed = el;
}, { passive: true });
document.addEventListener('pointermove', (e) => {
  if (glassPressed) followFinger(glassPressed, e);
}, { passive: true });
document.addEventListener('pointerup', releaseGlass, { passive: true });
document.addEventListener('pointercancel', releaseGlass, { passive: true });

// ============================================================
// NUBE — guardado automático y código para vincular dispositivos
// ============================================================
const syncStatusLabelEl = document.getElementById('syncStatusLabel');
const syncCodeBtnEl = document.getElementById('syncCodeBtn');
const syncLinkBtnEl = document.getElementById('syncLinkBtn');

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return formatDate(ts);
}

const SYNC_TEXTS = {
  off: 'Solo en este dispositivo: falta configurar el servidor',
  idle: 'Conectando…',
  syncing: 'Guardando…',
  offline: 'Sin conexión. Se guardará al volver',
  error: 'No se pudo conectar. Se reintentará solo',
  unlinked: 'Este dispositivo no está vinculado',
  full: 'Vincula este dispositivo con tu código'
};

function renderSyncStatus() {
  const status = Store.status();
  const last = Store.lastSync();
  syncStatusLabelEl.textContent = (status === 'ok' || ((status === 'idle' || status === 'syncing') && last))
    ? `En la nube · ${timeAgo(last)}`
    : SYNC_TEXTS[status] || '';
  syncCodeBtnEl.hidden = !Store.configured() || !Store.token();
  syncLinkBtnEl.hidden = !Store.configured();
}
Store.onStatus(renderSyncStatus);
document.getElementById('syncNowBtn').addEventListener('click', () => Store.sync());

// ---------- Hoja del código ----------
const syncSheetOverlay = document.getElementById('syncSheetOverlay');
const syncSheetTitleEl = document.getElementById('syncSheetTitle');
const syncSheetHintEl = document.getElementById('syncSheetHint');
const syncCodeInputEl = document.getElementById('syncCodeInput');
const syncSheetErrorEl = document.getElementById('syncSheetError');
const syncSheetBtnEl = document.getElementById('syncSheetBtn');
let syncSheetMode = 'show';

function formatCode(token) {
  return (token.match(/.{1,4}/g) || []).join(' ');
}

function openSyncSheet(mode) {
  syncSheetMode = mode;
  syncSheetErrorEl.textContent = '';
  syncSheetBtnEl.disabled = false;
  if (mode === 'show') {
    syncSheetTitleEl.textContent = 'Código de sincronización';
    syncSheetHintEl.textContent = 'Escríbelo en otro dispositivo para tener allí tus partidas. ' +
      'Guárdalo en un sitio seguro: si borras la app, con él lo recuperas todo.';
    syncCodeInputEl.value = formatCode(Store.token() || '');
    syncCodeInputEl.readOnly = true;
    syncCodeInputEl.placeholder = '';
    syncSheetBtnEl.textContent = 'Copiar código';
  } else {
    syncSheetTitleEl.textContent = 'Vincular con otro dispositivo';
    syncSheetHintEl.textContent = 'Escribe el código que sale en Ajustes del otro dispositivo. ' +
      'Las partidas de aquí se juntarán con las de allí.';
    syncCodeInputEl.value = '';
    syncCodeInputEl.readOnly = false;
    syncCodeInputEl.placeholder = 'abcd efgh jkmn …';
    syncSheetBtnEl.textContent = 'Vincular';
  }
  syncSheetOverlay.classList.add('open');
}

function closeSyncSheet() { syncSheetOverlay.classList.remove('open'); }

syncCodeBtnEl.addEventListener('click', () => openSyncSheet('show'));
syncLinkBtnEl.addEventListener('click', () => openSyncSheet('link'));
document.getElementById('closeSyncSheetBtn').addEventListener('click', closeSyncSheet);
syncSheetOverlay.addEventListener('click', (e) => { if (e.target === syncSheetOverlay) closeSyncSheet(); });

syncSheetBtnEl.addEventListener('click', async () => {
  if (syncSheetMode === 'show') {
    try {
      await navigator.clipboard.writeText(formatCode(Store.token() || ''));
      syncSheetBtnEl.textContent = 'Copiado';
    } catch (e) {
      syncCodeInputEl.select();
    }
    return;
  }
  syncSheetBtnEl.disabled = true;
  syncSheetBtnEl.textContent = 'Vinculando…';
  const result = await Store.link(syncCodeInputEl.value);
  syncSheetBtnEl.disabled = false;
  syncSheetBtnEl.textContent = 'Vincular';
  if (result === 'ok') {
    closeSyncSheet();
    renderSyncStatus();
    return;
  }
  syncSheetErrorEl.textContent = result === 'invalid'
    ? 'Ese código no existe. Revísalo.'
    : 'No se pudo conectar. Inténtalo de nuevo.';
});

// ---------- Cambios que llegan de otro dispositivo ----------
// Se refresca solo lo que está a la vista y le afecta. Lo que se está
// escribiendo en ese momento nunca se pisa.
Store.onRemoteChange(keys => {
  const id = currentLibraryRecord ? currentLibraryRecord.id : null;
  let library = false, folders = false, current = false, notes = false, branches = false;
  keys.forEach(k => {
    if (k.startsWith(GAME_PREFIX)) {
      library = true;
      if (id && k === GAME_PREFIX + id) current = true;
    } else if (k === FOLDERS_KEY) folders = true;
    else if (k.startsWith('chess-notes:')) notes = true;
    else if (id && k === branchesKey(id)) branches = true;
  });
  if (library) libraryCache = null;

  if (!homeView.hidden && (library || folders)) {
    renderFolderChips();
    renderLibraryList(false);
  }
  if (analysisView.hidden || !id) return;
  if (current) {
    const record = findGame(id);
    if (!record) { showHome(); return; }
    currentLibraryRecord = record;
    gameTitleLabelEl.textContent = gameDisplayTitle(record);
  }
  if (notes) {
    refreshNotedPlies();
    updateMoveStripActive();
    if (document.activeElement !== notesArea) renderNotesForCurrentPly();
  }
  if (branches && !branchEditMode) renderBranchAction();
});

// ============================================================
// VOLVER ATRÁS DESLIZANDO DESDE EL BORDE
// Como en cualquier app de iPad: se arrastra desde el borde
// izquierdo y la pantalla acompaña al dedo. Si se pasa de la
// mitad del recorrido, se vuelve; si no, se queda donde estaba.
// ============================================================
(function enableEdgeSwipeBack() {
  const EDGE = 26;       // desde dónde cuenta como gesto de borde
  const TRIGGER = 72;    // cuánto hay que arrastrar para volver
  const MAX = 260;
  let startX = 0, startY = 0, tracking = false, engaged = false, view = null, busy = false;

  function currentBackAction() {
    if (!settingsView.hidden) return { el: settingsView, go: showHome };
    if (!analysisView.hidden) {
      // Dentro de una ramificación, el paso atrás natural es la partida.
      if (viewingBranch) return { el: analysisView, go: exitToMainLine };
      return { el: analysisView, go: showHome };
    }
    return null;
  }

  function clearStyles(el) {
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
  }

  function snapBack() {
    const el = view;
    tracking = engaged = false;
    view = null;
    if (!el) return;
    el.style.transition = 'transform .26s cubic-bezier(.22,.61,.36,1)';
    el.style.transform = '';
    setTimeout(() => clearStyles(el), 280);
  }

  document.addEventListener('pointerdown', (e) => {
    if (busy || e.clientX > EDGE) return;
    // Editando una ramificación se tocan casillas pegadas al borde:
    // el gesto no debe robarle el toque al tablero.
    if (branchEditMode) return;
    // La tira de notación se desplaza sola en horizontal.
    if (e.target.closest && e.target.closest('#moveStrip')) return;
    if (document.querySelector('.sheetOverlay.open, #promotionOverlay.open')) return;
    const action = currentBackAction();
    if (!action) return;
    startX = e.clientX; startY = e.clientY;
    tracking = true; engaged = false; view = action.el;
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!engaged) {
      // Solo se engancha si el gesto es claramente horizontal.
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { snapBack(); return; }
      if (dx < 10) return;
      engaged = true;
      view.style.transition = '';
    }
    if (dx <= 0) { view.style.transform = ''; return; }
    // Resistencia al final del recorrido, para que no se sienta un tirón.
    const eased = dx > MAX ? MAX + (dx - MAX) * 0.2 : dx;
    view.style.transform = `translateX(${eased}px)`;
  }, true);

  document.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    const dx = (e.clientX || 0) - startX;
    const action = currentBackAction();

    if (engaged && dx >= TRIGGER && action) {
      // La pantalla termina de salir y solo entonces se navega: así el
      // cambio no da un salto, sigue el movimiento del dedo.
      const el = view;
      tracking = engaged = false; view = null; busy = true;
      el.style.transition = 'transform .2s cubic-bezier(.3,.7,.4,1)';
      el.style.transform = 'translateX(100%)';
      setTimeout(() => {
        clearStyles(el);
        document.body.classList.add('nav-back');
        action.go();
        setTimeout(() => { document.body.classList.remove('nav-back'); busy = false; }, 320);
      }, 200);
      return;
    }
    snapBack();
  }, true);

  document.addEventListener('pointercancel', snapBack, true);
})();

// ---------- Registro del Service Worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW no registrado:', err));
  });
}

// ---------- Aviso para abrirla a pantalla completa ----------
// Abierta desde el icono de la pantalla de inicio, la app ocupa toda la
// pantalla y solo se ve la barra de estado. Una web no puede quitar las
// barras de Safari por su cuenta, así que si se abre dentro de Safari en
// un iPhone o iPad se explica cómo instalarla.
const INSTALL_HINT_KEY = 'chess-install-hint-closed';
(function setupInstallHint() {
  const hint = document.getElementById('installHint');
  const standalone = navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches;
  // El iPad se presenta como un Mac, pero con pantalla táctil.
  const ua = navigator.userAgent;
  const appleTouch = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (standalone || !appleTouch || readPref(INSTALL_HINT_KEY, '') === '1') return;
  document.getElementById('installHintIcon').innerHTML = iconButton('share');
  const closeBtn = document.getElementById('installHintClose');
  closeBtn.innerHTML = iconButton('close');
  closeBtn.addEventListener('click', () => {
    hint.hidden = true;
    writePref(INSTALL_HINT_KEY, '1');
  });
  hint.hidden = false;
})();

// ---------- Arranque ----------
ensureLibrarySeeded();
showHome();
renderSyncStatus();
Store.sync();
