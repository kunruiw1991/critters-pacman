import { CHAPTERS, VILLAINS } from './chapters.js';
import { sound } from './audio.js';

// ============================================================================
// CRITTER PAC-MAZE · 萌宠吃豆人 (8 CHAPTERS, EACH WITH A UNIQUE CRITTER HEAD!)
// ============================================================================

const COLS = 21;
const ROWS = 19;
const TILE = 32; // 21 * 32 = 672px, 19 * 32 = 608px
const SAVE_KEY = 'critter_pacman_save_v1';

const canvas = document.getElementById('mazeCanvas');
const ctx = canvas.getContext('2d');

// Preload all Critter Head & Villain Ghost portraits
const imageCache = new Map();
function preloadImages() {
  const urls = new Set();
  CHAPTERS.forEach(c => urls.add(c.icon));
  VILLAINS.forEach(v => urls.add(v.icon));
  urls.forEach(url => {
    const img = new Image();
    img.src = url;
    imageCache.set(url, img);
  });
}
preloadImages();

const DIRS = {
  none:  { dx: 0,  dy: 0,  angle: 0 },
  right: { dx: 1,  dy: 0,  angle: 0 },
  down:  { dx: 0,  dy: 1,  angle: Math.PI / 2 },
  left:  { dx: -1, dy: 0,  angle: Math.PI },
  up:    { dx: 0,  dy: -1, angle: -Math.PI / 2 }
};

const SPEED_PRESETS = {
  gentle: { playerSpeed: 3.2, ghostSpeed: 1.75, frightDuration: 11.0 },
  normal: { playerSpeed: 3.8, ghostSpeed: 2.15, frightDuration: 9.5 },
  turbo:  { playerSpeed: 4.6, ghostSpeed: 2.75, frightDuration: 8.0 }
};

export const S = {
  phase: 'playing', // 'playing' | 'paused' | 'victory' | 'gameover'
  speedMode: 'normal',
  immortalMode: true, // Colliding with ghosts bounces them away without dying!
  chapterIndex: 0,
  chapter: CHAPTERS[0],
  clearedChapters: new Set(),
  score: 0,
  highScore: 0,
  lives: 99,
  maxLives: 99,
  totalBeans: 0,
  beansLeft: 0,
  beansEaten: 0,
  ghostCombo: 0,
  frightTimer: 0,
  freezeTimer: 0,
  slowTimer: 0,
  grid: [], // 2D array [row][col]: '#' | '.' | 'o' | ' ' | '-' | 'G'
  bonusFruit: null, // { x, y, emoji, timer, points }
  fruitSpawned1: false,
  fruitSpawned2: false,
  player: {
    x: 10,
    y: 15,
    spawnX: 10,
    spawnY: 15,
    dir: 'none',
    nextDir: 'none',
    facingAngle: 0,
    mouthAngle: 0.25,
    chompPhase: 0,
    invulnTimer: 0,
    shieldTimer: 0,
    dashTimer: 0,
    skillCd: 0,
    skillMaxCd: 11.0
  },
  ghosts: [],
  particles: [],
  popups: []
};

// ============================================================================
// CHAPTER INITIALIZATION & MAZE BUILDER
// ============================================================================
export function loadChapter(chapIdx, resetScoreAndLives = false) {
  const idx = Math.max(0, Math.min(CHAPTERS.length - 1, Number(chapIdx) || 0));
  S.chapterIndex = idx;
  const chap = CHAPTERS[idx];
  S.chapter = chap;

  if (resetScoreAndLives) {
    S.score = 0;
    S.lives = 99;
  }

  S.grid = [];
  S.totalBeans = 0;
  S.beansLeft = 0;
  S.beansEaten = 0;
  S.frightTimer = 0;
  S.freezeTimer = 0;
  S.slowTimer = 0;
  S.ghostCombo = 0;
  S.bonusFruit = null;
  S.fruitSpawned1 = false;
  S.fruitSpawned2 = false;
  S.particles = [];
  S.popups = [];

  let spawnX = 10;
  let spawnY = 15;

  for (let r = 0; r < ROWS; r++) {
    const rawRow = (chap.map[r] || '').padEnd(COLS, '#');
    const rowArr = [];
    for (let c = 0; c < COLS; c++) {
      let ch = rawRow[c];
      if (ch === 'P') {
        spawnX = c;
        spawnY = r;
        ch = ' ';
      } else if (ch === '.' || ch === 'o') {
        S.totalBeans++;
        S.beansLeft++;
      }
      rowArr.push(ch);
    }
    S.grid.push(rowArr);
  }

  S.player.spawnX = spawnX;
  S.player.spawnY = spawnY;
  S.player.skillMaxCd = chap.skill?.cooldown || 11.0;
  S.player.skillCd = 0;
  resetPositionsAfterLifeLost(true);

  S.phase = 'playing';
  document.getElementById('resultModal')?.classList.add('hidden');
  document.getElementById('mainMenuModal')?.classList.add('hidden');

  renderChapterTabs();
  updateHUD();
  showBanner(`🎭 ${chap.critterName} · Eat all ${chap.beanEmoji} Beans! (撞到不死)`, 2.2);
}

function resetPositionsAfterLifeLost(fullReset = false) {
  S.player.x = S.player.spawnX;
  S.player.y = S.player.spawnY;
  S.player.dir = 'none';
  S.player.nextDir = 'none';
  S.player.facingAngle = 0;
  S.player.mouthAngle = 0.28;
  S.player.invulnTimer = fullReset ? 1.5 : 2.5;
  S.player.shieldTimer = 0;
  S.player.dashTimer = 0;

  // Spawn 4 Villain Ghosts in and around the Ghost House with relaxed staggered release
  const startPositions = [
    { x: 10, y: 8,  dir: 'left',  releaseDelay: 0.5 },
    { x: 9,  y: 11, dir: 'up',    releaseDelay: 2.5 },
    { x: 10, y: 11, dir: 'up',    releaseDelay: 4.8 },
    { x: 11, y: 11, dir: 'up',    releaseDelay: 7.2 }
  ];

  S.ghosts = VILLAINS.map((v, i) => {
    const pos = startPositions[i % startPositions.length];
    return {
      ...v,
      index: i,
      x: pos.x,
      y: pos.y,
      homeX: 10,
      homeY: 8,
      dir: pos.dir,
      state: 'normal', // 'normal' | 'frightened' | 'eaten'
      releaseTimer: pos.releaseDelay,
      decisionCooldown: 0
    };
  });
}

// ============================================================================
// ACTIVE CRITTER SKILL SYSTEM (UNIQUE PER CHAPTER CRITTER HEAD!)
// ============================================================================
export function activateCritterSkill() {
  if (S.phase !== 'playing') return false;
  if (S.player.skillCd > 0) {
    showBanner(`⏳ Skill Cooling Down (${S.player.skillCd.toFixed(1)}s) · 技能冷却中`, 1.1);
    return false;
  }

  const chap = S.chapter;
  const sk = chap.skill;
  S.player.skillCd = sk.cooldown || 11.0;
  sound.skill();

  const px = S.player.x;
  const py = S.player.y;
  spawnParticles(px, py, chap.ringColor, 18);

  if (sk.id === 'solar_dash') {
    // DogDay: 3.0s blazing speed + solar shield
    S.player.dashTimer = sk.duration;
    S.player.shieldTimer = sk.duration;
    showBanner(`☀️ DogDay Solar Dash! · 阳光冲刺无敌加速！`, 1.8);
  } else if (sk.id === 'poppy_slumber') {
    // CatNap: Freezes all ghosts in place for 3.5s
    S.freezeTimer = sk.duration;
    showBanner(`💤 CatNap Poppy Slumber! · 全场反派催眠定身！`, 1.8);
  } else if (sk.id === 'heart_shield') {
    // Bobby BearHug: 4.0s rose shield + magnetizes nearby beans
    S.player.shieldTimer = sk.duration;
    vacuumNearbyBeans(3.2);
    showBanner(`🛡️ Bobby Heart Hug Shield! · 爱心护盾+吸豆！`, 1.8);
  } else if (sk.id === 'rainbow_fright') {
    // CraftyCorn: Turns all ghosts Frightened blue for 4.0s + speed boost
    S.frightTimer = Math.max(S.frightTimer, sk.duration);
    S.player.dashTimer = 2.0;
    S.ghosts.forEach(g => {
      if (g.state !== 'eaten') g.state = 'frightened';
    });
    showBanner(`🌈 CraftyCorn Prism Flash! · 彩虹炫光惊吓全场幽灵！`, 1.8);
  } else if (sk.id === 'bunny_turbo') {
    // Hoppy Hopscotch: 3.5s super hop overdrive + stuns nearby ghosts
    S.player.dashTimer = sk.duration;
    S.player.invulnTimer = Math.max(S.player.invulnTimer, 2.0);
    S.freezeTimer = Math.max(S.freezeTimer, 1.8);
    showBanner(`🦘 Hoppy Bunny Overdrive! · 闪电兔极速冲刺！`, 1.8);
  } else if (sk.id === 'feast_magnet') {
    // PickyPiggy: Vacuums all beans within 4.2 tiles + +250 bonus score
    const count = vacuumNearbyBeans(4.2);
    addScore(250);
    addPopup(px, py, `+250 🍎 FEAST! (${count})`, '#ff85a1');
    showBanner(`🧲 PickyPiggy Gourmet Vacuum! · 大胃王暴风吸豆！`, 1.8);
  } else if (sk.id === 'cryo_nova') {
    // Bubba Bubbaphant: Slows all ghosts by 65% for 4.5s + barrier
    S.slowTimer = sk.duration;
    S.player.shieldTimer = 2.5;
    showBanner(`❄️ Bubba Cryo Nova! · 寒冰星爆全场减速65%！`, 1.8);
  } else if (sk.id === 'thunder_shock') {
    // KickinChicken: Zaps nearest ghost home & frightens all others for 3.5s
    let nearest = null;
    let bestD = Infinity;
    for (const g of S.ghosts) {
      const d = Math.hypot(g.x - px, g.y - py);
      if (d < bestD) {
        bestD = d;
        nearest = g;
      }
    }
    if (nearest) {
      nearest.state = 'eaten';
      nearest.x = nearest.homeX;
      nearest.y = nearest.homeY;
      addScore(400);
      addPopup(px, py, `⚡ +400 ZAPPED!`, '#ffd60a');
    }
    S.frightTimer = Math.max(S.frightTimer, sk.duration);
    S.ghosts.forEach(g => {
      if (g.state === 'normal') g.state = 'frightened';
    });
    showBanner(`⚡ Kickin Thunder Shock! · 雷霆电击清场！`, 1.8);
  }

  updateHUD();
  return true;
}

function vacuumNearbyBeans(radius) {
  let grabbed = 0;
  const px = S.player.x;
  const py = S.player.y;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = S.grid[r][c];
      if ((cell === '.' || cell === 'o') && Math.hypot(c - px, r - py) <= radius) {
        consumeTileBean(c, r);
        grabbed++;
      }
    }
  }
  return grabbed;
}

// ============================================================================
// BEAN CHOMPING, POWER PELLETS, SCORE & CHAPTER VICTORY CHECK
// ============================================================================
function consumeTileBean(c, r) {
  const cell = S.grid[r]?.[c];
  if (cell !== '.' && cell !== 'o') return false;

  S.grid[r][c] = ' ';
  S.beansLeft = Math.max(0, S.beansLeft - 1);
  S.beansEaten++;

  if (cell === 'o') {
    addScore(50);
    sound.powerPellet();
    const preset = SPEED_PRESETS[S.speedMode] || SPEED_PRESETS.normal;
    S.frightTimer = preset.frightDuration;
    S.ghostCombo = 0;
    S.ghosts.forEach(g => {
      if (g.state !== 'eaten') g.state = 'frightened';
    });
    spawnParticles(c, r, S.chapter.pelletColor, 14);
    addPopup(c, r, `+50 ${S.chapter.pelletEmoji} POWER!`, '#ffd166');
    showBanner(`🌟 POWER PELLET! Chomp the Blue Ghosts! · 能量豆生效，反咬幽灵！`, 1.9);
  } else {
    addScore(10);
    sound.waka();
    spawnParticles(c, r, S.chapter.beanColor, 4);
  }

  // Spawn Bonus Chapter Treat at 35% and 70% beans eaten
  const progress = S.beansEaten / Math.max(1, S.totalBeans);
  if (!S.fruitSpawned1 && progress >= 0.35) {
    S.fruitSpawned1 = true;
    S.bonusFruit = { x: 10, y: 13, emoji: S.chapter.fruitEmoji || '🍒', timer: 9.5, points: 300 };
    showBanner(`${S.bonusFruit.emoji} Bonus Treat Appeared! (+300) · 奖励甜点出现！`, 1.6);
  } else if (!S.fruitSpawned2 && progress >= 0.70) {
    S.fruitSpawned2 = true;
    S.bonusFruit = { x: 10, y: 13, emoji: S.chapter.fruitEmoji || '🍒', timer: 9.5, points: 500 };
    showBanner(`${S.bonusFruit.emoji} Super Bonus Treat! (+500) · 超级甜点出现！`, 1.6);
  }

  updateHUD();

  if (S.beansLeft <= 0) {
    triggerChapterVictory();
  }
  return true;
}

function addScore(pts) {
  S.score += pts;
  if (S.score > S.highScore) {
    S.highScore = S.score;
  }
}

function triggerChapterVictory() {
  if (S.phase === 'victory') return;
  S.phase = 'victory';
  S.clearedChapters.add(S.chapterIndex);
  addScore(500 + S.chapterIndex * 150);
  sound.victory();
  saveGameState(true);
  renderChapterTabs();
  updateHUD();

  const isAllClear = S.chapterIndex >= CHAPTERS.length - 1;
  const curChap = S.chapter;
  const nextChap = CHAPTERS[(S.chapterIndex + 1) % CHAPTERS.length];

  const curImg = document.getElementById('resultCritterImg');
  const nextImg = document.getElementById('resultNextCritterImg');
  const arrowEl = document.getElementById('resultArrow');
  const titleEl = document.getElementById('resultTitle');
  const subEl = document.getElementById('resultSub');
  const statsEl = document.getElementById('resultStatsBox');
  const primaryBtn = document.getElementById('resultPrimaryBtn');

  if (curImg) curImg.src = curChap.icon;
  if (nextImg) nextImg.src = nextChap.icon;
  if (arrowEl) arrowEl.textContent = isAllClear ? '🏆' : '➔';

  if (isAllClear) {
    if (titleEl) titleEl.textContent = '🏆 ALL 8 CHAPTERS CLEARED! · 八章萌宠吃豆全通关！';
    if (subEl) {
      subEl.textContent =
        'Every Smiling Critter Head chomped their maze clean! Happy Feast! · 所有8只萌宠头像全部完成吃豆大冒险！';
    }
    if (primaryBtn) primaryBtn.textContent = '🌟 Play Again (Ch.1) · 从第一章再来';
  } else {
    if (titleEl) {
      titleEl.textContent = `🎉 CH.${S.chapterIndex + 1} CLEARED! · ${curChap.critterName} 吃豆通关！`;
    }
    if (subEl) {
      subEl.textContent = `Next Up: ${nextChap.critterName} (${nextChap.beanEmoji} ${nextChap.beanName})!`;
    }
    if (primaryBtn) {
      primaryBtn.textContent = `▶️ Next: ${nextChap.critterName} · 下一章换头吃豆`;
    }
  }

  if (statsEl) {
    statsEl.textContent = `⭐ Score: ${S.score} · 🏆 Best: ${S.highScore} · ❤️ Lives: ${S.lives} · ✅ Cleared: ${S.clearedChapters.size}/${CHAPTERS.length}`;
  }

  document.getElementById('resultModal')?.classList.remove('hidden');
}

function triggerGameOver() {
  S.phase = 'gameover';
  sound.hurt();
  saveGameState(true);

  const curChap = S.chapter;
  const curImg = document.getElementById('resultCritterImg');
  const nextImg = document.getElementById('resultNextCritterImg');
  const arrowEl = document.getElementById('resultArrow');
  const titleEl = document.getElementById('resultTitle');
  const subEl = document.getElementById('resultSub');
  const statsEl = document.getElementById('resultStatsBox');
  const primaryBtn = document.getElementById('resultPrimaryBtn');

  if (curImg) curImg.src = curChap.icon;
  if (nextImg) nextImg.src = 'icons/huggy.jpg';
  if (arrowEl) arrowEl.textContent = '💔';
  if (titleEl) titleEl.textContent = '💔 OUT OF LIVES! · 挑战失败，再试一次！';
  if (subEl) subEl.textContent = `${curChap.critterName} still has ${S.beansLeft} ${curChap.beanEmoji} beans left to chomp!`;
  if (statsEl) {
    statsEl.textContent = `⭐ Score: ${S.score} · 🏆 Best: ${S.highScore} · 🫘 Beans Eaten: ${S.beansEaten}/${S.totalBeans}`;
  }
  if (primaryBtn) {
    primaryBtn.textContent = '🔄 Retry Chapter · 重玩本章';
  }

  document.getElementById('resultModal')?.classList.remove('hidden');
}

// ============================================================================
// GRID COLLISION & MOVEMENT HELPERS
// ============================================================================
function wrapCol(c) {
  if (c < 0) return COLS - 1;
  if (c >= COLS) return 0;
  return c;
}

function isTileWalkableForPlayer(c, r) {
  if (r < 0 || r >= ROWS) return false;
  const wc = wrapCol(c);
  const cell = S.grid[r]?.[wc];
  return cell !== '#' && cell !== '-' && cell !== 'G';
}

function isTileWalkableForGhost(c, r) {
  if (r < 0 || r >= ROWS) return false;
  const wc = wrapCol(c);
  const cell = S.grid[r]?.[wc];
  return cell !== '#';
}

function canMoveInDir(x, y, dirKey, isGhost = false) {
  const d = DIRS[dirKey];
  if (!d || (d.dx === 0 && d.dy === 0)) return false;
  const cx = Math.round(x);
  const cy = Math.round(y);
  const targetC = cx + d.dx;
  const targetR = cy + d.dy;
  return isGhost ? isTileWalkableForGhost(targetC, targetR) : isTileWalkableForPlayer(targetC, targetR);
}

// ============================================================================
// MAIN SIMULATION STEP (CRITTER HEAD CHOMPING + GHOST AI)
// ============================================================================
export function updateGame(dt) {
  if (S.phase !== 'playing') return;

  const preset = SPEED_PRESETS[S.speedMode] || SPEED_PRESETS.normal;
  const p = S.player;

  // Cooldowns & Timers
  if (p.skillCd > 0) p.skillCd = Math.max(0, p.skillCd - dt);
  if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
  if (p.shieldTimer > 0) p.shieldTimer = Math.max(0, p.shieldTimer - dt);
  if (p.dashTimer > 0) p.dashTimer = Math.max(0, p.dashTimer - dt);
  if (S.freezeTimer > 0) S.freezeTimer = Math.max(0, S.freezeTimer - dt);
  if (S.slowTimer > 0) S.slowTimer = Math.max(0, S.slowTimer - dt);

  if (S.frightTimer > 0) {
    S.frightTimer = Math.max(0, S.frightTimer - dt);
    if (S.frightTimer <= 0) {
      S.ghosts.forEach(g => {
        if (g.state === 'frightened') g.state = 'normal';
      });
    }
  }

  // Bonus Fruit countdown & collection
  if (S.bonusFruit) {
    S.bonusFruit.timer -= dt;
    if (Math.hypot(p.x - S.bonusFruit.x, p.y - S.bonusFruit.y) <= 0.65) {
      sound.fruit();
      addScore(S.bonusFruit.points);
      addPopup(S.bonusFruit.x, S.bonusFruit.y, `+${S.bonusFruit.points} ${S.bonusFruit.emoji}!`, '#ffd166');
      spawnParticles(S.bonusFruit.x, S.bonusFruit.y, '#ffd166', 12);
      S.bonusFruit = null;
    } else if (S.bonusFruit.timer <= 0) {
      S.bonusFruit = null;
    }
  }

  //Bobby Shield passive gentle bean pull
  if (p.shieldTimer > 0 && S.chapter.id === 'bobby') {
    vacuumNearbyBeans(1.85);
  }

  // --------------------------------------------------------------------------
  // 1. UPDATE PLAYER CRITTER HEAD MOVEMENT & MOUTH CHOMPING ANIMATION
  // --------------------------------------------------------------------------
  const speedMult = p.dashTimer > 0 ? 1.48 : 1.0;
  const step = preset.playerSpeed * speedMult * dt;

  // Try switching to buffered nextDir when near tile center or reversing direction
  if (p.nextDir !== 'none' && p.nextDir !== p.dir) {
    const curD = DIRS[p.dir] || DIRS.none;
    const nxtD = DIRS[p.nextDir] || DIRS.none;
    const isReverse = (curD.dx !== 0 && curD.dx === -nxtD.dx) || (curD.dy !== 0 && curD.dy === -nxtD.dy);

    if (isReverse) {
      p.dir = p.nextDir;
      p.facingAngle = nxtD.angle;
    } else {
      const distToCenter = Math.hypot(p.x - Math.round(p.x), p.y - Math.round(p.y));
      if (distToCenter <= 0.45 && canMoveInDir(Math.round(p.x), Math.round(p.y), p.nextDir, false)) {
        p.x = Math.round(p.x);
        p.y = Math.round(p.y);
        p.dir = p.nextDir;
        p.facingAngle = nxtD.angle;
      }
    }
  }

  if (p.dir !== 'none') {
    const d = DIRS[p.dir];
    p.facingAngle = d.angle;
    let nx = p.x + d.dx * step;
    let ny = p.y + d.dy * step;

    // Horizontal tunnel wrap-around
    if (nx < -0.45) nx = COLS - 0.55;
    else if (nx > COLS - 0.55) nx = -0.45;

    // Check wall ahead
    const checkC = d.dx > 0 ? Math.floor(nx + 0.46) : (d.dx < 0 ? Math.ceil(nx - 0.46) : Math.round(nx));
    const checkR = d.dy > 0 ? Math.floor(ny + 0.46) : (d.dy < 0 ? Math.ceil(ny - 0.46) : Math.round(ny));

    if (isTileWalkableForPlayer(checkC, checkR)) {
      p.x = nx;
      p.y = ny;
      // Keep perpendicular coordinate cleanly centered on corridor
      if (d.dx !== 0) p.y += (Math.round(p.y) - p.y) * Math.min(1, dt * 16);
      if (d.dy !== 0) p.x += (Math.round(p.x) - p.x) * Math.min(1, dt * 16);

      // Animate WAKA-WAKA chomping mouth!
      p.chompPhase += dt * 15 * speedMult;
      p.mouthAngle = 0.05 + Math.abs(Math.sin(p.chompPhase)) * 0.68;
    } else {
      // Snap to tile center on wall stop
      p.x = Math.round(p.x);
      p.y = Math.round(p.y);
      p.mouthAngle = 0.22;
    }
  } else {
    p.chompPhase += dt * 4;
    p.mouthAngle = 0.14 + Math.abs(Math.sin(p.chompPhase)) * 0.16;
  }

  // Check if Critter Head chomps a bean on the current tile!
  const curCol = wrapCol(Math.round(p.x));
  const curRow = Math.max(0, Math.min(ROWS - 1, Math.round(p.y)));
  consumeTileBean(curCol, curRow);
  if (S.phase !== 'playing') return;

  // --------------------------------------------------------------------------
  // 2. UPDATE VILLAIN GHOSTS & NON-LETHAL BOUNCE COLLISION WITH CRITTER HEAD
  // --------------------------------------------------------------------------
  const oppositeDir = { left: 'right', right: 'left', up: 'down', down: 'up', none: 'none' };

  for (const g of S.ghosts) {
    if (g.releaseTimer > 0) {
      g.releaseTimer = Math.max(0, g.releaseTimer - dt);
      continue;
    }
    if (S.freezeTimer > 0 && g.state !== 'eaten') {
      continue;
    }

    let gSpeed = preset.ghostSpeed * (1 + S.chapterIndex * 0.01);
    if (g.state === 'frightened') gSpeed *= 0.55;
    else if (g.state === 'eaten') gSpeed *= 1.65;
    if (S.slowTimer > 0 && g.state !== 'eaten') gSpeed *= 0.35;

    const gStep = gSpeed * dt;
    g.decisionCooldown = Math.max(0, (g.decisionCooldown || 0) - gStep);

    // Ghost inside Ghost House moves straight up through the gate to (10, 8)
    const gc = Math.round(g.x);
    const gr = Math.round(g.y);
    const cellHere = S.grid[gr]?.[wrapCol(gc)];
    if (g.state !== 'eaten' && (cellHere === 'G' || cellHere === '-')) {
      if (Math.abs(g.x - 10) > 0.12) {
        g.x += Math.sign(10 - g.x) * gStep;
      } else {
        g.x = 10;
        g.y -= gStep;
        g.dir = 'up';
      }
    } else {
      // Choose direction at intersections
      const distCenter = Math.hypot(g.x - gc, g.y - gr);
      if (distCenter <= 0.18 && g.decisionCooldown <= 0) {
        g.x = gc;
        g.y = gr;
        g.decisionCooldown = 0.48;

        if (g.state === 'eaten' && Math.hypot(g.x - g.homeX, g.y - g.homeY) <= 0.6) {
          g.state = 'normal';
          g.x = g.homeX;
          g.y = g.homeY;
        }

        const candidateDirs = ['up', 'left', 'down', 'right'].filter(dk => {
          if (dk === oppositeDir[g.dir]) return false;
          const d = DIRS[dk];
          const nc = gc + d.dx;
          const nr = gr + d.dy;
          const nextCell = S.grid[nr]?.[wrapCol(nc)];
          if (g.state !== 'eaten' && (nextCell === '-' || nextCell === 'G')) return false;
          return isTileWalkableForGhost(nc, nr);
        });

        if (candidateDirs.length === 0) {
          // Dead end or reverse allowed
          const rev = oppositeDir[g.dir];
          if (canMoveInDir(gc, gr, rev, true)) g.dir = rev;
        } else if (g.state === 'frightened' || (g.state === 'normal' && Math.random() < 0.35)) {
          // Frightened or relaxed wander so ghosts don't aggressively swarm
          g.dir = candidateDirs[Math.floor(Math.random() * candidateDirs.length)];
        } else {
          // Target tile: home if eaten, player (with personality offset) if normal
          let tx = p.x;
          let ty = p.y;
          if (g.state === 'eaten') {
            tx = g.homeX;
            ty = g.homeY;
          } else if (g.index === 1) {
            const pd = DIRS[p.dir] || DIRS.none;
            tx = p.x + pd.dx * 3;
            ty = p.y + pd.dy * 3;
          } else if (g.index === 3 && Math.hypot(g.x - p.x, g.y - p.y) < 4.5) {
            tx = g.scatterTarget.x;
            ty = g.scatterTarget.y;
          }

          let bestDir = candidateDirs[0];
          let bestDist = Infinity;
          for (const dk of candidateDirs) {
            const d = DIRS[dk];
            const dist = Math.hypot((gc + d.dx) - tx, (gr + d.dy) - ty);
            if (dist < bestDist) {
              bestDist = dist;
              bestDir = dk;
            }
          }
          g.dir = bestDir;
        }
      }

      const gd = DIRS[g.dir] || DIRS.left;
      let ngx = g.x + gd.dx * gStep;
      let ngy = g.y + gd.dy * gStep;
      if (ngx < -0.45) ngx = COLS - 0.55;
      else if (ngx > COLS - 0.55) ngx = -0.45;

      const cCheck = gd.dx > 0 ? Math.floor(ngx + 0.45) : (gd.dx < 0 ? Math.ceil(ngx - 0.45) : Math.round(ngx));
      const rCheck = gd.dy > 0 ? Math.floor(ngy + 0.45) : (gd.dy < 0 ? Math.ceil(ngy - 0.45) : Math.round(ngy));
      if (isTileWalkableForGhost(cCheck, rCheck)) {
        g.x = ngx;
        g.y = ngy;
      } else {
        g.x = Math.round(g.x);
        g.y = Math.round(g.y);
        g.decisionCooldown = 0;
      }
    }

    // Check collision between Critter Head and Ghost! (IMMORTAL / NO-DEATH MODE!)
    const distPG = Math.hypot(g.x - p.x, g.y - p.y);
    if (distPG <= 0.68) {
      if (g.state === 'frightened') {
        g.state = 'eaten';
        S.ghostCombo = Math.min(4, S.ghostCombo + 1);
        const pts = 200 * Math.pow(2, S.ghostCombo - 1);
        addScore(pts);
        sound.eatGhost();
        spawnParticles(g.x, g.y, '#4cc9f0', 16);
        addPopup(g.x, g.y, `👻 +${pts}!`, '#72efdd');
        updateHUD();
      } else if (g.state === 'normal') {
        // Never die on collision! Bounce & scare the ghost away so the player can chomp freely!
        g.state = 'frightened';
        g.dir = oppositeDir[g.dir] || 'up';
        S.frightTimer = Math.max(S.frightTimer, 3.2);
        p.invulnTimer = Math.max(p.invulnTimer, 1.5);
        sound.powerPellet();
        spawnParticles(g.x, g.y, S.chapter.ringColor, 14);
        addPopup(p.x, p.y, `🛡️ BOING! (不死弹开!)`, '#ffd166');
        showBanner(`🛡️ Boing! Bumped Ghost Away (No-Death Mode · 撞到不死，直接弹晕反派！)`, 1.6);
        updateHUD();
      }
    }
  }

  // Update Crumb Particles & Floating Popups
  for (let i = S.particles.length - 1; i >= 0; i--) {
    const pt = S.particles[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      S.particles.splice(i, 1);
    } else {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
  }

  for (let i = S.popups.length - 1; i >= 0; i--) {
    const pop = S.popups[i];
    pop.life -= dt;
    if (pop.life <= 0) {
      S.popups.splice(i, 1);
    } else {
      pop.y -= dt * 0.9;
    }
  }

  updateSkillBarUI();
}

// ============================================================================
// EXPRESSIVE 2D CANVAS RENDERER (CRITTER HEAD WITH CHOMPING MOUTH + BEANS!)
// ============================================================================
export function renderMaze() {
  const chap = S.chapter;
  const now = performance.now() * 0.001;

  // 1. Maze Floor Background
  ctx.fillStyle = chap.floorBg || '#162238';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle checkerboard corridor tiles
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((r + c) % 2 === 0 && S.grid[r]?.[c] !== '#') {
        ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }
  }

  // 2. Render Walls, Ghost Gate & Chapter-Themed Beans!
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = S.grid[r]?.[c];
      const x = c * TILE;
      const y = r * TILE;

      if (cell === '#') {
        ctx.fillStyle = chap.wallFill || '#2b580c';
        ctx.strokeStyle = chap.wallBorder || '#80ed99';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.roundRect(x + 2, y + 2, TILE - 4, TILE - 4, 7);
        ctx.fill();
        ctx.stroke();

        // Top glossy highlight on each wall block
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.fillRect(x + 5, y + 4, TILE - 10, 4);
      } else if (cell === '-') {
        // Ghost House Gate
        ctx.fillStyle = '#ff99c8';
        ctx.fillRect(x + 2, y + TILE / 2 - 3, TILE - 4, 6);
      } else if (cell === '.') {
        // Chapter Themed Bean!
        const cx = x + TILE / 2;
        const cy = y + TILE / 2;
        const pulse = 1 + Math.sin(now * 4 + (c + r) * 0.5) * 0.12;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(pulse, pulse);
        ctx.fillStyle = chap.beanGlow || '#ff9f1c';
        ctx.beginPath();
        ctx.arc(0, 0, 6.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = chap.beanColor || '#ffd166';
        ctx.beginPath();
        ctx.arc(0, 0, 4.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-1.4, -1.4, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (cell === 'o') {
        // Chapter Power Pellet!
        const cx = x + TILE / 2;
        const cy = y + TILE / 2;
        const pulse = 1 + Math.sin(now * 7) * 0.18;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(pulse, pulse);
        ctx.fillStyle = chap.ringColor || '#ff9f1c';
        ctx.beginPath();
        ctx.arc(0, 0, 11.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = chap.pelletColor || '#fff3bf';
        ctx.beginPath();
        ctx.arc(0, 0, 8.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(chap.pelletEmoji || '🌟', 0, 0.5);
        ctx.restore();
      }
    }
  }

  // 3. Render Bonus Chapter Treat if active
  if (S.bonusFruit) {
    const fx = (S.bonusFruit.x + 0.5) * TILE;
    const fy = (S.bonusFruit.y + 0.5) * TILE;
    const bounce = Math.sin(now * 6) * 3;
    ctx.save();
    ctx.translate(fx, fy + bounce);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.32)';
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(S.bonusFruit.emoji, 0, 1);
    ctx.restore();
  }

  // 4. Render Villain Ghosts
  for (const g of S.ghosts) {
    drawVillainGhost(g, now);
  }

  // 5. Render the Active Chapter's CRITTER HEAD (with Animated Pac-Man Chomping Mouth!)
  drawCritterPacHead(S.player, chap, now);

  // 6. Render Crumb Particles & Score Popups
  for (const pt of S.particles) {
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc((pt.x + 0.5) * TILE, (pt.y + 0.5) * TILE, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const pop of S.popups) {
    ctx.save();
    ctx.font = '900 13px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1b120c';
    ctx.fillText(pop.text, (pop.x + 0.5) * TILE + 1, (pop.y + 0.2) * TILE + 1);
    ctx.fillStyle = pop.color || '#ffd166';
    ctx.fillText(pop.text, (pop.x + 0.5) * TILE, (pop.y + 0.2) * TILE);
    ctx.restore();
  }
}

function drawCritterPacHead(p, chap, now) {
  const cx = (p.x + 0.5) * TILE;
  const cy = (p.y + 0.5) * TILE;
  const radius = 15.2;

  ctx.save();
  ctx.translate(cx, cy);

  // Blink gently during brief spawn invulnerability
  if (p.invulnTimer > 0 && Math.floor(now * 14) % 2 === 0 && p.shieldTimer <= 0) {
    ctx.globalAlpha = 0.65;
  }

  // Active Skill Shield / Dash Aura Ring
  if (p.shieldTimer > 0 || p.dashTimer > 0) {
    ctx.save();
    ctx.strokeStyle = p.dashTimer > 0 ? '#ffd166' : '#ff8fab';
    ctx.lineWidth = 3.5;
    ctx.setLineDash([6, 4]);
    ctx.rotate(now * 4);
    ctx.beginPath();
    ctx.arc(0, 0, radius + 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Draw Chapter Critter's Custom 3D-Shaded Ears / Horn / Crest behind the head!
  drawCritterEars(chap);

  // Outer Glowing Critter Rim (clipped with the animated Pac-Man chomping mouth wedge!)
  const angle = p.facingAngle || 0;
  const mouth = p.mouthAngle || 0.22;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius + 2.2, angle + mouth, angle + Math.PI * 2 - mouth, false);
  ctx.closePath();
  ctx.fillStyle = chap.ringColor || '#ff9f1c';
  ctx.fill();

  // Clip inner circle + mouth wedge for the Critter Head Portrait!
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius - 0.5, angle + mouth, angle + Math.PI * 2 - mouth, false);
  ctx.closePath();
  ctx.clip();

  const img = imageCache.get(chap.icon);
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = chap.ringColor || '#ffd166';
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  }
  ctx.restore();

  // Draw Crisp Chomping Mouth Jaw Lines so the Pac-Man bite is unmistakably visible!
  ctx.strokeStyle = '#fffdf7';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(Math.cos(angle + mouth) * radius, Math.sin(angle + mouth) * radius);
  ctx.lineTo(0, 0);
  ctx.lineTo(Math.cos(angle - mouth) * radius, Math.sin(angle - mouth) * radius);
  ctx.stroke();

  ctx.restore();
}

function drawCritterEars(chap) {
  ctx.save();
  ctx.fillStyle = chap.earColor || chap.ringColor || '#ff9f1c';
  ctx.strokeStyle = '#fffdf7';
  ctx.lineWidth = 1.6;

  const style = chap.earStyle;
  if (style === 'pointy_cat') {
    // CatNap pointy cat ears
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * 6, -12);
      ctx.lineTo(dir * 15, -21);
      ctx.lineTo(dir * 15, -7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (style === 'tall_bunny') {
    // Hoppy tall bunny ears
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(dir * 7, -18, 4.2, 8.5, dir * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (style === 'unicorn_horn') {
    // CraftyCorn golden spiral unicorn horn + side ears
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(-4, -13);
    ctx.lineTo(0, -24);
    ctx.lineTo(4, -13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 'chicken_crest') {
    // KickinChicken cool crown feather crest
    ctx.beginPath();
    ctx.arc(-4, -16, 4.2, 0, Math.PI * 2);
    ctx.arc(0, -18, 4.8, 0, Math.PI * 2);
    ctx.arc(4, -16, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (style === 'elephant_ears') {
    // Bubba wide round elephant ears
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(dir * 15, -2, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    // DogDay / Bobby / Picky cute rounded top ears
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(dir * 11, -12, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawVillainGhost(g, now) {
  const gx = (g.x + 0.5) * TILE;
  const gy = (g.y + 0.5) * TILE;
  const r = 13.8;

  ctx.save();
  ctx.translate(gx, gy);

  if (g.state === 'eaten') {
    // Eaten state: two big scurrying eyes returning to Ghost House
    for (const dx of [-5, 5]) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(dx, -2, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1d4ed8';
      ctx.beginPath();
      ctx.arc(dx, -2, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const isFright = g.state === 'frightened';
  const flashing = isFright && S.frightTimer < 2.0 && Math.floor(now * 10) % 2 === 0;
  const bodyColor = isFright ? (flashing ? '#f8f9fa' : '#1d4ed8') : (g.color || '#ff5964');

  // Classic Wavy Arcade Ghost Cloak
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -2, r, Math.PI, 0, false);
  ctx.lineTo(r, r - 1);
  const waves = 3;
  const waveW = (r * 2) / waves;
  for (let i = 0; i < waves; i++) {
    const wx = r - (i + 0.5) * waveW;
    const wy = r - 4 + Math.sin(now * 10 + i) * 2;
    ctx.quadraticCurveTo(wx, wy - 4, r - (i + 1) * waveW, r - 1);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (isFright) {
    // Dizzy Frightened Eyes & Wavy Mouth
    ctx.fillStyle = flashing ? '#e03131' : '#ffe066';
    ctx.beginPath();
    ctx.arc(-4.5, -3, 2.5, 0, Math.PI * 2);
    ctx.arc(4.5, -3, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = flashing ? '#e03131' : '#ffe066';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-7, 5);
    ctx.lineTo(-3.5, 2.5);
    ctx.lineTo(0, 5);
    ctx.lineTo(3.5, 2.5);
    ctx.lineTo(7, 5);
    ctx.stroke();
  } else {
    // Villain Circular Portrait Badge inside Ghost Dome
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, -2, r - 3, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const img = imageCache.get(g.icon);
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -(r - 3), -(r - 1), (r - 3) * 2, (r - 3) * 2);
    }
    ctx.restore();
  }

  // Frozen / Slowed indicator badge
  if (S.freezeTimer > 0) {
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💤', 0, -14);
  } else if (S.slowTimer > 0) {
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('❄️', 0, -14);
  }

  ctx.restore();
}

// ============================================================================
// PARTICLES, POPUPS & FLOATING BANNERS
// ============================================================================
function spawnParticles(x, y, color, count = 6) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.2 + Math.random() * 3.2;
    S.particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: 2.5 + Math.random() * 2.5,
      color,
      life: 0.28 + Math.random() * 0.22
    });
  }
}

function addPopup(x, y, text, color = '#ffd166') {
  S.popups.push({ x, y, text, color, life: 0.95 });
}

let bannerTimeout = null;
export function showBanner(msg, durSec = 1.8) {
  const el = document.getElementById('floatingBanner');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  if (bannerTimeout) clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => {
    el.classList.add('hidden');
  }, durSec * 1000);
}

// ============================================================================
// UI, CHAPTER SELECTOR TABS & SAVE/LOAD SYSTEM
// ============================================================================
function renderChapterTabs() {
  const strip = document.getElementById('chapterStrip');
  if (strip) {
    strip.innerHTML = '';
    CHAPTERS.forEach((c, idx) => {
      const btn = document.createElement('button');
      const isCur = idx === S.chapterIndex;
      const isDone = S.clearedChapters.has(idx);
      btn.className = `chap-tab${isCur ? ' active' : ''}${isDone ? ' cleared' : ''}`;
      btn.dataset.chapter = String(idx);
      btn.innerHTML = `
        <img src="${c.icon}" alt="${c.critterName}" />
        <span>Ch.${idx + 1} ${c.critterName.split('·')[0].trim()}</span>
        <span>${isDone ? '★' : c.beanEmoji}</span>
      `;
      btn.addEventListener('click', () => {
        sound.click();
        loadChapter(idx, false);
      });
      strip.appendChild(btn);
    });
  }

  const grid = document.getElementById('menuChapterGrid');
  if (grid) {
    grid.innerHTML = '';
    CHAPTERS.forEach((c, idx) => {
      const card = document.createElement('button');
      card.className = `chapter-pick-card${idx === S.chapterIndex ? ' active' : ''}`;
      card.dataset.chapter = String(idx);
      const done = S.clearedChapters.has(idx) ? ' ✅' : '';
      card.innerHTML = `
        <img src="${c.icon}" alt="${c.critterName}" />
        <b>Ch.${idx + 1} ${c.critterName}${done}</b>
        <span>${c.beanEmoji} ${c.skill.name}</span>
      `;
      card.addEventListener('click', () => {
        sound.click();
        loadChapter(idx, false);
        saveGameState(true);
      });
      grid.appendChild(card);
    });
  }
}

export function updateHUD() {
  const chap = S.chapter;
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };
  const setSrc = (id, src) => {
    const el = document.getElementById(id);
    if (el) el.src = src;
  };

  setSrc('topCritterAvatar', chap.icon);
  setTxt('topChapterTitle', chap.chapterTitle);
  setTxt('topChapterSub', chap.chapterSub);

  setTxt('beansLeftCount', `${S.beansLeft}/${S.totalBeans}`);
  setTxt('scoreCount', S.score);
  setTxt('highScoreCount', S.highScore);
  setTxt('livesCount', '∞');

  setSrc('dockCritterImg', chap.icon);
  setTxt('dockBeanBadge', chap.beanEmoji);
  setTxt('dockCritterName', chap.critterName);
  setTxt('dockChapterBadge', `Chapter ${S.chapterIndex + 1} / ${CHAPTERS.length} · 第 ${S.chapterIndex + 1} 章`);
  setTxt('dockBeanDesc', `${chap.beanEmoji} ${chap.beanName}`);
  setTxt('dockSkillName', chap.skill.name);
  setTxt('dockSkillDesc', chap.skill.desc);

  updateSkillBarUI();
}

function updateSkillBarUI() {
  const fill = document.getElementById('skillCooldownFill');
  const frightBadge = document.getElementById('frightTimerBadge');
  const p = S.player;
  if (fill) {
    const ratio = p.skillCd <= 0 ? 1 : Math.max(0, 1 - p.skillCd / Math.max(1, p.skillMaxCd));
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
  }
  if (frightBadge) {
    if (S.frightTimer > 0) {
      frightBadge.textContent = `😱 Edible (${S.frightTimer.toFixed(1)}s) · 可反咬!`;
      frightBadge.style.color = '#d9480f';
    } else if (S.freezeTimer > 0) {
      frightBadge.textContent = `💤 Asleep (${S.freezeTimer.toFixed(1)}s) · 定身中`;
      frightBadge.style.color = '#7950f2';
    } else {
      frightBadge.textContent = '👻 Patrol · 巡逻中';
      frightBadge.style.color = '#1971c2';
    }
  }
}

export function saveGameState(silent = false) {
  try {
    const payload = {
      version: 1,
      timestamp: Date.now(),
      chapterIndex: S.chapterIndex,
      score: S.score,
      highScore: S.highScore,
      lives: S.lives,
      speedMode: S.speedMode,
      clearedChapters: Array.from(S.clearedChapters)
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    refreshMenuSaveStatus();
    if (!silent) {
      sound.fruit();
      showBanner('💾 Progress Saved! · 章节与分数已保存！', 1.6);
    }
    return true;
  } catch {
    return false;
  }
}

export function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      showBanner('📂 No Save Found · 暂无存档记录', 1.5);
      return false;
    }
    const data = JSON.parse(raw);
    S.highScore = Math.max(S.highScore, Number(data.highScore) || 0);
    S.score = Math.max(0, Number(data.score) || 0);
    S.lives = Math.max(1, Number(data.lives) || 3);
    S.speedMode = data.speedMode || 'normal';
    S.clearedChapters = new Set(Array.isArray(data.clearedChapters) ? data.clearedChapters : []);
    loadChapter(data.chapterIndex ?? 0, false);
    showBanner(`📂 Loaded Ch.${S.chapterIndex + 1} (${S.chapter.critterName}) · 已读取存档！`, 1.8);
    return true;
  } catch {
    return false;
  }
}

function refreshMenuSaveStatus() {
  const box = document.getElementById('menuSaveStatus');
  if (!box) return;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      box.textContent = '📂 No Saved Game Yet · 暂无存档（点击新游戏或任选章节萌宠头像开始！）';
      return;
    }
    const data = JSON.parse(raw);
    const chIdx = Math.max(0, Math.min(CHAPTERS.length - 1, Number(data.chapterIndex) || 0));
    const chap = CHAPTERS[chIdx];
    box.textContent = `📂 Saved: Ch.${chIdx + 1} ${chap.critterName} · ⭐ Score ${data.score || 0} · 🏆 Best ${data.highScore || 0} · ✅ Cleared ${(data.clearedChapters || []).length}/8`;
  } catch {
    box.textContent = '📂 Save Slot Ready · 存档槽位就绪';
  }
}

export function openMainMenu() {
  S.phase = 'paused';
  refreshMenuSaveStatus();
  renderChapterTabs();
  document.getElementById('mainMenuModal')?.classList.remove('hidden');
}

export function closeMainMenu() {
  document.getElementById('mainMenuModal')?.classList.add('hidden');
  S.phase = 'playing';
}

// ============================================================================
// KEYBOARD, D-PAD, AND MAZE SWIPE / TAP STEERING
// ============================================================================
export function setPlayerDirection(dirKey) {
  if (!DIRS[dirKey]) return;
  sound.startMusic();
  S.player.nextDir = dirKey;
  if (S.player.dir === 'none' && canMoveInDir(S.player.x, S.player.y, dirKey, false)) {
    S.player.dir = dirKey;
    S.player.facingAngle = DIRS[dirKey].angle;
  }
}

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'arrowup' || k === 'w') {
    e.preventDefault();
    setPlayerDirection('up');
  } else if (k === 'arrowdown' || k === 's') {
    e.preventDefault();
    setPlayerDirection('down');
  } else if (k === 'arrowleft' || k === 'a') {
    e.preventDefault();
    setPlayerDirection('left');
  } else if (k === 'arrowright' || k === 'd') {
    e.preventDefault();
    setPlayerDirection('right');
  } else if (k === ' ') {
    e.preventDefault();
    activateCritterSkill();
  }
});

document.querySelectorAll('.dpad-btn').forEach(btn => {
  const dir = btn.dataset.dir;
  const trigger = e => {
    e.preventDefault();
    setPlayerDirection(dir);
  };
  btn.addEventListener('pointerdown', trigger);
  btn.addEventListener('click', trigger);
});

// Direct tap or swipe on the Maze Canvas steers the Critter Head toward that direction!
let touchStartX = null;
let touchStartY = null;

canvas.addEventListener('pointerdown', e => {
  const rect = canvas.getBoundingClientRect();
  touchStartX = e.clientX;
  touchStartY = e.clientY;

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clickTileX = ((e.clientX - rect.left) * scaleX) / TILE - 0.5;
  const clickTileY = ((e.clientY - rect.top) * scaleY) / TILE - 0.5;
  const dx = clickTileX - S.player.x;
  const dy = clickTileY - S.player.y;
  if (Math.hypot(dx, dy) > 0.35) {
    if (Math.abs(dx) > Math.abs(dy)) {
      setPlayerDirection(dx > 0 ? 'right' : 'left');
    } else {
      setPlayerDirection(dy > 0 ? 'down' : 'up');
    }
  }
});

canvas.addEventListener('pointermove', e => {
  if (touchStartX === null || touchStartY === null) return;
  const dx = e.clientX - touchStartX;
  const dy = e.clientY - touchStartY;
  if (Math.hypot(dx, dy) >= 24) {
    if (Math.abs(dx) > Math.abs(dy)) {
      setPlayerDirection(dx > 0 ? 'right' : 'left');
    } else {
      setPlayerDirection(dy > 0 ? 'down' : 'up');
    }
    touchStartX = e.clientX;
    touchStartY = e.clientY;
  }
});

window.addEventListener('pointerup', () => {
  touchStartX = null;
  touchStartY = null;
});

// HUD & Modal Buttons
document.getElementById('topSkillBtn')?.addEventListener('click', () => activateCritterSkill());
document.getElementById('dockSkillBtn')?.addEventListener('click', () => activateCritterSkill());
document.getElementById('saveGameBtn')?.addEventListener('click', () => saveGameState(false));
document.getElementById('openMenuBtn')?.addEventListener('click', () => openMainMenu());

document.getElementById('pauseBtn')?.addEventListener('click', e => {
  sound.click();
  S.phase = S.phase === 'paused' ? 'playing' : 'paused';
  e.currentTarget.textContent = S.phase === 'paused' ? '▶' : '⏸';
});

document.getElementById('musicBtn')?.addEventListener('click', e => {
  const on = sound.toggleMusic();
  e.currentTarget.style.opacity = on ? '1' : '0.5';
});

document.getElementById('sfxBtn')?.addEventListener('click', e => {
  const on = sound.toggleSfx();
  e.currentTarget.style.opacity = on ? '1' : '0.5';
});

document.getElementById('menuNewGameBtn')?.addEventListener('click', () => {
  sound.click();
  loadChapter(0, true);
  saveGameState(true);
});

document.getElementById('menuLoadGameBtn')?.addEventListener('click', () => {
  sound.click();
  loadSavedGame();
});

document.getElementById('menuResumeBtn')?.addEventListener('click', () => {
  sound.click();
  closeMainMenu();
});

document.querySelectorAll('.speed-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    sound.click();
    S.speedMode = btn.dataset.speed || 'normal';
    document.querySelectorAll('.speed-chip').forEach(b => b.classList.toggle('active', b === btn));
  });
});

document.getElementById('resultPrimaryBtn')?.addEventListener('click', () => {
  sound.click();
  if (S.phase === 'gameover') {
    S.lives = 3;
    loadChapter(S.chapterIndex, false);
  } else {
    const nextIdx = (S.chapterIndex + 1) % CHAPTERS.length;
    loadChapter(nextIdx, false);
  }
});

document.getElementById('resultRetryBtn')?.addEventListener('click', () => {
  sound.click();
  if (S.lives <= 0) S.lives = 3;
  loadChapter(S.chapterIndex, false);
});

document.getElementById('resultMenuBtn')?.addEventListener('click', () => {
  sound.click();
  document.getElementById('resultModal')?.classList.add('hidden');
  openMainMenu();
});

// ============================================================================
// INITIALIZE CHAPTER 1 (DOGDAY) & START 60FPS ANIMATION LOOP
// ============================================================================
try {
  const savedRaw = localStorage.getItem(SAVE_KEY);
  if (savedRaw) {
    const parsed = JSON.parse(savedRaw);
    S.highScore = Math.max(0, Number(parsed.highScore) || 0);
    S.clearedChapters = new Set(Array.isArray(parsed.clearedChapters) ? parsed.clearedChapters : []);
  }
} catch {
  // Ignore storage errors
}

loadChapter(0, true);

let lastTime = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  updateGame(dt);
  renderMaze();
}
requestAnimationFrame(loop);

// Expose automated verification hooks for headless browser testing
window.__PACMAN__ = {
  S,
  CHAPTERS,
  VILLAINS,
  loadChapter,
  setPlayerDirection,
  activateCritterSkill,
  consumeTileBean,
  triggerChapterVictory,
  saveGameState,
  loadSavedGame,
  openMainMenu,
  closeMainMenu,
  stepSim(sec) {
    const steps = Math.ceil(sec / 0.025);
    for (let i = 0; i < steps; i++) {
      updateGame(0.025);
    }
    renderMaze();
  }
};
