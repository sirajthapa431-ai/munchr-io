import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '../client')));

const WORLD = { w: 8000, h: 8000 };
const FOOD_COUNT = 1400;
const COIN_COUNT = 200;
const POWERUP_COUNT = 32;
const PALETTE = ['#ff6fa5', '#ffd23f', '#4be3d0', '#b98bff', '#ff9d5c', '#6fe07a'];
const PATTERNS = ['solid', 'stripe', 'dots', 'gradient', 'tiger', 'scale', 'rainbow', 'lava'];
const BOT_NAMES = ['Pip', 'Nib', 'Zumo', 'Kiki', 'Bramble', 'Nova', 'Wiggle', 'Slinky', 'Boop', 'Fango', 'Twix', 'Marbles', 'Ziggy', 'Puffin', 'Coco', 'Ranger', 'Milo', 'Cosmo', 'Peanut', 'Dash'];
const BOT_COUNT = 40;
const BOOST_MULT = 1.6;
const BOOST_MS = 4000;
const DASH_COOLDOWN_MS = 8000;
const DASH_DURATION_MS = 250;
const DASH_SPEED_MULT = 2.6;
const DASH_MIN_MASS = 20;
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
const VIRUS_COUNT = 24;
const VIRUS_R = 45;
const RAMPAGE_DURATION_MS = 8000;
const RAMPAGE_RESPAWN_MS = 40000;
const RAMPAGE_SPEED_MULT = 2.1;
const TURN_RATE_MAX = 6.4;   // rad/s for a tiny worm — very snappy
const TURN_RATE_MIN = 1.7;   // rad/s for a huge worm — heavier, slower turning
const FOOD_EMOJIS = ['🍄', '🥕', '🍞', '🍎', '🥦', '🍇', '🍊'];
const EMOJI_FOOD_CHANCE = 0.16;
const STAR_MS = 6000;
const SEG_SPACING = 14;
const START_LEN = 90;
const BODY_HIT_PAD = 8;
const MAX_R = 220; // hard cap — prevents runaway snowball growth and keeps segment arrays small

const RAGE_STREAK = 3;
const RAGE_MS = 5000;
const RAGE_MULT = 2;
const REVENGE_WINDOW_MS = 30000;
const REVENGE_MULT = 2;
const GOLDEN_INTERVAL_MS = 45000;
const GOLDEN_DURATION_MS = 20000;
const GOLDEN_COIN_BONUS = 50;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const radiusForMass = m => Math.sqrt(m) * 3.1;
const massForRadius = r => (r / 3.1) * (r / 3.1);
const baseSpeedFor = r => clamp(5000 / (r + 8), 90, 200);
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

let food = [], coins = [], powerups = [], viruses = [];
function spawnFood(n) {
    for (let i = 0; i < n; i++) {
        const isEmoji = Math.random() < EMOJI_FOOD_CHANCE;
        if (isEmoji) {
            food.push({ x: rand(40, WORLD.w - 40), y: rand(40, WORLD.h - 40), r: rand(13, 17), color: PALETTE[Math.floor(Math.random() * PALETTE.length)], emoji: FOOD_EMOJIS[Math.floor(Math.random() * FOOD_EMOJIS.length)], bonus: 9 });
        } else {
            food.push({ x: rand(40, WORLD.w - 40), y: rand(40, WORLD.h - 40), r: rand(4, 7), color: PALETTE[Math.floor(Math.random() * PALETTE.length)] });
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
spawnFood(FOOD_COUNT); spawnCoins(COIN_COUNT); spawnPowerups(POWERUP_COUNT); spawnViruses(VIRUS_COUNT);

const owners = {};
const bots = {};
const revengeMemory = {};
let goldenBotId = null;
let goldenUntil = 0;
let goldenSpawnAt = Date.now() + GOLDEN_INTERVAL_MS;

function tryDash(o) {
    const now = Date.now();
    if (now < (o.dashReadyAt || 0)) return false;
    if (massForRadius(o.r) < DASH_MIN_MASS) return false;
    o.dashUntil = now + DASH_DURATION_MS;
    o.dashReadyAt = now + DASH_COOLDOWN_MS;
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
        killStreak: 0, rageUntil: 0, golden: false
    };
}
function allBots() {
    const arr = [];
    for (const id in bots) arr.push(bots[id]);
    return arr;
}
function advancePath(o, dt, len) {
    const head = o.path[0];
    if (!head || Math.hypot(o.x - head.x, o.y - head.y) > 2) {
        o.path.unshift({ x: o.x, y: o.y });
        let total = 0, cut = o.path.length;
        for (let i = 1; i < o.path.length; i++) {
            total += Math.hypot(o.path[i].x - o.path[i - 1].x, o.path[i].y - o.path[i - 1].y);
            if (total > len + 40) { cut = i; break; }
        }
        if (cut < o.path.length) o.path.length = cut;
    }
}
function updateWorm(o, dt) {
    if (o.frozenUntil > Date.now()) { advancePath(o, dt, o.len); return; }
    const ix = o.inputX || 0, iy = o.inputY || 0;
    const mag = Math.hypot(ix, iy);
    const boosting = o.boosting && massForRadius(o.r) > 18;
    const sp = speedFor(o) * (boosting ? 1.6 : 1);
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
function wormSegments(o) {
    const segs = []; let dist = 0, next = SEG_SPACING;
    for (let i = 1; i < o.path.length && segs.length < 150; i++) {
        const a = o.path[i - 1], b = o.path[i];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        while (dist + d >= next) {
            const t = (next - dist) / d;
            segs.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
            next += SEG_SPACING;
        }
        dist += d;
    }
    return segs;
}
let botSpawnIndex = 0;
function spawnBot() {
    const i = botSpawnIndex++;
    const lap = Math.floor(i / BOT_NAMES.length) + 1;
    const name = BOT_NAMES[i % BOT_NAMES.length] + (lap > 1 ? ' ' + lap : '');
    const r = rand(14, 26);
    const b = makeEntity(rand(200, WORLD.w - 200), rand(200, WORLD.h - 200), r, PALETTE[i % PALETTE.length], name, true);
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
        const sx = rand(200, WORLD.w - 200), sy = rand(200, WORLD.h - 200);
        const startR = perk === 'heavy' ? 24 : 16;
        owners[socket.id] = {
            name, color, second, pattern, perk, inputX: 0, inputY: 0,
            x: sx, y: sy, r: startR, targetR: startR, kills: 0,
            len: START_LEN, path: [{ x: sx, y: sy }],
            boostUntil: 0, shieldUntil: 0, magnetUntil: perk === 'magnetic' ? Number.MAX_SAFE_INTEGER : 0,
            starUntil: 0, rampageUntil: 0, dashUntil: 0, dashReadyAt: 0, invisUntil: 0, invisReadyAt: 0,
            freezeReadyAt: 0, frozenUntil: 0, killStreak: 0, rageUntil: 0, lastRank: undefined
        };
        socket.emit('welcome', { id: socket.id, world: WORLD });
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
    socket.on('disconnect', () => { delete owners[socket.id]; delete revengeMemory[socket.id]; });
});

function eatFood(entity) {
    let ate = false;
    for (let i = food.length - 1; i >= 0; i--) {
        const f = food[i];
        if (dist2(entity, f) < (entity.r + f.r) * (entity.r + f.r)) {
            entity.targetR = capR(radiusForMass(massForRadius(entity.r) + (f.bonus || 3.5)));
            food.splice(i, 1); ate = true;
        }
    }
    return ate;
}
function eatCoins(entity) {
    let count = 0;
    for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        if (dist2(entity, c) < (entity.r + c.r) * (entity.r + c.r)) {
            entity.targetR = capR(radiusForMass(massForRadius(entity.r) + 2.5));
            coins.splice(i, 1); count++;
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
function applyMagnet(entity, dt) {
    if (!(entity.magnetUntil > Date.now())) return;
    for (const f of food) {
        if (dist2(entity, f) < MAGNET_RADIUS * MAGNET_RADIUS) {
            const dx = entity.x - f.x, dy = entity.y - f.y;
            const d = Math.hypot(dx, dy) || 1;
            f.x += (dx / d) * 240 * dt;
            f.y += (dy / d) * 240 * dt;
        }
    }
}
function updateBot(b, dt) {
    if (b.frozenUntil > Date.now()) { advancePath(b, dt, b.len); return; }
    b.wanderTimer -= dt;
    let nearestFood = null, nd = Infinity;
    for (const f of food) { const d = dist2(b, f); if (d < nd) { nd = d; nearestFood = f; } }
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
        if (b.wanderTimer <= 0) { b.wanderAngle = Math.random() * Math.PI * 2; b.wanderTimer = rand(1.2, 2.6); }
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
    const PROX_RANGE = 350;
    for (const w of worms) {
        const o = w.ent;
        if (o.shieldUntil > now) continue;
        let killer = null;
        for (const other of worms) {
            if (other === w) continue;
            const dx = other.ent.x - o.x, dy = other.ent.y - o.y;
            if (dx * dx + dy * dy > PROX_RANGE * PROX_RANGE) continue;
            const segs = segCache.get(other.ent) || [];
            const hitR = o.r * 0.6 + BODY_HIT_PAD;
            for (const s of segs) {
                if (dist2(o, s) < hitR * hitR) { killer = other; break; }
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
        if (killer || cause === 'virus') dead.push({ id: w.id, kind: w.kind, ent: o, killer, cause });
    }
    return dead;
}
function dropFoodFromCorpse(o) {
    const segs = wormSegments(o);
    const mass = massForRadius(o.r);
    const chunkBonus = clamp(mass * 0.015, 3, 10);
    const chunkR = clamp(o.r * 0.3, 5, 16);
    for (let i = 0; i < segs.length; i += 3) {
        food.push({ x: segs[i].x + rand(-10, 10), y: segs[i].y + rand(-10, 10), r: chunkR + rand(-2, 2), color: o.color, bonus: chunkBonus });
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

let last = Date.now();
setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    for (const id in owners) updateWorm(owners[id], dt);
    for (const id in bots) updateBot(bots[id], dt);
    for (const id in owners) applyMagnet(owners[id], dt);
    for (const id in bots) applyMagnet(bots[id], dt);

    const segCache = new Map();
    for (const id in owners) segCache.set(owners[id], wormSegments(owners[id]));
    for (const id in bots) segCache.set(bots[id], wormSegments(bots[id]));

    for (const id in owners) {
        const o = owners[id];
        let coinCount = 0, ateFood = false, powerType = null;
        const mult = (o.starUntil > now ? 2 : 1) * (o.rageUntil > now ? RAGE_MULT : 1);
        if (eatFood(o)) { ateFood = true; o.len += 4 * mult; }
        coinCount += eatCoins(o);
        if (coinCount > 0) o.len += coinCount * 2 * mult;
        const pt = eatPowerup(o); if (pt) powerType = pt;
        if (eatRampage(o)) io.to(id).emit('sfx', 'rampage');
        if (coinCount > 0) io.to(id).emit('coin', o.perk === 'lucky' ? coinCount * 2 : coinCount);
        else if (powerType) io.to(id).emit('sfx', powerType);
        else if (ateFood) io.to(id).emit('sfx', 'food');
    }
    for (const id in bots) {
        const b = bots[id];
        if (eatFood(b)) b.len += 4;
        const c = eatCoins(b); if (c > 0) b.len += c * 2;
        eatPowerup(b);
        eatRampage(b);
    }

    for (const w of checkDeaths(now, segCache)) {
        dropFoodFromCorpse(w.ent);
        if (w.killer) {
            const k = w.killer.ent;
            k.kills = (k.kills || 0) + 1;
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
            io.to(w.id).emit('died', { size: Math.round(massForRadius(w.ent.r)), kills: w.ent.kills || 0 });
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

    const ranked = collectWorms().sort((a, b) => massForRadius(b.ent.r) - massForRadius(a.ent.r));
    ranked.forEach((w, i) => {
        if (w.kind === 'player') {
            const rank = i + 1;
            const o = w.ent;
            if (rank <= 5 && (o.lastRank === undefined || o.lastRank > 5)) {
                io.to(w.id).emit('milestone', { type: 'top5' });
            }
            o.lastRank = rank;
        }
    });

    io.emit('state', {
        players: Object.fromEntries(Object.entries(owners).map(([id, o]) => [id, {
            name: o.name, color: o.color, second: o.second, pattern: o.pattern, x: o.x, y: o.y, r: o.r, kills: o.kills || 0, segments: segCache.get(o) || [],
            boost: o.boostUntil > now, shield: o.shieldUntil > now, magnet: o.magnetUntil > now, star: o.starUntil > now,
            dashing: o.dashUntil > now, dashReadyAt: o.dashReadyAt || 0,
            invis: o.invisUntil > now, invisReadyAt: o.invisReadyAt || 0,
            frozen: o.frozenUntil > now, freezeReadyAt: o.freezeReadyAt || 0,
            rage: o.rageUntil > now, rampage: o.rampageUntil > now
        }])),
        bots: Object.fromEntries(Object.entries(bots).map(([id, b]) => [id, {
            x: b.x, y: b.y, r: b.r, color: b.color, name: b.name, segments: segCache.get(b) || [],
            boost: b.boostUntil > now, shield: b.shieldUntil > now, magnet: b.magnetUntil > now, star: b.starUntil > now,
            frozen: b.frozenUntil > now, rampage: b.rampageUntil > now, golden: !!b.golden
        }])),
        food: food.map(f => ({ x: f.x, y: f.y, r: f.r, color: f.color, emoji: f.emoji || null })),
        coins: coins.map(c => ({ x: c.x, y: c.y, r: c.r })),
        powerups: powerups.map(pu => ({ x: pu.x, y: pu.y, r: pu.r, type: pu.type })),
        viruses: viruses.map(v => ({ x: v.x, y: v.y, r: v.r })),
        rampageOrb: rampageOrb ? { x: rampageOrb.x, y: rampageOrb.y, r: rampageOrb.r } : null
    });
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log('Munchr.io server running: http://localhost:' + PORT));