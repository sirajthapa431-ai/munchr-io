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

const WORLD = { w: 6000, h: 6000 };
const FOOD_COUNT = 520;
const COIN_COUNT = 80;
const POWERUP_COUNT = 12;
const PALETTE = ['#ff6fa5', '#ffd23f', '#4be3d0', '#b98bff', '#ff9d5c', '#6fe07a'];
const BOT_NAMES = ['Pip', 'Nib', 'Zumo', 'Kiki', 'Bramble', 'Nova'];
const BOT_COUNT = 10;
const BOOST_MULT = 1.6;
const BOOST_MS = 4000;
const SHIELD_MS = 4500;
const MAGNET_MS = 5000;
const MAGNET_RADIUS = 260;
const POWER_TYPES = ['speed', 'shield', 'magnet'];
const SPLIT_MIN_MASS = 36;
const MAX_CELLS = 8;
const SPLIT_SPEED = 620;
const SPLIT_DECAY = 6;
const MERGE_COOLDOWN_MS = 12000;
const VIRUS_COUNT = 24;
const VIRUS_R = 45;
const EJECT_MIN_MASS = 24;
const EJECT_MASS_COST = 3;
const EJECT_SPEED = 780;
const EJECT_DECAY = 5;
const MAX_EJECTED = 200;
const RAMPAGE_DURATION_MS = 8000;
const RAMPAGE_RESPAWN_MS = 40000;
const RAMPAGE_SPEED_MULT = 2.1;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const radiusForMass = m => Math.sqrt(m) * 3.1;
const massForRadius = r => (r / 3.1) * (r / 3.1);
const baseSpeedFor = r => clamp(5000 / (r + 8), 90, 200);
function speedFor(entity) {
    const s = baseSpeedFor(entity.r);
    const now = Date.now();
    if (entity.rampageUntil > now) return s * RAMPAGE_SPEED_MULT;
    return (entity.boostUntil && now < entity.boostUntil) ? s * BOOST_MULT : s;
}
const uid = () => Math.random().toString(36).slice(2, 10);

let food = [], coins = [], powerups = [];
function spawnFood(n) { for (let i = 0; i < n; i++) food.push({ x: rand(40, WORLD.w - 40), y: rand(40, WORLD.h - 40), r: rand(4, 7), color: PALETTE[Math.floor(Math.random() * PALETTE.length)] }); }
function spawnCoins(n) { for (let i = 0; i < n; i++) coins.push({ x: rand(60, WORLD.w - 60), y: rand(60, WORLD.h - 60), r: 8 }); }
function spawnPowerups(n) { for (let i = 0; i < n; i++) powerups.push({ x: rand(80, WORLD.w - 80), y: rand(80, WORLD.h - 80), r: 13, type: POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)] }); }
let viruses = [];
function spawnViruses(n) { for (let i = 0; i < n; i++) viruses.push({ x: rand(150, WORLD.w - 150), y: rand(150, WORLD.h - 150), r: VIRUS_R }); }
let ejected = [];
let rampageOrb = null;
let rampageRespawnAt = 0;
function trySpawnRampage() {
    if (rampageOrb || Date.now() < rampageRespawnAt) return;
    rampageOrb = { x: rand(150, WORLD.w - 150), y: rand(150, WORLD.h - 150), r: 20 };
}
function eatRampage(entity) {
    if (!rampageOrb) return false;
    if (dist2(entity, rampageOrb) < (entity.r + rampageOrb.r) * (entity.r + rampageOrb.r)) {
        entity.rampageUntil = Date.now() + RAMPAGE_DURATION_MS;
        rampageOrb = null;
        rampageRespawnAt = Date.now() + RAMPAGE_RESPAWN_MS;
        return true;
    }
    return false;
}
function ejectFromOwner(o) {
    const ang = Math.atan2(o.inputY || 0, o.inputX || 0);
    for (const cell of o.cells) {
        const mass = massForRadius(cell.r);
        if (mass < EJECT_MIN_MASS) continue;
        if (ejected.length >= MAX_EJECTED) break;
        cell.targetR = radiusForMass(mass - EJECT_MASS_COST);
        const startR = cell.r * 0.9;
        ejected.push({
            x: cell.x + Math.cos(ang) * startR, y: cell.y + Math.sin(ang) * startR,
            r: 7, color: cell.color,
            vx: Math.cos(ang) * EJECT_SPEED, vy: Math.sin(ang) * EJECT_SPEED
        });
    }
}
function updateEjected(dt) {
    for (const e of ejected) {
        e.x = clamp(e.x + e.vx * dt, e.r, WORLD.w - e.r);
        e.y = clamp(e.y + e.vy * dt, e.r, WORLD.h - e.r);
        e.vx = lerp(e.vx, 0, Math.min(1, EJECT_DECAY * dt));
        e.vy = lerp(e.vy, 0, Math.min(1, EJECT_DECAY * dt));
    }
}
function eatEjected(entity) {
    let ate = false;
    for (let i = ejected.length - 1; i >= 0; i--) {
        const e = ejected[i];
        if (dist2(entity, e) < (entity.r + e.r) * (entity.r + e.r)) {
            entity.targetR = radiusForMass(massForRadius(entity.r) + 3);
            ejected.splice(i, 1); ate = true;
        }
    }
    return ate;
}
function checkVirusEjected() {
    for (let vi = viruses.length - 1; vi >= 0; vi--) {
        const v = viruses[vi];
        let hits = 0;
        for (let i = ejected.length - 1; i >= 0; i--) {
            if (dist2(v, ejected[i]) < (v.r + ejected[i].r) * (v.r + ejected[i].r)) {
                ejected.splice(i, 1); hits++;
            }
        }
        if (hits > 0) {
            v.feed = (v.feed || 0) + hits;
            if (v.feed >= 7) { viruses.splice(vi, 1); viruses.push({ x: v.x, y: v.y, r: VIRUS_R }); viruses.push({ x: v.x + rand(-40, 40), y: v.y + rand(-40, 40), r: VIRUS_R }); }
        }
    }
}
spawnFood(FOOD_COUNT); spawnCoins(COIN_COUNT); spawnPowerups(POWERUP_COUNT); spawnViruses(VIRUS_COUNT);

const owners = {};
const bots = {};

function makeEntity(x, y, r, color, name, isBot, ownerId) {
    return { id: uid(), ownerId, x, y, r, targetR: r, vx: 0, vy: 0, color, name, isBot, wanderAngle: Math.random() * Math.PI * 2, wanderTimer: 0, boostUntil: 0, shieldUntil: 0, magnetUntil: 0, splitVX: 0, splitVY: 0, mergeAt: 0 };
}
function allCells() {
    const arr = [];
    for (const id in owners) arr.push(...owners[id].cells);
    for (const id in bots) arr.push(bots[id]);
    return arr;
}
function splitOwner(o) {
    const ang = Math.atan2(o.inputY || 0, o.inputX || 0);
    const newCells = [];
    for (const cell of o.cells) {
        if (o.cells.length + newCells.length >= MAX_CELLS) break;
        const mass = massForRadius(cell.r);
        if (mass < SPLIT_MIN_MASS) continue;
        const half = radiusForMass(mass / 2);
        cell.targetR = half; cell.r = half;
        cell.mergeAt = Date.now() + MERGE_COOLDOWN_MS;
        const child = makeEntity(cell.x, cell.y, half, cell.color, cell.name, false, cell.ownerId);
        child.targetR = half;
        child.splitVX = Math.cos(ang) * SPLIT_SPEED;
        child.splitVY = Math.sin(ang) * SPLIT_SPEED;
        child.mergeAt = Date.now() + MERGE_COOLDOWN_MS;
        newCells.push(child);
    }
    o.cells.push(...newCells);
}
function updateOwnerCellPhysics(o) {
    const now = Date.now();
    for (let i = 0; i < o.cells.length; i++) {
        for (let j = i + 1; j < o.cells.length; j++) {
            const a = o.cells[i], b = o.cells[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 0.01;
            const minD = a.r + b.r;
            if (d < minD) {
                if (now > a.mergeAt && now > b.mergeAt) {
                    a.targetR = radiusForMass(massForRadius(a.r) + massForRadius(b.r));
                    a.x = (a.x + b.x) / 2; a.y = (a.y + b.y) / 2;
                    b.eaten = true;
                } else {
                    const overlap = (minD - d) / 2, nx = dx / d, ny = dy / d;
                    a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
                    b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
                }
            }
        }
    }
    o.cells = o.cells.filter(c => !c.eaten);
}
function popCell(o, cell) {
    const slotsLeft = MAX_CELLS - o.cells.length;
    if (slotsLeft <= 0) return;
    const pieces = Math.min(slotsLeft, 3);
    const mass = massForRadius(cell.r);
    const pieceMass = mass / (pieces + 1);
    const newR = radiusForMass(pieceMass);
    cell.targetR = newR; cell.r = newR;
    cell.mergeAt = Date.now() + MERGE_COOLDOWN_MS;
    for (let i = 0; i < pieces; i++) {
        const ang = Math.random() * Math.PI * 2;
        const child = makeEntity(cell.x, cell.y, newR, cell.color, cell.name, false, cell.ownerId);
        child.targetR = newR;
        child.splitVX = Math.cos(ang) * SPLIT_SPEED;
        child.splitVY = Math.sin(ang) * SPLIT_SPEED;
        child.mergeAt = Date.now() + MERGE_COOLDOWN_MS;
        o.cells.push(child);
    }
}
function checkViruses(o) {
    let popped = false;
    for (const cell of o.cells) {
        for (let i = viruses.length - 1; i >= 0; i--) {
            const v = viruses[i];
            if (cell.r > v.r * 1.05 && dist2(cell, v) < (cell.r + v.r) * (cell.r + v.r)) {
                viruses.splice(i, 1);
                popCell(o, cell);
                popped = true;
                break;
            }
        }
    }
    return popped;
}
function spawnBot(i) {
    const r = rand(14, 26);
    bots[uid()] = makeEntity(rand(200, WORLD.w - 200), rand(200, WORLD.h - 200), r, PALETTE[i % PALETTE.length], BOT_NAMES[i % BOT_NAMES.length], true);
}
for (let i = 0; i < BOT_COUNT; i++) spawnBot(i);

io.on('connection', socket => {
    socket.on('join', payload => {
        const name = String(payload?.name || 'Player').slice(0, 12);
        const color = typeof payload?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(payload.color) ? payload.color : '#4be3d0';
        const cell = makeEntity(rand(200, WORLD.w - 200), rand(200, WORLD.h - 200), 22, color, name, false, socket.id);
        owners[socket.id] = { name, color, inputX: 0, inputY: 0, cells: [cell] };
        socket.emit('welcome', { id: socket.id, world: WORLD });
    });
    socket.on('input', dir => {
        const o = owners[socket.id];
        if (!o || typeof dir?.x !== 'number') return;
        o.inputX = clamp(dir.x, -1, 1);
        o.inputY = clamp(dir.y, -1, 1);
    });
    socket.on('split', () => { if (owners[socket.id]) splitOwner(owners[socket.id]); });
    socket.on('eject', () => { if (owners[socket.id]) ejectFromOwner(owners[socket.id]); });
    socket.on('disconnect', () => { delete owners[socket.id]; });
});

function eatFood(entity) {
    let ate = false;
    for (let i = food.length - 1; i >= 0; i--) {
        const f = food[i];
        if (dist2(entity, f) < (entity.r + f.r) * (entity.r + f.r)) {
            entity.targetR = radiusForMass(massForRadius(entity.r) + 2.2);
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
            entity.targetR = radiusForMass(massForRadius(entity.r) + 1.4);
            coins.splice(i, 1); count++;
        }
    }
    return count;
}
function eatPowerup(entity) {
    for (let i = powerups.length - 1; i >= 0; i--) {
        const pu = powerups[i];
        if (dist2(entity, pu) < (entity.r + pu.r) * (entity.r + pu.r)) {
            entity.targetR = radiusForMass(massForRadius(entity.r) + 5);
            if (pu.type === 'speed') entity.boostUntil = Date.now() + BOOST_MS;
            else if (pu.type === 'shield') entity.shieldUntil = Date.now() + SHIELD_MS;
            else if (pu.type === 'magnet') entity.magnetUntil = Date.now() + MAGNET_MS;
            powerups.splice(i, 1);
            return pu.type;
        }
    }
    return null;
}
function eatEntities(a, allList) {
    const now = Date.now();
    for (const b of allList) {
        if (b === a || b.eaten) continue;
        if (a.ownerId && b.ownerId === a.ownerId) continue;
        if (b.shieldUntil > now) continue;
        const rampaging = a.rampageUntil > now;
        const sizeOk = rampaging || a.r > b.r * 1.05;
        const touchDist = rampaging ? (a.r + b.r) : (a.r * 0.62 + b.r * 0.62);
        if (sizeOk && dist2(a, b) < touchDist * touchDist) {
            a.targetR = radiusForMass(massForRadius(a.r) + massForRadius(b.r) * 0.82);
            b.eaten = true;
            return true;
        }
    }
    return false;
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
    b.wanderTimer -= dt;
    let nearestFood = null, nd = Infinity;
    for (const f of food) { const d = dist2(b, f); if (d < nd) { nd = d; nearestFood = f; } }
    let threat = null, td = Infinity;
    const now = Date.now();
    const all = allCells();
    for (const o of all) {
        if (o === b) continue;
        const d = dist2(b, o);
        if (o.r > b.r * 1.15 && d < 220 * 220 && d < td && !(b.shieldUntil > now)) { td = d; threat = o; }
    }
    let ang;
    if (threat) ang = Math.atan2(b.y - threat.y, b.x - threat.x);
    else if (nearestFood && nd < 500 * 500) ang = Math.atan2(nearestFood.y - b.y, nearestFood.x - b.x);
    else {
        if (b.wanderTimer <= 0) { b.wanderAngle = Math.random() * Math.PI * 2; b.wanderTimer = rand(1.2, 2.6); }
        ang = b.wanderAngle;
    }
    const sp = speedFor(b) * (threat ? 1.15 : 0.82);
    b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp;
    b.x = clamp(b.x + b.vx * dt, b.r, WORLD.w - b.r);
    b.y = clamp(b.y + b.vy * dt, b.r, WORLD.h - b.r);
    b.r = lerp(b.r, b.targetR, 0.08);
}
function updateCell(cell, inputX, inputY, dt) {
    const ix = inputX || 0, iy = inputY || 0;
    const mag = Math.hypot(ix, iy);
    if (mag > 0.05) {
        const sp = speedFor(cell);
        cell.vx = (ix / mag) * sp * Math.min(mag, 1);
        cell.vy = (iy / mag) * sp * Math.min(mag, 1);
    } else { cell.vx *= 0.9; cell.vy *= 0.9; }
    let dx = cell.vx, dy = cell.vy;
    if (cell.splitVX || cell.splitVY) {
        dx += cell.splitVX; dy += cell.splitVY;
        cell.splitVX = lerp(cell.splitVX, 0, Math.min(1, SPLIT_DECAY * dt));
        cell.splitVY = lerp(cell.splitVY, 0, Math.min(1, SPLIT_DECAY * dt));
    }
    cell.x = clamp(cell.x + dx * dt, cell.r, WORLD.w - cell.r);
    cell.y = clamp(cell.y + dy * dt, cell.r, WORLD.h - cell.r);
    cell.r = lerp(cell.r, cell.targetR, 0.08);
}

let last = Date.now();
setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    for (const id in owners) {
        const o = owners[id];
        for (const cell of o.cells) updateCell(cell, o.inputX, o.inputY, dt);
        updateOwnerCellPhysics(o);
        if (checkViruses(o)) io.to(id).emit('sfx', 'pop');
    }
    for (const id in bots) updateBot(bots[id], dt);
    for (const id in owners) for (const cell of owners[id].cells) applyMagnet(cell, dt);
    for (const id in bots) applyMagnet(bots[id], dt);
    updateEjected(dt);
    checkVirusEjected();

    const allC = allCells();
    for (const id in owners) {
        const o = owners[id];
        let coinCount = 0, ateFood = false, powerType = null, ateEntity = false;
        for (const cell of o.cells) {
            if (eatFood(cell)) ateFood = true;
            if (eatEjected(cell)) ateFood = true;
            coinCount += eatCoins(cell);
            const pt = eatPowerup(cell); if (pt) powerType = pt;
            if (eatRampage(cell)) io.to(id).emit('sfx', 'rampage');
            if (eatEntities(cell, allC)) ateEntity = true;
        }
        if (coinCount > 0) io.to(id).emit('coin', coinCount);
        if (ateEntity) io.to(id).emit('sfx', 'eat');
        else if (powerType) io.to(id).emit('sfx', powerType);
        else if (ateFood) io.to(id).emit('sfx', 'food');
    }
    for (const id in bots) {
        eatFood(bots[id]); eatCoins(bots[id]); eatPowerup(bots[id]);
        eatEntities(bots[id], allC);
    }

    for (const id in owners) {
        const o = owners[id];
        o.cells = o.cells.filter(c => !c.eaten);
        if (o.cells.length === 0) { io.to(id).emit('died'); delete owners[id]; }
    }
    for (const id in bots) { if (bots[id].eaten) delete bots[id]; }
    while (Object.keys(bots).length < BOT_COUNT) spawnBot(Math.floor(Math.random() * BOT_NAMES.length));
    if (food.length < FOOD_COUNT) spawnFood(FOOD_COUNT - food.length);
    if (coins.length < COIN_COUNT) spawnCoins(COIN_COUNT - coins.length);
    if (powerups.length < POWERUP_COUNT) spawnPowerups(POWERUP_COUNT - powerups.length);
    if (viruses.length < VIRUS_COUNT) spawnViruses(VIRUS_COUNT - viruses.length);
    trySpawnRampage();

    io.emit('state', {
        players: Object.fromEntries(Object.entries(owners).map(([id, o]) => [id, {
            name: o.name, color: o.color,
            cells: o.cells.map(c => ({ id: c.id, x: c.x, y: c.y, r: c.r, vx: c.vx, vy: c.vy, boost: c.boostUntil > now, shield: c.shieldUntil > now, magnet: c.magnetUntil > now, rampage: c.rampageUntil > now }))
        }])),
        bots: Object.fromEntries(Object.entries(bots).map(([id, b]) => [id, { x: b.x, y: b.y, r: b.r, color: b.color, name: b.name, vx: b.vx, vy: b.vy, boost: b.boostUntil > now, shield: b.shieldUntil > now, magnet: b.magnetUntil > now }])),
        food: food.map(f => ({ x: f.x, y: f.y, r: f.r, color: f.color })),
        coins: coins.map(c => ({ x: c.x, y: c.y, r: c.r })),
        powerups: powerups.map(pu => ({ x: pu.x, y: pu.y, r: pu.r, type: pu.type })),
        viruses: viruses.map(v => ({ x: v.x, y: v.y, r: v.r })),
        ejected: ejected.map(e => ({ x: e.x, y: e.y, r: e.r, color: e.color })),
        rampageOrb: rampageOrb ? { x: rampageOrb.x, y: rampageOrb.y, r: rampageOrb.r } : null
    });
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log('Munchr.io server running: http://localhost:' + PORT));