import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '../client'), {
    etag: false,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.html') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

const WORLD = { w: 8000, h: 8000 };
const FOOD_COUNT = 1400;
const COIN_COUNT = 200;
const POWERUP_COUNT = 32;
const PALETTE = ['#ff6fa5', '#ffd23f', '#4be3d0', '#b98bff', '#ff9d5c', '#6fe07a'];
const PATTERNS = ['solid', 'stripe', 'dots', 'gradient', 'tiger', 'scale', 'rainbow', 'lava', 'aurora', 'inferno', 'diamond', 'dragonSkin', 'customSkin'];
const BOT_SECOND_COLORS = ['#ffffff', '#7a4b00', '#2d0a5e', '#3a1c00', '#0b3d17', '#ffd23f', '#111111'];
const BOT_NAMES = ['siraj', 'anjali', 'bijay', 'karan', 'parash', 'lama', 'anmol', 'sagar', 'bishal', 'subash', 'Marbles', 'Ziggy', 'Puffin', 'Coco', 'Ranger', 'Milo', 'Cosmo', 'Peanut', 'Dash'];
const BOT_COUNT = 25;
const BOOST_MULT = 1.35;
const BOOST_MS = 4000;
const DASH_COOLDOWN_MS = 8000;
const DASH_DURATION_MS = 250;
const DASH_SPEED_MULT = 2.6;
const DASH_MIN_MASS = 20;
// Production ma dev backdoor off. Testing garna Render env var DEV_NAME set garnu
// (Render dashboard → Environment → DEV_NAME=ram), production ma khali chodnu.
const DEV_UNLIMITED_DASH_NAME = process.env.DEV_NAME || null;
const INVIS_COOLDOWN_MS = 12000;
const INVIS_DURATION_MS = 3000;
const FREEZE_COOLDOWN_MS = 10000;
const FREEZE_DURATION_MS = 2000;
const FREEZE_RANGE = 300;
const FREEZE_MIN_MASS = 20;
const SHIELD_MS = 4500;
const MAGNET_MS = 5000;
const MAGNET_RADIUS = 260;
const POWER_TYPES = ['speed', 'shield', 'magnet', 'star'];
const VIRUS_COUNT = 5;
const VIRUS_R = 45;
const RAMPAGE_DURATION_MS = 8000;
const RAMPAGE_RESPAWN_MS = 40000;
const RAMPAGE_SPEED_MULT = 2.1;
const TURN_RATE_MAX = 8.5;
const TURN_RATE_MIN = 2.6;
const FOOD_EMOJIS = ['🍄', '🥕', '🍞', '🍎', '🥦', '🍇', '🍊'];
const EMOJI_FOOD_CHANCE = 0.16;
const STAR_MS = 6000;
const START_LEN = 160;
const BODY_HIT_PAD = 8;
const MAX_R = 900;
const RAGE_STREAK = 3;
const RAGE_MS = 5000;
const RAGE_MULT = 2;
const REVENGE_WINDOW_MS = 30000;
const REVENGE_MULT = 2;
const GOLDEN_INTERVAL_MS = 45000;
const GOLDEN_DURATION_MS = 20000;
const GOLDEN_COIN_BONUS = 50;

// ---- NEW: Wormhole Portals (theme feature) ----
const PORTAL_PAIR_COUNT = 2; // 2 pairs = 4 portals total
const PORTAL_R = 55;
const PORTAL_COOLDOWN_MS = 1500; // prevents instant re-teleport ping-pong

// ---- NEW: Boss Virus event (periodic big-risk-big-reward target) ----
const BOSS_INTERVAL_MS = 90000;
const BOSS_R = 130;
const BOSS_MASS_REWARD = 4000;

// ---- NEW: Biome zones (visual only — client tints background by zone) ----
const BIOME_COUNT = 4; // grid of biome cells across the world, sent once at welcome

const GRID_CELL = 220; // spatial grid cell size — keeps per-entity searches to nearby cells only

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
// motai (radius) chai mass ko 4th-root anusar badhcha — slow growth, worm lamो ra patalो rahancha
const RADIUS_K = 2.5;
const RADIUS_EXP = 0.21;
const radiusForMass = m => RADIUS_K * Math.pow(Math.max(m, 0.0001), RADIUS_EXP);
const massForRadius = r => Math.pow(Math.max(r, 0.0001) / RADIUS_K, 1 / RADIUS_EXP);
const baseSpeedFor = r => clamp(7800 / (r + 8), 172, 260);
function speedFor(entity) {
    let s = baseSpeedFor(entity.r);
    if (entity.perk === 'speedy') s *= 1.12;
    const now = Date.now();
    if (entity.rampageUntil > now) return s * RAMPAGE_SPEED_MULT;
    if (entity.dashUntil > now) return s * DASH_SPEED_MULT;
    return (entity.boostUntil && now < entity.boostUntil) ? s * BOOST_MULT : s;
}
const uid = () => Math.random().toString(36).slice(2, 10);
const capR = r => Math.min(MAX_R, r);

// ---- spatial grid helpers ----
function buildGrid(items, cellSize) {
    const grid = new Map();
    for (const it of items) {
        const key = Math.floor(it.x / cellSize) + ',' + Math.floor(it.y / cellSize);
        let arr = grid.get(key);
        if (!arr) { arr = []; grid.set(key, arr); }
        arr.push(it);
    }
    return grid;
}
function nearbyItems(grid, x, y, cellSize, radiusCells) {
    const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize);
    const result = [];
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        for (let dy = -radiusCells; dy <= radiusCells; dy++) {
            const arr = grid.get((gx + dx) + ',' + (gy + dy));
            if (arr) for (const it of arr) result.push(it);
        }
    }
    return result;
}

let food = [], coins = [], powerups = [], viruses = [];

// ---- Decorative vine-pattern food layout ----
// Most food sits along gently-curving "vine" paths (like the trail a dead
// worm's corpse leaves), a smaller share fills the empty space evenly.
// Same total food count as before — layout only, zero extra render cost.
const VINE_COUNT = 22;
const VINE_POINTS_PER = 26;
const VINE_STEP = 90;
let vinePosPool = [];
function buildVines() {
    vinePosPool = [];
    for (let v = 0; v < VINE_COUNT; v++) {
        let x = rand(300, WORLD.w - 300), y = rand(300, WORLD.h - 300);
        let ang = rand(0, Math.PI * 2);
        for (let p = 0; p < VINE_POINTS_PER; p++) {
            ang += rand(-0.5, 0.5);
            x = clamp(x + Math.cos(ang) * VINE_STEP, 60, WORLD.w - 60);
            y = clamp(y + Math.sin(ang) * VINE_STEP, 60, WORLD.h - 60);
            vinePosPool.push({
                x: clamp(x + rand(-14, 14), 40, WORLD.w - 40),
                y: clamp(y + rand(-14, 14), 40, WORLD.h - 40),
                vine: v
            });
        }
    }
    for (let i = vinePosPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [vinePosPool[i], vinePosPool[j]] = [vinePosPool[j], vinePosPool[i]];
    }
}
buildVines();

const FOOD_GRID_DIM = Math.ceil(Math.sqrt(FOOD_COUNT * 0.5));
const FOOD_CELL_W = WORLD.w / FOOD_GRID_DIM;
const FOOD_CELL_H = WORLD.h / FOOD_GRID_DIM;
let foodCellPool = [];
function refillFoodCellPool() {
    foodCellPool = [];
    for (let gx = 0; gx < FOOD_GRID_DIM; gx++) {
        for (let gy = 0; gy < FOOD_GRID_DIM; gy++) foodCellPool.push([gx, gy]);
    }
    for (let i = foodCellPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [foodCellPool[i], foodCellPool[j]] = [foodCellPool[j], foodCellPool[i]];
    }
}
function nextFoodPos() {
    // ~80% of food follows the vine trails, the rest fills gaps evenly.
    // Pool auto-refills when empty so clustering never runs out over a long session.
    if (Math.random() < 0.8) {
        if (vinePosPool.length === 0) buildVines();
        return vinePosPool.pop();
    }
    if (foodCellPool.length === 0) refillFoodCellPool();
    const [gx, gy] = foodCellPool.pop();
    return {
        x: clamp(gx * FOOD_CELL_W + rand(0.15, 0.85) * FOOD_CELL_W, 40, WORLD.w - 40),
        y: clamp(gy * FOOD_CELL_H + rand(0.15, 0.85) * FOOD_CELL_H, 40, WORLD.h - 40)
    };
}

function spawnFood(n) {
    for (let i = 0; i < n; i++) {
        const pos = nextFoodPos();
        const isBonus = Math.random() < EMOJI_FOOD_CHANCE;
        if (isBonus) {
            food.push({
                x: pos.x, y: pos.y, r: 26,
                color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
                emoji: FOOD_EMOJIS[Math.floor(Math.random() * FOOD_EMOJIS.length)],
                group: pos.vine !== undefined ? pos.vine : null,
                bonus: 350
            });
        } else {
            food.push({
                x: pos.x, y: pos.y, r: 20,
                color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
                group: pos.vine !== undefined ? pos.vine : null,
                bonus: 130
            });
        }
    }
}
function spawnCoins(n) { for (let i = 0; i < n; i++) coins.push({ x: rand(60, WORLD.w - 60), y: rand(60, WORLD.h - 60), r: 8 }); }
function spawnPowerups(n) { for (let i = 0; i < n; i++) powerups.push({ x: rand(80, WORLD.w - 80), y: rand(80, WORLD.h - 80), r: 13, type: POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)] }); }
function spawnViruses(n) { for (let i = 0; i < n; i++) viruses.push({ x: rand(150, WORLD.w - 150), y: rand(150, WORLD.h - 150), r: VIRUS_R }); }
let rampageOrb = null;
let rampageRespawnAt = 0;
function trySpawnRampage() {
    if (rampageOrb || Date.now() < rampageRespawnAt) return;
    rampageOrb = { x: rand(150, WORLD.w - 150), y: rand(150, WORLD.h - 150), r: 20 };
}
function eatRampage(entity) {
    if (!rampageOrb) return false;
    if (dist2(entity, rampageOrb) < (entity.r + rampageOrb.r) * (entity.r + rampageOrb.r)) {
        const until = Date.now() + RAMPAGE_DURATION_MS;
        entity.rampageUntil = until;
        entity.shieldUntil = Math.max(entity.shieldUntil || 0, until);
        rampageOrb = null;
        rampageRespawnAt = Date.now() + RAMPAGE_RESPAWN_MS;
        return true;
    }
    return false;
}

// ---- NEW: Portal pairs ----
let portals = []; // each: { id, x, y, linkId (index of partner), pairColor }
let lastSegCache = new Map(); // previous tick's body segments, used to check portal-landing safety
function isPortalDestSafe(entity, dest) {
    const buffer = 45;
    for (const w of collectWorms()) {
        if (w.ent === entity) continue;
        const segs = lastSegCache.get(w.ent);
        if (!segs) continue;
        for (const s of segs) {
            const hitR = entity.r + w.ent.r * 0.6 + buffer;
            if (dist2(dest, s) < hitR * hitR) return false;
        }
    }
    return true;
}
function spawnPortals() {
    portals = [];
    const pairColors = ['#7dd3ff', '#ff8bd0'];
    for (let p = 0; p < PORTAL_PAIR_COUNT; p++) {
        const a = { id: uid(), x: rand(300, WORLD.w - 300), y: rand(300, WORLD.h - 300), r: PORTAL_R, color: pairColors[p % pairColors.length] };
        const b = { id: uid(), x: rand(300, WORLD.w - 300), y: rand(300, WORLD.h - 300), r: PORTAL_R, color: pairColors[p % pairColors.length] };
        a.linkId = b.id; b.linkId = a.id;
        portals.push(a, b);
    }
}
spawnPortals();
function tryPortal(entity, now) {
    if ((entity.portalCooldownUntil || 0) > now) return;
    for (const p of portals) {
        const hitR = entity.r * 0.6 + p.r * 0.5;
        if (dist2(entity, p) < hitR * hitR) {
            const dest = portals.find(x => x.id === p.linkId);
            if (!dest) return;
            if (!isPortalDestSafe(entity, dest)) return; // enemy blocking exit — wait, retry next tick
            entity.x = dest.x; entity.y = dest.y;
            entity.portalCooldownUntil = now + PORTAL_COOLDOWN_MS;
            // reset the path so the body doesn't stretch a visible line across the map
            entity.path = [{ x: entity.x, y: entity.y }];
            entity.shieldUntil = Math.max(entity.shieldUntil || 0, now + 700); // brief landing shield
            return true;
        }
    }
    return false;
}

// ---- NEW: Boss Virus ----
let boss = null;
let bossSpawnAt = Date.now() + BOSS_INTERVAL_MS;
function trySpawnBoss(now) {
    if (boss || now < bossSpawnAt) return;
    boss = { x: rand(400, WORLD.w - 400), y: rand(400, WORLD.h - 400), r: BOSS_R, hp: 3 };
    io.emit('bossSpawned', { x: boss.x, y: boss.y });
}
// boss is destroyed by DASHING into it (risk: costs mass on hit if not dashing)
function checkBossHits(now) {
    if (!boss) return;
    for (const w of collectWorms()) {
        const o = w.ent;
        const hitR = o.r * 0.6 + boss.r * 0.9;
        if (dist2(o, boss) < hitR * hitR) {
            const dashing = o.dashUntil > now;
            if (dashing) {
                boss.hp -= 1;
                if (boss.hp <= 0) {
                    o.targetR = capR(radiusForMass(massForRadius(o.targetR) + BOSS_MASS_REWARD));
                    o.len += BOSS_MASS_REWARD * 0.6;
                    if (w.kind === 'player') {
                        io.to(w.id).emit('bossDefeated', { gain: BOSS_MASS_REWARD });
                        io.to(w.id).emit('achievement', { id: 'boss_slayer', label: 'Boss Slayer!' });
                    }
                    io.emit('bossKilled', { name: o.name });
                    boss = null;
                    bossSpawnAt = now + BOSS_INTERVAL_MS;
                }
            } else if (!(o.shieldUntil > now)) {
                // touching the boss without dashing costs mass — risk/reward
                o.targetR = capR(radiusForMass(Math.max(16, massForRadius(o.targetR) - 30)));
            }
        }
    }
}

spawnFood(FOOD_COUNT); spawnCoins(COIN_COUNT); spawnPowerups(POWERUP_COUNT); spawnViruses(VIRUS_COUNT);
const deadPlayersCache = {}; // holds recent death state briefly so "continue" can restore it
const CONTINUE_WINDOW_MS = 15000; // player must click continue within 15s of dying
const owners = {};
const bots = {};
const revengeMemory = {};
let goldenBotId = null;
let goldenUntil = 0;
let goldenSpawnAt = Date.now() + GOLDEN_INTERVAL_MS;

function tryDash(o) {
    const now = Date.now();
    const isDevTester = o.name === DEV_UNLIMITED_DASH_NAME;
    if (!isDevTester) {
        if (now < (o.dashReadyAt || 0)) return false;
        if (massForRadius(o.r) < DASH_MIN_MASS) return false;
    }
    o.dashUntil = now + DASH_DURATION_MS;
    o.dashReadyAt = isDevTester ? 0 : now + DASH_COOLDOWN_MS;
    return true;
}
function tryInvis(o) {
    const now = Date.now();
    if (now < (o.invisReadyAt || 0)) return false;
    o.invisUntil = now + INVIS_DURATION_MS;
    o.invisReadyAt = now + INVIS_COOLDOWN_MS;
    return true;
}
function tryFreeze(o) {
    const now = Date.now();
    if (now < (o.freezeReadyAt || 0)) return false;
    if (massForRadius(o.r) < FREEZE_MIN_MASS) return false;
    const fx = o.inputX || 1, fy = o.inputY || 0;
    const fmag = Math.hypot(fx, fy) || 1;
    const dirX = fx / fmag, dirY = fy / fmag;
    let target = null, bestScore = -Infinity;
    for (const w of collectWorms()) {
        if (w.ent === o) continue;
        const dx = w.ent.x - o.x, dy = w.ent.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d > FREEZE_RANGE || d < 1) continue;
        const facing = (dx / d) * dirX + (dy / d) * dirY;
        if (facing < 0.5) continue;
        const score = facing - d / FREEZE_RANGE;
        if (score > bestScore) { bestScore = score; target = w.ent; }
    }
    if (!target) return false;
    target.frozenUntil = now + FREEZE_DURATION_MS;
    o.freezeReadyAt = now + FREEZE_COOLDOWN_MS;
    return true;
}
function makeEntity(x, y, r, color, name, isBot) {
    return {
        id: uid(), x, y, r, targetR: r, vx: 0, vy: 0, color, name, isBot, kills: 0,
        wanderAngle: Math.random() * Math.PI * 2, wanderTimer: 0,
        boostUntil: 0, shieldUntil: 0, magnetUntil: 0, starUntil: 0, rampageUntil: 0,
        dashUntil: 0, dashReadyAt: 0, invisUntil: 0, invisReadyAt: 0, freezeReadyAt: 0, frozenUntil: 0,
        killStreak: 0, rageUntil: 0, golden: false, portalCooldownUntil: 0
    };
}
function allBots() {
    const arr = [];
    for (const id in bots) arr.push(bots[id]);
    return arr;
}
const MAX_PATH_NODES = 1200; // absolute safety cap — chahe len jati thulo vaye pani array yeti bhanda badi kahilepani nahune, hang na hos

function advancePath(o, dt, len) {
    const head = o.path[0];
    if (!head || Math.hypot(o.x - head.x, o.y - head.y) > 2) {
        o.path.unshift({ x: o.x, y: o.y });
        let total = 0, cut = o.path.length;
        for (let i = 1; i < o.path.length && i <= MAX_PATH_NODES; i++) {
            total += Math.hypot(o.path[i].x - o.path[i - 1].x, o.path[i].y - o.path[i - 1].y);
            if (total > len + 40 || i === MAX_PATH_NODES) { cut = i; break; }
        }
        if (cut < o.path.length) o.path.length = cut;
    }
}
function updateWorm(o, dt) {
    if (o.frozenUntil > Date.now()) { advancePath(o, dt, o.len); return; }
    const ix = o.inputX || 0, iy = o.inputY || 0;
    const mag = Math.hypot(ix, iy);
    const boosting = o.boosting && massForRadius(o.r) > 18;
    const speedScale = lerp(0.55, 1, clamp(mag, 0, 1));
    const sp = speedFor(o) * speedScale * (boosting ? 1.6 : 1);
    if (o.heading === undefined) o.heading = Math.atan2(iy || 0, ix || 1);
    if (mag > 0.05) {
        const desired = Math.atan2(iy, ix);
        let diff = desired - o.heading;
        diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        const turnRate = lerp(TURN_RATE_MAX, TURN_RATE_MIN, clamp((o.r - 12) / 90, 0, 1));
        const maxStep = turnRate * dt * clamp(mag, 0.35, 1);
        o.heading += clamp(diff, -maxStep, maxStep);
    }
    o.x = clamp(o.x + Math.cos(o.heading) * sp * dt, o.r, WORLD.w - o.r);
    o.y = clamp(o.y + Math.sin(o.heading) * sp * dt, o.r, WORLD.h - o.r);
    if (boosting) o.targetR = radiusForMass(Math.max(18, massForRadius(o.targetR) - 14 * dt));
    o.r = lerp(o.r, o.targetR, 0.08);
    if (boosting) o.len = Math.max(START_LEN * 0.5, o.len - 30 * dt);
    advancePath(o, dt, o.len);
}
const SEG_STEP_MULT = 0.62; // pahile 0.32 — segments aadha huncha, body visually ustai
const MAX_SEGS = 180;       // pahile 400
function wormSegments(o) {
    const segs = []; let dist = 0;
    const step = clamp(o.r * SEG_STEP_MULT, 14, 46);
    let next = step;
    const maxSegs = Math.min(MAX_SEGS, Math.ceil((o.len + 60) / step) + 2);
    for (let i = 1; i < o.path.length && segs.length < maxSegs; i++) {
        const a = o.path[i - 1], b = o.path[i];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        while (dist + d >= next) {
            const t = (next - dist) / d;
            segs.push({ x: Math.round(lerp(a.x, b.x, t)), y: Math.round(lerp(a.y, b.y, t)) }); // int — JSON size 2-3x kam
            next += step;
        }
        dist += d;
    }
    return segs;
}
const BOT_SPAWN_MIN_DIST = 500; // yeso minimum distance bhitra player cha bhane tyaha bot spawn nagarne

function findSafeSpawnPos(margin) {
    for (let attempt = 0; attempt < 12; attempt++) {
        const x = rand(margin, WORLD.w - margin);
        const y = rand(margin, WORLD.h - margin);
        let safe = true;
        for (const id in owners) {
            const o = owners[id];
            const dx = x - o.x, dy = y - o.y;
            if (dx * dx + dy * dy < BOT_SPAWN_MIN_DIST * BOT_SPAWN_MIN_DIST) { safe = false; break; }
        }
        if (safe) return { x, y };
    }
    return { x: rand(margin, WORLD.w - margin), y: rand(margin, WORLD.h - margin) };
}

let botSpawnIndex = 0;
function spawnBot() {
    const i = botSpawnIndex++;
    const lap = Math.floor(i / BOT_NAMES.length) + 1;
    const name = BOT_NAMES[i % BOT_NAMES.length] + (lap > 1 ? ' ' + lap : '');
    const r = rand(8, 14);
    const botColor = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const pos = findSafeSpawnPos(200);
    const b = makeEntity(pos.x, pos.y, r, botColor, name, true);
    b.pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
    b.second = BOT_SECOND_COLORS[Math.floor(Math.random() * BOT_SECOND_COLORS.length)];
    b.path = [{ x: b.x, y: b.y }];
    b.len = START_LEN;
    bots[uid()] = b;
}
for (let i = 0; i < BOT_COUNT; i++) spawnBot();

io.on('connection', socket => {
    socket.on('join', payload => {
        const name = String(payload?.name || 'Player').slice(0, 12);
        const color = typeof payload?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(payload.color) ? payload.color : '#4be3d0';
        const second = typeof payload?.second === 'string' && /^#[0-9a-fA-F]{6}$/.test(payload.second) ? payload.second : null;
        const pattern = PATTERNS.includes(payload?.pattern) ? payload.pattern : 'solid';
        const perk = ['speedy', 'heavy', 'magnetic', 'lucky'].includes(payload?.perk) ? payload.perk : 'none';
        const hat = typeof payload?.hat === 'string' ? payload.hat : 'none';
        const sx = rand(200, WORLD.w - 200), sy = rand(200, WORLD.h - 200);
        const startR = perk === 'heavy' ? 16 : 10;
        owners[socket.id] = {
            name, color, second, pattern, perk, hat, inputX: 0, inputY: 0,
            x: sx, y: sy, r: startR, targetR: startR, kills: 0,
            len: START_LEN, path: [{ x: sx, y: sy }],
            boostUntil: 0, shieldUntil: 0, magnetUntil: perk === 'magnetic' ? Number.MAX_SAFE_INTEGER : 0,
            starUntil: 0, rampageUntil: 0, dashUntil: 0, dashReadyAt: 0, invisUntil: 0, invisReadyAt: 0,
            freezeReadyAt: 0, frozenUntil: 0, killStreak: 0, rageUntil: 0, lastRank: undefined,
            portalCooldownUntil: 0, sessionKills: 0, sessionStart: Date.now()
        };
        socket.emit('welcome', { id: socket.id, world: WORLD, biomeCount: BIOME_COUNT });
    });
    socket.on('input', dir => {
        const o = owners[socket.id];
        if (!o || typeof dir?.x !== 'number') return;
        o.inputX = clamp(dir.x, -1, 1);
        o.inputY = clamp(dir.y, -1, 1);
        o.boosting = !!dir.boost;
        if (dir.dash) {
            const did = tryDash(o);
            if (did) socket.emit('sfx', 'dash');
        }
        if (dir.invis) {
            const did = tryInvis(o);
            if (did) socket.emit('sfx', 'invis');
        }
        if (dir.freeze) {
            const did = tryFreeze(o);
            if (did) socket.emit('sfx', 'freeze');
        }
    });
    socket.on('continueAfterAd', () => {
        const saved = deadPlayersCache[socket.id];
        if (!saved || Date.now() - saved.savedAt > CONTINUE_WINDOW_MS) {
            socket.emit('continueFailed');
            return;
        }
        const revivedR = radiusForMass(massForRadius(saved.r) * 0.5); // revive at 50% of previous mass
        owners[socket.id] = {
            ...saved, r: revivedR, targetR: revivedR,
            x: rand(200, WORLD.w - 200), y: rand(200, WORLD.h - 200),
            path: [{ x: 0, y: 0 }], shieldUntil: Date.now() + 3000
        };
        owners[socket.id].path = [{ x: owners[socket.id].x, y: owners[socket.id].y }];
        delete deadPlayersCache[socket.id];
        socket.emit('continued');
    });
    socket.on('devSetMass', targetMass => {
        const o = owners[socket.id];
        if (!o || o.name !== DEV_UNLIMITED_DASH_NAME) return; // dev-only, ram matra
        const m = Number(targetMass);
        if (!isFinite(m) || m <= 0) return;
        o.targetR = capR(radiusForMass(m));
        o.r = o.targetR;
        o.len = massForRadius(o.r) * 3.4; // bots jasari nai natural scale — pahile pathNode cap le hang thegisakyo tesaile aba full-size dinu safe
        o.path = [{ x: o.x, y: o.y }]; // path reset garne, purano huge path clear garna
    });
    socket.on('disconnect', () => { delete owners[socket.id]; delete revengeMemory[socket.id]; delete deadPlayersCache[socket.id]; });
});

function eatFood(entity, foodGrid, isPlayer) {
    let ate = false;
    const nearby = nearbyItems(foodGrid, entity.x, entity.y, GRID_CELL, 1);
    const EAT_REACH = entity.pattern === 'dragonSkin' ? 2.6 : 1.5; // dragon's big head visual needs a wider reach to feel right
    let bonusMult = isPlayer ? 1.6 : 1; // players grow a bit faster than bots to stay competitive
    if (entity.name === DEV_UNLIMITED_DASH_NAME) bonusMult *= 5; // dev tester grows 5x for testing
    for (const f of nearby) {
        if (f.eaten) continue;
        const reach = (entity.r + f.r) * EAT_REACH;
        if (dist2(entity, f) < reach * reach) {
            entity.targetR = capR(radiusForMass(massForRadius(entity.r) + (f.bonus || 3.5) * bonusMult));
            f.eaten = true; ate = true;
        }
    }
    return ate;
}

function eatCoins(entity, coinGrid) {
    let count = 0;
    const nearby = nearbyItems(coinGrid, entity.x, entity.y, GRID_CELL, 1);
    const coinMult = entity.name === DEV_UNLIMITED_DASH_NAME ? 5 : 1;
    const coinReach = entity.pattern === 'dragonSkin' ? 1.8 : 1;
    for (const c of nearby) {
        if (c.eaten) continue;
        const reach = (entity.r + c.r) * coinReach;
        if (dist2(entity, c) < reach * reach) {
            entity.targetR = capR(radiusForMass(massForRadius(entity.r) + 90 * coinMult));
            c.eaten = true; count++;
        }
    }
    return count;
}
function eatPowerup(entity) {
    for (let i = powerups.length - 1; i >= 0; i--) {
        const pu = powerups[i];
        if (dist2(entity, pu) < (entity.r + pu.r) * (entity.r + pu.r)) {
            entity.targetR = capR(radiusForMass(massForRadius(entity.r) + 5));
            if (pu.type === 'speed') entity.boostUntil = Date.now() + BOOST_MS;
            else if (pu.type === 'shield') entity.shieldUntil = Date.now() + SHIELD_MS;
            else if (pu.type === 'magnet') entity.magnetUntil = Date.now() + MAGNET_MS;
            else if (pu.type === 'star') { entity.starUntil = Date.now() + STAR_MS; entity.boostUntil = Date.now() + STAR_MS; entity.shieldUntil = Date.now() + STAR_MS; }
            powerups.splice(i, 1);
            return pu.type;
        }
    }
    return null;
}
function applyMagnet(entity, dt, foodGrid) {
    if (!(entity.magnetUntil > Date.now())) return;
    const nearby = nearbyItems(foodGrid, entity.x, entity.y, GRID_CELL, 2);
    for (const f of nearby) {
        if (f.eaten) continue;
        if (dist2(entity, f) < MAGNET_RADIUS * MAGNET_RADIUS) {
            const dx = entity.x - f.x, dy = entity.y - f.y;
            const d = Math.hypot(dx, dy) || 1;
            f.x += (dx / d) * 240 * dt;
            f.y += (dy / d) * 240 * dt;
        }
    }
}
function updateBot(b, dt, foodGrid) {
    if (b.frozenUntil > Date.now()) { advancePath(b, dt, b.len); return; }
    b.wanderTimer -= dt;
    let nearestFood = null, nd = Infinity;
    let candidates = nearbyItems(foodGrid, b.x, b.y, GRID_CELL, 1);
    if (!candidates.length) candidates = nearbyItems(foodGrid, b.x, b.y, GRID_CELL, 2);
    for (const f of candidates) {
        if (f.eaten) continue;
        const d = dist2(b, f);
        if (d < nd) { nd = d; nearestFood = f; }
    }
    let threat = null, td = Infinity;
    const now = Date.now();
    for (const o of allBots()) {
        if (o === b) continue;
        const d = dist2(b, o);
        if (d < 180 * 180 && d < td && !(b.shieldUntil > now)) { td = d; threat = o; }
    }
    let desiredAng;
    if (threat) desiredAng = Math.atan2(b.y - threat.y, b.x - threat.x);
    else if (nearestFood && nd < 500 * 500) desiredAng = Math.atan2(nearestFood.y - b.y, nearestFood.x - b.x);
    else {
        if (b.wanderTimer <= 0) {
            const turnAmount = rand(-1.1, 1.1); // relative turn only, not a full random direction — avoids spiral loops
            b.wanderAngle = (b.heading || 0) + turnAmount;
            b.wanderTimer = rand(1.4, 2.8);
        }
        desiredAng = b.wanderAngle;
    }
    const margin = 220;
    let wallX = 0, wallY = 0;
    if (b.x < margin) wallX = 1; else if (b.x > WORLD.w - margin) wallX = -1;
    if (b.y < margin) wallY = 1; else if (b.y > WORLD.h - margin) wallY = -1;
    if (wallX || wallY) desiredAng = Math.atan2(wallY || Math.sin(desiredAng), wallX || Math.cos(desiredAng));
    if (b.heading === undefined) b.heading = desiredAng;
    let diff = desiredAng - b.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turnRate = (threat || wallX || wallY ? 6 : 3.2) * dt;
    b.heading += clamp(diff, -turnRate, turnRate);
    const sp = speedFor(b) * (threat ? 1.15 : 0.82);
    b.vx = Math.cos(b.heading) * sp; b.vy = Math.sin(b.heading) * sp;
    b.x = clamp(b.x + b.vx * dt, b.r, WORLD.w - b.r);
    b.y = clamp(b.y + b.vy * dt, b.r, WORLD.h - b.r);
    b.r = lerp(b.r, b.targetR, 0.08);
    b.len = massForRadius(b.r) * 3.4;
    advancePath(b, dt, b.len);
}

function collectWorms() {
    const list = [];
    for (const id in owners) list.push({ id, kind: 'player', ent: owners[id] });
    for (const id in bots) list.push({ id, kind: 'bot', ent: bots[id] });
    return list;
}
function checkDeaths(now, segCache) {
    const worms = collectWorms();
    const dead = [];
    // herek worm ko body ko actual bounding box — purano "PROX_RANGE + len" check
    // thulo worm ma kahilyai skip hudainathyo (len lakhau ma pugcha)
    const bounds = new Map();
    for (const w of worms) {
        const segs = segCache.get(w.ent) || [];
        let minX = w.ent.x, maxX = w.ent.x, minY = w.ent.y, maxY = w.ent.y;
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            if (s.x < minX) minX = s.x;
            if (s.x > maxX) maxX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.y > maxY) maxY = s.y;
        }
        const pad = w.ent.r + BODY_HIT_PAD + 6;
        bounds.set(w.ent, { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad });
    }
    for (const w of worms) {
        const o = w.ent;
        if (o.shieldUntil > now) continue;
        let killer = null;
        for (const other of worms) {
            if (other === w) continue;
            const bb = bounds.get(other.ent);
            if (!bb || o.x < bb.minX || o.x > bb.maxX || o.y < bb.minY || o.y > bb.maxY) continue;
            const segs = segCache.get(other.ent) || [];
            const n = segs.length;
            for (let si = 0; si < n; si++) {
                const t = si / Math.max(1, n - 1);
                const segR = lerp(other.ent.r, other.ent.r * 0.35, t) * 0.92;
                const hitR = o.r * 0.6 + segR * 0.5 + BODY_HIT_PAD;
                if (dist2(o, segs[si]) < hitR * hitR) { killer = other; break; }
            }
            if (killer) break;
        }
        let cause = killer ? 'worm' : null;
        if (!killer) {
            for (const v of viruses) {
                const hitR = o.r * 0.7 + v.r * 0.5;
                if (dist2(o, v) < hitR * hitR) { cause = 'virus'; break; }
            }
        }
        if (!killer && cause === null) {
            const BORDER_PAD = 4;
            if (o.x <= o.r + BORDER_PAD || o.x >= WORLD.w - o.r - BORDER_PAD ||
                o.y <= o.r + BORDER_PAD || o.y >= WORLD.h - o.r - BORDER_PAD) {
                cause = 'border';
            }
        }
        if (killer || cause === 'virus' || cause === 'border') dead.push({ id: w.id, kind: w.kind, ent: o, killer, cause });
    }
    return dead;
}
function dropFoodFromCorpse(o) {
    const segs = wormSegments(o);
    const mass = massForRadius(o.r);
    const chunkBonus = clamp(mass * 0.05, 150, 900);
    const chunkR = 20;
    for (let i = 0; i < segs.length; i += 2) {
        food.push({
            x: segs[i].x + rand(-14, 14),
            y: segs[i].y + rand(-14, 14),
            r: chunkR + rand(-3, 3),
            color: '#ffd700',
            bonus: chunkBonus,
            golden: true
        });
    }
}
function tryGoldenSpawn(now) {
    if (goldenBotId || now < goldenSpawnAt) return;
    const ids = Object.keys(bots);
    if (!ids.length) return;
    const id = ids[Math.floor(Math.random() * ids.length)];
    goldenBotId = id;
    bots[id].golden = true;
    goldenUntil = now + GOLDEN_DURATION_MS;
    io.emit('golden', { name: bots[id].name });
}

// ---- NEW: Daily-ish challenge tracked server-side per connected player (resets on reconnect for simplicity) ----
function checkChallenge(o, id) {
    const CHALLENGE_KILLS = 5;
    const CHALLENGE_MASS = 50000;
    if (!o.challengeDone) {
        if ((o.sessionKills || 0) >= CHALLENGE_KILLS || massForRadius(o.r) >= CHALLENGE_MASS) {
            o.challengeDone = true;
            io.to(id).emit('coin', 100);
            io.to(id).emit('achievement', { id: 'challenge', label: 'Challenge Complete! +100 coins' });
        }
    }
}

let last = Date.now();
let ranked = [];
setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const foodGrid = buildGrid(food, GRID_CELL);
    const coinGrid = buildGrid(coins, GRID_CELL);

    for (const id in owners) updateWorm(owners[id], dt);
    for (const id in bots) updateBot(bots[id], dt, foodGrid);
    for (const id in owners) applyMagnet(owners[id], dt, foodGrid);
    for (const id in bots) applyMagnet(bots[id], dt, foodGrid);

    // portal checks (players + bots)
    for (const id in owners) tryPortal(owners[id], now);
    for (const id in bots) tryPortal(bots[id], now);

    trySpawnBoss(now);
    checkBossHits(now);

    const segCache = new Map();
    for (const id in owners) segCache.set(owners[id], wormSegments(owners[id]));
    for (const id in bots) segCache.set(bots[id], wormSegments(bots[id]));
    lastSegCache = segCache;

    for (const id in owners) {
        const o = owners[id];
        let coinCount = 0, ateFood = false, powerType = null;
        const mult = (o.starUntil > now ? 2 : 1) * (o.rageUntil > now ? RAGE_MULT : 1);
        if (eatFood(o, foodGrid, true)) { ateFood = true; o.len += 4 * mult; }
        coinCount += eatCoins(o, coinGrid);
        if (coinCount > 0) o.len += coinCount * 2 * mult;
        const pt = eatPowerup(o); if (pt) powerType = pt;
        if (eatRampage(o)) io.to(id).emit('sfx', 'rampage');
        if (coinCount > 0) io.to(id).emit('coin', o.perk === 'lucky' ? coinCount * 2 : coinCount);
        else if (powerType) io.to(id).emit('sfx', powerType);
        else if (ateFood) io.to(id).emit('sfx', 'food');
        checkChallenge(o, id);
    }
    for (const id in bots) {
        const b = bots[id];
        if (eatFood(b, foodGrid, false)) b.len += 4;
        const c = eatCoins(b, coinGrid); if (c > 0) b.len += c * 2;
        eatPowerup(b);
        eatRampage(b);
    }

    if (food.some(f => f.eaten)) food = food.filter(f => !f.eaten);
    if (coins.some(c => c.eaten)) coins = coins.filter(c => !c.eaten);

    for (const w of checkDeaths(now, segCache)) {
        dropFoodFromCorpse(w.ent);
        if (w.killer) {
            const k = w.killer.ent;
            k.kills = (k.kills || 0) + 1;
            k.sessionKills = (k.sessionKills || 0) + 1;
            k.killStreak = (k.killStreak || 0) + 1;
            if (k.killStreak >= RAGE_STREAK) k.rageUntil = now + RAGE_MS;
            if (w.killer.kind === 'player') {
                const rv = revengeMemory[w.killer.id];
                if (rv && rv.until > now && rv.killerName === w.ent.name) {
                    k.targetR = capR(radiusForMass(massForRadius(k.r) * REVENGE_MULT));
                    delete revengeMemory[w.killer.id];
                    io.to(w.killer.id).emit('sfx', 'revenge');
                }
            }

            const victimMass = massForRadius(w.ent.r);
            const killMult = victimMass >= 500 ? 3 : 1;
            const devMult = k.name === DEV_UNLIMITED_DASH_NAME ? 5 : 1;
            const massGain = victimMass * killMult * devMult;
            k.targetR = capR(radiusForMass(massForRadius(k.targetR) + massGain));
            k.len += massGain * 0.9;

            if (w.killer.kind === 'player') {
                io.to(w.killer.id).emit('gotKill', { victim: w.ent.name, gain: Math.round(massGain) });
                if (k.kills === 1) io.to(w.killer.id).emit('achievement', { id: 'first_kill', label: 'First Blood!' });
                if (k.kills === 10) io.to(w.killer.id).emit('achievement', { id: 'ten_kills', label: '10 Kills!' });
                if (k.kills === 50) io.to(w.killer.id).emit('achievement', { id: 'fifty_kills', label: '50 Kills — Predator!' });
            }
            if (w.id === goldenBotId) {
                if (w.killer.kind === 'player') io.to(w.killer.id).emit('coin', GOLDEN_COIN_BONUS);
                io.emit('goldenKilled', { killer: k.name });
                goldenBotId = null;
                goldenSpawnAt = now + GOLDEN_INTERVAL_MS;
            }
        } else if (w.id === goldenBotId) {
            goldenBotId = null;
            goldenSpawnAt = now + GOLDEN_INTERVAL_MS;
        }
        if (w.kind === 'player' && w.killer) {
            revengeMemory[w.id] = { killerName: w.killer.ent.name, until: now + REVENGE_WINDOW_MS };
        }
        io.emit('kill', { victim: w.ent.name, killer: w.killer ? w.killer.ent.name : null, cause: w.cause });
        if (w.kind === 'player') {
            deadPlayersCache[w.id] = { ...w.ent, savedAt: now };
            io.to(w.id).emit('died', { size: Math.round(massForRadius(w.ent.r)), kills: w.ent.kills || 0, canContinue: true });
            delete owners[w.id];
        } else {
            delete bots[w.id];
        }
    }

    while (Object.keys(bots).length < BOT_COUNT) spawnBot();
    if (food.length < FOOD_COUNT) spawnFood(FOOD_COUNT - food.length);
    if (coins.length < COIN_COUNT) spawnCoins(COIN_COUNT - coins.length);
    if (powerups.length < POWERUP_COUNT) spawnPowerups(POWERUP_COUNT - powerups.length);
    if (viruses.length < VIRUS_COUNT) spawnViruses(VIRUS_COUNT - viruses.length);
    trySpawnRampage();
    tryGoldenSpawn(now);
    if (goldenBotId && (!bots[goldenBotId] || now > goldenUntil)) {
        if (bots[goldenBotId]) bots[goldenBotId].golden = false;
        goldenBotId = null;
        goldenSpawnAt = now + GOLDEN_INTERVAL_MS;
    }

    ranked = collectWorms().sort((a, b) => massForRadius(b.ent.r) - massForRadius(a.ent.r));
    ranked.forEach((w, i) => {
        if (w.kind === 'player') {
            const rank = i + 1;
            const o = w.ent;
            if (rank <= 5 && (o.lastRank === undefined || o.lastRank > 5)) {
                io.to(w.id).emit('milestone', { type: 'top5' });
            }
            o.lastRank = rank;

            const mass = massForRadius(o.r);
            const lakh = Math.floor(mass / 100000);
            if (lakh > (o.lastLakh || 0)) {
                o.lastLakh = lakh;
                io.to(w.id).emit('lakhMilestone', { lakh });
            }
        }
    });

    const BASE_VIEW_RADIUS = 2200;
    const viewRadiusFor = r => BASE_VIEW_RADIUS + r * 3; // thulo body hune bitikai door samma dekhne (camera zoom-out sanga match)
    const inViewR2 = (obj, px, py, r2) => {
        const dx = obj.x - px, dy = obj.y - py;
        return dx * dx + dy * dy < r2;
    };

    const allPlayersData = Object.fromEntries(Object.entries(owners).map(([id, o]) => [id, {
        name: o.name, color: o.color, second: o.second, pattern: o.pattern, hat: o.hat || 'none', x: Math.round(o.x), y: Math.round(o.y), r: Math.round(o.r * 10) / 10, kills: o.kills || 0, segments: segCache.get(o) || [],
        boost: o.boostUntil > now, shield: o.shieldUntil > now, magnet: o.magnetUntil > now, star: o.starUntil > now,
        dashing: o.dashUntil > now, dashReadyAt: o.dashReadyAt || 0,
        invis: o.invisUntil > now, invisReadyAt: o.invisReadyAt || 0,
        frozen: o.frozenUntil > now, freezeReadyAt: o.freezeReadyAt || 0,
        rage: o.rageUntil > now, rampage: o.rampageUntil > now
    }]));
    const allBotsData = Object.fromEntries(Object.entries(bots).map(([id, b]) => [id, {
        x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.r * 10) / 10, color: b.color, name: b.name, segments: segCache.get(b) || [],
        boost: b.boostUntil > now, shield: b.shieldUntil > now, magnet: b.magnetUntil > now, star: b.starUntil > now,
        frozen: b.frozenUntil > now, rampage: b.rampageUntil > now, golden: !!b.golden
    }]));
    const allFoodData = food.map(f => ({ x: Math.round(f.x), y: Math.round(f.y), r: Math.round(f.r), color: f.color, emoji: f.emoji || null, golden: f.golden || false, group: f.group ?? null }));
    const allCoinsData = coins.map(c => ({ x: Math.round(c.x), y: Math.round(c.y), r: c.r }));
    const allPowerupsData = powerups.map(pu => ({ x: Math.round(pu.x), y: Math.round(pu.y), r: pu.r, type: pu.type }));
    const allVirusesData = viruses.map(v => ({ x: Math.round(v.x), y: Math.round(v.y), r: v.r }));
    const rampageOrbData = rampageOrb ? { x: rampageOrb.x, y: rampageOrb.y, r: rampageOrb.r } : null;
    const portalData = portals.map(p => ({ x: p.x, y: p.y, r: p.r, color: p.color }));
    const bossData = boss ? { x: boss.x, y: boss.y, r: boss.r, hp: boss.hp } : null;

    // leaderboard client ma 400ms ma matra render huncha — hareक tick pathaउनu waste
    if (!globalThis.__lbNext || now >= globalThis.__lbNext) {
        globalThis.__lbCache = ranked.map(w => ({ name: w.ent.name, mass: Math.round(massForRadius(w.ent.r)), me: w.kind === 'player' ? w.id : null }));
        globalThis.__lbNext = now + 400;
    }
    const leaderboardData = globalThis.__lbCache;

    for (const id in owners) {
        const me = owners[id];
        const px = me.x, py = me.y;
        const VR = viewRadiusFor(me.r);
        const VR2 = VR * VR;
        const inView = (obj, x, y) => inViewR2(obj, x, y, VR2);

        const players = { [id]: allPlayersData[id] };
        for (const oid in allPlayersData) {
            if (oid !== id && inView(allPlayersData[oid], px, py)) players[oid] = allPlayersData[oid];
        }
        const botsNear = {};
        for (const bid in allBotsData) {
            if (inView(allBotsData[bid], px, py)) botsNear[bid] = allBotsData[bid];
        }

        io.to(id).emit('state', {
            players,
            bots: botsNear,
            food: allFoodData.filter(f => inView(f, px, py)),
            coins: allCoinsData.filter(c => inView(c, px, py)),
            powerups: allPowerupsData.filter(pu => inView(pu, px, py)),
            viruses: allVirusesData.filter(v => inView(v, px, py)),
            rampageOrb: rampageOrbData,
            portals: portalData.filter(p => inView(p, px, py)),
            boss: bossData && inView(bossData, px, py) ? bossData : null,
            leaderboard: leaderboardData,
            devTopEntities: (id === Object.keys(owners).find(oid => owners[oid].name === DEV_UNLIMITED_DASH_NAME))
                ? ranked.slice(0, 20).map(w => ({
                    name: w.ent.name, kind: w.kind, x: Math.round(w.ent.x), y: Math.round(w.ent.y),
                    mass: Math.round(massForRadius(w.ent.r))
                }))
                : null
        });
    }
}, 1000 / 24); // 30 bata 24 tick/sec — CPU load kam garna, visually farak thaha painna

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log('Munchr.io server running: http://localhost:' + PORT));
