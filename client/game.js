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
    { color: '#4be3d0', cost: 0, pattern: 'solid', name: 'Classic Teal' },
    { color: '#ff6fa5', second: '#ffffff', cost: 80, pattern: 'stripe', name: 'Candy Stripe' },
    { color: '#ffd23f', second: '#7a4b00', cost: 160, pattern: 'dots', name: 'Golden Dots' },
    { color: '#b98bff', second: '#2d0a5e', cost: 260, pattern: 'gradient', name: 'Galaxy' },
    { color: '#ff9d5c', second: '#3a1c00', cost: 400, pattern: 'tiger', name: 'Tiger' },
    { color: '#6fe07a', second: '#0b3d17', cost: 550, pattern: 'scale', name: 'Serpent' },
    { color: '#ff3b3b', second: '#ffd23f', cost: 700, pattern: 'rainbow', name: 'Joker' },
    { color: '#fff45c', second: '#111111', cost: 850, pattern: 'stripe', name: 'Bee' },
    { color: '#bfe9ff', second: '#ffffff', cost: 1000, pattern: 'gradient', name: 'Ice' },
    { color: '#ff4d1c', second: '#ffdd00', cost: 1200, pattern: 'lava', name: 'Lava' }
]; function getWallet() { return parseInt(localStorage.getItem('munchr_coins') || '0', 10); }
function setWallet(v) { localStorage.setItem('munchr_coins', String(v)); }
function getUnlocked() { try { return JSON.parse(localStorage.getItem('munchr_unlocked') || '["#4be3d0"]'); } catch (e) { return ['#4be3d0']; } }
function setUnlocked(arr) { localStorage.setItem('munchr_unlocked', JSON.stringify(arr)); }
let selectedSkin = localStorage.getItem('munchr_skin') || '#4be3d0';
function currentSkinDef() { return SKINS.find(s => s.color === selectedSkin) || SKINS[0]; }
function skinPreviewCSS(s) {
    const c = s.color, sec = s.second || c;
    switch (s.pattern) {
        case 'stripe': return `repeating-linear-gradient(45deg, ${c} 0 6px, ${sec} 6px 12px)`;
        case 'dots': return `radial-gradient(circle at 30% 30%, ${sec} 3px, ${c} 4px), radial-gradient(circle at 70% 60%, ${sec} 3px, ${c} 4px), ${c}`;
        case 'gradient': return `linear-gradient(135deg, ${c}, ${sec})`;
        case 'tiger': return `repeating-linear-gradient(70deg, ${c} 0 5px, ${sec} 5px 9px, ${c} 9px 14px)`;
        case 'scale': return `radial-gradient(circle at 50% 30%, ${sec} 2px, transparent 3px) 0 0/10px 10px, ${c}`;
        case 'rainbow': return `linear-gradient(90deg, #ff3b3b, #ffd23f, #6fe07a, #4be3d0, #b98bff, #ff6fa5)`;
        case 'lava': return `radial-gradient(circle at 40% 40%, ${sec}, ${c})`;
        default: return c;
    }
} function renderSkinRow() {
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
        div.style.background = skinPreviewCSS(s);
        div.title = s.name || ''; if (!isUnlocked) {
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

let killfeed = [];
const killfeedEl = document.createElement('div');
killfeedEl.id = 'killfeed';
killfeedEl.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:40;display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;font-family:Segoe UI,sans-serif;';
document.body.appendChild(killfeedEl);
function renderKillfeed() {
    killfeedEl.innerHTML = '';
    killfeed.forEach(k => {
        const div = document.createElement('div');
        div.textContent = k.text;
        div.style.cssText = `background:rgba(14,34,51,0.75);color:#eaf6ff;padding:4px 12px;border-radius:6px;font-size:13px;opacity:${Math.max(0, 1 - k.age / 4)};transition:opacity 0.3s;`;
        killfeedEl.appendChild(div);
    });
}
setInterval(() => {
    let changed = false;
    for (let i = killfeed.length - 1; i >= 0; i--) {
        killfeed[i].age += 0.2;
        if (killfeed[i].age > 4) { killfeed.splice(i, 1); changed = true; }
    }
    if (changed || killfeed.length) renderKillfeed();
}, 200);

const killsPanel = document.createElement('div');
killsPanel.id = 'killsPanel';
killsPanel.style.cssText = 'margin-top:8px;background:rgba(14,34,51,0.75);border-radius:10px;padding:8px 14px;color:#eaf6ff;font-family:Segoe UI,sans-serif;display:flex;gap:8px;align-items:center;width:fit-content;';
killsPanel.innerHTML = '<span class="label">KILLS</span><span class="value" id="killsVal">0</span>';
document.getElementById('hud').appendChild(killsPanel);

const dashPanel = document.createElement('div');
dashPanel.id = 'dashPanel';
dashPanel.style.cssText = 'margin-top:8px;background:rgba(14,34,51,0.75);border-radius:10px;padding:8px 14px;color:#eaf6ff;font-family:Segoe UI,sans-serif;display:flex;gap:8px;align-items:center;width:fit-content;';
dashPanel.innerHTML = '<span class="label">DASH</span><span class="value" id="dashVal">Ready</span>';
document.getElementById('hud').appendChild(dashPanel);

const invisPanel = document.createElement('div');
invisPanel.id = 'invisPanel';
invisPanel.style.cssText = dashPanel.style.cssText;
invisPanel.innerHTML = '<span class="label">CLOAK</span><span class="value" id="invisVal">Ready</span>';
document.getElementById('hud').appendChild(invisPanel);

const freezePanel = document.createElement('div');
freezePanel.id = 'freezePanel';
freezePanel.style.cssText = dashPanel.style.cssText;
freezePanel.innerHTML = '<span class="label">FREEZE</span><span class="value" id="freezeVal">Ready</span>';
document.getElementById('hud').appendChild(freezePanel);

const PERKS = [
    { id: 'none', label: 'None', desc: 'Balanced — no bonus, no drawback' },
    { id: 'speedy', label: 'Speedy', desc: '+12% base speed' },
    { id: 'heavy', label: 'Heavy', desc: 'Bigger starting size' },
    { id: 'magnetic', label: 'Magnetic', desc: 'Always auto-pulls nearby food' },
    { id: 'lucky', label: 'Lucky', desc: 'Double coin winnings' }
];
let selectedPerk = localStorage.getItem('munchr_perk') || 'none';
const perkRow = document.createElement('div');
perkRow.id = 'perkRow';
perkRow.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:10px 0;';
function renderPerkRow() {
    perkRow.innerHTML = '';
    PERKS.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = p.label;
        btn.title = p.desc;
        const active = p.id === selectedPerk;
        btn.style.cssText = `padding:6px 12px;border-radius:8px;border:1px solid ${active ? '#ffd23f' : '#2a4a63'};background:${active ? 'rgba(255,210,63,0.18)' : 'rgba(14,34,51,0.6)'};color:#eaf6ff;font-family:Segoe UI,sans-serif;font-size:12px;cursor:pointer;`;
        btn.addEventListener('click', () => { selectedPerk = p.id; localStorage.setItem('munchr_perk', p.id); renderPerkRow(); });
        perkRow.appendChild(btn);
    });
}
renderPerkRow();
document.getElementById('skinRow').insertAdjacentElement('afterend', perkRow);

const wardrobeBtn = document.getElementById('wardrobeIconBtn');
const perksBtn = document.getElementById('perksIconBtn');
const skinPanel = document.getElementById('skinPanel');
if (wardrobeBtn) wardrobeBtn.addEventListener('click', () => {
    skinPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
if (perksBtn) perksBtn.addEventListener('click', () => {
    perkRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

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



const bannerEl = document.createElement('div');
bannerEl.id = 'bannerEl';
bannerEl.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%) scale(1);z-index:60;font-family:Segoe UI,sans-serif;font-weight:800;font-size:32px;color:#ffd23f;text-shadow:0 0 20px rgba(255,210,63,0.8);opacity:0;pointer-events:none;transition:opacity .4s,transform .4s;text-align:center;';
document.body.appendChild(bannerEl);
let bannerTimer = null;
function showBanner(text, color) {
    bannerEl.textContent = text;
    bannerEl.style.color = color || '#ffd23f';
    bannerEl.style.opacity = '1';
    bannerEl.style.transform = 'translate(-50%,-50%) scale(1.1)';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
        bannerEl.style.opacity = '0';
        bannerEl.style.transform = 'translate(-50%,-50%) scale(1)';
    }, 2200);
}

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
    else if (type === 'dash') tone(700, 0.16, 'square', 0.24, 1900);
    else if (type === 'invis') tone(450, 0.4, 'sine', 0.14, 200);
    else if (type === 'freeze') tone(1000, 0.25, 'triangle', 0.2, 400);
    else if (type === 'revenge') tone(600, 0.3, 'sawtooth', 0.25, 1200);
}

socket.on('welcome', data => { myId = data.id; world = data.world; });
socket.on('state', data => { latest = data; });
socket.on('kill', data => {
    const text = data.killer ? `${data.victim} was taken down by ${data.killer}`
        : data.cause === 'virus' ? `${data.victim} hit a virus`
            : `${data.victim} died`;
    killfeed.push({ text, age: 0 });
    if (killfeed.length > 5) killfeed.shift();
    renderKillfeed();
});
socket.on('sfx', type => {
    playSound(type);
    const meOwner = latest && latest.players[myId];
    if (type === 'eat' && meOwner) floaters.push({ x: meOwner.x, y: meOwner.y - meOwner.r - 20, text: 'NOM!', life: 0.8, age: 0 });
    if (type === 'revenge' && meOwner) floaters.push({ x: meOwner.x, y: meOwner.y - meOwner.r - 30, text: 'REVENGE!', life: 1.2, age: 0 });
});
socket.on('coin', count => {
    playSound('coin');
    setWallet(getWallet() + count);
    document.getElementById('walletVal').textContent = getWallet();
});
socket.on('milestone', data => { if (data.type === 'top5') showBanner('TOP 5!', '#ffd23f'); });
socket.on('golden', data => showBanner(`✨ ${data.name} turned GOLDEN! ✨`, '#ffd700'));
socket.on('goldenKilled', data => showBanner(`${data.killer} caught the Golden Worm!`, '#ffd700'));
socket.on('died', data => {
    playing = false;
    playSound('death');
    const size = data && typeof data.size === 'number' ? data.size : 0;
    const kills = data && typeof data.kills === 'number' ? data.kills : 0;
    const best = parseInt(localStorage.getItem('munchr_best') || '0', 10);
    let newBest = '';
    if (size > best) { localStorage.setItem('munchr_best', String(size)); newBest = ' — New best!'; }
    document.getElementById('deathline').style.display = 'block';
    document.getElementById('deathline').textContent = `You got eaten! Size: ${size} · Kills: ${kills}${newBest}`;
    document.getElementById('overlay').classList.remove('hidden');
    renderSkinRow();
});

document.getElementById('nameInput').addEventListener('input', e => {
    const tag = document.getElementById('topNameTag');
    if (tag) tag.textContent = e.target.value || 'Player';
});
document.getElementById('playBtn').addEventListener('click', () => {
    ensureAudio();
    const name = document.getElementById('nameInput').value || 'Player'; const skinDef = currentSkinDef();
    socket.emit('join', { name, color: selectedSkin, second: skinDef.second || null, pattern: skinDef.pattern || 'solid', perk: selectedPerk });
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('deathline').style.display = 'none';
    playing = true;
});

const mouse = { x: 0, y: 0, active: false };
window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
canvas.addEventListener('touchmove', e => { const t = e.touches[0]; mouse.x = t.clientX; mouse.y = t.clientY; mouse.active = true; e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchstart', e => { const t = e.touches[0]; mouse.x = t.clientX; mouse.y = t.clientY; mouse.active = true; boosting = true; });
canvas.addEventListener('touchend', () => { boosting = false; });
canvas.addEventListener('touchcancel', () => { boosting = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
let boosting = false;
canvas.addEventListener('mousedown', () => { boosting = true; });
window.addEventListener('mouseup', () => { boosting = false; });

let dashRequested = false;
let invisRequested = false;
let freezeRequested = false;
window.addEventListener('keydown', e => {
    if (e.code === 'Space') { ensureAudio(); dashRequested = true; }
    if (e.code === 'KeyC') { ensureAudio(); invisRequested = true; }
    if (e.code === 'KeyF') { ensureAudio(); freezeRequested = true; }
});
setInterval(() => {
    if (!playing) return;
    const dx = mouse.x - W / 2, dy = mouse.y - H / 2;
    const d = Math.hypot(dx, dy);
    const payload = (mouse.active && d > 4)
        ? { x: dx / d * clamp(d / 70, 0, 1), y: dy / d * clamp(d / 70, 0, 1), boost: boosting }
        : { x: 0, y: 0, boost: boosting };
    if (dashRequested) { payload.dash = true; dashRequested = false; }
    if (invisRequested) { payload.invis = true; invisRequested = false; }
    if (freezeRequested) { payload.freeze = true; freezeRequested = false; }
    socket.emit('input', payload);
}, 1000 / 20);

function lighten(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = clamp(r + pct * 2.5, 0, 255); g = clamp(g + pct * 2.5, 0, 255); b = clamp(b + pct * 2.5, 0, 255);
    return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function mixColor(hexA, hexB, t) {
    const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
    return `rgb(${clamp(r, 0, 255)},${clamp(g, 0, 255)},${clamp(bl, 0, 255)})`;
}
function segmentFill(o, i, n) {
    const t = n > 1 ? i / (n - 1) : 0;
    const shade = i % 2 === 0 ? 10 : -18;
    const second = o.second || lighten(o.color, -35);
    switch (o.pattern) {
        case 'stripe':
            return (Math.floor(i / 2) % 2 === 0) ? lighten(o.color, shade) : lighten(second, shade);
        case 'dots':
            return (i % 5 === 0) ? lighten(second, shade) : lighten(o.color, shade);
        case 'gradient':
            return lighten(mixColor(o.color, second, t), shade * 0.4);
        case 'tiger':
            return (Math.sin(i * 0.9) > 0.4) ? lighten(second, shade) : lighten(o.color, shade);
        case 'rainbow': {
            const hue = ((performance.now() / 12) + i * 16) % 360;
            return `hsl(${hue},85%,58%)`;
        }
        case 'lava': {
            const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260 + i * 0.4);
            return mixColor(o.color, second, pulse);
        }
        default:
            return lighten(o.color, shade);
    }
}
function drawSnakeBody(b, trail) {
    const n = trail.length;
    if (n < 2) return;
    for (let i = n - 1; i >= 0; i--) {
        const p = trail[i];
        const r = lerp(b.r * 1.0, b.r * 0.35, i / (n - 1));
        const shade = i % 2 === 0 ? 10 : -18;
        ctx.beginPath();
        ctx.fillStyle = lighten(b.color, shade);
        ctx.arc(p.x, p.y, r * 0.92, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}
function drawWormFromSegments(o, isMe) {
    const segs = o.segments || [];
    const prevAlpha = ctx.globalAlpha;
    if (o.invis) ctx.globalAlpha = isMe ? 0.5 : 0.12;
    for (let i = segs.length - 1; i >= 0; i--) {
        const t = i / Math.max(1, segs.length - 1);
        const r = lerp(o.r, o.r * 0.35, t);
        const shade = i % 2 === 0 ? 10 : -18;
        ctx.beginPath(); ctx.fillStyle = o.golden ? lighten('#ffd700', shade) : segmentFill(o, i, segs.length);
        ctx.arc(segs[i].x, segs[i].y, r * 0.92, 0, Math.PI * 2); ctx.fill();
    }
    // trail sparks while dashing or rampaging
    if (o.dashing || o.rampage) {
        for (let i = 0; i < segs.length; i += 3) {
            if (Math.random() < 0.4) {
                const p = segs[i];
                const ang = Math.random() * Math.PI * 2;
                ctx.beginPath();
                ctx.fillStyle = `rgba(255,${120 + Math.floor(Math.random() * 80)},40,${0.4 + Math.random() * 0.4})`;
                ctx.arc(p.x + Math.cos(ang) * 6, p.y + Math.sin(ang) * 6, 2 + Math.random() * 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    ctx.save(); ctx.translate(o.x, o.y);
    if (o.shield) { ctx.beginPath(); ctx.strokeStyle = 'rgba(107,206,255,0.85)'; ctx.lineWidth = 3; ctx.arc(0, 0, o.r + 8, 0, Math.PI * 2); ctx.stroke(); }
    if (o.magnet) { ctx.beginPath(); ctx.strokeStyle = 'rgba(185,139,255,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); ctx.arc(0, 0, o.r + 14, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    if (o.boost) { ctx.beginPath(); ctx.strokeStyle = 'rgba(255,210,63,0.8)'; ctx.lineWidth = 3; ctx.arc(0, 0, o.r + 5, 0, Math.PI * 2); ctx.stroke(); }
    if (o.dashing) { ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4; ctx.arc(0, 0, o.r + 10, 0, Math.PI * 2); ctx.stroke(); }
    if (o.invis) { ctx.beginPath(); ctx.strokeStyle = 'rgba(150,200,255,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([3, 5]); ctx.arc(0, 0, o.r + 7, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    if (o.frozen) { ctx.beginPath(); ctx.fillStyle = 'rgba(150,220,255,0.35)'; ctx.arc(0, 0, o.r + 4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.strokeStyle = 'rgba(200,240,255,0.9)'; ctx.lineWidth = 3; ctx.arc(0, 0, o.r + 4, 0, Math.PI * 2); ctx.stroke(); }
    if (o.golden) { ctx.beginPath(); ctx.strokeStyle = 'rgba(255,215,0,0.9)'; ctx.lineWidth = 5; ctx.shadowColor = 'gold'; ctx.shadowBlur = 20; ctx.arc(0, 0, o.r + 14, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0; }
    if (o.star) {
        const hue = (performance.now() / 8) % 360;
        ctx.beginPath(); ctx.strokeStyle = `hsl(${hue},90%,60%)`; ctx.lineWidth = 4; ctx.shadowColor = `hsl(${hue},90%,60%)`; ctx.shadowBlur = 16;
        ctx.arc(0, 0, o.r + 12, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
    }
    const baseColor = o.golden ? '#ffd700' : o.color;
    const grad = ctx.createRadialGradient(-o.r * 0.3, -o.r * 0.3, o.r * 0.1, 0, 0, o.r);
    grad.addColorStop(0, lighten(baseColor, 30)); grad.addColorStop(1, baseColor);
    ctx.beginPath(); ctx.fillStyle = grad; ctx.shadowColor = baseColor; ctx.shadowBlur = isMe ? 12 : 8;
    ctx.arc(0, 0, o.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    const s0 = segs[0];
    const dirAng = s0 ? Math.atan2(o.y - s0.y, o.x - s0.x) : 0;
    const eyeOffset = o.r * 0.4, eyeR = clamp(o.r * 0.24, 3, 11);
    let hash = 0; for (let i = 0; i < o.name.length; i++) hash += o.name.charCodeAt(i);
    const face = isMe ? 'happy' : ['happy', 'sad', 'cry'][hash % 3];
    [-1, 1].forEach(side => {
        const ex = Math.cos(dirAng + side * 0.75) * eyeOffset, ey = Math.sin(dirAng + side * 0.75) * eyeOffset;
        ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill();
        const pupilY = face === 'sad' ? ey + eyeR * 0.25 : ey;
        ctx.beginPath(); ctx.fillStyle = '#0e2233'; ctx.arc(ex + Math.cos(dirAng) * eyeR * 0.35, pupilY + Math.sin(dirAng) * eyeR * 0.35, eyeR * 0.55, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(ex + Math.cos(dirAng) * eyeR * 0.35 - eyeR * 0.15, pupilY - eyeR * 0.15, eyeR * 0.18, 0, Math.PI * 2); ctx.fill();
        if (face === 'cry') {
            ctx.beginPath(); ctx.fillStyle = '#6bceff';
            ctx.moveTo(ex, ey + eyeR * 1.1);
            ctx.quadraticCurveTo(ex - eyeR * 0.5, ey + eyeR * 2.2, ex, ey + eyeR * 2.8);
            ctx.quadraticCurveTo(ex + eyeR * 0.5, ey + eyeR * 2.2, ex, ey + eyeR * 1.1);
            ctx.fill();
        }
    });
    ctx.beginPath(); ctx.strokeStyle = '#0e2233'; ctx.lineWidth = eyeR * 0.3; ctx.lineCap = 'round';
    const mx = Math.cos(dirAng) * o.r * 0.55, my = Math.sin(dirAng) * o.r * 0.55;
    if (face === 'happy') ctx.arc(mx, my, eyeR * 0.7, dirAng - 0.5, dirAng + 0.5);
    else ctx.arc(mx, my, eyeR * 0.7, dirAng + Math.PI - 0.5, dirAng + Math.PI + 0.5);
    ctx.stroke();
    ctx.font = `${clamp(o.r * 0.3, 9, 14)}px Segoe UI, sans-serif`;
    ctx.fillStyle = isMe ? 'rgba(255,210,63,0.9)' : (o.golden ? 'rgba(255,215,0,0.9)' : 'rgba(234,246,255,0.6)');
    ctx.textAlign = 'center'; ctx.fillText(o.name, 0, -o.r - 8);
    ctx.restore();
    ctx.globalAlpha = prevAlpha;
}
function drawCoin(c) {
    const spin = Math.sin(performance.now() / 220 + c.x);
    ctx.save(); ctx.translate(c.x, c.y);
    ctx.beginPath(); ctx.fillStyle = '#ffd23f'; ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 8;
    ctx.ellipse(0, 0, c.r * (0.5 + Math.abs(spin) * 0.5), c.r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
}
const POWER_COLORS = { speed: '#ffd23f', shield: '#6bceff', magnet: '#b98bff', star: '#ff9d5c' };
function starPath(outerR, innerR) {
    let rot = -Math.PI / 2;
    const step = Math.PI / 5;
    ctx.beginPath();
    ctx.moveTo(0, -outerR);
    for (let i = 0; i < 5; i++) {
        rot += step;
        ctx.lineTo(Math.cos(rot) * innerR, Math.sin(rot) * innerR);
        rot += step;
        ctx.lineTo(Math.cos(rot) * outerR, Math.sin(rot) * outerR);
    }
    ctx.closePath();
} function drawPowerup(pu) {
    const pulse = 0.7 + Math.sin(performance.now() / 180 + pu.x) * 0.3;
    const col = POWER_COLORS[pu.type] || '#ffd23f';
    ctx.save(); ctx.translate(pu.x, pu.y);

    ctx.beginPath(); ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14 * pulse;
    ctx.arc(0, 0, pu.r * 1.1, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;

    const s = pu.r * 0.65;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (pu.type === 'speed') {
        ctx.beginPath();
        ctx.moveTo(s * 0.1, -s);
        ctx.lineTo(-s * 0.5, s * 0.15);
        ctx.lineTo(-s * 0.05, s * 0.15);
        ctx.lineTo(-s * 0.25, s);
        ctx.lineTo(s * 0.5, -s * 0.15);
        ctx.lineTo(s * 0.05, -s * 0.15);
        ctx.closePath(); ctx.fill();
    } else if (pu.type === 'shield') {
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.quadraticCurveTo(s, -s * 0.6, s, 0);
        ctx.quadraticCurveTo(s, s * 0.7, 0, s);
        ctx.quadraticCurveTo(-s, s * 0.7, -s, 0);
        ctx.quadraticCurveTo(-s, -s * 0.6, 0, -s);
        ctx.closePath(); ctx.stroke();
    } else if (pu.type === 'magnet') {
        const w = s * 0.55, h = s * 1.05;
        ctx.beginPath();
        ctx.moveTo(-w, -h * 0.5);
        ctx.lineTo(-w, h * 0.15);
        ctx.arc(0, h * 0.15, w, Math.PI, 0, false);
        ctx.lineTo(w, -h * 0.5);
        ctx.stroke();
        ctx.fillStyle = '#ff6b6b'; ctx.fillRect(-w - 2, -h * 0.5 - 6, w * 0.9, 6);
        ctx.fillStyle = '#6bceff'; ctx.fillRect(w - w * 0.9 + 2, -h * 0.5 - 6, w * 0.9, 6);
    } else if (pu.type === 'star') {
        starPath(s, s * 0.45); ctx.fill();
    }

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



let shakeX = 0, shakeY = 0;
function render() {
    ctx.clearRect(0, 0, W, H);
    if (!latest) { requestAnimationFrame(render); return; }

    const meOwner = latest.players[myId];
    if (meOwner) {
        camera.x = meOwner.x; camera.y = meOwner.y;
        const massZoom = clamp(1.15 - (meOwner.r - 16) * 0.006, 0.4, 1.15);
        camera.zoom = lerp(camera.zoom, massZoom, 0.08);
        document.getElementById('scoreVal').textContent = Math.round(massForRadius(meOwner.r));
        document.getElementById('killsVal').textContent = meOwner.kills || 0;
        const dashLeft = Math.max(0, (meOwner.dashReadyAt || 0) - Date.now());
        const dashEl = document.getElementById('dashVal');
        dashEl.textContent = dashLeft > 0 ? (dashLeft / 1000).toFixed(1) + 's' : 'Ready';
        dashEl.style.color = dashLeft > 0 ? '#9fc3d8' : '#3ee06b';
        const invisLeft = Math.max(0, (meOwner.invisReadyAt || 0) - Date.now());
        const invisEl = document.getElementById('invisVal');
        invisEl.textContent = invisLeft > 0 ? (invisLeft / 1000).toFixed(1) + 's' : 'Ready';
        invisEl.style.color = invisLeft > 0 ? '#9fc3d8' : '#3ee06b';
        const freezeLeft = Math.max(0, (meOwner.freezeReadyAt || 0) - Date.now());
        const freezeEl = document.getElementById('freezeVal');
        freezeEl.textContent = freezeLeft > 0 ? (freezeLeft / 1000).toFixed(1) + 's' : 'Ready';
        freezeEl.style.color = freezeLeft > 0 ? '#9fc3d8' : '#3ee06b';
        if (meOwner.rage) { shakeX = (Math.random() - 0.5) * 10; shakeY = (Math.random() - 0.5) * 10; }
        else { shakeX = 0; shakeY = 0; }
    }

    ctx.save();
    ctx.translate(W / 2 + shakeX, H / 2 + shakeY); ctx.scale(camera.zoom, camera.zoom); ctx.translate(-camera.x, -camera.y);

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

    for (const f of latest.food) {
        ctx.save(); ctx.translate(f.x, f.y);
        if (f.emoji) {
            const bob = Math.sin(performance.now() / 260 + f.x) * (f.r * 0.08);
            ctx.font = `${Math.round(f.r * 2)}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 6;
            ctx.fillText(f.emoji, 0, bob);
            ctx.shadowBlur = 0;
        } else {
            ctx.beginPath(); ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 12;
            ctx.arc(0, 0, f.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
            ctx.beginPath(); ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.arc(-f.r * 0.3, -f.r * 0.3, f.r * 0.32, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
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
    for (const id in latest.bots) drawWormFromSegments(latest.bots[id], false);
    for (const id in latest.players) drawWormFromSegments(latest.players[id], id === myId);
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

    if (meOwner && meOwner.rage) {
        const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.7);
        vg.addColorStop(0, 'rgba(255,0,0,0)');
        vg.addColorStop(1, 'rgba(255,0,0,0.35)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
    }

    const all = [
        ...Object.entries(latest.players).map(([id, o]) => ({ name: o.name, mass: massForRadius(o.r), me: id === myId })),
        ...Object.entries(latest.bots).map(([id, b]) => ({ name: b.name, mass: massForRadius(b.r), me: false }))
    ].sort((a, b) => b.mass - a.mass);

    const lbCountEl = document.getElementById('lbCount');
    if (lbCountEl) lbCountEl.textContent = `(in the arena: ${all.length})`;

    const TOP_N = 9;
    const top = all.slice(0, TOP_N);
    const myRank = all.findIndex(e => e.me);
    const fmt = n => Math.round(n).toLocaleString();

    const list = document.getElementById('lbList'); list.innerHTML = '';
    top.forEach((e, i) => {
        const li = document.createElement('li'); if (e.me) li.className = 'me';
        li.innerHTML = `<span>${i + 1}. ${e.name}</span><span>👤 ${fmt(e.mass)}</span>`;
        list.appendChild(li);
    });
    if (myRank >= TOP_N) {
        const sep = document.createElement('li'); sep.className = 'lbSep'; sep.textContent = '···';
        list.appendChild(sep);
        const mine = all[myRank];
        const li = document.createElement('li'); li.className = 'me';
        li.innerHTML = `<span>${myRank + 1}. ${mine.name}</span><span>👤 ${fmt(mine.mass)}</span>`;
        list.appendChild(li);
    }

    requestAnimationFrame(render);
}
requestAnimationFrame(render);