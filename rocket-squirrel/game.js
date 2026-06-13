'use strict';

/* =====================================================================
   Rocket Squirrel Rescue
   Explore a dark cave, keep your flashlight fed with batteries, find
   five well-hidden diamonds, beat three bosses, free three squirrels,
   and fly everyone home on the rocket.
   ===================================================================== */

const TILE = 32;
const W = 52, H = 40;            // world size in tiles
const DIAMONDS_NEEDED = 5;
const SQUIRRELS_NEEDED = 3;
const BATTERY_COUNT = 16;
const START_LIVES = 5;
const MAX_HEARTS = 5;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ============================== World gen ============================== */
let grid = null;        // Uint8Array, 1 = wall, 0 = floor
let world = null;       // { rocket, diamonds, batteries, rooms, hearts }

function idx(c, r) { return r * W + c; }
function isWall(c, r) {
  if (c < 0 || c >= W || r < 0 || r >= H) return true;
  return grid[idx(c, r)] === 1;
}

// gentle bosses: all slower than the player, with slow telegraphed dashes
const BOSS_DEFS = [
  { name: 'GRUMPY GOLEM', hp: 4, speed: 1.5, color: '#8d8d99', dashSpeed: 5.2, size: 0.9 },
  { name: 'GIANT CAVE BAT', hp: 5, speed: 2.2, color: '#7a4fd8', dashSpeed: 5.6, size: 0.8 },
  { name: 'CRYSTAL KING', hp: 6, speed: 1.9, color: '#3ec9d6', dashSpeed: 6, size: 1.05 },
];

function generateWorld(seed) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const w = tryGenerate(mulberry32((seed + attempt * 7919) | 0));
    if (w) return w;
  }
  throw new Error('world generation failed');
}

function tryGenerate(rng) {
  grid = new Uint8Array(W * H).fill(1);
  const cx = W >> 1, cy = H >> 1;
  const carve = function (c, r) {
    if (c >= 1 && c <= W - 2 && r >= 1 && r <= H - 2) grid[idx(c, r)] = 0;
  };

  // start clearing around the rocket
  for (let r = cy - 3; r <= cy + 3; r++)
    for (let c = cx - 3; c <= cx + 3; c++) carve(c, r);

  // drunkard's walk carves the main cave (always connected)
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let x = cx, y = cy, dir = 0, floors = 0;
  const target = 800;
  for (let step = 0; step < 90000 && floors < target; step++) {
    if (rng() < 0.32) dir = (rng() * 4) | 0;
    x = Math.max(2, Math.min(W - 4, x + dirs[dir][0]));
    y = Math.max(2, Math.min(H - 4, y + dirs[dir][1]));
    for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (grid[idx(x + dc, y + dr)] === 1) { carve(x + dc, y + dr); floors++; }
    }
  }
  const mainFloor = grid.slice(); // snapshot before rooms, for corridor stopping

  // three boss rooms in far corners, joined to the cave with a tunnel
  const corners = [[9, 9], [W - 10, 9], [9, H - 10], [W - 10, H - 10]];
  for (let i = corners.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = corners[i]; corners[i] = corners[j]; corners[j] = t;
  }
  const rooms = [];
  for (let i = 0; i < 3; i++) {
    const [rcx, rcy] = corners[i];
    for (let r = rcy - 5; r <= rcy + 5; r++)
      for (let c = rcx - 5; c <= rcx + 5; c++)
        if ((c - rcx) * (c - rcx) + (r - rcy) * (r - rcy) <= 20) carve(c, r);
    // tunnel toward the rocket until we hit the main cave
    let tx = rcx, ty = rcy;
    for (let step = 0; step < 200; step++) {
      const inRoom = (tx - rcx) * (tx - rcx) + (ty - rcy) * (ty - rcy) <= 30;
      if (!inRoom && mainFloor[idx(tx, ty)] === 0) break;
      if (Math.abs(cx - tx) > Math.abs(cy - ty)) tx += Math.sign(cx - tx);
      else ty += Math.sign(cy - ty);
      carve(tx, ty); carve(tx + 1, ty); carve(tx, ty + 1);
    }
    rooms.push({ cx: rcx, cy: rcy, bossIdx: i });
  }

  // diamonds hide at the end of tiny 1-wide nooks dug off far-away walls
  const dist2 = function (c, r) { return (c - cx) * (c - cx) + (r - cy) * (r - cy); };
  const diamonds = [];
  for (let tries = 0; tries < 6000 && diamonds.length < DIAMONDS_NEEDED; tries++) {
    const c = 3 + ((rng() * (W - 6)) | 0);
    const r = 3 + ((rng() * (H - 6)) | 0);
    if (grid[idx(c, r)] !== 0 || dist2(c, r) < 12 * 12) continue;
    if (rooms.some(function (rm) { return (c - rm.cx) * (c - rm.cx) + (r - rm.cy) * (r - rm.cy) < 64; })) continue;
    if (diamonds.some(function (d) { return (d.c - c) * (d.c - c) + (d.r - r) * (d.r - r) < 100; })) continue;
    // try every direction off this floor tile, dig the first one that bores into rock
    const len = 2 + ((rng() * 2) | 0);
    let dug = false;
    for (let di = 0; di < 4 && !dug; di++) {
      const d = dirs[di];
      let depth = 0;
      for (let k = 1; k <= len; k++) {
        const nc = c + d[0] * k, nr = r + d[1] * k;
        if (nc < 2 || nc > W - 3 || nr < 2 || nr > H - 3 || grid[idx(nc, nr)] === 0) break;
        depth = k;
      }
      if (depth < 1) continue; // need at least a 1-deep rock pocket
      for (let k = 1; k <= depth; k++) carve(c + d[0] * k, r + d[1] * k);
      diamonds.push({ c: c + d[0] * depth, r: r + d[1] * depth, found: false });
      dug = true;
    }
  }
  if (diamonds.length < DIAMONDS_NEEDED) return null;

  // batteries lie out in the open on the cave floor
  const batteries = [];
  for (let tries = 0; tries < 4000 && batteries.length < BATTERY_COUNT; tries++) {
    const c = 2 + ((rng() * (W - 4)) | 0);
    const r = 2 + ((rng() * (H - 4)) | 0);
    if (grid[idx(c, r)] !== 0 || dist2(c, r) < 8 * 8) continue;
    let open = 0;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (!isWall(c + dc, r + dr)) open++;
    if (open < 6) continue; // keep them visible, not in nooks
    if (batteries.some(function (b) { return (b.c - c) * (b.c - c) + (b.r - r) * (b.r - r) < 36; })) continue;
    batteries.push({ c: c, r: r, taken: false });
  }
  if (batteries.length < BATTERY_COUNT - 4) return null;

  // everything must be reachable from the rocket
  const seen = new Uint8Array(W * H);
  const q = [idx(cx, cy)];
  seen[idx(cx, cy)] = 1;
  while (q.length) {
    const i = q.pop();
    const c = i % W, r = (i / W) | 0;
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= W || nr < 0 || nr >= H) continue;
      const ni = idx(nc, nr);
      if (!seen[ni] && grid[ni] === 0) { seen[ni] = 1; q.push(ni); }
    }
  }
  const reachable = function (c, r) { return seen[idx(c, r)] === 1; };
  if (!diamonds.every(function (d) { return reachable(d.c, d.r); })) return null;
  if (!rooms.every(function (rm) { return reachable(rm.cx, rm.cy); })) return null;
  const okBatteries = batteries.filter(function (b) { return reachable(b.c, b.r); });
  if (okBatteries.length < BATTERY_COUNT - 4) return null;

  return {
    rocket: { c: cx, r: cy },
    diamonds: diamonds,
    batteries: okBatteries,
    rooms: rooms,
    hearts: [],
  };
}

/* ============================== Game state ============================== */
const STORAGE_MUTE = 'rocket-squirrel-mute';
let state = 'menu'; // menu | play | dead | launch | victory | gameover | paused
let stateTimer = 0;
let lives = START_LIVES;
let diamondsFound = 0;
let squirrelsFreed = 0;
let timePlayed = 0;
let hintTimer = 0;
let hintSparks = [];   // {x, y, t}
let particles = [];
let shakeT = 0;

const player = {
  x: 0, y: 0, vx: 0, vy: 0,
  hearts: MAX_HEARTS,
  battery: 100,
  speed: 4.6 * TILE,
  face: { x: 1, y: 0 },
  iframes: 0,
  zapCd: 0,
  zapAnim: 0,
  walk: 0,
};

let bosses = [];    // {def, x, y, hp, maxHp, state, t, dashDir, room, shards, awake}
let squirrels = []; // {x, y, freed, boarded, room}
let trail = [];     // recent player positions for followers

function tileCenter(c, r) { return { x: (c + 0.5) * TILE, y: (r + 0.5) * TILE }; }

function newGame(seed) {
  world = generateWorld(seed);
  lives = START_LIVES;
  diamondsFound = 0;
  squirrelsFreed = 0;
  timePlayed = 0;
  particles = [];
  hintSparks = [];
  bosses = world.rooms.map(function (rm) {
    const def = BOSS_DEFS[rm.bossIdx];
    const p = tileCenter(rm.cx, rm.cy - 1);
    return {
      def: def, x: p.x, y: p.y, hp: def.hp, maxHp: def.hp,
      state: 'sleep', t: 0, dashDir: { x: 0, y: 0 },
      room: rm, shards: [], wob: Math.random() * 9,
    };
  });
  squirrels = world.rooms.map(function (rm) {
    const p = tileCenter(rm.cx, rm.cy + 2);
    return { x: p.x, y: p.y, freed: false, boarded: false, room: rm, hop: Math.random() * 9 };
  });
  respawn();
  updateHud();
}

function respawn() {
  const p = tileCenter(world.rocket.c, world.rocket.r + 2);
  player.x = p.x; player.y = p.y;
  player.vx = 0; player.vy = 0;
  player.hearts = MAX_HEARTS;
  player.battery = Math.max(player.battery, 75);
  player.iframes = 2;
  trail = [];
  // freed squirrels regroup around you
  squirrels.forEach(function (s, i) {
    if (s.freed && !s.boarded) { s.x = p.x - 20 - i * 14; s.y = p.y + 10; }
  });
  hideBossBar();
}

function setState(s) { state = s; stateTimer = 0; }

/* ============================== Movement ============================== */
function circleHitsWall(x, y, rad) {
  const minC = Math.floor((x - rad) / TILE), maxC = Math.floor((x + rad) / TILE);
  const minR = Math.floor((y - rad) / TILE), maxR = Math.floor((y + rad) / TILE);
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++) {
      if (!isWall(c, r)) continue;
      const nx = Math.max(c * TILE, Math.min(x, (c + 1) * TILE));
      const ny = Math.max(r * TILE, Math.min(y, (r + 1) * TILE));
      if ((x - nx) * (x - nx) + (y - ny) * (y - ny) < rad * rad) return true;
    }
  return false;
}

function moveActor(a, dx, dy, rad) {
  if (dx && !circleHitsWall(a.x + dx, a.y, rad)) a.x += dx;
  if (dy && !circleHitsWall(a.x, a.y + dy, rad)) a.y += dy;
}

/* ============================== Update ============================== */
function update(dt) {
  stateTimer += dt;
  if (shakeT > 0) shakeT -= dt;
  particles = particles.filter(function (p) {
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; return p.t < p.life;
  });
  hintSparks = hintSparks.filter(function (s) { s.t += dt; return s.t < 1.2; });

  if (state === 'dead') {
    if (stateTimer > 1.6) {
      if (lives <= 0) {
        setState('gameover');
        showOverlay('So Close!', '🐿️💤',
          'You found ' + diamondsFound + ' 💎 and saved ' + squirrelsFreed + ' 🐿️ — amazing work!<br>' +
          'The squirrels are waiting for you. Brave explorers always try again!',
          '🚀 Try a New Cave');
      } else {
        respawn();
        setState('play');
      }
    }
    return;
  }
  if (state === 'launch') {
    updateLaunch(dt);
    return;
  }
  if (state !== 'play') return;

  timePlayed += dt;
  updatePlayer(dt);
  updateSquirrels(dt);
  bosses.forEach(function (b) { updateBoss(b, dt); });
  updatePickups();
  updateHints(dt);
}

function updatePlayer(dt) {
  const inp = inputVector();
  if (inp.x || inp.y) {
    const len = Math.hypot(inp.x, inp.y) || 1;
    const sp = player.speed * Math.min(1, len);
    const nx = inp.x / len, ny = inp.y / len;
    moveActor(player, nx * sp * dt, ny * sp * dt, 11);
    player.face = { x: nx, y: ny };
    player.walk += dt * 10;
    trail.push({ x: player.x, y: player.y });
    if (trail.length > 90) trail.shift();
  }
  player.iframes = Math.max(0, player.iframes - dt);
  player.zapCd = Math.max(0, player.zapCd - dt);
  player.zapAnim = Math.max(0, player.zapAnim - dt * 2.5);

  // the flashlight slowly eats battery — keep finding more!
  player.battery = Math.max(0, player.battery - dt * 0.8);

  if (zapQueued) {
    zapQueued = false;
    doZap();
  }

  // reaching the rocket with everything done => launch!
  const rp = tileCenter(world.rocket.c, world.rocket.r);
  if (diamondsFound >= DIAMONDS_NEEDED && squirrelsFreed >= SQUIRRELS_NEEDED &&
      Math.hypot(player.x - rp.x, player.y - rp.y) < TILE * 1.6) {
    squirrels.forEach(function (s) { s.boarded = true; });
    setState('launch');
    launch = { t: 0, y: 0 };
    sfx.fanfare();
    if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 120]);
  }
}

function doZap() {
  if (player.zapCd > 0) return;
  if (player.battery < 4) { sfx.deny(); return; }
  player.battery -= 4;
  player.zapCd = 0.55;
  player.zapAnim = 1;
  sfx.zap();
  const RANGE = TILE * 2.6;
  let hitSomething = false;
  bosses.forEach(function (b) {
    if (b.hp <= 0) return;
    if (Math.hypot(b.x - player.x, b.y - player.y) < RANGE + TILE * b.def.size * 0.5) {
      b.hp--;
      hitSomething = true;
      const kb = 90;
      const dx = b.x - player.x, dy = b.y - player.y;
      const len = Math.hypot(dx, dy) || 1;
      moveActor(b, dx / len * kb * 0.3, dy / len * kb * 0.3, TILE * b.def.size * 0.45);
      burst(b.x, b.y, '#ffd84a', 10);
      if (b.hp <= 0) defeatBoss(b);
      else sfx.bossHit();
    }
    b.shards = b.shards.filter(function (s) {
      if (Math.hypot(s.x - player.x, s.y - player.y) < RANGE) {
        burst(s.x, s.y, '#9ef', 6);
        hitSomething = true;
        return false;
      }
      return true;
    });
  });
  if (hitSomething && navigator.vibrate) navigator.vibrate(25);
}

function defeatBoss(b) {
  sfx.bossDown();
  shakeT = 0.6;
  burst(b.x, b.y, b.def.color, 26);
  b.shards = [];
  hideBossBar();
  // bosses drop hearts to keep you going
  world.hearts.push({ x: b.x - 14, y: b.y, taken: false });
  world.hearts.push({ x: b.x + 14, y: b.y, taken: false });
  banner(b.def.name + ' DEFEATED!', '#ffd84a');
  if (navigator.vibrate) navigator.vibrate([50, 50, 100]);
}

function hurtPlayer(fromX, fromY) {
  if (player.iframes > 0 || player.hearts <= 0 || state !== 'play') return;
  player.hearts--;
  player.iframes = 1.8;
  shakeT = 0.35;
  sfx.hurt();
  if (navigator.vibrate) navigator.vibrate([80, 50, 80]);
  const dx = player.x - fromX, dy = player.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  moveActor(player, dx / len * 26, dy / len * 26, 11);
  updateHud();
  if (player.hearts <= 0) {
    lives--;
    updateHud();
    burst(player.x, player.y, '#fff', 18);
    sfx.death();
    setState('dead');
  }
}

function updateBoss(b, dt) {
  if (b.hp <= 0) return;
  b.t += dt;
  b.wob += dt * 6;
  const distP = Math.hypot(player.x - b.x, player.y - b.y);
  const home = tileCenter(b.room.cx, b.room.cy);
  const distHome = Math.hypot(b.x - home.x, b.y - home.y);
  const playerNearRoom = Math.hypot(player.x - home.x, player.y - home.y) < TILE * 11;
  const rad = TILE * b.def.size * 0.5;

  if (b.state === 'sleep') {
    if (distP < TILE * 7 && playerNearRoom) {
      b.state = 'chase'; b.t = 0;
      banner('⚠ ' + b.def.name + ' AWAKENS! ⚠', '#ff5b5b');
      sfx.roar();
      showBossBar(b);
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    }
    return;
  }
  showBossBar(b);

  if (!playerNearRoom) {
    // you ran away — the boss trudges home and catches its breath
    b.state = 'return';
  }
  if (b.state === 'return') {
    if (distHome < TILE) { b.state = 'sleep'; b.hp = Math.min(b.maxHp, b.hp + 1); hideBossBar(); return; }
    const dx = home.x - b.x, dy = home.y - b.y, len = Math.hypot(dx, dy) || 1;
    moveActor(b, dx / len * b.def.speed * TILE * dt, dy / len * b.def.speed * TILE * dt, rad);
    return;
  }
  if (b.state === 'chase') {
    let dx = player.x - b.x, dy = player.y - b.y;
    const len = Math.hypot(dx, dy) || 1;
    let sp = b.def.speed * TILE;
    // the bat weaves side to side
    if (b.def.name === 'GIANT CAVE BAT') {
      const px = -dy / len, py = dx / len;
      dx += px * Math.sin(b.wob * 1.7) * len * 0.6;
      dy += py * Math.sin(b.wob * 1.7) * len * 0.6;
    }
    const l2 = Math.hypot(dx, dy) || 1;
    moveActor(b, dx / l2 * sp * dt, dy / l2 * sp * dt, rad);
    if (b.t > 3.2 && distP < TILE * 6) { b.state = 'windup'; b.t = 0; }
    // the crystal king grows a chasing shard
    if (b.def.name === 'CRYSTAL KING' && b.shards.length < 1 && Math.random() < dt * 0.25) {
      b.shards.push({ x: b.x, y: b.y, t: 0 });
      sfx.shard();
    }
  } else if (b.state === 'windup') {
    if (b.t > 0.9) {
      const dx = player.x - b.x, dy = player.y - b.y, len = Math.hypot(dx, dy) || 1;
      b.dashDir = { x: dx / len, y: dy / len };
      b.state = 'dash'; b.t = 0;
      sfx.dash();
    }
  } else if (b.state === 'dash') {
    moveActor(b, b.dashDir.x * b.def.dashSpeed * TILE * dt, b.dashDir.y * b.def.dashSpeed * TILE * dt, rad);
    if (b.t > 0.45) { b.state = 'chase'; b.t = 0; }
  }

  b.shards.forEach(function (s) {
    s.t += dt;
    const dx = player.x - s.x, dy = player.y - s.y, len = Math.hypot(dx, dy) || 1;
    s.x += dx / len * 1.2 * TILE * dt;
    s.y += dy / len * 1.2 * TILE * dt;
    if (len < 14) { hurtPlayer(s.x, s.y); }
  });

  if (distP < rad + 12) hurtPlayer(b.x, b.y);
}

function updateSquirrels(dt) {
  let followIdx = 0;
  squirrels.forEach(function (s) {
    s.hop += dt * 8;
    if (!s.freed) {
      // cage opens once its boss is beaten — walk up to set them free
      const boss = bosses[world.rooms.indexOf(s.room)];
      if (boss.hp <= 0 && Math.hypot(player.x - s.x, player.y - s.y) < TILE * 1.3) {
        s.freed = true;
        squirrelsFreed++;
        sfx.squirrel();
        banner('🐿️ SQUIRREL RESCUED! (' + squirrelsFreed + '/' + SQUIRRELS_NEEDED + ')', '#7df9a0');
        burst(s.x, s.y, '#c98a4b', 14);
        updateHud();
      }
      return;
    }
    if (s.boarded) return;
    followIdx++;
    const back = trail.length - 1 - followIdx * 14;
    const target = back >= 0 ? trail[back] : { x: player.x, y: player.y };
    const dx = target.x - s.x, dy = target.y - s.y;
    const d = Math.hypot(dx, dy);
    if (d > 6) {
      const sp = Math.min(d * 6, 5.4 * TILE);
      s.x += dx / d * sp * dt;
      s.y += dy / d * sp * dt;
    }
  });
}

function updatePickups() {
  world.batteries.forEach(function (b) {
    if (b.taken) return;
    const p = tileCenter(b.c, b.r);
    if (Math.hypot(player.x - p.x, player.y - p.y) < TILE * 0.8) {
      b.taken = true;
      player.battery = Math.min(100, player.battery + 45);
      sfx.battery();
      burst(p.x, p.y, '#2ee06a', 8);
      updateHud();
    }
  });
  world.diamonds.forEach(function (d) {
    if (d.found) return;
    const p = tileCenter(d.c, d.r);
    if (Math.hypot(player.x - p.x, player.y - p.y) < TILE * 0.8) {
      d.found = true;
      diamondsFound++;
      sfx.diamond();
      burst(p.x, p.y, '#7df9ff', 16);
      banner('💎 DIAMOND! (' + diamondsFound + '/' + DIAMONDS_NEEDED + ')', '#7df9ff');
      if (navigator.vibrate) navigator.vibrate(40);
      updateHud();
    }
  });
  world.hearts.forEach(function (h) {
    if (h.taken) return;
    if (Math.hypot(player.x - h.x, player.y - h.y) < TILE * 0.7) {
      h.taken = true;
      player.hearts = Math.min(MAX_HEARTS, player.hearts + 1);
      sfx.heart();
      burst(h.x, h.y, '#ff6b9d', 8);
      updateHud();
    }
  });
}

// rescued squirrel friends sniff out the nearest hidden diamond
function updateHints(dt) {
  if (squirrelsFreed === 0 || diamondsFound >= DIAMONDS_NEEDED) return;
  hintTimer -= dt;
  if (hintTimer > 0) return;
  hintTimer = 5;
  let nearest = null, best = Infinity;
  world.diamonds.forEach(function (d) {
    if (d.found) return;
    const p = tileCenter(d.c, d.r);
    const dist = Math.hypot(p.x - player.x, p.y - player.y);
    if (dist < best) { best = dist; nearest = p; }
  });
  if (!nearest) return;
  const dx = nearest.x - player.x, dy = nearest.y - player.y;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i <= 5; i++) {
    hintSparks.push({
      x: player.x + dx / len * i * 26,
      y: player.y + dy / len * i * 26,
      t: -i * 0.12,
    });
  }
  sfx.chitter();
}

let launch = { t: 0, y: 0 };
function updateLaunch(dt) {
  launch.t += dt;
  if (launch.t > 1) {
    launch.y += (launch.t - 1) * (launch.t - 1) * 260 * dt * 8;
    shakeT = 0.1;
    if (Math.random() < 0.7) {
      const rp = tileCenter(world.rocket.c, world.rocket.r);
      burst(rp.x + (Math.random() - 0.5) * 14, rp.y - launch.y + 36, Math.random() < 0.5 ? '#ffd84a' : '#ff7b3e', 2);
    }
  }
  if (launch.t > 4.4) {
    setState('victory');
    const mins = Math.floor(timePlayed / 60), secs = Math.floor(timePlayed % 60);
    showOverlay('YOU DID IT! 🎉', '🚀🐿️🐿️🐿️',
      'All ' + SQUIRRELS_NEEDED + ' squirrels are flying home with ' + DIAMONDS_NEEDED + ' diamonds!<br>' +
      'Cave conquered in ' + mins + 'm ' + secs + 's with ' + lives + ' explorer' + (lives === 1 ? '' : 's') + ' left.<br>' +
      'Your friends cheer as the rocket zooms to the stars! ⭐',
      '🌟 Explore a New Cave');
  }
}

function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 120;
    particles.push({
      x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      t: 0, life: 0.4 + Math.random() * 0.4, color: color,
    });
  }
}

/* ============================== Rendering ============================== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let darkCanvas = document.createElement('canvas');
let dctx = darkCanvas.getContext('2d');
let VIEW_W = 0, VIEW_H = 0, DPR = 1;
const cam = { x: 0, y: 0 };

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VIEW_W = window.innerWidth;
  VIEW_H = window.innerHeight;
  canvas.width = Math.round(VIEW_W * DPR);
  canvas.height = Math.round(VIEW_H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  darkCanvas.width = canvas.width;
  darkCanvas.height = canvas.height;
  dctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function lightRadius() {
  return 70 + (player.battery / 100) * 150;
}

function draw(now) {
  if (!world) { ctx.fillStyle = '#06040c'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); return; }

  // camera follows player (or the rocket during launch)
  let fx = player.x, fy = player.y;
  if (state === 'launch') {
    const rp = tileCenter(world.rocket.c, world.rocket.r);
    fx = rp.x; fy = rp.y - launch.y * 0.5;
  }
  cam.x += (fx - VIEW_W / 2 - cam.x) * 0.12;
  cam.y += (fy - VIEW_H / 2 - cam.y) * 0.12;
  cam.x = Math.max(-TILE * 2, Math.min(W * TILE - VIEW_W + TILE * 2, cam.x));
  cam.y = Math.max(-TILE * 2, Math.min(H * TILE - VIEW_H + TILE * 2, cam.y));

  ctx.save();
  if (shakeT > 0) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
  ctx.fillStyle = '#06040c';
  ctx.fillRect(-10, -10, VIEW_W + 20, VIEW_H + 20);
  ctx.translate(-cam.x, -cam.y);

  drawTiles();
  drawPickups(now);
  drawCagesAndSquirrels(now);
  bosses.forEach(function (b) { drawBoss(b, now); });
  drawRocket(now);
  if (state !== 'launch' || launch.t < 1.2) drawPlayer(now);
  drawParticles();
  drawHintSparks(now);
  ctx.restore();

  drawDarkness(now);
  drawCompass();
}

function drawTiles() {
  const c0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
  const r0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
  const c1 = Math.min(W - 1, Math.ceil((cam.x + VIEW_W) / TILE) + 1);
  const r1 = Math.min(H - 1, Math.ceil((cam.y + VIEW_H) / TILE) + 1);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const x = c * TILE, y = r * TILE;
      if (grid[idx(c, r)] === 1) {
        ctx.fillStyle = ((c * 7 + r * 13) % 5 === 0) ? '#1c1428' : '#181022';
        ctx.fillRect(x, y, TILE, TILE);
        if (!isWall(c, r + 1)) { // lit edge where rock meets floor
          ctx.fillStyle = '#3a2b52';
          ctx.fillRect(x, y + TILE - 4, TILE, 4);
        }
      } else {
        ctx.fillStyle = ((c * 11 + r * 17) % 7 === 0) ? '#322843' : '#2b2239';
        ctx.fillRect(x, y, TILE, TILE);
        if ((c * 31 + r * 57) % 23 === 0) { // pebbles
          ctx.fillStyle = '#3e3354';
          ctx.fillRect(x + (c * 13 % 20) + 4, y + (r * 7 % 20) + 4, 4, 3);
        }
      }
    }
  }
}

function drawPickups(now) {
  world.batteries.forEach(function (b) {
    if (b.taken) return;
    const p = tileCenter(b.c, b.r);
    ctx.save();
    ctx.translate(p.x, p.y + Math.sin(now / 300 + b.c) * 2);
    ctx.fillStyle = '#2ee06a';
    ctx.fillRect(-5, -8, 10, 16);
    ctx.fillStyle = '#b8f04a';
    ctx.fillRect(-3, -11, 6, 3);
    ctx.fillStyle = '#0a4422';
    ctx.fillRect(-5, -2, 10, 4);
    ctx.restore();
  });
  world.diamonds.forEach(function (d) {
    if (d.found) return;
    const p = tileCenter(d.c, d.r);
    const tw = 0.8 + Math.sin(now / 200 + d.c * 3) * 0.2;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(tw, tw);
    ctx.fillStyle = '#7df9ff';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(7, -2); ctx.lineTo(0, 10); ctx.lineTo(-7, -2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(3, -2); ctx.lineTo(-3, -2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  world.hearts.forEach(function (h) {
    if (h.taken) return;
    ctx.save();
    ctx.translate(h.x, h.y + Math.sin(now / 250) * 2);
    ctx.fillStyle = '#ff5b7d';
    ctx.beginPath();
    ctx.arc(-3.5, -2, 4, 0, Math.PI * 2);
    ctx.arc(3.5, -2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-7, 0); ctx.lineTo(0, 8); ctx.lineTo(7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
}

function drawCagesAndSquirrels(now) {
  squirrels.forEach(function (s, i) {
    if (s.boarded) return;
    const hopY = s.freed ? Math.abs(Math.sin(s.hop)) * -4 : 0;
    ctx.save();
    ctx.translate(s.x, s.y + hopY);
    // squirrel
    ctx.fillStyle = '#b5703a';
    ctx.beginPath(); // fluffy tail
    ctx.ellipse(-9, -6, 6, 9, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c98a4b';
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); // head
    ctx.arc(7, -5, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(8.5, -6, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a5a2b';
    ctx.beginPath(); // ear
    ctx.arc(5, -9.5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (!s.freed) {
      // cage bars
      const boss = bosses[world.rooms.indexOf(s.room)];
      const open = boss.hp <= 0;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.strokeStyle = open ? '#5a7a5a' : '#9aa3b5';
      ctx.lineWidth = 3;
      ctx.strokeRect(-16, -18, 32, 32);
      if (!open) {
        for (let k = -10; k <= 10; k += 7) {
          ctx.beginPath(); ctx.moveTo(k, -18); ctx.lineTo(k, 14); ctx.stroke();
        }
      } else {
        ctx.fillStyle = '#7df9a0';
        ctx.font = '12px Georgia';
        ctx.textAlign = 'center';
        ctx.fillText('FREE ME!', 0, -24);
      }
      ctx.restore();
    }
  });
}

function drawBoss(b, now) {
  if (b.hp <= 0) return;
  const r = TILE * b.def.size * 0.55;
  ctx.save();
  ctx.translate(b.x, b.y);
  const windup = b.state === 'windup';
  if (windup) ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);

  if (b.def.name === 'GIANT CAVE BAT') {
    const flap = Math.sin(b.wob * 2.4) * 0.6;
    ctx.fillStyle = b.def.color;
    for (const side of [-1, 1]) { // wings
      ctx.beginPath();
      ctx.moveTo(side * r * 0.3, 0);
      ctx.quadraticCurveTo(side * r * 1.8, -r * (0.8 + flap), side * r * 2.1, r * 0.3 - flap * r);
      ctx.quadraticCurveTo(side * r * 1.2, r * 0.25, side * r * 0.3, r * 0.4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.6, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2266'; // ears
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, -r * 0.6); ctx.lineTo(-r * 0.2, -r * 1.1); ctx.lineTo(0, -r * 0.6);
    ctx.moveTo(r * 0.4, -r * 0.6); ctx.lineTo(r * 0.2, -r * 1.1); ctx.lineTo(0, -r * 0.6);
    ctx.fill();
  } else if (b.def.name === 'CRYSTAL KING') {
    ctx.fillStyle = b.def.color;
    ctx.beginPath(); // crystal cluster body
    ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 0.8, -r * 0.2); ctx.lineTo(r, r * 0.9);
    ctx.lineTo(-r, r * 0.9); ctx.lineTo(-r * 0.8, -r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#bdf6fa';
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 0.3, -r * 0.3); ctx.lineTo(-r * 0.3, -r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd84a'; // crown
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(k * r * 0.4 - 4, -r * 1.25); ctx.lineTo(k * r * 0.4, -r * 1.55); ctx.lineTo(k * r * 0.4 + 4, -r * 1.25);
      ctx.fill();
    }
  } else { // golem
    ctx.fillStyle = b.def.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6e6e7a';
    ctx.beginPath(); // rocky lumps
    ctx.arc(-r * 0.5, -r * 0.5, r * 0.45, 0, Math.PI * 2);
    ctx.arc(r * 0.55, -r * 0.35, r * 0.38, 0, Math.PI * 2);
    ctx.arc(0, r * 0.5, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // angry eyes (also drawn over the darkness so they glow from afar)
  ctx.fillStyle = windup ? '#fff' : '#ff3535';
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.15, 3.4, 0, Math.PI * 2);
  ctx.arc(r * 0.3, -r * 0.15, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#9ef';
  b.shards.forEach(function (s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.t * 4);
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  });
}

function drawRocket(now) {
  const rp = tileCenter(world.rocket.c, world.rocket.r);
  const y = rp.y - (state === 'launch' ? launch.y : 0);
  ctx.save();
  ctx.translate(rp.x, y);
  // launch pad
  ctx.fillStyle = '#4a4258';
  ctx.fillRect(-30, 26, 60, 8);
  // body
  ctx.fillStyle = '#e8e4f5';
  ctx.beginPath();
  ctx.moveTo(0, -44);
  ctx.quadraticCurveTo(18, -18, 16, 14);
  ctx.lineTo(-16, 14);
  ctx.quadraticCurveTo(-18, -18, 0, -44);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff4d4d'; // nose
  ctx.beginPath();
  ctx.moveTo(0, -44);
  ctx.quadraticCurveTo(12, -30, 13, -20);
  ctx.lineTo(-13, -20);
  ctx.quadraticCurveTo(-12, -30, 0, -44);
  ctx.closePath();
  ctx.fill();
  // window with waving friends inside
  ctx.fillStyle = '#7df9ff';
  ctx.beginPath();
  ctx.arc(0, -6, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a3344';
  ctx.beginPath();
  ctx.arc(-3, -5, 2.6, 0, Math.PI * 2);
  ctx.arc(3.5, -6, 2.6, 0, Math.PI * 2);
  ctx.fill();
  // fins
  ctx.fillStyle = '#ff4d4d';
  ctx.beginPath();
  ctx.moveTo(-16, 2); ctx.lineTo(-26, 24); ctx.lineTo(-14, 14);
  ctx.moveTo(16, 2); ctx.lineTo(26, 24); ctx.lineTo(14, 14);
  ctx.fill();
  // flame during launch
  if (state === 'launch' && launch.t > 1) {
    const f = 18 + Math.random() * 18;
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.moveTo(-9, 15); ctx.lineTo(0, 15 + f); ctx.lineTo(9, 15);
    ctx.closePath();
    ctx.fill();
  }
  // ready beacon when all objectives are done
  if (state === 'play' && diamondsFound >= DIAMONDS_NEEDED && squirrelsFreed >= SQUIRRELS_NEEDED) {
    ctx.fillStyle = 'rgba(125,249,160,' + (0.5 + Math.sin(now / 150) * 0.4) + ')';
    ctx.font = 'bold 14px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText('ALL ABOARD!', 0, -56);
  }
  ctx.restore();
}

function drawPlayer(now) {
  ctx.save();
  ctx.translate(player.x, player.y);
  if (player.iframes > 0 && Math.floor(now / 90) % 2 === 0) ctx.globalAlpha = 0.35;
  const bob = Math.sin(player.walk) * 1.5;
  // backpack
  ctx.fillStyle = '#c9742e';
  ctx.fillRect(-12 - player.face.x * 3, -6 + bob, 8, 12);
  // suit body
  ctx.fillStyle = '#e8e4f5';
  ctx.beginPath();
  ctx.ellipse(0, 4 + bob, 9, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  // helmet
  ctx.beginPath();
  ctx.arc(0, -8 + bob, 10, 0, Math.PI * 2);
  ctx.fill();
  // visor looks where you walk
  ctx.fillStyle = '#2a3d55';
  ctx.beginPath();
  ctx.ellipse(player.face.x * 3, -8 + bob + player.face.y * 2, 6.5, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(player.face.x * 3 - 2, -10 + bob, 1.8, 0, Math.PI * 2);
  ctx.fill();
  // zap ring
  if (player.zapAnim > 0) {
    ctx.globalAlpha = player.zapAnim * 0.8;
    ctx.strokeStyle = '#ffd84a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, (1 - player.zapAnim) * TILE * 2.6 + 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticles() {
  particles.forEach(function (p) {
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
  });
  ctx.globalAlpha = 1;
}

function drawHintSparks(now) {
  hintSparks.forEach(function (s) {
    if (s.t < 0) return;
    const a = Math.max(0, 1 - s.t / 1.2);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffe9a0';
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.t * 5);
    ctx.fillRect(-4, -1.5, 8, 3);
    ctx.fillRect(-1.5, -4, 3, 8);
    ctx.restore();
  });
  ctx.globalAlpha = 1;
}

function drawDarkness(now) {
  dctx.globalCompositeOperation = 'source-over';
  dctx.fillStyle = 'rgba(2, 1, 8, 0.97)';
  dctx.fillRect(0, 0, VIEW_W, VIEW_H);
  dctx.globalCompositeOperation = 'destination-out';

  const hole = function (wx, wy, radius, strength) {
    const x = wx - cam.x, y = wy - cam.y;
    if (x < -radius || x > VIEW_W + radius || y < -radius || y > VIEW_H + radius) return;
    const g = dctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, 'rgba(0,0,0,' + strength + ')');
    g.addColorStop(0.7, 'rgba(0,0,0,' + strength * 0.55 + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = g;
    dctx.beginPath();
    dctx.arc(x, y, radius, 0, Math.PI * 2);
    dctx.fill();
  };

  const lr = lightRadius() * (1 + Math.sin(now / 90) * 0.015);
  hole(player.x, player.y, lr, 1);
  // batteries glow faintly so a dying flashlight can still find one
  world.batteries.forEach(function (b) {
    if (b.taken) return;
    const p = tileCenter(b.c, b.r);
    hole(p.x, p.y, 26, 0.8);
  });
  // diamonds only shimmer once your light almost touches them
  world.diamonds.forEach(function (d) {
    if (d.found) return;
    const p = tileCenter(d.c, d.r);
    if (Math.hypot(p.x - player.x, p.y - player.y) < lr * 1.05) hole(p.x, p.y, 22, 0.9);
  });
  world.hearts.forEach(function (h) {
    if (!h.taken) hole(h.x, h.y, 22, 0.7);
  });
  const rp = tileCenter(world.rocket.c, world.rocket.r);
  hole(rp.x, rp.y - (state === 'launch' ? launch.y : 0), 110, 0.9);
  hintSparks.forEach(function (s) { if (s.t >= 0) hole(s.x, s.y, 18, 0.8); });

  ctx.drawImage(darkCanvas, 0, 0, VIEW_W, VIEW_H);

  // glowing boss eyes pierce the dark
  bosses.forEach(function (b) {
    if (b.hp <= 0) return;
    const x = b.x - cam.x, y = b.y - cam.y;
    if (x < -20 || x > VIEW_W + 20 || y < -20 || y > VIEW_H + 20) return;
    const r = TILE * b.def.size * 0.55;
    const blink = b.state === 'sleep' && Math.floor(now / 1400) % 3 === 0;
    if (blink) return;
    ctx.fillStyle = '#ff3535';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.15, 2.6, 0, Math.PI * 2);
    ctx.arc(x + r * 0.3, y - r * 0.15, 2.6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawCompass() {
  if (state !== 'play') return;
  const rp = tileCenter(world.rocket.c, world.rocket.r);
  const dx = rp.x - player.x, dy = rp.y - player.y;
  const dist = Math.hypot(dx, dy);
  if (dist < TILE * 7) return;
  const ready = diamondsFound >= DIAMONDS_NEEDED && squirrelsFreed >= SQUIRRELS_NEEDED;
  const a = Math.atan2(dy, dx);
  const cx = VIEW_W / 2 + Math.cos(a) * Math.min(VIEW_W, VIEW_H) * 0.36;
  const cy = VIEW_H / 2 + Math.sin(a) * Math.min(VIEW_W, VIEW_H) * 0.36;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a);
  ctx.globalAlpha = ready ? 0.95 : 0.4;
  ctx.fillStyle = ready ? '#7df9a0' : '#8e7bb0';
  ctx.beginPath();
  ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (ready) {
    ctx.font = '11px Georgia';
    ctx.fillStyle = '#7df9a0';
    ctx.textAlign = 'center';
    ctx.fillText('🚀', cx, cy - 14);
  }
  ctx.globalAlpha = 1;
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
    battery: function () { tone(520, 0.12, 'triangle', 0.07, 780); },
    diamond: function () {
      tone(880, 0.12, 'triangle', 0.07);
      setTimeout(function () { tone(1175, 0.18, 'triangle', 0.07); }, 110);
    },
    heart: function () { tone(660, 0.15, 'sine', 0.07, 880); },
    zap: function () { tone(900, 0.12, 'sawtooth', 0.05, 200); },
    deny: function () { tone(160, 0.15, 'square', 0.05); },
    hurt: function () { tone(220, 0.25, 'sawtooth', 0.07, 90); },
    death: function () { tone(500, 0.9, 'sawtooth', 0.07, 60); },
    roar: function () { tone(90, 0.7, 'sawtooth', 0.1, 50); },
    dash: function () { tone(300, 0.2, 'square', 0.05, 600); },
    shard: function () { tone(1400, 0.1, 'triangle', 0.04, 900); },
    bossHit: function () { tone(180, 0.1, 'square', 0.07, 120); },
    bossDown: function () {
      tone(200, 0.2, 'square', 0.08, 100);
      setTimeout(function () { tone(440, 0.2, 'triangle', 0.08); }, 200);
      setTimeout(function () { tone(660, 0.3, 'triangle', 0.08); }, 400);
    },
    squirrel: function () {
      tone(1100, 0.08, 'square', 0.05);
      setTimeout(function () { tone(1400, 0.08, 'square', 0.05); }, 90);
      setTimeout(function () { tone(1100, 0.08, 'square', 0.05); }, 180);
    },
    chitter: function () { tone(1600, 0.06, 'square', 0.03, 1900); },
    fanfare: function () {
      [440, 554, 659, 880].forEach(function (f, i) {
        setTimeout(function () { tone(f, 0.25, 'triangle', 0.08); }, i * 160);
      });
    },
  };
})();

/* ============================== Input ============================== */
const joy = { active: false, id: null, sx: 0, sy: 0, dx: 0, dy: 0 };
let zapQueued = false;
const keys = {};

function inputVector() {
  let x = 0, y = 0;
  if (keys.ArrowLeft || keys.a) x -= 1;
  if (keys.ArrowRight || keys.d) x += 1;
  if (keys.ArrowUp || keys.w) y -= 1;
  if (keys.ArrowDown || keys.s) y += 1;
  if (joy.active) {
    const jx = joy.dx / 50, jy = joy.dy / 50;
    const len = Math.hypot(jx, jy);
    if (len > 0.15) {
      x = len > 1 ? jx / len : jx;
      y = len > 1 ? jy / len : jy;
    }
  }
  return { x: x, y: y };
}

canvas.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  sfx.unlock();
  if (state === 'paused') setState('play');
  if (!joy.active) {
    joy.active = true;
    joy.id = e.pointerId;
    joy.sx = e.clientX; joy.sy = e.clientY;
    joy.dx = 0; joy.dy = 0;
  }
}, { passive: false });
canvas.addEventListener('pointermove', function (e) {
  if (joy.active && e.pointerId === joy.id) {
    joy.dx = e.clientX - joy.sx;
    joy.dy = e.clientY - joy.sy;
    const len = Math.hypot(joy.dx, joy.dy);
    if (len > 60) { // joystick drags along with big swipes
      joy.sx = e.clientX - joy.dx / len * 60;
      joy.sy = e.clientY - joy.dy / len * 60;
      joy.dx = e.clientX - joy.sx;
      joy.dy = e.clientY - joy.sy;
    }
  }
}, { passive: false });
function joyEnd(e) {
  if (joy.active && e.pointerId === joy.id) {
    joy.active = false;
    joy.id = null;
  }
}
window.addEventListener('pointerup', joyEnd);
window.addEventListener('pointercancel', joyEnd);

document.getElementById('zap').addEventListener('pointerdown', function (e) {
  e.preventDefault();
  e.stopPropagation();
  sfx.unlock();
  zapQueued = true;
}, { passive: false });

window.addEventListener('keydown', function (e) {
  keys[e.key] = true;
  if (e.key === ' ' || e.key === 'Enter') {
    if (!overlayEl.classList.contains('hidden')) { startBtn.click(); }
    else { zapQueued = true; }
    e.preventDefault();
  }
  if (e.key.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', function (e) { keys[e.key] = false; });

document.addEventListener('visibilitychange', function () {
  if (document.hidden && state === 'play') setState('paused');
});

/* ============================== UI ============================== */
const overlayEl = document.getElementById('overlay');
const overlayTitle = overlayEl.querySelector('h1');
const overlayIcons = overlayEl.querySelector('.icons');
const overlayText = document.getElementById('overlay-text');
const startBtn = document.getElementById('start-btn');
const bannerEl = document.getElementById('banner');
const bossbarEl = document.getElementById('bossbar');
const muteBtn = document.getElementById('mute');
let bannerTimeout = null;

function showOverlay(title, icons, html, btnLabel) {
  overlayTitle.textContent = title;
  overlayIcons.textContent = icons;
  overlayText.innerHTML = html;
  startBtn.textContent = btnLabel;
  overlayEl.classList.remove('hidden');
}
function banner(text, color) {
  bannerEl.textContent = text;
  bannerEl.style.color = color;
  bannerEl.style.opacity = '1';
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(function () { bannerEl.style.opacity = '0'; }, 2200);
}
function showBossBar(b) {
  bossbarEl.style.display = 'block';
  document.getElementById('bossname').textContent = b.def.name;
  document.getElementById('bossfill').style.width = Math.max(0, b.hp / b.maxHp * 100) + '%';
}
function hideBossBar() { bossbarEl.style.display = 'none'; }

function updateHud() {
  document.getElementById('hearts').textContent =
    '❤️'.repeat(Math.max(0, player.hearts)) + '🖤'.repeat(Math.max(0, MAX_HEARTS - player.hearts));
  document.getElementById('battfill').style.width = player.battery + '%';
  document.getElementById('battfill').style.background =
    player.battery < 25 ? 'linear-gradient(90deg,#e02545,#ff7b3e)' : 'linear-gradient(90deg,#2ee06a,#b8f04a)';
  document.getElementById('goal').innerHTML =
    '💎 ' + diamondsFound + '/' + DIAMONDS_NEEDED + ' &nbsp; 🐿️ ' + squirrelsFreed + '/' + SQUIRRELS_NEEDED;
  document.getElementById('lives').textContent = '🧑‍🚀'.repeat(Math.max(0, lives));
  document.getElementById('zap').classList.toggle('dead', player.battery < 4);
}

muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
muteBtn.addEventListener('click', function () {
  muteBtn.textContent = sfx.toggleMute() ? '🔇' : '🔊';
});

startBtn.addEventListener('click', function () {
  sfx.unlock();
  overlayEl.classList.add('hidden');
  newGame((Math.random() * 1e9) | 0);
  setState('play');
});

/* ============================== Main loop ============================== */
let lastTime = 0;
let hudTick = 0;
function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  draw(now);
  hudTick += dt;
  if (hudTick > 0.25) { hudTick = 0; if (state === 'play') updateHud(); }
  if (state === 'paused') {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#cfc6e8';
    ctx.font = 'bold 22px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED — TAP TO CONTINUE', VIEW_W / 2, VIEW_H / 2);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(function (now) {
  lastTime = now;
  requestAnimationFrame(frame);
});
