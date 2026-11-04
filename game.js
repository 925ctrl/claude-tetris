'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
  '#ef5350', // Bomba - rojo
  '#ffee58', // Rayo (fila) - amarillo
  '#40c4ff', // Rayo 2 (columna) - azul
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8]],                                       // Bomba
  [[9]],                                       // Rayo (fila)
  [[10]],                                      // Rayo 2 (columna)
];

const BOMB = 8;
const ROW_BOLT = 9;
const COL_BOLT = 10;
const POWERUP_CHANCE = 0.1;
const POWERUP_CELL_SCORE = 10;

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const pauseBtn = document.getElementById('pause-btn');
const pauseMenu = document.getElementById('pause-menu');
const resumeBtn = document.getElementById('resume-btn');
const menuRestartBtn = document.getElementById('menu-restart-btn');
const controlsBtn = document.getElementById('controls-btn');
const pauseControls = document.getElementById('pause-controls');
const startLevelSelect = document.getElementById('start-level-select');
const themeToggle =document.getElementById('theme-toggle');
const editUserBtn = document.getElementById('edit-user-btn');
const userModal = document.getElementById('user-modal');
const userForm = document.getElementById('user-form');
const usernameInput = document.getElementById('username-input');
const scoreboardEl = document.getElementById('scoreboard');

const MAX_NAME = 12;
const MAX_SCORES = 10;
let modalOpen = false;

let gridColor = '#22222e';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let startLevel = 1;     // nivel inicial aplicado a la partida en curso
let nextStartLevel = 1; // nivel elegido en el menú, se aplica en el próximo init()

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.random() < POWERUP_CHANCE
    ? BOMB + Math.floor(Math.random() * 3)
    : Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = startLevel + Math.floor(lines / 10);
    dropInterval = calcDropInterval();
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

// Aplica el efecto del power-up en la celda donde aterrizó; no deja bloques.
function applyPowerUp() {
  const { x, y, type } = current;
  let destroyed = 0;
  const clearCell = (r, c) => {
    if (board[r][c]) { board[r][c] = 0; destroyed++; }
  };
  if (type === BOMB) {
    for (let r = Math.max(0, y - 1); r <= Math.min(ROWS - 1, y + 1); r++)
      for (let c = Math.max(0, x - 1); c <= Math.min(COLS - 1, x + 1); c++)
        clearCell(r, c);
  } else if (type === ROW_BOLT) {
    destroyed = board[y].filter(v => v !== 0).length;
    board.splice(y, 1);
    board.unshift(new Array(COLS).fill(0));
  } else if (type === COL_BOLT) {
    for (let r = 0; r < ROWS; r++) clearCell(r, x);
  }
  score += destroyed * POWERUP_CELL_SCORE * level;
  updateHUD();
}

function lockPiece() {
  if (current.type >= BOMB) {
    applyPowerUp();
  } else {
    merge();
    clearLines();
  }
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  if (colorIndex >= BOMB) drawPowerUpIcon(context, x, y, colorIndex, size);
  context.globalAlpha = 1;
}

// Icono vectorial oscuro sobre el bloque (respeta el globalAlpha del ghost).
function drawPowerUpIcon(context, x, y, colorIndex, size) {
  const cx = x * size + size / 2;
  const cy = y * size + size / 2;
  const u = size / 30;
  context.save();
  context.translate(cx, cy);
  context.scale(u, u);
  context.fillStyle = 'rgba(15,15,23,0.85)';
  context.strokeStyle = 'rgba(15,15,23,0.85)';
  context.lineWidth = 2;
  context.lineCap = 'round';
  if (colorIndex === BOMB) {
    context.beginPath();
    context.arc(-1, 3, 8, 0, Math.PI * 2);
    context.fill();
    context.beginPath(); // mecha
    context.moveTo(4, -3);
    context.quadraticCurveTo(7, -7, 10, -8);
    context.stroke();
    context.fillStyle = 'rgba(255,255,255,0.85)'; // chispa y brillo
    context.beginPath();
    context.arc(10, -8, 2, 0, Math.PI * 2);
    context.arc(-4, 0, 2, 0, Math.PI * 2);
    context.fill();
  } else {
    if (colorIndex === COL_BOLT) context.rotate(Math.PI / 2);
    context.beginPath(); // rayo en zigzag
    context.moveTo(3, -11);
    context.lineTo(-6, 2);
    context.lineTo(-1, 2);
    context.lineTo(-3, 11);
    context.lineTo(6, -2);
    context.lineTo(1, -2);
    context.closePath();
    context.fill();
  }
  context.restore();
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function getUsername() {
  try { return (localStorage.getItem('username') || '').trim().slice(0, MAX_NAME); } catch (e) { return ''; }
}

function setUsername(name) {
  name = name.trim().slice(0, MAX_NAME);
  if (!name) return false;
  try { localStorage.setItem('username', name); } catch (e) {}
  return true;
}

function loadScores() {
  try {
    const data = JSON.parse(localStorage.getItem('scoreboard'));
    if (!Array.isArray(data)) return [];
    return data
      .filter(e => e && typeof e.name === 'string' && typeof e.score === 'number' && Number.isFinite(e.score))
      .slice(0, MAX_SCORES);
  } catch (e) {
    return [];
  }
}

function addScore(name, value) {
  if (!name || value < 1) return;
  const scores = loadScores();
  // Inserta antes del primer puntaje estrictamente menor: un empate queda debajo
  let idx = scores.findIndex(e => e.score < value);
  if (idx === -1) {
    if (scores.length >= MAX_SCORES) return;
    idx = scores.length;
  }
  scores.splice(idx, 0, { name, score: value });
  try { localStorage.setItem('scoreboard', JSON.stringify(scores.slice(0, MAX_SCORES))); } catch (e) {}
  renderScoreboard();
}

function renderScoreboard() {
  scoreboardEl.textContent = '';
  for (const e of loadScores()) {
    const li = document.createElement('li');
    li.textContent = `${e.name} - ${e.score}`;
    scoreboardEl.appendChild(li);
  }
}

function calcDropInterval() {
  return Math.max(100, 1000 - (level - 1) * 90);
}

function loadStartLevel() {
  let v = 1;
  try {
    const n = parseInt(localStorage.getItem('startLevel'), 10);
    if (Number.isInteger(n) && n >= 1 && n <= 10) v = n;
  } catch (e) {}
  return v;
}

for (let i = 1; i <= 10; i++) {
  const opt = document.createElement('option');
  opt.value = opt.textContent = i;
  startLevelSelect.appendChild(opt);
}
nextStartLevel = loadStartLevel();
startLevelSelect.value = nextStartLevel;

function openUserModal(editing) {
  modalOpen = true;
  if (editing && !paused && !gameOver) togglePause();
  usernameInput.value = editing ? getUsername() : '';
  userModal.classList.remove('hidden');
  usernameInput.focus();
  usernameInput.select();
}

function endGame() {
  gameOver = true;
  addScore(getUsername(), score);
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  updatePauseBtn();
}

function updatePauseBtn() {
  pauseBtn.textContent = paused ? '▶️' : '⏸️';
  pauseBtn.setAttribute('aria-label', paused ? 'Reanudar' : 'Pausar');
  pauseBtn.title = paused ? 'Reanudar' : 'Pausar';
  pauseBtn.disabled = gameOver;
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  updatePauseBtn();
  if (!paused) {
    pauseMenu.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    pauseControls.classList.add('hidden');
    controlsBtn.setAttribute('aria-expanded', 'false');
    pauseMenu.classList.remove('hidden');
    resumeBtn.focus();
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  if (gameOver) return; // endGame() ocurrió dentro de este frame: no re-programar
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  startLevel = nextStartLevel;
  level = startLevel;
  paused = false;
  gameOver = false;
  dropInterval = calcDropInterval();
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  pauseMenu.classList.add('hidden');
  updatePauseBtn();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (modalOpen) return;
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (!e.repeat) togglePause();
    return;
  }
  if (paused || gameOver) return; // menú abierto: no mover ni caer (Space/Enter activan botones del menú)
  if (e.repeat && e.code === 'Space') return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

resumeBtn.addEventListener('click', () => {
  resumeBtn.blur();
  if (paused) togglePause();
});

menuRestartBtn.addEventListener('click', () => {
  menuRestartBtn.blur();
  init();
});

controlsBtn.addEventListener('click', () => {
  const hide = !pauseControls.classList.contains('hidden');
  pauseControls.classList.toggle('hidden', hide);
  controlsBtn.setAttribute('aria-expanded', String(!hide));
  controlsBtn.blur();
});

startLevelSelect.addEventListener('change', () => {
  const n = parseInt(startLevelSelect.value, 10);
  if (!(n >= 1 && n <= 10)) return;
  nextStartLevel = n;
  try { localStorage.setItem('startLevel', String(n)); } catch (e) {}
  startLevelSelect.blur();
});

pauseBtn.addEventListener('click', () => {
  togglePause();
  pauseBtn.blur(); // evita que Space/Enter reactiven el botón durante el juego
});

userForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!setUsername(usernameInput.value)) return;
  const firstTime = !board;
  modalOpen = false;
  userModal.classList.add('hidden');
  usernameInput.blur();
  if (firstTime) init();
});

editUserBtn.addEventListener('click', () => {
  openUserModal(true);
  editUserBtn.blur();
});

function applyTheme(theme, save) {
  document.documentElement.dataset.theme = theme;
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
  themeToggle.textContent = theme === 'light' ? '🌙' : '☀️';
  themeToggle.setAttribute('aria-label', theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro');
  if (save) {
    try { localStorage.setItem('theme', theme); } catch (e) {}
  }
  // Redibuja para que pausa/game over reflejen el nuevo tema
  if (current) draw();
}

themeToggle.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true);
  themeToggle.blur(); // evita que Space/Enter reactiven el botón durante el juego
});

applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', false);

renderScoreboard();

if (getUsername()) init();
else openUserModal(false);
