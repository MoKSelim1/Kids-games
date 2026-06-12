'use strict';

/* ============================== Maze ==============================
   # wall   . blood drop   o blood vial (power)   = crypt door
   space: open path        P player spawn (tile becomes empty)
*/
const MAP_SRC = [
  '###################',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#.......#....#',
  '####.###.#.###.####',
  '####.#       #.####',
  '####.# ##=## #.####',
  '      .#   #.      ',
  '####.# ##### #.####',
  '#.................#',
  '#.##.###.#.###.##.#',
  '#....#...#...#....#',
  '#.##.#.#####.#.##.#',
  '#o.......P.......o#',
  '#.##.###.#.###.##.#',
  '#.................#',
  '###################',
];
const ROWS = MAP_SRC.length;
const COLS = MAP_SRC[0].length;
const MAP = MAP_SRC.map(function (row) { return row.split(''); });

const DOOR = { x: 9, y: 8 };       // crypt door tile
const DOOR_FRONT = { x: 9, y: 7 }; // tile just outside the door
const HOUSE = { x: 9, y: 9 };      // center of the crypt
const BONUS_TILE = { x: 9, y: 11 };

let PLAYER_SPAWN = { x: 9, y: 15 };
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (MAP[r][c] === 'P') { PLAYER_SPAWN = { x: c, y: r }; MAP[r][c] = ' '; }
  }
}

function tileAt(cx, cy) {
  if (cy < 0 || cy >= ROWS) return '#';
  cx = ((cx % COLS) + COLS) % COLS;
  return MAP[cy][cx];
}
function canEnter(cx, cy, allowDoor) {
  const t = tileAt(cx, cy);
  if (t === '#') return false;
  if (t === '=') return !!allowDoor;
  return true;
}

/* ============================== State ============================== */
const DIRS = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  none: { x: 0, y: 0 },
};
const STORAGE_BEST = 'vampire-pacman-best';
const STORAGE_MUTE = 'vampire-pacman-mute';

let state = 'menu'; // menu | ready | play | dying | levelclear | over | paused
let stateTimer = 0;
let level = 1;
let score = 0;
let best = parseInt(localStorage.getItem(STORAGE_BEST) || '0', 10) || 0;
let lives = 3;
let extraLifeGiven = false;
let pellets = new Set();   // 'c,r'
let powers = new Set();
let pelletsEaten = 0;
let totalPellets = 0;
let frightTimer = 0;
let ghostChain = 0;
let modeTimer = 0;
let chaseMode = false;     // starts in scatter
let lifeTimer = 0;         // time since life started (ghost release)
let chompFlip = false;
let bonus = null;          // {x, y, timer, value}
let bonusSpawned = 0;
let popups = [];           // {x, y, text, t}
let shakeT = 0;

const player = {
  x: 0, y: 0, dir: { x: 0, y: 0 }, queued: null,
  speed: 6, mouth: 0, deathT: 0,
};

const GHOST_DEFS = [
  { name: 'Van Crimson', color: '#ff2d4e', glow: 'rgba(255,45,78,0.55)',  scatter: { x: COLS - 2, y: 1 } },
  { name: 'Lady Silver', color: '#e8e6ff', glow: 'rgba(220,215,255,0.5)', scatter: { x: 1, y: 1 } },
  { name: 'Friar Moss',  color: '#41d97c', glow: 'rgba(65,217,124,0.5)',  scatter: { x: COLS - 2, y: ROWS - 2 } },
  { name: 'Old Ember',   color: '#ff9d2e', glow: 'rgba(255,157,46,0.5)',  scatter: { x: 1, y: ROWS - 2 } },
];
const ghosts = GHOST_DEFS.map(function (def, i) {
  return {
    def: def, idx: i,
    x: 0, y: 0, dir: { x: 0, y: 0 },
    state: 'home', // home | leaving | normal | fright | eyes | entering
    releaseAt: 0, bob: Math.random() * Math.PI * 2,
  };
});

function speedScale() { return Math.min(1 + (level - 1) * 0.05, 1.4); }
function playerSpeed() { return 6.0 * speedScale(); }
function ghostSpeed(g) {
  if (g.state === 'eyes') return 12;
  if (g.state === 'fright') return 3.9 * speedScale();
  return 5.5 * speedScale();
}
function frightDuration() { return Math.max(7.5 - (level - 1) * 0.7, 2.5); }

/* ============================== Setup ============================== */
function resetPellets() {
  pellets.clear(); powers.clear();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (MAP[r][c] === '.') pellets.add(c + ',' + r);
      if (MAP[r][c] === 'o') powers.add(c + ',' + r);
    }
  }
  totalPellets = pellets.size + powers.size;
  pelletsEaten = 0;
  bonusSpawned = 0;
  bonus = null;
}

function resetPositions() {
  player.x = PLAYER_SPAWN.x; player.y = PLAYER_SPAWN.y;
  player.dir = { x: 0, y: 0 }; player.queued = DIRS.left;
  player.mouth = 0; player.deathT = 0;

  const homeSpots = [DOOR_FRONT, { x: 9, y: 9 }, { x: 8, y: 9 }, { x: 10, y: 9 }];
  const releaseDelays = [0, 1.5, 4.0, 6.5];
  ghosts.forEach(function (g, i) {
    g.x = homeSpots[i].x; g.y = homeSpots[i].y;
    g.dir = i === 0 ? { x: -1, y: 0 } : { x: 0, y: 0 };
    g.state = i === 0 ? 'normal' : 'home';
    g.releaseAt = releaseDelays[i];
  });
  frightTimer = 0;
  ghostChain = 0;
  modeTimer = 0;
  chaseMode = false;
  lifeTimer = 0;
  popups = [];
}

function startGame() {
  level = 1; score = 0; lives = 3; extraLifeGiven = false;
  resetPellets();
  resetPositions();
  setState('ready');
  updateHud();
}

function setState(s) { state = s; stateTimer = 0; }

/* ============================== Movement ============================== */
function wrapActor(a) {
  if (a.x < -0.5) a.x += COLS;
  else if (a.x > COLS - 0.5) a.x -= COLS;
}

// Moves an actor `a` by speed*dt tile units, calling decide(a) at tile centers.
function stepActor(a, dt, speed, decide, allowDoor) {
  let dist = speed * dt;
  let guard = 0;
  while (dist > 1e-6 && guard++ < 32) {
    const cx = Math.round(a.x), cy = Math.round(a.y);
    const atCenter = Math.abs(a.x - cx) < 1e-4 && Math.abs(a.y - cy) < 1e-4;
    if (atCenter) {
      a.x = cx; a.y = cy;
      decide(a);
      if (a.dir.x === 0 && a.dir.y === 0) break;
      if (!canEnter(cx + a.dir.x, cy + a.dir.y, allowDoor)) {
        a.dir = { x: 0, y: 0 };
        break;
      }
      const m = Math.min(dist, 1);
      a.x += a.dir.x * m; a.y += a.dir.y * m; dist -= m;
    } else {
      const tx = a.dir.x > 0 ? Math.ceil(a.x) : a.dir.x < 0 ? Math.floor(a.x) : a.x;
      const ty = a.dir.y > 0 ? Math.ceil(a.y) : a.dir.y < 0 ? Math.floor(a.y) : a.y;
      const toNext = Math.abs(tx - a.x) + Math.abs(ty - a.y);
      if (toNext < 1e-6) { a.x = Math.round(a.x); a.y = Math.round(a.y); continue; }
      const m = Math.min(dist, toNext);
      a.x += a.dir.x * m; a.y += a.dir.y * m; dist -= m;
    }
    wrapActor(a);
  }
}

function playerDecide(p) {
  const cx = Math.round(p.x), cy = Math.round(p.y);
  eatAt(cx, cy);
  if (p.queued && canEnter(cx + p.queued.x, cy + p.queued.y, false)) {
    p.dir = p.queued;
  }
}

function eatAt(cx, cy) {
  const key = cx + ',' + cy;
  if (pellets.delete(key)) {
    score += 10; pelletsEaten++;
    chompFlip = !chompFlip;
    sfx.chomp(chompFlip);
    onPelletProgress();
  } else if (powers.delete(key)) {
    score += 50; pelletsEaten++;
    frightTimer = frightDuration();
    ghostChain = 0;
    ghosts.forEach(function (g) {
      if (g.state === 'normal') {
        g.state = 'fright';
        g.dir = { x: -g.dir.x, y: -g.dir.y };
      }
    });
    sfx.power();
    onPelletProgress();
  }
  if (bonus && cx === bonus.x && cy === bonus.y) {
    score += bonus.value;
    addPopup(bonus.x, bonus.y, '+' + bonus.value, '#ffd700');
    bonus = null;
    sfx.bonus();
  }
  checkScoreMilestones();
  updateHud();
}

function onPelletProgress() {
  const thresholds = [60, 130];
  if (bonusSpawned < thresholds.length && pelletsEaten >= thresholds[bonusSpawned]) {
    bonusSpawned++;
    bonus = { x: BONUS_TILE.x, y: BONUS_TILE.y, timer: 9, value: 100 + level * 50 };
  }
  if (pellets.size + powers.size === 0) {
    setState('levelclear');
    sfx.levelClear();
  }
}

function checkScoreMilestones() {
  if (!extraLifeGiven && score >= 10000) {
    extraLifeGiven = true;
    lives++;
    addPopup(player.x, player.y, '+1 🦇', '#ff6b9d');
  }
  if (score > best) {
    best = score;
    localStorage.setItem(STORAGE_BEST, String(best));
  }
}

/* ============================== Ghost AI ============================== */
function ghostTarget(g) {
  if (g.state === 'eyes') return DOOR_FRONT;
  if (!chaseMode) return g.def.scatter;
  const px = Math.round(player.x), py = Math.round(player.y);
  const pd = player.dir;
  switch (g.idx) {
    case 0: // relentless pursuit
      return { x: px, y: py };
    case 1: // ambush four tiles ahead
      return { x: px + pd.x * 4, y: py + pd.y * 4 };
    case 2: { // mirror of the leader through a point ahead of the player
      const lead = ghosts[0];
      const ax = px + pd.x * 2, ay = py + pd.y * 2;
      return { x: ax + (ax - Math.round(lead.x)), y: ay + (ay - Math.round(lead.y)) };
    }
    default: { // shy: chase when far, flee to corner when close
      const d = Math.abs(g.x - px) + Math.abs(g.y - py);
      return d > 8 ? { x: px, y: py } : g.def.scatter;
    }
  }
}

function ghostDecide(g) {
  const cx = Math.round(g.x), cy = Math.round(g.y);
  if (g.state === 'eyes' && cx === DOOR_FRONT.x && cy === DOOR_FRONT.y) {
    g.x = DOOR.x; g.y = DOOR_FRONT.y;
    g.state = 'entering';
    g.dir = { x: 0, y: 0 };
    return;
  }
  const allowDoor = g.state === 'eyes';
  const options = [];
  const order = [DIRS.up, DIRS.left, DIRS.down, DIRS.right];
  for (let i = 0; i < order.length; i++) {
    const d = order[i];
    if (d.x === -g.dir.x && d.y === -g.dir.y && (g.dir.x || g.dir.y)) continue;
    if (canEnter(cx + d.x, cy + d.y, allowDoor)) options.push(d);
  }
  if (options.length === 0) {
    g.dir = { x: -g.dir.x, y: -g.dir.y };
    return;
  }
  if (g.state === 'fright') {
    g.dir = options[Math.floor(Math.random() * options.length)];
    return;
  }
  const t = ghostTarget(g);
  let bestD = Infinity, bestDir = options[0];
  for (let i = 0; i < options.length; i++) {
    const d = options[i];
    const nx = cx + d.x, ny = cy + d.y;
    const dist = (nx - t.x) * (nx - t.x) + (ny - t.y) * (ny - t.y);
    if (dist < bestD) { bestD = dist; bestDir = d; }
  }
  g.dir = bestDir;
}

function updateGhost(g, dt) {
  g.bob += dt * 5;
  if (g.state === 'home') {
    g.y = HOUSE.y + Math.sin(g.bob) * 0.15;
    if (lifeTimer >= g.releaseAt) {
      g.state = 'leaving';
      g.y = HOUSE.y;
    }
    return;
  }
  if (g.state === 'leaving') {
    const sp = 3.5 * dt;
    if (Math.abs(g.x - DOOR.x) > 0.05) {
      g.x += Math.sign(DOOR.x - g.x) * Math.min(sp, Math.abs(g.x - DOOR.x));
    } else {
      g.x = DOOR.x;
      g.y -= sp;
      if (g.y <= DOOR_FRONT.y) {
        g.y = DOOR_FRONT.y;
        g.state = 'normal';
        g.dir = Math.random() < 0.5 ? { x: -1, y: 0 } : { x: 1, y: 0 };
      }
    }
    return;
  }
  if (g.state === 'entering') {
    const sp = 6 * dt;
    g.y += sp;
    if (g.y >= HOUSE.y) {
      g.y = HOUSE.y;
      g.state = 'home';
      g.releaseAt = lifeTimer + 1.2;
    }
    return;
  }
  stepActor(g, dt, ghostSpeed(g), ghostDecide, g.state === 'eyes');
}

/* ============================== Update loop ============================== */
function update(dt) {
  stateTimer += dt;
  popups = popups.filter(function (p) { p.t += dt; p.y -= dt * 0.8; return p.t < 1; });
  if (shakeT > 0) shakeT -= dt;

  if (state === 'ready') {
    if (stateTimer >= 2) setState('play');
    return;
  }
  if (state === 'dying') {
    player.deathT += dt;
    if (player.deathT >= 1.4) {
      lives--;
      updateHud();
      if (lives < 0) {
        setState('over');
        showOverlay('The Sun Rises…',
          'The hunters got you! You drank ' + score + ' points of blood.' +
          (score >= best && score > 0 ? '<br>🌑 A new best for the ages! 🌑' : ''),
          'Rise Again');
      } else {
        resetPositions();
        setState('ready');
      }
    }
    return;
  }
  if (state === 'levelclear') {
    if (stateTimer >= 2.2) {
      level++;
      resetPellets();
      resetPositions();
      setState('ready');
      updateHud();
    }
    return;
  }
  if (state !== 'play') return;

  lifeTimer += dt;

  // scatter/chase rhythm (paused while frightened)
  if (frightTimer > 0) {
    frightTimer -= dt;
    if (frightTimer <= 0) {
      frightTimer = 0;
      ghosts.forEach(function (g) { if (g.state === 'fright') g.state = 'normal'; });
    }
  } else {
    modeTimer += dt;
    const phase = chaseMode ? 20 : 7;
    if (modeTimer >= phase) {
      modeTimer = 0;
      chaseMode = !chaseMode;
      ghosts.forEach(function (g) {
        if (g.state === 'normal') g.dir = { x: -g.dir.x, y: -g.dir.y };
      });
    }
  }

  if (bonus) {
    bonus.timer -= dt;
    if (bonus.timer <= 0) bonus = null;
  }

  // instant reversal feels snappy on mobile
  if (player.queued && player.queued.x === -player.dir.x && player.queued.y === -player.dir.y &&
      (player.dir.x || player.dir.y)) {
    player.dir = player.queued;
  }
  stepActor(player, dt, playerSpeed(), playerDecide, false);
  player.mouth += dt * (player.dir.x || player.dir.y ? 10 : 3);

  ghosts.forEach(function (g) { updateGhost(g, dt); });

  // collisions
  for (let i = 0; i < ghosts.length; i++) {
    const g = ghosts[i];
    if (g.state !== 'normal' && g.state !== 'fright') continue;
    if (Math.abs(g.x - player.x) < 0.6 && Math.abs(g.y - player.y) < 0.6) {
      if (g.state === 'fright') {
        ghostChain++;
        const pts = 100 * Math.pow(2, ghostChain); // 200 400 800 1600
        score += pts;
        addPopup(g.x, g.y, '+' + pts, '#7df9ff');
        g.state = 'eyes';
        sfx.eatGhost();
        if (navigator.vibrate) navigator.vibrate(40);
        checkScoreMilestones();
        updateHud();
      } else {
        setState('dying');
        player.deathT = 0;
        shakeT = 0.5;
        sfx.death();
        if (navigator.vibrate) navigator.vibrate([80, 60, 120]);
        return;
      }
    }
  }
}

function addPopup(x, y, text, color) {
  popups.push({ x: x, y: y, text: text, color: color, t: 0 });
}

/* ============================== Rendering ============================== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let TILE = 20;
let mazeLayer = null;

function resize() {
  const wrap = document.getElementById('game-wrap');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const availW = wrap.clientWidth - 8;
  const availH = wrap.clientHeight - 4;
  TILE = Math.max(8, Math.floor(Math.min(availW / COLS, availH / ROWS)));
  const w = TILE * COLS, h = TILE * ROWS;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  buildMazeLayer(dpr);
}

function buildMazeLayer(dpr) {
  mazeLayer = document.createElement('canvas');
  mazeLayer.width = canvas.width;
  mazeLayer.height = canvas.height;
  const m = mazeLayer.getContext('2d');
  m.setTransform(dpr, 0, 0, dpr, 0, 0);

  // floor
  const g = m.createRadialGradient(COLS * TILE / 2, ROWS * TILE / 2, TILE * 2,
                                   COLS * TILE / 2, ROWS * TILE / 2, COLS * TILE * 0.7);
  g.addColorStop(0, '#160a22');
  g.addColorStop(1, '#0a0410');
  m.fillStyle = g;
  m.fillRect(0, 0, COLS * TILE, ROWS * TILE);

  // wall edges: stroke boundaries between walls and paths
  m.strokeStyle = '#8c1d4f';
  m.lineWidth = Math.max(1.5, TILE * 0.12);
  m.lineCap = 'round';
  m.shadowColor = 'rgba(255, 45, 110, 0.55)';
  m.shadowBlur = TILE * 0.4;
  const isWall = function (c, r) {
    if (r < 0 || r >= ROWS) return true;
    if (c < 0 || c >= COLS) return true;
    return MAP[r][c] === '#';
  };
  m.beginPath();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isWall(c, r)) continue;
      const x = c * TILE, y = r * TILE;
      if (!isWall(c, r - 1) && tileAt(c, r - 1) !== '=') { m.moveTo(x, y); m.lineTo(x + TILE, y); }
      if (!isWall(c, r + 1) && tileAt(c, r + 1) !== '=') { m.moveTo(x, y + TILE); m.lineTo(x + TILE, y + TILE); }
      if (!isWall(c - 1, r) && tileAt(c - 1, r) !== '=') { m.moveTo(x, y); m.lineTo(x, y + TILE); }
      if (!isWall(c + 1, r) && tileAt(c + 1, r) !== '=') { m.moveTo(x + TILE, y); m.lineTo(x + TILE, y + TILE); }
    }
  }
  m.stroke();
  m.shadowBlur = 0;

  // crypt door
  m.fillStyle = '#caa8e8';
  m.fillRect(DOOR.x * TILE + TILE * 0.1, DOOR.y * TILE + TILE * 0.38, TILE * 0.8, TILE * 0.24);
}

function px(v) { return (v + 0.5) * TILE; }

function draw(now) {
  ctx.fillStyle = '#0a0410';
  ctx.fillRect(0, 0, TILE * COLS, TILE * ROWS);
  ctx.save();
  if (shakeT > 0) {
    ctx.translate((Math.random() - 0.5) * TILE * 0.3, (Math.random() - 0.5) * TILE * 0.3);
  }
  if (mazeLayer) {
    const flash = state === 'levelclear' && Math.floor(stateTimer * 6) % 2 === 0;
    ctx.globalAlpha = flash ? 0.45 : 1;
    ctx.drawImage(mazeLayer, 0, 0, TILE * COLS, TILE * ROWS);
    ctx.globalAlpha = 1;
  }

  drawPellets(now);
  if (bonus) drawBonus(now);
  ghosts.forEach(function (g) { drawGhost(g, now); });
  if (state !== 'over') drawPlayer(now);
  drawPopups();

  if (state === 'ready') {
    drawCenterText(stateTimer < 1 ? 'READY…' : 'RISE!', '#ff2d4e');
  } else if (state === 'levelclear') {
    drawCenterText('NIGHT ' + level + ' SURVIVED!', '#ffd700');
  } else if (state === 'paused') {
    drawCenterText('PAUSED — TAP TO CONTINUE', '#c9b8e8');
  }
  ctx.restore();
}

function drawCenterText(text, color) {
  ctx.save();
  ctx.font = 'bold ' + Math.max(14, TILE * 0.9) + 'px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillText(text, COLS * TILE / 2, (BONUS_TILE.y + 0.5) * TILE);
  ctx.restore();
}

function drawPellets(now) {
  ctx.save();
  ctx.fillStyle = '#e02545';
  pellets.forEach(function (key) {
    const i = key.indexOf(',');
    const c = +key.slice(0, i), r = +key.slice(i + 1);
    ctx.beginPath();
    ctx.arc(px(c), px(r) + TILE * 0.06, TILE * 0.1, 0, Math.PI * 2);
    ctx.fill();
  });
  const pulse = 0.75 + Math.sin(now / 180) * 0.25;
  powers.forEach(function (key) {
    const i = key.indexOf(',');
    const c = +key.slice(0, i), r = +key.slice(i + 1);
    ctx.save();
    ctx.shadowColor = 'rgba(255,40,80,0.9)';
    ctx.shadowBlur = TILE * 0.5 * pulse;
    ctx.fillStyle = '#ff2d4e';
    ctx.beginPath();
    // blood vial: drop shape
    const x = px(c), y = px(r);
    const s = TILE * 0.3 * pulse;
    ctx.moveTo(x, y - s);
    ctx.bezierCurveTo(x + s, y - s * 0.1, x + s * 0.8, y + s, x, y + s);
    ctx.bezierCurveTo(x - s * 0.8, y + s, x - s, y - s * 0.1, x, y - s);
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}

function drawBonus(now) {
  ctx.save();
  ctx.font = TILE * 0.9 + 'px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fade = bonus.timer < 2 ? (Math.floor(now / 150) % 2 === 0 ? 0.35 : 1) : 1;
  ctx.globalAlpha = fade;
  ctx.fillText('🍷', px(bonus.x), px(bonus.y));
  ctx.restore();
}

function drawPlayer(now) {
  const x = px(player.x), y = px(player.y);
  const r = TILE * 0.46;
  ctx.save();
  ctx.translate(x, y);

  if (state === 'dying') {
    const t = Math.min(player.deathT / 1.2, 1);
    ctx.rotate(t * Math.PI * 4);
    ctx.scale(1 - t * 0.9, 1 - t * 0.9);
    ctx.globalAlpha = 1 - t * 0.7;
  } else {
    const ang = player.dir.x === -1 ? Math.PI
      : player.dir.y === -1 ? -Math.PI / 2
      : player.dir.y === 1 ? Math.PI / 2 : 0;
    ctx.rotate(ang);
  }

  // cape
  ctx.fillStyle = '#1a0b2e';
  ctx.strokeStyle = '#5b2a8c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-r * 0.2, -r * 1.05);
  ctx.quadraticCurveTo(-r * 1.5, 0, -r * 0.9, r * 1.05);
  ctx.lineTo(-r * 0.1, r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // pale head with chomping mouth
  const mouth = state === 'dying' ? 0.1 : (0.08 + Math.abs(Math.sin(player.mouth)) * 0.55);
  ctx.fillStyle = '#efe6f7';
  ctx.shadowColor = 'rgba(239,230,247,0.4)';
  ctx.shadowBlur = TILE * 0.25;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, mouth, Math.PI * 2 - mouth);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // fang on the upper lip
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(r * 0.55, -r * Math.sin(mouth) * 0.9);
  ctx.lineTo(r * 0.72, -r * Math.sin(mouth) * 0.5 + r * 0.18);
  ctx.lineTo(r * 0.85, -r * Math.sin(mouth) * 0.75);
  ctx.closePath();
  ctx.fill();

  // red eye
  ctx.fillStyle = '#c01030';
  ctx.beginPath();
  ctx.arc(r * 0.18, -r * 0.45, r * 0.14, 0, Math.PI * 2);
  ctx.fill();

  // slick hair widow's peak
  ctx.fillStyle = '#14081f';
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI * 1.15, Math.PI * 1.85);
  ctx.quadraticCurveTo(r * 0.15, -r * 0.35, -r * Math.cos(Math.PI * 0.15), -r * Math.sin(Math.PI * 0.15));
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawGhost(g, now) {
  const x = px(g.x), y = px(g.y);
  const r = TILE * 0.46;
  const fright = g.state === 'fright';
  const flashing = fright && frightTimer < 2 && Math.floor(now / 180) % 2 === 0;
  const eyesOnly = g.state === 'eyes';

  ctx.save();
  ctx.translate(x, y);

  if (!eyesOnly) {
    const body = fright ? (flashing ? '#efe6f7' : '#3a4fd8') : g.def.color;
    ctx.fillStyle = body;
    ctx.shadowColor = fright ? 'rgba(80,110,255,0.5)' : g.def.glow;
    ctx.shadowBlur = TILE * 0.3;
    ctx.beginPath();
    ctx.arc(0, -r * 0.1, r, Math.PI, 0);
    const wob = Math.sin(now / 110 + g.idx) * r * 0.12;
    ctx.lineTo(r, r * 0.85);
    ctx.lineTo(r * 0.6, r * 0.65 + wob);
    ctx.lineTo(r * 0.2, r * 0.85);
    ctx.lineTo(-r * 0.2, r * 0.65 + wob);
    ctx.lineTo(-r * 0.6, r * 0.85);
    ctx.lineTo(-r, r * 0.65 + wob);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    if (!fright) {
      // hunter hat
      ctx.fillStyle = '#1a0e24';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.78, r * 0.85, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-r * 0.45, -r * 1.35, r * 0.9, r * 0.6);
      ctx.fillStyle = '#8c1d4f';
      ctx.fillRect(-r * 0.45, -r * 0.95, r * 0.9, r * 0.16);
    }
  }

  // eyes
  const ex = g.dir.x * r * 0.16, ey = g.dir.y * r * 0.16;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(-r * 0.32 + ex, -r * 0.18 + ey, r * 0.22, r * 0.27, 0, 0, Math.PI * 2);
  ctx.ellipse(r * 0.32 + ex, -r * 0.18 + ey, r * 0.22, r * 0.27, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fright ? '#d8344f' : '#2a1140';
  ctx.beginPath();
  ctx.arc(-r * 0.32 + ex * 1.8, -r * 0.18 + ey * 1.8, r * 0.11, 0, Math.PI * 2);
  ctx.arc(r * 0.32 + ex * 1.8, -r * 0.18 + ey * 1.8, r * 0.11, 0, Math.PI * 2);
  ctx.fill();

  if (fright && !eyesOnly) {
    // frightened squiggle mouth
    ctx.strokeStyle = flashing ? '#d8344f' : '#cfd8ff';
    ctx.lineWidth = Math.max(1, TILE * 0.06);
    ctx.beginPath();
    for (let i = -3; i <= 3; i++) {
      const sx = i * r * 0.18;
      const sy = r * 0.28 + (i % 2 === 0 ? -r * 0.08 : r * 0.08);
      if (i === -3) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawPopups() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold ' + Math.max(11, TILE * 0.55) + 'px Georgia, serif';
  popups.forEach(function (p) {
    ctx.globalAlpha = 1 - p.t;
    ctx.fillStyle = p.color || '#fff';
    ctx.fillText(p.text, px(p.x), px(p.y));
  });
  ctx.restore();
}

/* ============================== Audio ============================== */
const sfx = (function () {
  let ac = null;
  let muted = localStorage.getItem(STORAGE_MUTE) === '1';

  function ctxGet() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, dur, type, vol, slideTo) {
    if (muted) return;
    const a = ctxGet();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.05, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur + 0.02);
  }
  return {
    unlock: function () { ctxGet(); },
    get muted() { return muted; },
    toggleMute: function () {
      muted = !muted;
      localStorage.setItem(STORAGE_MUTE, muted ? '1' : '0');
      return muted;
    },
    chomp: function (flip) { tone(flip ? 520 : 430, 0.07, 'square', 0.03); },
    power: function () { tone(180, 0.45, 'sawtooth', 0.06, 520); },
    eatGhost: function () { tone(300, 0.25, 'square', 0.06, 1200); },
    bonus: function () { tone(700, 0.15, 'triangle', 0.07, 1400); },
    death: function () { tone(600, 1.1, 'sawtooth', 0.07, 60); },
    levelClear: function () {
      tone(440, 0.18, 'triangle', 0.07);
      setTimeout(function () { tone(560, 0.18, 'triangle', 0.07); }, 160);
      setTimeout(function () { tone(700, 0.3, 'triangle', 0.07); }, 320);
    },
  };
})();

/* ============================== UI / Input ============================== */
const overlayEl = document.getElementById('overlay');
const overlayTextEl = document.getElementById('overlay-text');
const overlayTitleEl = overlayEl.querySelector('h2');
const playBtn = document.getElementById('play-btn');
const muteBtn = document.getElementById('mute');

function showOverlay(title, html, btnLabel) {
  overlayTitleEl.textContent = title;
  overlayTextEl.innerHTML = html;
  playBtn.textContent = btnLabel;
  overlayEl.classList.remove('hidden');
}
function hideOverlay() { overlayEl.classList.add('hidden'); }

function updateHud() {
  document.getElementById('score').textContent = score;
  document.getElementById('best').textContent = best;
  document.getElementById('level').textContent = level;
  document.getElementById('lives').textContent = '🦇'.repeat(Math.max(0, lives));
}

muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
muteBtn.addEventListener('click', function () {
  muteBtn.textContent = sfx.toggleMute() ? '🔇' : '🔊';
});

playBtn.addEventListener('click', function () {
  sfx.unlock();
  hideOverlay();
  startGame();
});

function queueDir(d) {
  player.queued = d;
  if (state === 'paused') setState('play');
}

window.addEventListener('keydown', function (e) {
  const map = {
    ArrowUp: DIRS.up, ArrowDown: DIRS.down, ArrowLeft: DIRS.left, ArrowRight: DIRS.right,
    w: DIRS.up, s: DIRS.down, a: DIRS.left, d: DIRS.right,
    W: DIRS.up, S: DIRS.down, A: DIRS.left, D: DIRS.right,
  };
  if (map[e.key]) {
    e.preventDefault();
    queueDir(map[e.key]);
  } else if ((e.key === 'Enter' || e.key === ' ') && !overlayEl.classList.contains('hidden')) {
    playBtn.click();
  }
});

// swipe: re-triggers every SWIPE_STEP px so you can steer without lifting
const SWIPE_STEP = 24;
let touchAnchor = null;
canvas.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  touchAnchor = { x: e.clientX, y: e.clientY };
  if (state === 'paused') setState('play');
}, { passive: false });
canvas.addEventListener('pointermove', function (e) {
  if (!touchAnchor) return;
  const dx = e.clientX - touchAnchor.x;
  const dy = e.clientY - touchAnchor.y;
  if (Math.abs(dx) < SWIPE_STEP && Math.abs(dy) < SWIPE_STEP) return;
  if (Math.abs(dx) > Math.abs(dy)) queueDir(dx > 0 ? DIRS.right : DIRS.left);
  else queueDir(dy > 0 ? DIRS.down : DIRS.up);
  touchAnchor = { x: e.clientX, y: e.clientY };
}, { passive: false });
window.addEventListener('pointerup', function () { touchAnchor = null; });
window.addEventListener('pointercancel', function () { touchAnchor = null; });

[['btn-up', DIRS.up], ['btn-down', DIRS.down], ['btn-left', DIRS.left], ['btn-right', DIRS.right]]
  .forEach(function (pair) {
    const el = document.getElementById(pair[0]);
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      sfx.unlock();
      queueDir(pair[1]);
    }, { passive: false });
  });

document.addEventListener('visibilitychange', function () {
  if (document.hidden && state === 'play') setState('paused');
});

/* ============================== Main loop ============================== */
let lastTime = 0;
function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  draw(now);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
resetPellets();
resetPositions();
updateHud();
requestAnimationFrame(function (now) {
  lastTime = now;
  requestAnimationFrame(frame);
});
