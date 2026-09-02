// chess-rules.js is the referee for Keep Chess: the overlay offers only what
// it allows, and the game repository's Action replays the same checks before
// a move becomes a commit. A wrong move generator would quietly corrupt the
// world's shared game, so the generator is not spot-checked but proven: perft
// counts the legal-move tree from positions chosen by the engine-testing
// community precisely because they trip castling, en passant, promotion and
// pin bugs, and a single missed or invented move changes the totals.
import test from 'node:test';
import assert from 'node:assert';
import { loadEsm } from './helpers/esm.mjs';

const C = await loadEsm('renderer/chess-rules.js');

function perft(state, depth) {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of C.legalMoves(state)) {
    nodes += perft(C.applyMove(state, move), depth - 1);
  }
  return nodes;
}

const play = (state, ...ucis) =>
  ucis.reduce((s, uci) => {
    const move = C.moveFromUci(s, uci);
    assert.ok(move, `${uci} should be legal in ${C.toFen(s)}`);
    return C.applyMove(s, move);
  }, state);

// ── perft: the move generator against the community's node counts ──

test('perft: the initial position', () => {
  const state = C.initialState();
  assert.strictEqual(perft(state, 1), 20);
  assert.strictEqual(perft(state, 2), 400);
  assert.strictEqual(perft(state, 3), 8902);
  assert.strictEqual(perft(state, 4), 197281);
});

test('perft: kiwipete, the castling and pin torture position', () => {
  const state = C.parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.strictEqual(perft(state, 1), 48);
  assert.strictEqual(perft(state, 2), 2039);
  assert.strictEqual(perft(state, 3), 97862);
});

test('perft: the en passant pin endgame', () => {
  const state = C.parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.strictEqual(perft(state, 1), 14);
  assert.strictEqual(perft(state, 2), 191);
  assert.strictEqual(perft(state, 3), 2812);
  assert.strictEqual(perft(state, 4), 43238);
});

test('perft: the promotion-heavy position', () => {
  const state = C.parseFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
  assert.strictEqual(perft(state, 1), 6);
  assert.strictEqual(perft(state, 2), 264);
  assert.strictEqual(perft(state, 3), 9467);
});

test('perft: the buggy-engine catcher', () => {
  const state = C.parseFen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8');
  assert.strictEqual(perft(state, 1), 44);
  assert.strictEqual(perft(state, 2), 1486);
  assert.strictEqual(perft(state, 3), 62379);
});

test('perft: a quiet middlegame', () => {
  const state = C.parseFen('r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10');
  assert.strictEqual(perft(state, 1), 46);
  assert.strictEqual(perft(state, 2), 2079);
  assert.strictEqual(perft(state, 3), 89890);
});

// ── FEN ──

test('fen: parse and unparse round-trip exactly', () => {
  for (const fen of [
    C.START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 b - - 12 34',
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  ]) {
    assert.strictEqual(C.toFen(C.parseFen(fen)), fen);
  }
});

test('fen: garbage is refused, not absorbed', () => {
  assert.throws(() => C.parseFen('not a position'));
  assert.throws(() => C.parseFen('8/8/8/8/8/8/8 w - - 0 1'), /8 ranks/);
  assert.throws(() => C.parseFen('9/8/8/8/8/8/8/8 w - - 0 1'));
  assert.throws(() => C.parseFen('8/8/8/8/8/8/8/8 x - - 0 1'), /w or b/);
});

// ── moves in and out of UCI ──

test('uci: a legal move parses, an illegal one comes back null', () => {
  const state = C.initialState();
  assert.strictEqual(C.uciForMove(C.moveFromUci(state, 'e2e4')), 'e2e4');
  assert.strictEqual(C.moveFromUci(state, 'e2e5'), null, 'a two-and-a-half square push');
  assert.strictEqual(C.moveFromUci(state, 'e7e5'), null, 'the other side is not to move');
  assert.strictEqual(C.moveFromUci(state, 'hello'), null);
  assert.strictEqual(C.moveFromUci(state, ''), null);
});

test('uci: promotion carries its piece and defaults to nothing', () => {
  const state = C.parseFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const move = C.moveFromUci(state, 'a7a8q');
  assert.ok(move);
  const after = C.applyMove(state, move);
  assert.match(C.toFen(after), /^Q7/);
  assert.strictEqual(C.moveFromUci(state, 'a7a8'), null, 'a pawn cannot stay a pawn on the last rank');
});

// ── the special moves ──

test('en passant: the capture window opens for one move and takes the right pawn', () => {
  const state = play(C.initialState(), 'e2e4', 'a7a6', 'e4e5', 'd7d5');
  const move = C.moveFromUci(state, 'e5d6');
  assert.ok(move, 'en passant is on offer');
  const after = C.applyMove(state, move);
  assert.strictEqual(C.toFen(after).split(' ')[0], 'rnbqkbnr/1pp1pppp/p2P4/8/8/8/PPPP1PPP/RNBQKBNR',
    'the d5 pawn is gone even though the capture landed on d6');
});

test('castling: both wings work and move the rook too', () => {
  const state = C.parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const short = C.applyMove(state, C.moveFromUci(state, 'e1g1'));
  assert.strictEqual(C.toFen(short).split(' ')[0], 'r3k2r/8/8/8/8/8/8/R4RK1');
  const long = C.applyMove(state, C.moveFromUci(state, 'e1c1'));
  assert.strictEqual(C.toFen(long).split(' ')[0], 'r3k2r/8/8/8/8/8/8/2KR3R');
});

test('castling: not out of, through, or into check', () => {
  const inCheck = C.parseFen('4r2k/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.strictEqual(C.moveFromUci(inCheck, 'e1g1'), null);
  const through = C.parseFen('5r1k/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.strictEqual(C.moveFromUci(through, 'e1g1'), null);
});

test('castling: an attacked b1 does not stop the long castle', () => {
  const state = C.parseFen('1r5k/8/8/8/8/8/8/R3K3 w Q - 0 1');
  assert.ok(C.moveFromUci(state, 'e1c1'), 'only the king squares must be safe');
});

test('castling: rights die when the rook is captured in its corner', () => {
  const state = C.parseFen('r3k2r/8/8/8/8/8/8/R3K2R b kq - 0 1');
  const after = play(state, 'a8a1');
  assert.strictEqual(C.toFen(after).split(' ')[2], 'k',
    'the black a-rook left home and took the white a-rook with its rights');
});

test('castling: claimed rights without the rook are ignored', () => {
  const state = C.parseFen('4k3/8/8/8/8/8/8/4K3 w KQ - 0 1');
  assert.strictEqual(C.moveFromUci(state, 'e1g1'), null);
  assert.strictEqual(C.moveFromUci(state, 'e1c1'), null);
});

// ── SAN, the human notation ──

test('san: the ordinary vocabulary', () => {
  const start = C.initialState();
  assert.strictEqual(C.san(start, C.moveFromUci(start, 'e2e4')), 'e4');
  assert.strictEqual(C.san(start, C.moveFromUci(start, 'g1f3')), 'Nf3');

  const capture = play(start, 'e2e4', 'd7d5');
  assert.strictEqual(C.san(capture, C.moveFromUci(capture, 'e4d5')), 'exd5');

  const castle = C.parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.strictEqual(C.san(castle, C.moveFromUci(castle, 'e1g1')), 'O-O');
  assert.strictEqual(C.san(castle, C.moveFromUci(castle, 'e1c1')), 'O-O-O');
});

test('san: twins are told apart by file, then rank', () => {
  const knights = C.parseFen('k7/8/8/8/8/8/8/KN3N2 w - - 0 1');
  assert.strictEqual(C.san(knights, C.moveFromUci(knights, 'b1d2')), 'Nbd2');
  assert.strictEqual(C.san(knights, C.moveFromUci(knights, 'f1d2')), 'Nfd2');

  const stacked = C.parseFen('k7/8/8/8/7R/8/8/K6R w - - 0 1');
  assert.strictEqual(C.san(stacked, C.moveFromUci(stacked, 'h4h2')), 'R4h2');
});

test('san: promotion, check and mate wear their marks', () => {
  const promo = C.parseFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  assert.strictEqual(C.san(promo, C.moveFromUci(promo, 'a7a8r')), 'a8=R');

  const fools = play(C.initialState(), 'f2f3', 'e7e5', 'g2g4');
  assert.strictEqual(C.san(fools, C.moveFromUci(fools, 'd8h4')), 'Qh4#');

  const spite = C.parseFen('k7/7R/8/8/8/8/8/K7 w - - 0 1');
  assert.strictEqual(C.san(spite, C.moveFromUci(spite, 'h7h8')), 'Rh8+');
});

// ── verdicts ──

test("outcome: the fool's mate is a win for black", () => {
  const mated = play(C.initialState(), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  assert.deepStrictEqual(C.outcome(mated), { status: 'checkmate', winner: 'black' });
});

test('outcome: no moves and no check is stalemate', () => {
  const state = C.parseFen('7k/8/6Q1/8/8/8/8/K7 b - - 0 1');
  assert.strictEqual(C.outcome(state).status, 'stalemate');
});

test('outcome: bare kings and lone minors cannot win', () => {
  assert.strictEqual(C.outcome(C.parseFen('k7/8/8/8/8/8/8/K7 w - - 0 1')).status, 'insufficient');
  assert.strictEqual(C.outcome(C.parseFen('k7/8/8/8/8/8/8/KN6 w - - 0 1')).status, 'insufficient');
  assert.strictEqual(
    C.outcome(C.parseFen('k5b1/8/8/8/8/8/8/1B5K w - - 0 1')).status,
    'insufficient',
    'bishops that share a square color can never deliver mate',
  );
});

test('outcome: two knights or opposite bishops still count as material', () => {
  assert.strictEqual(C.outcome(C.parseFen('k7/8/8/8/8/8/8/KNN5 w - - 0 1')).status, 'playing');
  assert.strictEqual(C.outcome(C.parseFen('kb6/8/8/8/8/8/8/KB6 w - - 0 1')).status, 'playing');
});

test('outcome: the fifty-move clock calls the draw', () => {
  const state = C.parseFen('k7/8/8/8/8/8/8/KQ6 w - - 100 80');
  assert.strictEqual(C.outcome(state).status, 'fifty-move');
});

test('outcome: the third visit to a position is a draw', () => {
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  let state = C.initialState();
  const priors = [];
  for (const uci of [...shuffle, ...shuffle]) {
    priors.push(C.positionKey(state));
    state = C.applyMove(state, C.moveFromUci(state, uci));
  }
  assert.strictEqual(C.outcome(state, priors).status, 'threefold',
    'the starting position has now been seen three times');
  assert.strictEqual(C.outcome(state, priors.slice(4)).status, 'playing',
    'with only one earlier visit on record the game goes on');
});
