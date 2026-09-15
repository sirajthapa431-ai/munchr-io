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

// ---- Food sprite (apple) ----
const foodImages = {};
function loadFoodImage(key, src) {
    const img = new Image();
    foodImages[key] = { img, loaded: false };
    img.onload = () => { foodImages[key].loaded = true; };
    img.onerror = () => { console.error('Failed to load food image:', src); };
    img.src = src;
}

loadFoodImage('apple', 'assets/food/apple.png');
loadFoodImage('orange', 'assets/food/orange.svg');
loadFoodImage('carrot', 'assets/food/carrot.png');
loadFoodImage('broccoli', 'assets/food/broccoli.png');
loadFoodImage('momo', 'assets/food/momo.png');
loadFoodImage('sekuwa', 'assets/food/sekuwa.png');
loadFoodImage('shabhale', 'assets/food/shabhale.png');

const FOOD_IMAGE_KEYS = ['apple', 'orange', 'carrot', 'broccoli', 'momo', 'sekuwa', 'shabhale'];
function pickFoodImageKey(f) {
    const h = foodHash(f);
    return FOOD_IMAGE_KEYS[Math.floor(h * FOOD_IMAGE_KEYS.length) % FOOD_IMAGE_KEYS.length];
}

// ---- Worm sprite images (head + body segment) ----
const wormImages = {};
function loadWormImage(key, src) {
    const img = new Image();
    wormImages[key] = { img, loaded: false };
    img.onload = () => { wormImages[key].loaded = true; };
    img.onerror = () => { console.error('Failed to load worm image:', src); };
    img.src = src;
}
loadWormImage('head', 'assets/worm/head.png');
loadWormImage('body', 'assets/worm/body-Segment.png');

// ---- Coin sprite (glossy coin.svg) ----
const coinImage = new Image();
let coinImageLoaded = false;
coinImage.onload = () => { coinImageLoaded = true; };
coinImage.onerror = () => { console.error('Failed to load coin image: assets/coin.svg'); };
coinImage.src = 'assets/coin.svg';

function foodHash(f) {
    const n = Math.sin(f.x * 12.9898 + f.y * 78.233) * 43758.5453;
    return n - Math.floor(n);
}
const lerp = (a, b, t) => a + (b - a) * t;
const RADIUS_K = 2.5;
const RADIUS_EXP = 0.21;
const massForRadius = r => Math.pow(Math.max(r, 0.0001) / RADIUS_K, 1 / RADIUS_EXP);

let myId = null, world = { w: 3200, h: 3200 }, biomeCount = 4;
let latest = null, playing = false;
let camera = { x: 1600, y: 1600, zoom: 1 };
let floaters = [];
let trails = {};
let frameActiveIds = new Set();

const SKINS = [
    { color: '#4be3d0', cost: 0, pattern: 'customSkin', name: 'Glossy Original' },
    { color: '#4be3d0', cost: 0, pattern: 'solid', name: 'Classic Teal' },
    { color: '#ff6fa5', second: '#ffffff', cost: 80, pattern: 'stripe', name: 'Candy Stripe' },
    { color: '#ffd23f', second: '#7a4b00', cost: 160, pattern: 'dots', name: 'Golden Dots' },
    { color: '#b98bff', second: '#2d0a5e', cost: 260, pattern: 'gradient', name: 'Galaxy' },
    { color: '#ff9d5c', second: '#3a1c00', cost: 400, pattern: 'tiger', name: 'Tiger' },
    { color: '#6fe07a', second: '#0b3d17', cost: 550, pattern: 'scale', name: 'Serpent' },
    { color: '#ff3b3b', second: '#ffd23f', cost: 700, pattern: 'rainbow', name: 'Joker' },
    { color: '#fff45c', second: '#111111', cost: 850, pattern: 'stripe', name: 'Bee' },
    { color: '#bfe9ff', second: '#ffffff', cost: 1000, pattern: 'gradient', name: 'Ice' },
    { color: '#ff4d1c', second: '#ffdd00', cost: 1200, pattern: 'lava', name: 'Lava' },
    { color: '#5ce1e6', second: '#a25cff', cost: 1500, pattern: 'aurora', name: 'Aurora', premium: true, priceNPR: 149 },
    { color: '#ff5a1f', second: '#ffd23f', cost: 1500, pattern: 'inferno', name: 'Inferno', premium: true, priceNPR: 149 },
    { color: '#e8f4ff', second: '#8ec5ff', cost: 1800, pattern: 'diamond', name: 'Diamond', premium: true, priceNPR: 199 }
];
// ---- NEW: Hat cosmetics (unlockable like skins, drawn on the head) ----
const HATS = [
    { id: 'none', cost: 0, name: 'No Hat' },
    { id: 'crown', cost: 300, name: 'Crown' },
    { id: 'party', cost: 150, name: 'Party Hat' },
    { id: 'top', cost: 500, name: 'Top Hat' },
    { id: 'halo', cost: 900, name: 'Halo' }
];

function getWallet() { return parseInt(localStorage.getItem('munchr_coins') || '0', 10); }
function setWallet(v) { localStorage.setItem('munchr_coins', String(v)); }
function getUnlocked() { try { return JSON.parse(localStorage.getItem('munchr_unlocked') || '["#4be3d0"]'); } catch (e) { return ['#4be3d0']; } }
function setUnlocked(arr) { localStorage.setItem('munchr_unlocked', JSON.stringify(arr)); }
function getUnlockedHats() { try { return JSON.parse(localStorage.getItem('munchr_hats') || '["none"]'); } catch (e) { return ['none']; } }
function setUnlockedHats(arr) { localStorage.setItem('munchr_hats', JSON.stringify(arr)); }

// ---- NEW: Premium skins (real-money tier) + first-play trial window ----
const PREMIUM_TRIAL_DAYS = 3;
const PREMIUM_TRIAL_MS = PREMIUM_TRIAL_DAYS * 24 * 60 * 60 * 1000;
function getFirstPlayTime() {
    let t = localStorage.getItem('munchr_first_play');
    if (!t) {
        t = String(Date.now());
        localStorage.setItem('munchr_first_play', t);
    }
    return parseInt(t, 10);
}
function isInPremiumTrial() {
    return (Date.now() - getFirstPlayTime()) < PREMIUM_TRIAL_MS;
}
function premiumTrialDaysLeft() {
    const left = PREMIUM_TRIAL_MS - (Date.now() - getFirstPlayTime());
    return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
}

let selectedSkin = localStorage.getItem('munchr_skin') || '#4be3d0';
let selectedHat = localStorage.getItem('munchr_hat') || 'none';
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
        case 'aurora': return `linear-gradient(120deg, ${c}, ${sec}, ${c})`;
        case 'inferno': return `linear-gradient(45deg, ${c}, ${sec}, #fff45c)`;
        case 'diamond': return `linear-gradient(135deg, #ffffff, ${sec}, ${c})`;
        default: return c;
    }
}
function updateAvatarBadge() {
    const badge = document.getElementById('avatarBadge');
    if (badge) badge.style.background = skinPreviewCSS(currentSkinDef());
}
function renderSkinRow() {
    const wallet = getWallet();
    const unlocked = getUnlocked();
    document.getElementById('walletStart').textContent = wallet;
    document.getElementById('walletVal').textContent = wallet;
    updateAvatarBadge();
    const row = document.getElementById('skinRow');
    row.innerHTML = '';
    row.style.marginBottom = '18px';
    row.style.rowGap = '22px';
    SKINS.forEach(s => {
        const trialActive = s.premium && isInPremiumTrial();
        const isUnlocked = unlocked.includes(s.color) || trialActive;
        const div = document.createElement('div');
        div.className = 'skin'
            + (s.color === selectedSkin ? ' selected' : '')
            + (!isUnlocked ? ' locked' : '')
            + (s.premium ? ' premium' : '');
        div.style.background = skinPreviewCSS(s);
        div.title = s.name || '';
        if (trialActive) {
            const badge = document.createElement('span');
            badge.className = 'price trialBadge';
            badge.style.cssText = 'white-space:nowrap; font-size:9px;';
            badge.textContent = `TRIAL ${premiumTrialDaysLeft()}d`;
            div.appendChild(badge);
        } else if (!isUnlocked) {
            const price = document.createElement('span');
            price.className = 'price';
            price.textContent = s.premium ? `Rs ${s.priceNPR}` : s.cost;
            div.appendChild(price);
        }
        div.addEventListener('click', () => {
            const nowUnlocked = getUnlocked();
            if (nowUnlocked.includes(s.color) || (s.premium && isInPremiumTrial())) {
                selectedSkin = s.color;
                localStorage.setItem('munchr_skin', selectedSkin);
                renderSkinRow();
            } else if (s.premium) {
                showBanner(`${s.name} — Rs ${s.priceNPR}. Payments coming soon!`, '#ffd23f');
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

    let premiumNote = document.getElementById('premiumTrialNote');
    if (!premiumNote) {
        premiumNote = document.createElement('div');
        premiumNote.id = 'premiumTrialNote';
        premiumNote.style.cssText = 'text-align:center;font-size:11px;color:#ffd23f;margin:4px 0 8px;';
        row.insertAdjacentElement('afterend', premiumNote);
    }
    const premiumNames = SKINS.filter(s => s.premium).map(s => s.name).join(', ');
    premiumNote.textContent = isInPremiumTrial()
        ? `✨ Premium skins (${premiumNames}) free for ${premiumTrialDaysLeft()} more day(s)!`
        : '';

    renderHatRow();
}

// ---- NEW: Hat picker row (auto-created under skin row) ----
const hatRow = document.createElement('div');
hatRow.id = 'hatRow';
hatRow.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:10px 0;';
function renderHatRow() {
    const wallet = getWallet();
    const unlockedHats = getUnlockedHats();
    hatRow.innerHTML = '';
    HATS.forEach(h => {
        const isUnlocked = unlockedHats.includes(h.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = h.name + (isUnlocked ? '' : ` (${h.cost})`);
        const active = h.id === selectedHat;
        btn.style.cssText = `padding:6px 12px;border-radius:8px;border:1px solid ${active ? '#ffd23f' : '#2a4a63'};background:${active ? 'rgba(255,210,63,0.18)' : 'rgba(14,34,51,0.6)'};color:#eaf6ff;font-family:Segoe UI,sans-serif;font-size:12px;cursor:pointer;`;
        btn.addEventListener('click', () => {
            const nowUnlocked = getUnlockedHats();
            if (nowUnlocked.includes(h.id)) {
                selectedHat = h.id;
                localStorage.setItem('munchr_hat', selectedHat);
                renderHatRow();
            } else if (getWallet() >= h.cost) {
                setWallet(getWallet() - h.cost);
                nowUnlocked.push(h.id);
                setUnlockedHats(nowUnlocked);
                selectedHat = h.id;
                localStorage.setItem('munchr_hat', selectedHat);
                renderSkinRow();
            }
        });
        hatRow.appendChild(btn);
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
killsPanel.style.cssText = 'margin-top:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.22);backdrop-filter:blur(1px) saturate(115%);-webkit-backdrop-filter:blur(1px) saturate(115%);border-radius:12px;padding:8px 14px;color:#eaf6ff;font-family:Segoe UI,sans-serif;display:flex;gap:8px;align-items:center;width:fit-content;box-shadow:0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.15);';
killsPanel.innerHTML = '<span class="label">KILLS</span><span class="value" id="killsVal">0</span>';
document.getElementById('hud').appendChild(killsPanel);

const dashPanel = document.createElement('div');
dashPanel.id = 'dashPanel';
dashPanel.style.cssText = 'margin-top:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.22);backdrop-filter:blur(1px) saturate(115%);-webkit-backdrop-filter:blur(1px) saturate(115%);border-radius:12px;padding:8px 14px;color:#eaf6ff;font-family:Segoe UI,sans-serif;display:flex;gap:8px;align-items:center;width:fit-content;box-shadow:0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.15);';
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

// ---- NEW: Daily-ish challenge tracker panel ----
const challengePanel = document.createElement('div');
challengePanel.id = 'challengePanel';
challengePanel.style.cssText = dashPanel.style.cssText;
challengePanel.innerHTML = '<span class="label">CHALLENGE</span><span class="value" id="challengeVal" style="font-size:11px">5 kills or 50k mass</span>';
document.getElementById('hud').appendChild(challengePanel);

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
const perkLabel = document.createElement('div');
perkLabel.className = 'subLabel';
perkLabel.style.marginTop = '14px';
perkLabel.textContent = 'Perk';
const hatLabel = document.createElement('div');
hatLabel.className = 'subLabel';
hatLabel.textContent = 'Hat';
document.getElementById('skinRow').insertAdjacentElement('afterend', perkLabel);
perkLabel.insertAdjacentElement('afterend', perkRow);
perkRow.insertAdjacentElement('afterend', hatLabel);
hatLabel.insertAdjacentElement('afterend', hatRow);
renderHatRow();
updateAvatarBadge();

const wardrobeBtn = document.getElementById('wardrobeIconBtn');
const perksBtn = document.getElementById('perksIconBtn');
const rankBtn = document.getElementById('rankIconBtn');
const skinPanel = document.getElementById('skinPanel');
function flashHighlight(el) {
    if (!el) return;
    el.style.transition = 'box-shadow .2s ease';
    el.style.boxShadow = '0 0 0 3px rgba(255,210,63,0.9), 0 4px 18px rgba(0,0,0,0.35)';
    setTimeout(() => { el.style.boxShadow = ''; }, 900);
}
if (wardrobeBtn) wardrobeBtn.addEventListener('click', () => {
    skinPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashHighlight(skinPanel);
});
if (perksBtn) perksBtn.addEventListener('click', () => {
    perkRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashHighlight(perkRow);
});
if (rankBtn) rankBtn.addEventListener('click', () => {
    const best = parseInt(localStorage.getItem('munchr_best') || '0', 10);
    showBanner(best > 0 ? `Your best size: ${best}` : 'Play a round to set your first record!', '#ffd23f');
});

let soundEnabled = localStorage.getItem('munchr_sound') !== 'off';
let musicEnabled = localStorage.getItem('munchr_music') !== 'off';
let showGrid = true;

const MUSIC_TRACKS = []; // गीत यहाँ थप्नुहोस् — जस्तै 'audio/bgm.mp3', 'audio/bgm1.mp3', ...
let musicOrder = [];
let musicIndex = 0;
function shuffleMusicOrder() {
    musicOrder = MUSIC_TRACKS.map((_, i) => i);
    for (let i = musicOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [musicOrder[i], musicOrder[j]] = [musicOrder[j], musicOrder[i]];
    }
    musicIndex = 0;
}
shuffleMusicOrder();
const bgMusic = new Audio();
bgMusic.volume = 0.7;
bgMusic.addEventListener('ended', () => {
    musicIndex++;
    if (musicIndex >= musicOrder.length) shuffleMusicOrder();
    playCurrentTrack();
});
function playCurrentTrack() {
    if (!musicEnabled || MUSIC_TRACKS.length === 0) return;
    bgMusic.src = MUSIC_TRACKS[musicOrder[musicIndex]];
    bgMusic.play().catch(() => { });
}
function playMusic() {
    if (!musicEnabled) return;
    if (!bgMusic.src) playCurrentTrack();
    else bgMusic.play().catch(() => { });
}
function pauseMusic() {
    bgMusic.pause();
}

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
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">
            <input type="checkbox" id="musicToggle" ${musicEnabled ? 'checked' : ''}/> Music
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
    panel.querySelector('#musicToggle').addEventListener('change', e => {
        musicEnabled = e.target.checked;
        localStorage.setItem('munchr_music', musicEnabled ? 'on' : 'off');
        if (musicEnabled) playMusic(); else pauseMusic();
    });
    panel.querySelector('#gridToggle').addEventListener('change', e => { showGrid = e.target.checked; });
})();

const bannerEl = document.createElement('div');
bannerEl.id = 'bannerEl';
bannerEl.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%) scale(1);z-index:60;font-family:Segoe UI,sans-serif;font-weight:800;font-size:32px;color:#ffd23f;text-shadow:0 0 20px rgba(255,210,63,0.8);opacity:0;pointer-events:none;transition:opacity .4s,transform .4s;text-align:center;';
document.body.appendChild(bannerEl);
let bannerTimer = null;
function showBanner(text, color) {
    if (!playing) return;
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

// ---- NEW: Achievement toast (separate from center banner so both can show) ----
const achToastEl = document.createElement('div');
achToastEl.id = 'achToast';
achToastEl.style.cssText = 'position:fixed;top:90px;left:50%;transform:translateX(-50%);z-index:60;font-family:Segoe UI,sans-serif;font-weight:700;font-size:16px;color:#fff;background:rgba(20,20,30,0.85);border:1px solid #ffd23f;padding:8px 18px;border-radius:20px;opacity:0;transition:opacity .4s, transform .4s;pointer-events:none;';
document.body.appendChild(achToastEl);
let achTimer = null;
function showAchievement(label) {
    achToastEl.textContent = '🏆 ' + label;
    achToastEl.style.opacity = '1';
    achToastEl.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(achTimer);
    achTimer = setTimeout(() => { achToastEl.style.opacity = '0'; }, 2600);
}

// ---- NEW: Confetti celebration burst (canvas-space particles, drawn in world coords) ----
let confetti = [];
function spawnConfetti(x, y, count) {
    const colors = ['#ff6fa5', '#ffd23f', '#4be3d0', '#b98bff', '#6fe07a', '#ff9d5c'];
    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 60 + Math.random() * 160;
        confetti.push({
            x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 40,
            life: 1.1 + Math.random() * 0.6, age: 0,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: 3 + Math.random() * 3
        });
    }
}
function updateAndDrawConfetti(dt) {
    for (let i = confetti.length - 1; i >= 0; i--) {
        const p = confetti[i];
        p.age += dt;
        if (p.age > p.life) { confetti.splice(i, 1); continue; }
        p.vy += 220 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.save();
        ctx.globalAlpha = clamp(1 - p.age / p.life, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.restore();
    }
}

// ---- Ambient background dust particles (simple, no bubble/ring effect) ----
const dustParticles = [];
for (let i = 0; i < 80; i++) {
    dustParticles.push({
        x: Math.random(), y: Math.random(),
        speed: 0.004 + Math.random() * 0.008,
        size: 1 + Math.random() * 2,
        drift: (Math.random() - 0.5) * 0.15
    });
}
const twinkleStars = [];
for (let i = 0; i < 140; i++) {
    twinkleStars.push({
        x: Math.random(), y: Math.random(),
        size: 0.6 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        speed: 0.8 + Math.random() * 1.5
    });
}
function drawTwinkleStars() {
    ctx.save();
    for (const s of twinkleStars) {
        const tw = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() / 1400 * s.speed + s.phase));
        ctx.globalAlpha = tw * 0.6;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}
function drawDustParticles() {
    ctx.save();
    for (const d of dustParticles) {
        d.y -= d.speed * 0.012;
        const wob = Math.sin(performance.now() / 900 + d.x * 30) * 0.001;
        d.x += d.drift * 0.0004 + wob;
        if (d.y < -0.03) { d.y = 1.03; d.x = Math.random(); }
        if (d.x < -0.02) d.x = 1.02; if (d.x > 1.02) d.x = -0.02;
        const px = d.x * W, py = d.y * H, r = d.size;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
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
    else if (type === 'boss') tone(90, 0.6, 'sawtooth', 0.3, 600);
    else if (type === 'portal') tone(700, 0.3, 'sine', 0.2, 1400);
}

socket.on('welcome', data => { myId = data.id; world = data.world; biomeCount = data.biomeCount || 4; });
socket.on('state', data => { latest = data; });
socket.on('kill', data => {
    const text = data.killer ? `${data.victim} was taken down by ${data.killer}`
        : data.cause === 'virus' ? `${data.victim} hit a virus`
            : data.cause === 'border' ? `${data.victim} hit the border`
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
socket.on('gotKill', data => {
    showBanner(`You eliminated ${data.victim}! +${data.gain}`, '#3ee06b');
    playSound('pop');
    const meOwner = latest && latest.players[myId];
    if (meOwner) spawnConfetti(meOwner.x, meOwner.y, 18);
});
let lakhGlowUntil = 0;
socket.on('lakhMilestone', data => {
    showBanner(`${data.lakh} Lakh Points! 🔥`, '#ff3b3b');
    playSound('revenge');
    lakhGlowUntil = performance.now() + 6000;
    const meOwner = latest && latest.players[myId];
    if (meOwner) spawnConfetti(meOwner.x, meOwner.y, 40);
});
socket.on('golden', data => showBanner(`✨ ${data.name} turned GOLDEN! ✨`, '#ffd700'));
socket.on('goldenKilled', data => showBanner(`${data.killer} caught the Golden Worm!`, '#ffd700'));
socket.on('bossSpawned', () => { showBanner('⚠️ BOSS VIRUS APPEARED ⚠️', '#ff3b3b'); playSound('boss'); });
socket.on('bossDefeated', data => {
    showBanner(`BOSS DEFEATED! +${data.gain}`, '#ffd700');
    playSound('rampage');
    const meOwner = latest && latest.players[myId];
    if (meOwner) spawnConfetti(meOwner.x, meOwner.y, 60);
});
socket.on('bossKilled', data => showBanner(`${data.name} slew the Boss Virus!`, '#ff3b3b'));
socket.on('achievement', data => { showAchievement(data.label); playSound('coin'); });
socket.on('died', data => {
    playing = false;
    if (crazySdkReady) window.CrazyGames.SDK.game.gameplayStop();
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
    if (data && data.canContinue) showContinueButton();
});
socket.on('continued', () => {
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('deathline').style.display = 'none';
    playing = true;
    hideContinueButton();
    if (crazySdkReady) window.CrazyGames.SDK.game.gameplayStart();
});
socket.on('continueFailed', () => {
    hideContinueButton();
});

const continueBtn = document.createElement('button');
continueBtn.id = 'continueBtn';
continueBtn.textContent = '▶ Watch Ad & Continue';
continueBtn.style.cssText = 'display:none;margin:12px auto;padding:10px 20px;border-radius:10px;border:none;background:#ffd23f;color:#111;font-weight:700;font-family:Segoe UI,sans-serif;font-size:14px;cursor:pointer;';
document.getElementById('deathline').insertAdjacentElement('afterend', continueBtn);
function showContinueButton() { continueBtn.style.display = 'block'; }
function hideContinueButton() { continueBtn.style.display = 'none'; }
let crazySdkReady = false;
try {
    if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.init) {
        window.CrazyGames.SDK.game.loadingStart();
        window.CrazyGames.SDK.init().then(() => {
            crazySdkReady = true;
            window.CrazyGames.SDK.game.loadingStop();
        }).catch(() => {
            crazySdkReady = false;
            window.CrazyGames.SDK.game.loadingStop();
        });
    }
} catch (e) { crazySdkReady = false; }

continueBtn.addEventListener('click', () => {
    let usedRealAd = false;
    try {
        if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.ad && crazySdkReady) {
            window.CrazyGames.SDK.ad.requestAd('rewarded', {
                adStarted: () => { },
                adFinished: () => { socket.emit('continueAfterAd'); },
                adError: () => { socket.emit('continueAfterAd'); }
            });
            usedRealAd = true;
        }
    } catch (e) {
        usedRealAd = false;
    }
    if (!usedRealAd) {
        // local testing / SDK not ready — instantly continue
        socket.emit('continueAfterAd');
    }
});

function grantFreeCoins() {
    const REWARD = 50;
    setWallet(getWallet() + REWARD);
    renderSkinRow();
    showBanner(`+${REWARD} coins! 🪙`, '#ffd23f');
}
const addCoinsBtn = document.getElementById('addCoinsBtn');
if (addCoinsBtn) addCoinsBtn.addEventListener('click', () => {
    let usedRealAd = false;
    try {
        if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.ad && crazySdkReady) {
            window.CrazyGames.SDK.ad.requestAd('rewarded', {
                adStarted: () => { },
                adFinished: () => { grantFreeCoins(); },
                adError: () => { grantFreeCoins(); }
            });
            usedRealAd = true;
        }
    } catch (e) {
        usedRealAd = false;
    }
    if (!usedRealAd) grantFreeCoins();
});

document.getElementById('nameInput').value = localStorage.getItem('munchr_name') || '';
document.getElementById('nameInput').addEventListener('input', e => {
    localStorage.setItem('munchr_name', e.target.value);
    const tag = document.getElementById('topNameTag');
    if (tag) tag.textContent = e.target.value || 'Player';
});
document.getElementById('playBtn').addEventListener('click', () => {
    ensureAudio();
    playMusic();
    const name = document.getElementById('nameInput').value || 'Player';
    let skinDef = currentSkinDef();
    // Trial expire bhaisakepachi pani premium skin selected rahiraheko
    // case handle garne — ownership nabhaeko premium skin sanga join
    // huna dine haina, default Classic Teal ma fallback garne
    const owns = getUnlocked().includes(skinDef.color);
    const trialOk = skinDef.premium && isInPremiumTrial();
    if (skinDef.premium && !owns && !trialOk) {
        selectedSkin = '#4be3d0';
        localStorage.setItem('munchr_skin', selectedSkin);
        skinDef = currentSkinDef();
        renderSkinRow();
    }
    socket.emit('join', { name, color: selectedSkin, second: skinDef.second || null, pattern: skinDef.pattern || 'solid', perk: selectedPerk, hat: selectedHat });
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('deathline').style.display = 'none';
    playing = true;
    if (crazySdkReady) window.CrazyGames.SDK.game.gameplayStart();
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
    const payload = (mouse.active && d > 2)
        ? { x: dx / d * clamp(d / 45, 0, 1), y: dy / d * clamp(d / 45, 0, 1), boost: boosting }
        : { x: 0, y: 0, boost: boosting };
    if (dashRequested) { payload.dash = true; dashRequested = false; }
    if (invisRequested) { payload.invis = true; invisRequested = false; }
    if (freezeRequested) { payload.freeze = true; freezeRequested = false; }
    socket.emit('input', payload);
}, 1000 / 20);

function hexToRgba(hex, a) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
}
function lighten(hex, pct) {
    let r, g, b;
    if (hex.startsWith('rgb')) {
        const m = hex.match(/[\d.]+/g);
        r = parseFloat(m[0]); g = parseFloat(m[1]); b = parseFloat(m[2]);
    } else if (hex.startsWith('hsl')) {
        return hex;
    } else {
        const n = parseInt(hex.slice(1), 16);
        r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    }
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
    const shade = i % 2 === 0 ? 5 : -6;
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
        case 'aurora': {
            const hue = (170 + Math.sin(performance.now() / 900 + i * 0.5) * 60 + 360) % 360;
            return `hsl(${hue},80%,62%)`;
        }
        case 'inferno': {
            const hue = (25 + Math.sin(performance.now() / 500 + i * 0.6) * 25 + 360) % 360;
            return `hsl(${hue},95%,55%)`;
        }
        case 'diamond': {
            const shimmer = 0.5 + 0.5 * Math.sin(performance.now() / 300 + i * 0.9);
            return mixColor('#e8f4ff', '#8ec5ff', shimmer);
        }
        default:
            return lighten(o.color, shade);
    }
} const segColorCache = new Map();
const ANIMATED_PATTERNS = new Set(['rainbow', 'lava', 'aurora', 'inferno', 'diamond']); function cachedSegmentFill(o, i, n, key) {
    if (ANIMATED_PATTERNS.has(o.pattern)) return segmentFill(o, i, n);
    let entry = segColorCache.get(key);
    if (!entry || entry.color !== o.color || entry.second !== o.second || entry.pattern !== o.pattern || entry.n !== n) {
        entry = { color: o.color, second: o.second, pattern: o.pattern, n, colors: [] };
        segColorCache.set(key, entry);
    }
    if (entry.colors[i] === undefined) entry.colors[i] = segmentFill(o, i, n);
    return entry.colors[i];
}

// ---- NEW: hat drawing on the head (world-space, called after the head is drawn) ----
function drawHat(hatId, r) {
    if (!hatId || hatId === 'none') return;
    ctx.save();
    if (hatId === 'crown') {
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        const w = r * 1.1, hgt = r * 0.55, baseY = -r * 0.75;
        ctx.moveTo(-w / 2, baseY);
        ctx.lineTo(-w / 2, baseY - hgt * 0.4);
        ctx.lineTo(-w / 4, baseY - hgt);
        ctx.lineTo(0, baseY - hgt * 0.4);
        ctx.lineTo(w / 4, baseY - hgt);
        ctx.lineTo(w / 2, baseY - hgt * 0.4);
        ctx.lineTo(w / 2, baseY);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (hatId === 'party') {
        ctx.fillStyle = '#ff6fa5';
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.7);
        ctx.lineTo(r * 0.5, -r * 0.7);
        ctx.lineTo(0, -r * 1.7);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.arc(0, -r * 1.7, r * 0.12, 0, Math.PI * 2); ctx.fill();
    } else if (hatId === 'top') {
        ctx.fillStyle = '#111';
        ctx.fillRect(-r * 0.42, -r * 1.5, r * 0.84, r * 0.7);
        ctx.fillRect(-r * 0.6, -r * 0.85, r * 1.2, r * 0.16);
    } else if (hatId === 'halo') {
        ctx.strokeStyle = '#ffe98a'; ctx.lineWidth = r * 0.14;
        ctx.shadowColor = '#ffe98a'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.ellipse(0, -r * 1.35, r * 0.5, r * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
    }
    ctx.restore();
}

// ---- NEW: pet companion — small orbiting creature that visually accompanies the head ----
const petState = new Map(); // key -> { angle }
function drawPet(o, isMe, key) {
    if (!isMe) return; // only draw pet for the local player to keep it simple + cheap
    let st = petState.get(key);
    if (!st) { st = { angle: Math.PI * 0.5, bob: 0 }; petState.set(key, st); }
    st.angle += 0.025;
    st.bob += 0.06;
    const orbitR = o.r + 46;
    const swing = 0.35 + (Math.sin(st.angle) + 1) * 0.5 * 1.3;
    const px = Math.cos(swing) * orbitR * (Math.sin(st.angle * 0.3) > 0 ? 1 : -1);
    const py = Math.sin(swing) * orbitR * 0.9 + Math.sin(st.bob) * 3;

    ctx.save();
    ctx.translate(px, py);
    const pr = clamp(o.r * 0.24, 7, 15);

    ctx.beginPath();
    ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 14;
    const grad = ctx.createRadialGradient(-pr * 0.35, -pr * 0.35, pr * 0.1, 0, 0, pr);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#ffe27a');
    grad.addColorStop(1, '#e8a400');
    ctx.fillStyle = grad;
    ctx.arc(0, 0, pr, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, pr * 0.18);
    ctx.arc(0, 0, pr * 0.65, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();

    const eyeR = pr * 0.2;
    ctx.beginPath(); ctx.fillStyle = '#fff';
    ctx.arc(-pr * 0.32, -pr * 0.05, eyeR, 0, Math.PI * 2);
    ctx.arc(pr * 0.32, -pr * 0.05, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); ctx.fillStyle = '#0e2233';
    ctx.arc(-pr * 0.32, -pr * 0.02, eyeR * 0.55, 0, Math.PI * 2);
    ctx.arc(pr * 0.32, -pr * 0.02, eyeR * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// ---- NEW: fish/eel fins ----
function segDir(segs, i) {
    const a = segs[Math.max(0, i - 1)];
    const b = segs[Math.min(segs.length - 1, i + 1)];
    return Math.atan2(b.y - a.y, b.x - a.x);
}
function drawPectoralFins(o, segs) {
    const s0 = segs[0];
    if (!s0) return;
    const ang = Math.atan2(o.y - s0.y, o.x - s0.x);
    const perp = ang + Math.PI / 2;
    const flap = Math.sin(performance.now() / 200) * 0.3;
    const finLen = o.r * 0.9;
    ctx.save();
    [-1, 1].forEach(side => {
        ctx.save();
        ctx.translate(Math.cos(perp) * side * o.r * 0.55, Math.sin(perp) * side * o.r * 0.55);
        ctx.rotate(ang + side * (1.1 + flap));
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(finLen * 0.5, side * finLen * 0.45, finLen, 0);
        ctx.quadraticCurveTo(finLen * 0.5, side * finLen * 0.05, 0, 0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
    });
    ctx.restore();
}
function drawSideFins(o, segs) {
    const n = segs.length;
    if (n < 10) return;
    const wave = performance.now() / 260;
    for (let i = 4; i < n - 6; i += 7) {
        const dir = segDir(segs, i);
        const perp = dir + Math.PI / 2;
        const side = (Math.floor(i / 7) % 2 === 0) ? 1 : -1;
        const flap = Math.sin(wave + i * 0.5) * 0.3;
        const segR = o.r * (1 - (i / n) * 0.5);
        const finLen = segR * 1.3;
        const px = segs[i].x + Math.cos(perp) * side * segR * 0.6;
        const py = segs[i].y + Math.sin(perp) * side * segR * 0.6;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(perp + flap * side);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(finLen * 0.4, side * finLen * 0.35, finLen * 0.85, 0);
        ctx.quadraticCurveTo(finLen * 0.4, side * finLen * 0.05, 0, 0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }
}
function drawTailFin(o, segs) {
    const n = segs.length;
    if (n < 6) return;
    const tail = segs[n - 1];
    const dir = segDir(segs, n - 2);
    const wave = Math.sin(performance.now() / 200) * 0.35;
    const tailR = Math.max(6, o.r * 0.45);
    ctx.save();
    ctx.translate(tail.x, tail.y);
    ctx.rotate(dir + Math.PI + wave);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(tailR * 1.2, -tailR * 1.4, tailR * 2.4, -tailR * 0.3);
    ctx.quadraticCurveTo(tailR * 1.5, 0, tailR * 2.4, tailR * 0.3);
    ctx.quadraticCurveTo(tailR * 1.2, tailR * 1.4, 0, 0);
    ctx.closePath();
    const finColor = o.golden ? '#ffd700' : (o.second || lighten(o.color, -20));
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = finColor;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}

const interpState = new Map();
const WORM_SMOOTH = 0.28;
const WORM_SNAP_DIST = 400;
function getSmoothedEntity(o, key) {
    let s = interpState.get(key);
    const segs = o.segments || [];
    if (!s) {
        s = { x: o.x, y: o.y, r: o.r, segments: segs.map(p => ({ x: p.x, y: p.y })) };
        interpState.set(key, s);
        return { ...o, x: s.x, y: s.y, r: s.r, segments: s.segments };
    }
    if (Math.hypot(o.x - s.x, o.y - s.y) > WORM_SNAP_DIST) {
        s.x = o.x; s.y = o.y; s.r = o.r;
        s.segments = segs.map(p => ({ x: p.x, y: p.y }));
    } else {
        s.x = lerp(s.x, o.x, WORM_SMOOTH);
        s.y = lerp(s.y, o.y, WORM_SMOOTH);
        s.r = lerp(s.r, o.r, WORM_SMOOTH);
        if (s.segments.length !== segs.length) {
            s.segments = segs.map(p => ({ x: p.x, y: p.y }));
        } else {
            for (let i = 0; i < segs.length; i++) {
                s.segments[i].x = lerp(s.segments[i].x, segs[i].x, WORM_SMOOTH);
                s.segments[i].y = lerp(s.segments[i].y, segs[i].y, WORM_SMOOTH);
            }
        }
    }
    return { ...o, x: s.x, y: s.y, r: s.r, segments: s.segments };
}
function drawWormFromSegments(o, isMe, key) {
    const segs = o.segments || [];
    const prevAlpha = ctx.globalAlpha;
    if (o.invis) ctx.globalAlpha = isMe ? 0.5 : 0.12;

    // ground shadow
    if (!o.invis) {
        ctx.save();
        ctx.globalAlpha = 0.28;
        for (let i = segs.length - 1; i >= 0; i -= 2) {
            const tLin = i / Math.max(1, segs.length - 1);
            let r = o.r;
            if (tLin > 0.985) {
                const tt = (tLin - 0.985) / 0.015;
                r = lerp(o.r, o.r * 0.6, tt);
            }
            ctx.beginPath(); ctx.fillStyle = '#000';
            ctx.ellipse(segs[i].x + r * 0.18, segs[i].y + r * 0.28, r * 0.95, r * 0.55, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.beginPath(); ctx.fillStyle = '#000';
        ctx.ellipse(o.x + o.r * 0.18, o.y + o.r * 0.28, o.r * 0.95, o.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    const bodyImgReady = o.pattern === 'customSkin' && wormImages.body && wormImages.body.loaded;
    for (let i = segs.length - 1; i >= 0; i--) {
        const tLin = i / Math.max(1, segs.length - 1);
        let r = o.r;
        if (tLin > 0.985) {
            const tt = (tLin - 0.985) / 0.015;
            r = lerp(o.r, o.r * 0.6, tt);
        }

        const pa = segs[i - 1], na = segs[i + 1];
        if (pa && na) {
            const a1 = Math.atan2(segs[i].y - pa.y, segs[i].x - pa.x);
            const a2 = Math.atan2(na.y - segs[i].y, na.x - segs[i].x);
            let dAng = a2 - a1;
            while (dAng > Math.PI) dAng -= Math.PI * 2;
            while (dAng < -Math.PI) dAng += Math.PI * 2;
            r *= 1 + clamp(dAng * 0.04, -0.03, 0.03);
        }

        if (bodyImgReady) {
            const size = r * 2.16;
            ctx.drawImage(wormImages.body.img, segs[i].x - size / 2, segs[i].y - size / 2, size, size);
        } else {
            const shade = i % 2 === 0 ? 4 : -5;
            const segColor = o.golden ? lighten('#ffd700', shade) : cachedSegmentFill(o, i, segs.length, key);
            ctx.beginPath(); ctx.fillStyle = segColor;
            ctx.arc(segs[i].x, segs[i].y, r * 1.08, 0, Math.PI * 2); ctx.fill();

            ctx.beginPath();
            ctx.fillStyle = lighten(segColor, 22);
            ctx.arc(segs[i].x - r * 0.28, segs[i].y - r * 0.32, r * 0.35, 0, Math.PI * 2); ctx.fill();
        }
    }
    drawSideFins(o, segs);
    drawTailFin(o, segs);
    if (o.pattern === 'diamond') {
        for (let i = 0; i < segs.length; i += 4) {
            const twinkle = Math.sin(performance.now() / 180 + i * 1.7);
            if (twinkle > 0.6) {
                const p = segs[i];
                ctx.beginPath();
                ctx.fillStyle = `rgba(255,255,255,${(twinkle - 0.6) * 2})`;
                ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 8;
                ctx.arc(p.x + (Math.random() - 0.5) * 6, p.y + (Math.random() - 0.5) * 6, 1.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
    }
    if (o.pattern === 'inferno' || o.pattern === 'aurora') {
        for (let i = 0; i < segs.length; i += 5) {
            if (Math.random() < 0.15) {
                const p = segs[i];
                const glowColor = o.pattern === 'inferno' ? '255,140,40' : '110,230,255';
                ctx.beginPath();
                ctx.fillStyle = `rgba(${glowColor},${0.3 + Math.random() * 0.3})`;
                ctx.shadowColor = `rgb(${glowColor})`; ctx.shadowBlur = 10;
                ctx.arc(p.x + (Math.random() - 0.5) * 8, p.y + (Math.random() - 0.5) * 8, 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
    } if (o.dashing || o.rampage) {
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
    drawPet(o, isMe, key);
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
    drawPectoralFins(o, segs);
    const baseColor = o.golden ? '#ffd700' : o.color;
    const headImgReady = o.pattern === 'customSkin' && wormImages.head && wormImages.head.loaded;
    if (headImgReady) {
        const hs = o.r * 2.7;
        ctx.save();
        if (o.golden) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 16; }
        ctx.drawImage(wormImages.head.img, -hs / 2, -hs / 2, hs, hs);
        ctx.restore();
    } else {
        const grad = ctx.createRadialGradient(-o.r * 0.3, -o.r * 0.3, o.r * 0.1, 0, 0, o.r);
        grad.addColorStop(0, lighten(baseColor, 30)); grad.addColorStop(1, baseColor);
        ctx.beginPath(); ctx.fillStyle = grad; ctx.shadowColor = baseColor; ctx.shadowBlur = isMe ? 12 : 8;
        ctx.arc(0, 0, o.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    const s0 = segs[0];
    const rawDirAng = s0 ? Math.atan2(o.y - s0.y, o.x - s0.x) : 0;
    const bobT = performance.now() / 260 + (o.x + o.y) * 0.001;
    const dirAng = rawDirAng + Math.sin(bobT) * 0.035;
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
    if (isMe && o.hat) drawHat(o.hat, o.r);
    ctx.font = `${clamp(o.r * 0.3, 9, 14)}px Segoe UI, sans-serif`;
    ctx.fillStyle = isMe ? 'rgba(255,210,63,0.9)' : (o.golden ? 'rgba(255,215,0,0.9)' : 'rgba(234,246,255,0.6)');
    ctx.textAlign = 'center'; ctx.fillText(o.name, 0, -o.r - 8);
    ctx.restore();
    ctx.globalAlpha = prevAlpha;
}
const COIN_VISUAL_SCALE = 2.4; // draw coins bigger than their actual pickup radius
function drawCoin(c) {
    const spin = Math.sin(performance.now() / 340 + c.x);
    const squash = 0.5 + Math.abs(spin) * 0.5; // horizontal squash = spin illusion
    const vr = c.r * COIN_VISUAL_SCALE; // visual-only radius, collision stays c.r
    ctx.save(); ctx.translate(c.x, c.y);
    ctx.beginPath(); ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.ellipse(0, vr * 0.6, vr * 0.55, vr * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    if (coinImageLoaded) {
        ctx.save();
        ctx.scale(squash, 1);
        const size = vr * 2;
        ctx.drawImage(coinImage, -size / 2, -size / 2, size, size);
        ctx.restore();
    } else {
        const grad = ctx.createRadialGradient(-vr * 0.2, -vr * 0.3, vr * 0.1, 0, 0, vr);
        grad.addColorStop(0, '#fff3b0'); grad.addColorStop(0.6, '#ffd23f'); grad.addColorStop(1, '#c98f00');
        ctx.beginPath(); ctx.fillStyle = grad; ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 10;
        ctx.ellipse(0, 0, vr * squash, vr, 0, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
    }
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
}
function drawPowerup(pu) {
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

// ---- NEW: Wormhole portal rendering (swirling animated ring) ----
function drawPortal(p) {
    const t = performance.now() / 500;
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.beginPath(); ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.arc(0, 0, p.r * 0.8, 0, Math.PI * 2); ctx.fill();
    for (let ring = 0; ring < 3; ring++) {
        const rr = p.r * (0.5 + ring * 0.22);
        ctx.beginPath();
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 0.55 - ring * 0.12;
        ctx.lineWidth = 4;
        ctx.shadowColor = p.color; ctx.shadowBlur = 18;
        ctx.arc(0, 0, rr, t * (ring % 2 === 0 ? 1 : -1), t * (ring % 2 === 0 ? 1 : -1) + Math.PI * 1.4);
        ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.restore();
}

// ---- NEW: Boss virus rendering (bigger, pulsing, HP pips) ----
function drawBoss(b) {
    const pulse = 0.85 + Math.sin(performance.now() / 200) * 0.15;
    ctx.save(); ctx.translate(b.x, b.y);
    const spikes = 22, inner = b.r * 0.78, outer = b.r * pulse;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? outer : inner;
        const ang = (Math.PI / spikes) * i;
        const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#ff2d55'; ctx.shadowColor = '#ff2d55'; ctx.shadowBlur = 30;
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.font = 'bold 16px Segoe UI, sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText('BOSS', 0, -b.r - 14);
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.fillStyle = i < b.hp ? '#fff' : 'rgba(255,255,255,0.25)';
        ctx.arc(-14 + i * 14, -b.r - 30, 5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// ---- NEW: Biome zone background tint (purely visual, based on world grid cell) ----
const BIOME_COLORS = ['rgba(20,40,70,0.14)', 'rgba(60,20,50,0.14)', 'rgba(15,55,45,0.14)', 'rgba(55,45,15,0.14)'];
function biomeColorAt(wx, wy) {
    const cellW = world.w / 2, cellH = world.h / 2;
    const cx = clamp(Math.floor(wx / cellW), 0, 1);
    const cy = clamp(Math.floor(wy / cellH), 0, 1);
    const idx = (cy * 2 + cx) % BIOME_COLORS.length;
    return BIOME_COLORS[idx];
}

function drawWorldBorder() {
    const w = world.w, h = world.h;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3 / camera.zoom;
    ctx.strokeRect(0, 0, w, h);
    ctx.restore();
}
let shakeX = 0, shakeY = 0;
let lastLbUpdate = 0;
let lastFrameTime = performance.now();
function render() {
    const now = performance.now();
    const dt = clamp((now - lastFrameTime) / 1000, 0, 0.05);
    lastFrameTime = now;

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
        shakeX = 0; shakeY = 0;
    }

    ctx.save();
    ctx.translate(W / 2 + shakeX, H / 2 + shakeY); ctx.scale(camera.zoom, camera.zoom); ctx.translate(-camera.x, -camera.y);

    const cullL = camera.x - (W / 2) / camera.zoom - 60, cullR = camera.x + (W / 2) / camera.zoom + 60;
    const cullT = camera.y - (H / 2) / camera.zoom - 60, cullB = camera.y + (H / 2) / camera.zoom + 60;

    // biome tint for current view center
    // biome tint disabled — keeping plain black background

    if (showGrid) {
        const gridSize = 64;
        const viewL = cullL, viewR = cullR;
        const viewT = cullT, viewB = cullB;
        ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1 / camera.zoom;
        ctx.beginPath();
        for (let gx = Math.floor(viewL / gridSize) * gridSize; gx < viewR; gx += gridSize) { ctx.moveTo(gx, viewT); ctx.lineTo(gx, viewB); }
        for (let gy = Math.floor(viewT / gridSize) * gridSize; gy < viewB; gy += gridSize) { ctx.moveTo(viewL, gy); ctx.lineTo(viewR, gy); }
        ctx.stroke();
    }

    drawWorldBorder();

    for (const p of (latest.portals || [])) drawPortal(p);
    if (latest.boss) drawBoss(latest.boss);

    for (const f of latest.food) {
        if (f.x < cullL || f.x > cullR || f.y < cullT || f.y > cullB) continue;
        ctx.save(); ctx.translate(f.x, f.y);
        if (f.emoji) {
            const bob = Math.sin(performance.now() / 260 + f.x) * (f.r * 0.1);
            const glowPulse = 0.8 + Math.sin(performance.now() / 240 + f.x) * 0.2;
            ctx.beginPath(); ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.ellipse(0, f.r * 0.55, f.r * 0.55, f.r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.fillStyle = f.color;
            ctx.shadowColor = f.color; ctx.shadowBlur = 22 * glowPulse;
            ctx.globalAlpha = 0.35;
            ctx.arc(0, bob, f.r * 1.1 * glowPulse, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            ctx.font = `${Math.round(f.r * 2)}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.shadowColor = f.color; ctx.shadowBlur = 12 * glowPulse;
            ctx.fillText(f.emoji, 0, bob);
            ctx.shadowBlur = 0;
        } else {
            const fruitKey = pickFoodImageKey(f);
            let entry = foodImages[fruitKey];
            if (!entry || !entry.loaded) entry = foodImages.apple; // fallback while that fruit is still loading
            if (entry && entry.loaded) {
                const h = foodHash(f);
                const scale = 1;
                const rot = h * Math.PI * 2;
                const bob = Math.sin(performance.now() / 900 + f.x) * (f.r * 0.025);
                const size = f.r * 2.2 * scale;
                ctx.save();
                ctx.rotate(rot);
                ctx.translate(0, bob);
                ctx.drawImage(entry.img, -size / 2, -size / 2, size, size);
                ctx.restore();
            } else {
                const pulse = 0.9 + Math.sin(performance.now() / 300 + f.x) * 0.1;
                ctx.shadowColor = f.color;
                ctx.shadowBlur = (f.golden ? 14 : 5) * pulse;
                const grad = ctx.createRadialGradient(-f.r * 0.32, -f.r * 0.32, f.r * 0.08, 0, 0, f.r);
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.45, f.color);
                grad.addColorStop(1, lighten(f.color, -25));
                ctx.beginPath(); ctx.fillStyle = grad;
                ctx.arc(0, 0, f.r * pulse, 0, Math.PI * 2); ctx.fill();
                ctx.shadowBlur = 0;
            }
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
    for (const id in latest.bots) {
        frameActiveIds.add('bot_' + id);
        drawWormFromSegments(getSmoothedEntity(latest.bots[id], 'bot_' + id), false, 'bot_' + id);
    }
    for (const id in latest.players) {
        frameActiveIds.add('player_' + id);
        const ent = id === myId ? latest.players[id] : getSmoothedEntity(latest.players[id], 'player_' + id);
        drawWormFromSegments(ent, id === myId, 'player_' + id);
    }
    for (const key in trails) { if (!frameActiveIds.has(key)) delete trails[key]; }
    for (const key of segColorCache.keys()) { if (!frameActiveIds.has(key)) segColorCache.delete(key); }
    for (const key of interpState.keys()) { if (!frameActiveIds.has(key)) interpState.delete(key); }

    updateAndDrawConfetti(dt);

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

    if (meOwner && performance.now() < lakhGlowUntil) {
        const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.7);
        vg.addColorStop(0, 'rgba(255,0,0,0)');
        vg.addColorStop(1, 'rgba(255,0,0,0.35)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
    }
    if (performance.now() - lastLbUpdate > 400) {
        lastLbUpdate = performance.now();
        const all = (latest.leaderboard || []).map(e => ({ name: e.name, mass: e.mass, me: e.me === myId }));
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
    }

    requestAnimationFrame(render);
}
requestAnimationFrame(render);
// ===== Background glowing worm (decorative, start-screen only) =====
(function () {
    const canvas = document.getElementById('bgWormCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const overlayEl = document.getElementById('overlay');

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const COLORS = ['#4be3d0', '#a855f7', '#e945ff', '#4d6bff'];

    function makeWorm(colorIdx, segCount, speed, radius) {
        return {
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            angle: Math.random() * Math.PI * 2,
            targetAngle: Math.random() * Math.PI * 2,
            speed,
            radius,
            color: COLORS[colorIdx % COLORS.length],
            trail: [],
            segCount,
            turnTimer: 0
        };
    }

    const worms = [
        makeWorm(0, 46, 1.1, 5),
        makeWorm(2, 34, 0.85, 4)
    ];

    function updateWorm(w, dt) {
        w.turnTimer -= dt;
        if (w.turnTimer <= 0) {
            w.targetAngle = Math.random() * Math.PI * 2;
            w.turnTimer = 1.5 + Math.random() * 2.5;
        }
        let diff = ((w.targetAngle - w.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        w.angle += diff * 0.02;

        w.x += Math.cos(w.angle) * w.speed;
        w.y += Math.sin(w.angle) * w.speed;

        const m = 60;
        if (w.x < -m) w.x = canvas.width + m;
        if (w.x > canvas.width + m) w.x = -m;
        if (w.y < -m) w.y = canvas.height + m;
        if (w.y > canvas.height + m) w.y = -m;

        w.trail.unshift({ x: w.x, y: w.y });
        if (w.trail.length > w.segCount) w.trail.pop();
    }

    function drawWorm(w) {
        if (w.trail.length < 2) return;
        ctx.save();
        ctx.shadowColor = w.color;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = w.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < w.trail.length; i++) {
            const t = 1 - i / w.trail.length;
            ctx.globalAlpha = t * 0.8;
            ctx.lineWidth = w.radius * t + 1;
            ctx.beginPath();
            ctx.moveTo(w.trail[i - 1].x, w.trail[i - 1].y);
            ctx.lineTo(w.trail[i].x, w.trail[i].y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = w.color;
        ctx.beginPath();
        ctx.arc(w.trail[0].x, w.trail[0].y, w.radius + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    let lastTime = performance.now();
    function loop(now) {
        requestAnimationFrame(loop);
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        if (overlayEl && overlayEl.classList.contains('hidden')) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const w of worms) {
            updateWorm(w, dt);
            drawWorm(w);
        }
    }
    requestAnimationFrame(loop);
})();