const socket = io();
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W, H, DPR;
function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize); resize();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const massForRadius = r => (r / 3.1) * (r / 3.1);

let myId = null, world = { w: 3200, h: 3200 };
let latest = null, playing = false;
let camera = { x: 1600, y: 1600, zoom: 1 };
let floaters = [];
let trails = {};
let frameActiveIds = new Set();

const SKINS = [
    { color: '#4be3d0', cost: 0 },
    { color: '#ff6fa5', cost: 80 },
    { color: '#ffd23f', cost: 160 },
    { color: '#b98bff', cost: 260 },
    { color: '#ff9d5c', cost: 400 },
    { color: '#6fe07a', cost: 550 }
];
function getWallet() { return parseInt(localStorage.getItem('munchr_coins') || '0', 10); }
function setWallet(v) { localStorage.setItem('munchr_coins', String(v)); }
function getUnlocked() { try { return JSON.parse(localStorage.getItem('munchr_unlocked') || '["#4be3d0"]'); } catch (e) { return ['#4be3d0']; } }
function setUnlocked(arr) { localStorage.setItem('munchr_unlocked', JSON.stringify(arr)); }
let selectedSkin = localStorage.getItem('munchr_skin') || '#4be3d0';

function renderSkinRow() {
    const wallet = getWallet();
    const unlocked = getUnlocked();
    document.getElementById('walletStart').textContent = wallet;
    document.getElementById('walletVal').textContent = wallet;
    const row = document.getElementById('skinRow');
    row.innerHTML = '';
    SKINS.forEach(s => {
        const isUnlocked = unlocked.includes(s.color);
        const div = document.createElement('div');
        div.className = 'skin' + (s.color === selectedSkin ? ' selected' : '') + (!isUnlocked ? ' locked' : '');
        div.style.background = s.color;
        if (!isUnlocked) {
            const price = document.createElement('span');
            price.className = 'price'; price.textContent = s.cost;
            div.appendChild(price);
        }
        div.addEventListener('click', () => {
            const nowUnlocked = getUnlocked();
            if (nowUnlocked.includes(s.color)) {
                selectedSkin = s.color;
                localStorage.setItem('munchr_skin', selectedSkin);
                renderSkinRow();
            } else if (getWallet() >= s.cost) {
                setWallet(getWallet() - s.cost);
                nowUnlocked.push(s.color);
                setUnlocked(nowUnlocked);
                selectedSkin = s.color;
                localStorage.setItem('munchr_skin', selectedSkin);
                renderSkinRow();
            }
        });
        row.appendChild(div);
    });
}
renderSkinRow();

let soundEnabled = localStorage.getItem('munchr_sound') !== 'off';
let showGrid = true;
(function setupSettingsPanel() {
    const btn = document.createElement('button');
    btn.textContent = '⚙';
    btn.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:50;width:44px;height:44px;border-radius:50%;border:none;background:#16324a;color:#eaf6ff;font-size:20px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.4)';
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;bottom:68px;right:16px;z-index:50;background:#0e2233;border:1px solid #2a4a63;border-radius:10px;padding:14px 18px;color:#eaf6ff;font-family:Segoe UI,sans-serif;display:none;min-width:180px;box-shadow:0 4px 18px rgba(0,0,0,0.5)';
    panel.innerHTML = `
        <div style="font-weight:600;margin-bottom:10px">Settings</div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">
            <input type="checkbox" id="soundToggle" ${soundEnabled ? 'checked' : ''}/> Sound
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="gridToggle" checked/> Show Grid
        </label>
    `;
    document.body.appendChild(btn); document.body.appendChild(panel);
    btn.addEventListener('click', () => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
    panel.querySelector('#soundToggle').addEventListener('change', e => {
        soundEnabled = e.target.checked;
        localStorage.setItem('munchr_sound', soundEnabled ? 'on' : 'off');
    });
    panel.querySelector('#gridToggle').addEventListener('change', e => { showGrid = e.target.checked; });
})();

let audioCtx = null;
function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}
function tone(freq, dur, type, vol, glideTo) {
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start();
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, audioCtx.currentTime + dur);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.stop(audioCtx.currentTime + dur + 0.03);
}
function playSound(type) {
    if (!soundEnabled) return;
    if (type === 'food') tone(880, 0.09, 'sine', 0.16, 1200);
    else if (type === 'eat') tone(200, 0.28, 'sawtooth', 0.22, 90);
    else if (type === 'speed') tone(500, 0.3, 'triangle', 0.24, 1500);
    else if (type === 'shield') tone(340, 0.35, 'sine', 0.22, 700);
    else if (type === 'magnet') tone(260, 0.3, 'square', 0.16, 650);
    else if (type === 'coin') tone(1200, 0.08, 'sine', 0.14, 1600);
    else if (type === 'death') tone(320, 0.55, 'sawtooth', 0.26, 55);
    else if (type === 'pop') tone(150, 0.18, 'square', 0.2, 400);
    else if (type === 'rampage') tone(120, 0.5, 'sawtooth', 0.28, 900);
}

socket.on('welcome', data => { myId = data.id; world = data.world; });
socket.on('state', data => { latest = data; });
socket.on('sfx', type => {
    playSound(type);
    const meOwner = latest && latest.players[myId];
    const cell = meOwner && meOwner.cells && meOwner.cells[0];
    if (type === 'eat' && cell) floaters.push({ x: cell.x, y: cell.y - cell.r - 20, text: 'NOM!', life: 0.8, age: 0 });
});
socket.on('coin', count => {
    playSound('coin');
    setWallet(getWallet() + count);
    document.getElementById('walletVal').textContent = getWallet();
});
socket.on('died', () => {
    playing = false;
    playSound('death');
    document.getElementById('deathline').style.display = 'block';
    document.getElementById('deathline').textContent = 'You got eaten! Try again.';
    document.getElementById('overlay').classList.remove('hidden');
    renderSkinRow();
});

document.getElementById('playBtn').addEventListener('click', () => {
    ensureAudio();
    const name = document.getElementById('nameInput').value || 'Player';
    socket.emit('join', { name, color: selectedSkin });
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('deathline').style.display = 'none';
    playing = true;
});

const mouse = { x: 0, y: 0, active: false };
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
canvas.addEventListener('touchmove', e => { const t = e.touches[0]; mouse.x = t.clientX; mouse.y = t.clientY; mouse.active = true; e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchstart', e => { const t = e.touches[0]; mouse.x = t.clientX; mouse.y = t.clientY; mouse.active = true; });
window.addEventListener('keydown', e => {
    if (e.code === 'Space' && playing) { e.preventDefault(); socket.emit('split'); }
    if (e.code === 'KeyW' && playing) { e.preventDefault(); socket.emit('eject'); }
});

setInterval(() => {
    if (!playing) return;
    const dx = mouse.x - W / 2, dy = mouse.y - H / 2;
    const d = Math.hypot(dx, dy);
    if (mouse.active && d > 4) socket.emit('input', { x: dx / d * clamp(d / 70, 0, 1), y: dy / d * clamp(d / 70, 0, 1) });
    else socket.emit('input', { x: 0, y: 0 });
}, 1000 / 20);

function lighten(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = clamp(r + pct * 2.5, 0, 255); g = clamp(g + pct * 2.5, 0, 255); b = clamp(b + pct * 2.5, 0, 255);
    return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function pushTrail(id, x, y, maxLen, minDist) {
    let t = trails[id];
    if (!t) { t = [{ x, y }]; trails[id] = t; }
    const head = t[0];
    const d = Math.hypot(x - head.x, y - head.y);
    if (d > 140) {
        trails[id] = [{ x, y }];
        frameActiveIds.add(id);
        return;
    }
    if (d >= minDist) {
        t.unshift({ x, y });
        if (t.length > maxLen) t.length = maxLen;
    } else {
        t[0] = { x, y };
    }
    frameActiveIds.add(id);
}
function drawSnakeBody(b, trail) {
    const n = trail.length;
    if (n < 2) return;
    const widths = trail.map((_, i) => lerp(b.r * 1.0, b.r * 0.12, i / (n - 1)));
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
        const p = trail[i];
        const prev = trail[i - 1] || p, next = trail[i + 1] || p;
        const dx = next.x - prev.x, dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len, w = widths[i] / 2;
        left.push({ x: p.x + nx * w, y: p.y + ny * w });
        right.push({ x: p.x - nx * w, y: p.y - ny * w });
    }
    const grad = ctx.createLinearGradient(trail[0].x, trail[0].y, trail[n - 1].x, trail[n - 1].y);
    grad.addColorStop(0, lighten(b.color, 8));
    grad.addColorStop(1, lighten(b.color, -30));
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
}
function drawBlob(b, isMe, trailId) {
    const segCount = clamp(Math.round(b.r / 4), 8, 26);
    pushTrail(trailId, b.x, b.y, segCount, Math.max(3, b.r * 0.22));
    drawSnakeBody(b, trails[trailId]);

    ctx.save(); ctx.translate(b.x, b.y);
    ctx.beginPath(); ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.ellipse(0, b.r * 0.55, b.r * 0.8, b.r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    if (b.shield) {
        ctx.beginPath(); ctx.strokeStyle = 'rgba(107,206,255,0.85)'; ctx.lineWidth = 3;
        ctx.arc(0, 0, b.r + 8, 0, Math.PI * 2); ctx.stroke();
    }
    if (b.magnet) {
        ctx.beginPath(); ctx.strokeStyle = 'rgba(185,139,255,0.6)'; ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.arc(0, 0, b.r + 14, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
    }
    if (b.boost) {
        ctx.beginPath(); ctx.strokeStyle = 'rgba(255,210,63,0.8)'; ctx.lineWidth = 3;
        ctx.arc(0, 0, b.r + 5, 0, Math.PI * 2); ctx.stroke();
    }
    if (b.rampage) {
        const pulse = 6 + Math.sin(performance.now() / 90) * 4;
        ctx.beginPath(); ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 4; ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 18;
        ctx.arc(0, 0, b.r + 10 + pulse, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
    }
    const grad = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.3, b.r * 0.1, 0, 0, b.r);
    grad.addColorStop(0, lighten(b.color, 30)); grad.addColorStop(1, b.color);
    ctx.beginPath(); ctx.fillStyle = grad; ctx.shadowColor = b.color; ctx.shadowBlur = isMe ? 12 : 8;
    ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    const dirAng = Math.atan2(b.vy || 0, b.vx || 0);
    const eyeOffset = b.r * 0.28, eyeR = clamp(b.r * 0.17, 2.2, 9);
    [-1, 1].forEach(side => {
        const ex = Math.cos(dirAng + side * 1.05) * eyeOffset, ey = Math.sin(dirAng + side * 1.05) * eyeOffset;
        ctx.beginPath(); ctx.fillStyle = '#0e2233'; ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(ex - eyeR * 0.3, ey - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2); ctx.fill();
    });
    ctx.font = `${clamp(b.r * 0.3, 9, 14)}px Segoe UI, sans-serif`;
    ctx.fillStyle = isMe ? 'rgba(255,210,63,0.9)' : 'rgba(234,246,255,0.6)';
    ctx.textAlign = 'center'; ctx.fillText(b.name, 0, -b.r - 8);
    ctx.restore();
}
function drawCoin(c) {
    const spin = Math.sin(performance.now() / 220 + c.x);
    ctx.save(); ctx.translate(c.x, c.y);
    ctx.beginPath(); ctx.fillStyle = '#ffd23f'; ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 8;
    ctx.ellipse(0, 0, c.r * (0.5 + Math.abs(spin) * 0.5), c.r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
}
const POWER_COLORS = { speed: '#ffd23f', shield: '#6bceff', magnet: '#b98bff' };
function drawPowerup(pu) {
    const pulse = 0.7 + Math.sin(performance.now() / 180 + pu.x) * 0.3;
    const col = POWER_COLORS[pu.type] || '#ffd23f';
    ctx.save(); ctx.translate(pu.x, pu.y);
    ctx.beginPath(); ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 18 * pulse;
    ctx.arc(0, 0, pu.r * pulse, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.restore();
}
function drawVirus(v) {
    const spikes = 16, inner = v.r * 0.82, outer = v.r;
    ctx.save(); ctx.translate(v.x, v.y);
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? outer : inner;
        const ang = (Math.PI / spikes) * i;
        const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#3ee06b'; ctx.shadowColor = '#3ee06b'; ctx.shadowBlur = 14;
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
}

function render() {
    ctx.clearRect(0, 0, W, H);
    if (!latest) { requestAnimationFrame(render); return; }

    const meOwner = latest.players[myId];
    if (meOwner && meOwner.cells.length) {
        let sx = 0, sy = 0, totalMass = 0;
        for (const c of meOwner.cells) { const m = massForRadius(c.r); sx += c.x * m; sy += c.y * m; totalMass += m; }
        const cx = sx / totalMass, cy = sy / totalMass;
        camera.x = cx; camera.y = cy;
        const avgR = Math.sqrt(totalMass / meOwner.cells.length) * 3.1;
        let maxReach = avgR;
        for (const c of meOwner.cells) {
            const d = Math.hypot(c.x - cx, c.y - cy) + c.r;
            if (d > maxReach) maxReach = d;
        }
        const massZoom = clamp(1.15 - (avgR - 22) * 0.006, 0.4, 1.15);
        const spreadZoom = clamp((Math.min(W, H) * 0.42) / maxReach, 0.22, 1.15);
        camera.zoom = lerp(camera.zoom, Math.min(massZoom, spreadZoom), 0.08);
        document.getElementById('scoreVal').textContent = Math.round(totalMass);
    }

    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(camera.zoom, camera.zoom); ctx.translate(-camera.x, -camera.y);

    if (showGrid) {
        const gridSize = 64;
        const viewL = camera.x - (W / 2) / camera.zoom - gridSize, viewR = camera.x + (W / 2) / camera.zoom + gridSize;
        const viewT = camera.y - (H / 2) / camera.zoom - gridSize, viewB = camera.y + (H / 2) / camera.zoom + gridSize;
        ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1 / camera.zoom;
        ctx.beginPath();
        for (let gx = Math.floor(viewL / gridSize) * gridSize; gx < viewR; gx += gridSize) { ctx.moveTo(gx, viewT); ctx.lineTo(gx, viewB); }
        for (let gy = Math.floor(viewT / gridSize) * gridSize; gy < viewB; gy += gridSize) { ctx.moveTo(viewL, gy); ctx.lineTo(viewR, gy); }
        ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(75,227,208,0.35)'; ctx.lineWidth = 6 / camera.zoom;
    ctx.strokeRect(0, 0, world.w, world.h);

    for (const f of latest.food) {
        ctx.beginPath(); ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 12;
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    for (const c of (latest.coins || [])) drawCoin(c);
    for (const pu of (latest.powerups || [])) drawPowerup(pu);
    for (const v of (latest.viruses || [])) drawVirus(v);
    if (latest.rampageOrb) {
        const ro = latest.rampageOrb;
        const pulse = 0.75 + Math.sin(performance.now() / 140) * 0.25;
        ctx.save(); ctx.translate(ro.x, ro.y);
        ctx.beginPath(); ctx.fillStyle = '#ff3b3b'; ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 26 * pulse;
        ctx.arc(0, 0, ro.r * pulse, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        ctx.font = 'bold 14px Segoe UI, sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.fillText('★', 0, 5);
        ctx.restore();
    }
    for (const e of (latest.ejected || [])) {
        ctx.beginPath(); ctx.fillStyle = e.color; ctx.shadowColor = e.color; ctx.shadowBlur = 8;
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    frameActiveIds.clear();
    for (const id in latest.bots) drawBlob(latest.bots[id], false, 'b_' + id);
    for (const id in latest.players) {
        const owner = latest.players[id];
        for (const cell of owner.cells) drawBlob({ ...cell, color: owner.color, name: owner.name }, id === myId, 'p_' + cell.id);
    }
    for (const key in trails) { if (!frameActiveIds.has(key)) delete trails[key]; }

    for (let i = floaters.length - 1; i >= 0; i--) {
        const fl = floaters[i]; fl.age += 1 / 60; fl.y -= 0.6;
        if (fl.age > fl.life) { floaters.splice(i, 1); continue; }
        ctx.globalAlpha = clamp(1 - fl.age / fl.life, 0, 1);
        ctx.font = 'bold 18px Segoe UI, sans-serif';
        ctx.fillStyle = '#ffd23f'; ctx.textAlign = 'center';
        ctx.fillText(fl.text, fl.x, fl.y);
        ctx.globalAlpha = 1;
    }

    ctx.restore();

    const all = [
        ...Object.entries(latest.players).map(([id, o]) => ({ name: o.name, mass: o.cells.reduce((s, c) => s + massForRadius(c.r), 0), me: id === myId })),
        ...Object.entries(latest.bots).map(([id, b]) => ({ name: b.name, mass: massForRadius(b.r), me: false }))
    ].sort((a, b) => b.mass - a.mass).slice(0, 6);
    const list = document.getElementById('lbList'); list.innerHTML = '';
    all.forEach((e, i) => {
        const li = document.createElement('li'); if (e.me) li.className = 'me';
        li.innerHTML = `<span>${i + 1}. ${e.name}</span><span>${Math.round(e.mass)}</span>`;
        list.appendChild(li);
    });

    requestAnimationFrame(render);
}
requestAnimationFrame(render);