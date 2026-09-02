// Keep Chess. The whole world shares one game of chess, and a commit buys one
// move in it: after you commit, the current position appears, you play for
// whichever side is to move, and the next move belongs to whoever commits
// next, wherever they are. The game itself lives in a public repository as an
// ordinary JSON file, moves travel as issues, and an Action there is the
// referee that turns a legal move into a commit crediting its player. So the
// game's history is a git log, which felt right for a git client.
//
// The overlay is a guest in the commit flow and behaves like one: it appears
// only after the commit has fully succeeded, any fetch or parse problem means
// it quietly does not appear at all, and "Never show again" is one click,
// stored as `chess: false` in settings.json (delete the line to rejoin the
// game). A different public game can be pointed at with `chessRepo:
// "owner/repo"`, which is also what makes the overlay drivable in tests.
import { $, state } from './state.js';
import { toast } from './toast.js';
import * as rules from '../chess-rules.js';

const DEFAULT_GAME_REPO = 'yarism/keep-chess';

// Both sides use the filled glyphs and are told apart by colour (the CSS
// side classes): the outline set renders thinner than the filled set, which
// made white's army look like it was fading. The variation selector asks for
// the text glyph, since some platforms would otherwise paint an emoji pawn.
const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const glyph = (piece) => GLYPHS[piece.toLowerCase()] + '︎';
const sideClass = (piece) => (piece === piece.toUpperCase() ? 'white-piece' : 'black-piece');

let _enabled = true;
let _forge = null;
let _open = false;

let _game = null;      // the fetched game.json
let _position = null;  // parsed rules state
let _legal = [];       // every legal move in _position
let _selected = -1;    // 0x88 square with a piece picked up, or -1
let _staged = null;    // the chosen move, waiting on the Play button
let _pendingPromo = null; // {from, to} while the promotion picker is open

export function setupChess(settings) {
  _enabled = !settings || settings.chess !== false;
  const custom = settings && typeof settings.chessRepo === 'string'
    && /^[\w.-]+\/[\w.-]+$/.test(settings.chessRepo) ? settings.chessRepo : null;
  const [owner, repo] = (custom || DEFAULT_GAME_REPO).split('/');
  _forge = { kind: 'github', host: 'github.com', owner, repo };

  $('#chess-skip').addEventListener('click', hideChess);
  $('#chess-overlay').addEventListener('click', (e) => {
    if (e.target === $('#chess-overlay')) hideChess();
  });
  $('#chess-play').addEventListener('click', play);
  $('#chess-watch').addEventListener('click', () => {
    window.git.openExternal(`https://${_forge.host}/${_forge.owner}/${_forge.repo}`);
  });
  $('#chess-never').addEventListener('click', () => {
    _enabled = false;
    window.git.saveSettings({ chess: false });
    hideChess();
    toast('Keep Chess will not show again. Set "chess": true in settings.json to rejoin the game.');
  });
  $('#chess-promo').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-promo]');
    if (!pick || !_pendingPromo) return;
    const move = _legal.find((m) => m.from === _pendingPromo.from
      && m.to === _pendingPromo.to && m.promo === pick.dataset.promo);
    _pendingPromo = null;
    $('#chess-promo').hidden = true;
    if (move) stage(move);
  });
}

// Fire and forget from the commit path: a game must never make a commit
// slower, louder, or worse. Anything short of a playable position means the
// overlay simply does not appear this time.
export async function offerChess() {
  if (!_enabled || _open || !state.repoPath) return;
  let result;
  try { result = await window.git.readJsonFile(state.repoPath, _forge, 'game.json'); }
  catch { return; }
  if (!result || !result.ok || !result.data) return;
  const game = result.data;
  if (typeof game.game !== 'number' || typeof game.ply !== 'number' || typeof game.fen !== 'string') return;
  try {
    if (rules.outcome(rules.parseFen(game.fen)).status !== 'playing') return;
  } catch { return; }
  showChess(game);
}

// Renders a fetched game and opens the overlay. Exported apart from
// offerChess so a driver can put a known position on screen without GitHub.
export function showChess(game) {
  _game = game;
  _position = rules.parseFen(game.fen);
  _legal = rules.legalMoves(_position);
  _selected = -1;
  _staged = null;
  _pendingPromo = null;

  const white = _position.turn === 'w';
  const moveNo = Math.floor(game.ply / 2) + 1;
  $('#chess-status').textContent =
    `Game ${game.game} - move ${moveNo} - ${white ? 'White' : 'Black'} to play`;
  const last = Array.isArray(game.moves) && game.moves.length
    ? game.moves[game.moves.length - 1] : null;
  $('#chess-last').textContent = last
    ? `Last move: ${last.san || last.uci}${last.by ? ` by @${last.by}` : ''}`
    : 'No moves yet - the world is waiting for the first one.';

  renderPromoChoices(white);
  $('#chess-promo').hidden = true;
  renderBoard();
  syncActions();

  $('#chess-overlay').hidden = false;
  _open = true;
  document.addEventListener('keydown', onKey);
}

export function hideChess() {
  $('#chess-overlay').hidden = true;
  _open = false;
  document.removeEventListener('keydown', onKey);
}

function onKey(e) {
  if (e.key === 'Escape') hideChess();
  if (e.key === 'Enter' && _staged) play();
}

const isOwn = (piece) =>
  Boolean(piece) && (piece === piece.toUpperCase()) === (_position.turn === 'w');

function renderBoard() {
  const board = $('#chess-board');
  board.textContent = '';
  // You play the side to move, so that side sits at the bottom.
  const flipped = _position.turn === 'b';
  const lastUci = _staged ? null : (Array.isArray(_game.moves) && _game.moves.length
    ? _game.moves[_game.moves.length - 1].uci : null);
  const inCheck = rules.inCheck(_position);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = flipped ? row : 7 - row;
      const file = flipped ? 7 - col : col;
      const sq = rank * 16 + file;
      const piece = _position.board[sq];
      const name = rules.algebraic(sq);

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `chess-cell ${(file + rank) % 2 ? 'light' : 'dark'}`;
      cell.dataset.square = String(sq);
      if (piece) {
        cell.textContent = glyph(piece);
        cell.classList.add(sideClass(piece));
      }
      cell.setAttribute('aria-label', piece
        ? `${name}, ${sideClass(piece) === 'white-piece' ? 'white' : 'black'} ${NAMES[piece.toLowerCase()]}`
        : name);

      if (_selected === sq) cell.classList.add('selected');
      if (_staged && (sq === _staged.from || sq === _staged.to)) cell.classList.add('staged');
      if (lastUci && (name === lastUci.slice(0, 2) || name === lastUci.slice(2, 4))) {
        cell.classList.add('last');
      }
      if (_selected !== -1 && _legal.some((m) => m.from === _selected && m.to === sq)) {
        cell.classList.add(piece ? 'capture' : 'target');
      }
      if (inCheck && piece === (_position.turn === 'w' ? 'K' : 'k')) cell.classList.add('check');

      cell.addEventListener('click', () => onCell(sq));
      board.appendChild(cell);
    }
  }
}

function onCell(sq) {
  if (_pendingPromo) return;
  _staged = null;
  const choices = _selected === -1 ? [] : _legal.filter((m) => m.from === _selected && m.to === sq);
  if (choices.length > 1) {
    // Four promotions share a destination; the picker settles which one.
    _pendingPromo = { from: _selected, to: sq };
    $('#chess-promo').hidden = false;
    syncActions();
    return;
  }
  if (choices.length === 1) { stage(choices[0]); return; }
  _selected = isOwn(_position.board[sq]) && _legal.some((m) => m.from === sq) ? sq : -1;
  renderBoard();
  syncActions();
}

function stage(move) {
  _staged = move;
  _selected = -1;
  renderBoard();
  syncActions();
}

function syncActions() {
  const play = $('#chess-play');
  play.disabled = !_staged;
  play.textContent = _staged ? `Play ${rules.san(_position, _staged)}` : 'Play';
  $('#chess-error').hidden = true;
}

async function play() {
  if (!_staged) return;
  const button = $('#chess-play');
  button.disabled = true;
  const san = rules.san(_position, _staged);
  const uci = rules.uciForMove(_staged);
  // The ply pins the position the move was chosen against: if the world got
  // there first, the referee sees the mismatch and explains on the issue
  // instead of playing the move into a different game.
  const result = await window.git.createIssue(state.repoPath, _forge, {
    title: `keep-chess | g${_game.game} | ply${_game.ply} | ${uci}`,
    body: `${san} - played from Keep. The referee validates and commits it, `
      + 'or explains here if the position has already moved on.',
  }).catch((e) => ({ ok: false, message: e.message || 'The move could not be sent.' }));

  if (result && result.ok) {
    hideChess();
    toast(`${san} is on its way - the referee will commit it to the game shortly.`);
    return;
  }
  const error = $('#chess-error');
  error.textContent = (result && result.message) || 'The move could not be sent.';
  error.hidden = false;
  button.disabled = false;
}

function renderPromoChoices(white) {
  const promo = $('#chess-promo');
  promo.textContent = '';
  const label = document.createElement('span');
  label.className = 'chess-promo-label';
  label.textContent = 'Promote to';
  promo.appendChild(label);
  for (const letter of ['q', 'r', 'b', 'n']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.promo = letter;
    button.className = white ? 'white-piece' : 'black-piece';
    button.textContent = glyph(letter);
    button.setAttribute('aria-label', NAMES[letter]);
    promo.appendChild(button);
  }
}
