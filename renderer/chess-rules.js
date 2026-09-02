// The rules of chess, complete and pure. Both halves of Keep Chess lean on
// this one file: the board in the commit overlay uses it to offer only legal
// moves, and the game repository's Action uses a vendored copy of it to be
// the referee, so a hand-crafted issue can never smuggle in an illegal move.
// It knows nothing about Keep, GitHub or the DOM, which is what lets the
// tests prove it against the standard perft node counts instead of trusting
// it by eye.
//
// Positions travel as FEN, moves travel as UCI ("e2e4", "e7e8q"), and SAN is
// generated only for humans: commit messages, the move list, the README.
//
// The board lives in a 128-slot array using 0x88 indexing: square = rank * 16
// + file, and the top bit of an off-board index is always set, so "did this
// ray leave the board" is a single mask instead of separate file and rank
// arithmetic. White pieces are 'PNBRQK', black are lowercase, empty is null.

const FILES = 'abcdefgh';

const square = (file, rank) => rank * 16 + file;
const fileOf = (sq) => sq & 15;
const rankOf = (sq) => sq >> 4;
const onBoard = (sq) => (sq & 0x88) === 0;

export const algebraic = (sq) => FILES[fileOf(sq)] + (rankOf(sq) + 1);

const isWhitePiece = (p) => p >= 'A' && p <= 'Z';

const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
const BISHOP_OFFSETS = [17, 15, -17, -15];
const ROOK_OFFSETS = [16, -16, 1, -1];
const ROYAL_OFFSETS = [...BISHOP_OFFSETS, ...ROOK_OFFSETS];

export function parseFen(fen) {
  const parts = String(fen || '').trim().split(/\s+/);
  if (parts.length !== 6) throw new Error(`FEN needs 6 fields, got ${parts.length}`);
  const [placement, turn, castling, ep, halfmove, fullmove] = parts;

  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error('FEN board needs 8 ranks');
  const board = new Array(128).fill(null);
  for (let rank = 7; rank >= 0; rank--) {
    const row = rows[7 - rank];
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else if ('pnbrqkPNBRQK'.includes(ch)) {
        if (file > 7) throw new Error(`FEN rank overflows: ${row}`);
        board[square(file, rank)] = ch;
        file += 1;
      } else {
        throw new Error(`FEN has an unknown piece: ${ch}`);
      }
    }
    if (file !== 8) throw new Error(`FEN rank is not 8 files wide: ${row}`);
  }

  if (turn !== 'w' && turn !== 'b') throw new Error(`FEN turn must be w or b, got ${turn}`);
  return {
    board,
    turn,
    castling: {
      K: castling.includes('K'),
      Q: castling.includes('Q'),
      k: castling.includes('k'),
      q: castling.includes('q'),
    },
    ep: ep === '-' ? -1 : square(FILES.indexOf(ep[0]), Number(ep[1]) - 1),
    halfmove: Number(halfmove),
    fullmove: Number(fullmove),
  };
}

export function toFen(state) {
  const rows = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = state.board[square(file, rank)];
      if (!piece) {
        empty += 1;
      } else {
        if (empty) row += empty;
        empty = 0;
        row += piece;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const castling =
    (state.castling.K ? 'K' : '') +
    (state.castling.Q ? 'Q' : '') +
    (state.castling.k ? 'k' : '') +
    (state.castling.q ? 'q' : '');
  return [
    rows.join('/'),
    state.turn,
    castling || '-',
    state.ep === -1 ? '-' : algebraic(state.ep),
    state.halfmove,
    state.fullmove,
  ].join(' ');
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const initialState = () => parseFen(START_FEN);

// Repetition and the tally compare positions, not games, so the key drops the
// two clocks: the same pieces with the same rights and the same side to move
// are the same position no matter how long it took to get there.
export const positionKey = (state) => toFen(state).split(' ').slice(0, 4).join(' ');

function kingSquare(board, white) {
  const king = white ? 'K' : 'k';
  for (let sq = 0; sq < 128; sq++) {
    if (onBoard(sq) && board[sq] === king) return sq;
  }
  return -1;
}

// Is this square attacked by the given side? Scans outward from the square
// instead of generating the attacker's moves, which keeps legality filtering
// cheap enough for the perft tests to run the full standard suite.
export function attacked(board, target, byWhite) {
  const pawn = byWhite ? 'P' : 'p';
  for (const offset of byWhite ? [-15, -17] : [15, 17]) {
    const from = target + offset;
    if (onBoard(from) && board[from] === pawn) return true;
  }

  const knight = byWhite ? 'N' : 'n';
  for (const offset of KNIGHT_OFFSETS) {
    const from = target + offset;
    if (onBoard(from) && board[from] === knight) return true;
  }

  const king = byWhite ? 'K' : 'k';
  for (const offset of ROYAL_OFFSETS) {
    const from = target + offset;
    if (onBoard(from) && board[from] === king) return true;
  }

  const lines = [
    [BISHOP_OFFSETS, byWhite ? 'BQ' : 'bq'],
    [ROOK_OFFSETS, byWhite ? 'RQ' : 'rq'],
  ];
  for (const [offsets, sliders] of lines) {
    for (const offset of offsets) {
      let from = target + offset;
      while (onBoard(from)) {
        const piece = board[from];
        if (piece) {
          if (sliders.includes(piece)) return true;
          break;
        }
        from += offset;
      }
    }
  }
  return false;
}

export const inCheck = (state) =>
  attacked(state.board, kingSquare(state.board, state.turn === 'w'), state.turn === 'b');

// Moves are {from, to, promo?} in 0x88 squares, promo one of 'qrbn'.
export const uciForMove = (move) =>
  algebraic(move.from) + algebraic(move.to) + (move.promo || '');

function pseudoMoves(state) {
  const { board, turn, castling, ep } = state;
  const white = turn === 'w';
  const moves = [];
  const push = (from, to) => moves.push({ from, to });

  for (let from = 0; from < 128; from++) {
    if (!onBoard(from)) continue;
    const piece = board[from];
    if (!piece || isWhitePiece(piece) !== white) continue;
    const kind = piece.toUpperCase();

    if (kind === 'P') {
      const forward = white ? 16 : -16;
      const startRank = white ? 1 : 6;
      const lastRank = white ? 7 : 0;
      const pushPawn = (from, to) => {
        // A pawn reaching the last rank must become something else; the four
        // choices are four distinct moves so legality is checked per piece.
        if (rankOf(to) === lastRank) {
          for (const promo of ['q', 'r', 'b', 'n']) moves.push({ from, to, promo });
        } else {
          moves.push({ from, to });
        }
      };
      const oneAhead = from + forward;
      if (onBoard(oneAhead) && !board[oneAhead]) {
        pushPawn(from, oneAhead);
        const twoAhead = from + 2 * forward;
        if (rankOf(from) === startRank && !board[twoAhead]) push(from, twoAhead);
      }
      for (const offset of white ? [15, 17] : [-15, -17]) {
        const to = from + offset;
        if (!onBoard(to)) continue;
        const captured = board[to];
        if (captured && isWhitePiece(captured) !== white) pushPawn(from, to);
        else if (to === ep) push(from, to);
      }
      continue;
    }

    if (kind === 'N' || kind === 'K') {
      for (const offset of kind === 'N' ? KNIGHT_OFFSETS : ROYAL_OFFSETS) {
        const to = from + offset;
        if (!onBoard(to)) continue;
        const captured = board[to];
        if (!captured || isWhitePiece(captured) !== white) push(from, to);
      }
      continue;
    }

    const offsets =
      kind === 'B' ? BISHOP_OFFSETS : kind === 'R' ? ROOK_OFFSETS : ROYAL_OFFSETS;
    for (const offset of offsets) {
      let to = from + offset;
      while (onBoard(to)) {
        const captured = board[to];
        if (!captured) {
          push(from, to);
        } else {
          if (isWhitePiece(captured) !== white) push(from, to);
          break;
        }
        to += offset;
      }
    }
  }

  // Castling: rights intact, the lane empty, and the king neither in check
  // nor crossing an attacked square. The rook's own path can be attacked,
  // only the king's three squares matter (b1 merely has to be empty).
  const home = white ? 0 : 7;
  const kingFrom = square(4, home);
  const rights = white ? ['K', 'Q'] : ['k', 'q'];
  const sides = [
    { right: rights[0], empty: [5, 6], safe: [4, 5, 6], to: 6 },
    { right: rights[1], empty: [1, 2, 3], safe: [4, 3, 2], to: 2 },
  ];
  for (const side of sides) {
    if (!castling[side.right]) continue;
    // A hand-written FEN can claim rights the pieces no longer back up.
    if (board[kingFrom] !== (white ? 'K' : 'k')) continue;
    if (board[square(side.to === 6 ? 7 : 0, home)] !== (white ? 'R' : 'r')) continue;
    if (side.empty.some((file) => board[square(file, home)])) continue;
    if (side.safe.some((file) => attacked(board, square(file, home), !white))) continue;
    push(kingFrom, square(side.to, home));
  }

  return moves;
}

export function applyMove(state, move) {
  const board = state.board.slice();
  const white = state.turn === 'w';
  const piece = board[move.from];
  const kind = piece.toUpperCase();
  const captured = board[move.to];

  board[move.to] = move.promo ? (white ? move.promo.toUpperCase() : move.promo) : piece;
  board[move.from] = null;

  let ep = -1;
  if (kind === 'P') {
    if (move.to === state.ep) board[move.to + (white ? -16 : 16)] = null;
    if (Math.abs(move.to - move.from) === 32) ep = (move.from + move.to) / 2;
  }

  if (kind === 'K' && Math.abs(move.to - move.from) === 2) {
    const home = rankOf(move.from);
    const kingSide = move.to > move.from;
    board[square(kingSide ? 5 : 3, home)] = board[square(kingSide ? 7 : 0, home)];
    board[square(kingSide ? 7 : 0, home)] = null;
  }

  // Rights die with the king's first move, with a rook leaving its corner,
  // and with a rook being captured in it. Checking both ends of the move
  // covers all three without caring which one happened.
  const castling = { ...state.castling };
  if (kind === 'K') {
    if (white) castling.K = castling.Q = false;
    else castling.k = castling.q = false;
  }
  for (const end of [move.from, move.to]) {
    if (end === square(0, 0)) castling.Q = false;
    if (end === square(7, 0)) castling.K = false;
    if (end === square(0, 7)) castling.q = false;
    if (end === square(7, 7)) castling.k = false;
  }

  return {
    board,
    turn: white ? 'b' : 'w',
    castling,
    ep,
    halfmove: kind === 'P' || captured ? 0 : state.halfmove + 1,
    fullmove: state.fullmove + (white ? 0 : 1),
  };
}

export function legalMoves(state) {
  const white = state.turn === 'w';
  return pseudoMoves(state).filter((move) => {
    const next = applyMove(state, move);
    return !attacked(next.board, kingSquare(next.board, white), !white);
  });
}

export function moveFromUci(state, uci) {
  const text = String(uci || '').trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)) return null;
  return (
    legalMoves(state).find((move) => uciForMove(move) === text) || null
  );
}

// SAN exists purely for the humans reading the scoresheet, so it follows the
// book: piece letter, the smallest disambiguator that works (file first, then
// rank, then both), x for captures with the pawn's file spelled out, =Q for
// promotions, O-O for castling, and + or # from the answering position.
export function san(state, move) {
  const piece = state.board[move.from];
  const kind = piece.toUpperCase();
  const after = applyMove(state, move);
  const suffix = !legalMoves(after).length && inCheck(after) ? '#' : inCheck(after) ? '+' : '';

  if (kind === 'K' && Math.abs(move.to - move.from) === 2) {
    return (move.to > move.from ? 'O-O' : 'O-O-O') + suffix;
  }

  const capture = state.board[move.to] || (kind === 'P' && move.to === state.ep);
  let text = '';
  if (kind === 'P') {
    if (capture) text = FILES[fileOf(move.from)] + 'x';
  } else {
    const rivals = legalMoves(state).filter(
      (other) =>
        other.to === move.to &&
        other.from !== move.from &&
        state.board[other.from] === piece
    );
    let clarify = '';
    if (rivals.length) {
      const sameFile = rivals.some((other) => fileOf(other.from) === fileOf(move.from));
      const sameRank = rivals.some((other) => rankOf(other.from) === rankOf(move.from));
      if (!sameFile) clarify = FILES[fileOf(move.from)];
      else if (!sameRank) clarify = String(rankOf(move.from) + 1);
      else clarify = algebraic(move.from);
    }
    text = kind + clarify + (capture ? 'x' : '');
  }
  return text + algebraic(move.to) + (move.promo ? '=' + move.promo.toUpperCase() : '') + suffix;
}

// The verdict on a position. priorKeys are the positionKeys of every earlier
// position in the game; the current one is counted here, so two earlier
// appearances mean this is the third.
export function outcome(state, priorKeys = []) {
  if (!legalMoves(state).length) {
    if (inCheck(state)) {
      return { status: 'checkmate', winner: state.turn === 'w' ? 'black' : 'white' };
    }
    return { status: 'stalemate' };
  }
  if (state.halfmove >= 100) return { status: 'fifty-move' };

  const key = positionKey(state);
  if (priorKeys.filter((prior) => prior === key).length >= 2) {
    return { status: 'threefold' };
  }

  // Insufficient material: bare kings, one minor piece, or bishops that all
  // live on the same color. Anything with a pawn, rook or queen can mate.
  const minors = [];
  let heavy = false;
  for (let sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) continue;
    const piece = state.board[sq];
    if (!piece) continue;
    const kind = piece.toUpperCase();
    if (kind === 'K') continue;
    if (kind === 'N' || kind === 'B') minors.push({ kind, color: (fileOf(sq) + rankOf(sq)) % 2 });
    else heavy = true;
  }
  if (!heavy) {
    if (minors.length <= 1) return { status: 'insufficient' };
    if (
      minors.every((minor) => minor.kind === 'B') &&
      minors.every((minor) => minor.color === minors[0].color)
    ) {
      return { status: 'insufficient' };
    }
  }

  return { status: 'playing' };
}
