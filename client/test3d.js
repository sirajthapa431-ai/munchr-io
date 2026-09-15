// Step 5,6,7: full 3D scene — own worm, other worms/bots, food, coins, powerups, viruses, boss, portals, rampage orb, status effects
const t3d_scene = new THREE.Scene();
t3d_scene.background = new THREE.Color(0x0a0a12);

const t3d_camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
t3d_camera.position.set(0, 120, 160);
t3d_camera.lookAt(0, 0, 0);

const t3d_renderer = new THREE.WebGLRenderer({ antialias: true });
t3d_renderer.setSize(window.innerWidth, window.innerHeight);
t3d_renderer.domElement.style.position = 'fixed';
t3d_renderer.domElement.style.top = '0';
t3d_renderer.domElement.style.left = '0';
t3d_renderer.domElement.style.zIndex = '1';
document.body.appendChild(t3d_renderer.domElement);

const t3d_oldCanvas = document.getElementById('game');
if (t3d_oldCanvas) t3d_oldCanvas.style.display = 'none';

const t3d_light = new THREE.DirectionalLight(0xffffff, 1.3);
t3d_light.position.set(60, 120, 60);
t3d_scene.add(t3d_light);
t3d_scene.add(new THREE.AmbientLight(0x404060));
t3d_scene.add(new THREE.HemisphereLight(0x8899ff, 0x0a0a12, 0.6));

const t3d_groundGeo = new THREE.PlaneGeometry(4000, 4000);
const t3d_groundMat = new THREE.MeshStandardMaterial({ color: 0x0f1620, side: THREE.DoubleSide });
const t3d_ground = new THREE.Mesh(t3d_groundGeo, t3d_groundMat);
t3d_ground.rotation.x = Math.PI / 2;
t3d_ground.position.y = -5;
t3d_scene.add(t3d_ground);

let t3d_wormMesh = null;
let t3d_wormShieldMesh = null;
let t3d_otherWormMeshes = new Map();
let t3d_otherShieldMeshes = new Map();
let t3d_foodMeshes = new Map();
const t3d_foodGeo = new THREE.SphereGeometry(1, 8, 8);

// ---- status effect appearance: whole-tube color/emissive/opacity based on active effects ----
function t3d_wormAppearance(o, baseColorHex, now) {
    let color = baseColorHex;
    let emissive = baseColorHex;
    let emissiveIntensity = 0.15;
    let opacity = 1;
    let transparent = false;

    if (o.golden) {
        color = 0xffd700;
        emissive = 0xffae00;
        emissiveIntensity = 0.5;
    }
    if (o.frozen) {
        color = 0x9fd6ff;
        emissive = 0x6bceff;
        emissiveIntensity = 0.5;
    }
    if (o.rampage) {
        emissive = 0xff5a1f;
        emissiveIntensity = 0.6;
    }
    if (o.dashing) {
        emissive = 0xffffff;
        emissiveIntensity = 0.7;
    }
    if (o.boost) {
        emissive = 0xffd23f;
        emissiveIntensity = Math.max(emissiveIntensity, 0.4);
    }
    if (o.star) {
        const hue = (now / 8) % 360;
        const c = new THREE.Color(`hsl(${hue}, 90%, 60%)`);
        emissive = c.getHex();
        emissiveIntensity = 0.6;
    }
    if (o.invis) {
        transparent = true;
        opacity = 0.28;
    }
    return { color, emissive, emissiveIntensity, opacity, transparent };
}

function t3d_buildWormMesh(o, colorHex, now) {
    if (!o.segments || o.segments.length < 2) return null;
    const rawPoints = o.segments.map(p => new THREE.Vector3(p.x * 0.15, 0, p.y * 0.15));
    const roughCurve = new THREE.CatmullRomCurve3(rawPoints);
    // beaded/lumpy look hataauna curve लाई smooth resample garne — sparse
    // server segments बीच extra interpolated बिन्दुहरू थप्छ
    const smoothPointCount = Math.max(40, rawPoints.length * 8);
    const points = roughCurve.getPoints(smoothPointCount);
    const curve = new THREE.CatmullRomCurve3(points);
    const radius = Math.max(2, o.r * 0.18);
    const tubularSegments = Math.min(300, smoothPointCount * 2);
    const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, 16, false);
    const appearance = t3d_wormAppearance(o, colorHex, now);
    const mat = new THREE.MeshStandardMaterial({
        color: appearance.color,
        emissive: appearance.emissive,
        emissiveIntensity: appearance.emissiveIntensity,
        transparent: appearance.transparent,
        opacity: appearance.opacity
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.curve = curve;
    mesh.userData.radius = radius;
    return mesh;
}

// full-body shield shell — wraps the entire tube, not just the head
function t3d_buildShieldMesh(o, curve, radius) {
    if (!o.shield) return null;
    const shellGeo = new THREE.TubeGeometry(curve, 48, radius * 1.35, 10, false);
    const shellMat = new THREE.MeshStandardMaterial({
        color: 0x6bceff,
        emissive: 0x6bceff,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide
    });
    return new THREE.Mesh(shellGeo, shellMat);
}

function t3d_disposeMesh(mesh) {
    if (!mesh) return;
    mesh.geometry.dispose();
    mesh.material.dispose();
}

function t3d_updateWorm() {
    if (!latest || !latest.players || !myId) return;
    const me = latest.players[myId];
    if (!me) return;
    const now = performance.now();

    const newMesh = t3d_buildWormMesh(me, 0x4be3d0, now);
    if (newMesh) {
        if (t3d_wormMesh) {
            t3d_scene.remove(t3d_wormMesh);
            t3d_disposeMesh(t3d_wormMesh);
        }
        t3d_wormMesh = newMesh;
        t3d_scene.add(t3d_wormMesh);

        if (t3d_wormShieldMesh) {
            t3d_scene.remove(t3d_wormShieldMesh);
            t3d_disposeMesh(t3d_wormShieldMesh);
            t3d_wormShieldMesh = null;
        }
        const shield = t3d_buildShieldMesh(me, newMesh.userData.curve, newMesh.userData.radius);
        if (shield) {
            t3d_wormShieldMesh = shield;
            t3d_scene.add(t3d_wormShieldMesh);
        }
    }

    const headX = me.x * 0.15, headZ = me.y * 0.15;
    t3d_camera.position.x = headX;
    t3d_camera.position.z = headZ + 80;
    t3d_camera.position.y = 60;
    t3d_camera.lookAt(headX, 0, headZ);
}

function t3d_updateOtherWorms() {
    if (!latest) return;
    const seen = new Set();
    const now = performance.now();

    const addOrUpdate = (id, o, colorHex) => {
        seen.add(id);
        const newMesh = t3d_buildWormMesh(o, colorHex, now);
        if (!newMesh) return;
        const old = t3d_otherWormMeshes.get(id);
        if (old) {
            t3d_scene.remove(old);
            t3d_disposeMesh(old);
        }
        t3d_scene.add(newMesh);
        t3d_otherWormMeshes.set(id, newMesh);

        const oldShield = t3d_otherShieldMeshes.get(id);
        if (oldShield) {
            t3d_scene.remove(oldShield);
            t3d_disposeMesh(oldShield);
            t3d_otherShieldMeshes.delete(id);
        }
        const shield = t3d_buildShieldMesh(o, newMesh.userData.curve, newMesh.userData.radius);
        if (shield) {
            t3d_scene.add(shield);
            t3d_otherShieldMeshes.set(id, shield);
        }
    };

    for (const id in (latest.players || {})) {
        if (id === myId) continue;
        addOrUpdate('p_' + id, latest.players[id], 0xff6fa5);
    }
    for (const id in (latest.bots || {})) {
        addOrUpdate('b_' + id, latest.bots[id], 0xffd23f);
    }

    for (const [key, mesh] of t3d_otherWormMeshes) {
        if (!seen.has(key)) {
            t3d_scene.remove(mesh);
            t3d_disposeMesh(mesh);
            t3d_otherWormMeshes.delete(key);
            const shield = t3d_otherShieldMeshes.get(key);
            if (shield) {
                t3d_scene.remove(shield);
                t3d_disposeMesh(shield);
                t3d_otherShieldMeshes.delete(key);
            }
        }
    }
}

function t3d_updateFood() {
    if (!latest || !latest.food) return;
    const seen = new Set();
    latest.food.forEach((f, i) => {
        const key = 'f' + i;
        seen.add(key);
        let mesh = t3d_foodMeshes.get(key);
        if (!mesh) {
            const mat = new THREE.MeshStandardMaterial({ color: f.color || '#ffd23f' });
            mesh = new THREE.Mesh(t3d_foodGeo, mat);
            t3d_scene.add(mesh);
            t3d_foodMeshes.set(key, mesh);
        }
        const r = Math.max(1, (f.r || 8) * 0.15);
        mesh.scale.set(r, r, r);
        mesh.position.set(f.x * 0.15, r, f.y * 0.15);
    });
    for (const [key, mesh] of t3d_foodMeshes) {
        if (!seen.has(key)) {
            t3d_scene.remove(mesh);
            t3d_foodMeshes.delete(key);
        }
    }
}

let t3d_coinMeshes = new Map();
const t3d_coinGeo = new THREE.SphereGeometry(1, 8, 8);
const t3d_coinMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffa500, emissiveIntensity: 0.3 });

function t3d_updateCoins() {
    if (!latest || !latest.coins) return;
    const seen = new Set();
    latest.coins.forEach((c, i) => {
        const key = 'c' + i;
        seen.add(key);
        let mesh = t3d_coinMeshes.get(key);
        if (!mesh) {
            mesh = new THREE.Mesh(t3d_coinGeo, t3d_coinMat);
            t3d_scene.add(mesh);
            t3d_coinMeshes.set(key, mesh);
        }
        const r = Math.max(1, (c.r || 8) * 0.15);
        mesh.scale.set(r, r, r);
        mesh.position.set(c.x * 0.15, r, c.y * 0.15);
    });
    for (const [key, mesh] of t3d_coinMeshes) {
        if (!seen.has(key)) {
            t3d_scene.remove(mesh);
            t3d_coinMeshes.delete(key);
        }
    }
}

let t3d_powerupMeshes = new Map();
const t3d_powerupGeo = new THREE.OctahedronGeometry(1);
const T3D_POWER_COLORS = { speed: 0xffd23f, shield: 0x6bceff, magnet: 0xb98bff, star: 0xff9d5c };

function t3d_updatePowerups() {
    if (!latest || !latest.powerups) return;
    const seen = new Set();
    latest.powerups.forEach((pu, i) => {
        const key = 'pu' + i;
        seen.add(key);
        let mesh = t3d_powerupMeshes.get(key);
        if (!mesh) {
            const mat = new THREE.MeshStandardMaterial({
                color: T3D_POWER_COLORS[pu.type] || 0xffd23f,
                emissive: T3D_POWER_COLORS[pu.type] || 0xffd23f,
                emissiveIntensity: 0.5
            });
            mesh = new THREE.Mesh(t3d_powerupGeo, mat);
            t3d_scene.add(mesh);
            t3d_powerupMeshes.set(key, mesh);
        }
        const r = Math.max(2, (pu.r || 13) * 0.2);
        mesh.scale.set(r, r, r);
        mesh.position.set(pu.x * 0.15, r + 3, pu.y * 0.15);
        mesh.rotation.y += 0.03;
    });
    for (const [key, mesh] of t3d_powerupMeshes) {
        if (!seen.has(key)) {
            t3d_scene.remove(mesh);
            t3d_powerupMeshes.delete(key);
        }
    }
}

// ---- viruses, boss, portals, rampage orb ----
let t3d_virusMeshes = new Map();
const t3d_virusGeo = new THREE.IcosahedronGeometry(1, 0);
const t3d_virusMat = new THREE.MeshStandardMaterial({ color: 0x3ee06b, emissive: 0x3ee06b, emissiveIntensity: 0.35, flatShading: true });

function t3d_updateViruses() {
    if (!latest || !latest.viruses) return;
    const seen = new Set();
    latest.viruses.forEach((v, i) => {
        const key = 'v' + i;
        seen.add(key);
        let mesh = t3d_virusMeshes.get(key);
        if (!mesh) {
            mesh = new THREE.Mesh(t3d_virusGeo, t3d_virusMat);
            t3d_scene.add(mesh);
            t3d_virusMeshes.set(key, mesh);
        }
        const r = Math.max(3, (v.r || 45) * 0.15);
        mesh.scale.set(r, r, r);
        mesh.position.set(v.x * 0.15, r, v.y * 0.15);
        mesh.rotation.y += 0.01;
        mesh.rotation.x += 0.005;
    });
    for (const [key, mesh] of t3d_virusMeshes) {
        if (!seen.has(key)) {
            t3d_scene.remove(mesh);
            t3d_virusMeshes.delete(key);
        }
    }
}

let t3d_bossMesh = null;
const t3d_bossGeo = new THREE.IcosahedronGeometry(1, 1);
const t3d_bossMat = new THREE.MeshStandardMaterial({ color: 0xff2d55, emissive: 0xff2d55, emissiveIntensity: 0.5, flatShading: true });

function t3d_updateBoss() {
    if (!latest || !latest.boss) {
        if (t3d_bossMesh) {
            t3d_scene.remove(t3d_bossMesh);
            t3d_bossMesh = null;
        }
        return;
    }
    const b = latest.boss;
    if (!t3d_bossMesh) {
        t3d_bossMesh = new THREE.Mesh(t3d_bossGeo, t3d_bossMat);
        t3d_scene.add(t3d_bossMesh);
    }
    const r = Math.max(5, (b.r || 130) * 0.15);
    const pulse = 1 + Math.sin(performance.now() / 200) * 0.06;
    t3d_bossMesh.scale.set(r * pulse, r * pulse, r * pulse);
    t3d_bossMesh.position.set(b.x * 0.15, r, b.y * 0.15);
    t3d_bossMesh.rotation.y += 0.02;
}

let t3d_portalMeshes = new Map();
const t3d_portalGeo = new THREE.TorusGeometry(1, 0.35, 12, 24);

function t3d_updatePortals() {
    if (!latest || !latest.portals) return;
    const seen = new Set();
    latest.portals.forEach((p, i) => {
        const key = 'portal' + i;
        seen.add(key);
        let mesh = t3d_portalMeshes.get(key);
        if (!mesh) {
            const mat = new THREE.MeshStandardMaterial({
                color: p.color || '#7dd3ff',
                emissive: p.color || '#7dd3ff',
                emissiveIntensity: 0.6
            });
            mesh = new THREE.Mesh(t3d_portalGeo, mat);
            mesh.rotation.x = Math.PI / 2;
            t3d_scene.add(mesh);
            t3d_portalMeshes.set(key, mesh);
        }
        const r = Math.max(3, (p.r || 55) * 0.15);
        mesh.scale.set(r, r, r);
        mesh.position.set(p.x * 0.15, r * 0.6, p.y * 0.15);
        mesh.rotation.z += 0.04;
    });
    for (const [key, mesh] of t3d_portalMeshes) {
        if (!seen.has(key)) {
            t3d_scene.remove(mesh);
            t3d_portalMeshes.delete(key);
        }
    }
}

let t3d_rampageMesh = null;
const t3d_rampageGeo = new THREE.SphereGeometry(1, 12, 12);
const t3d_rampageMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 0.6 });

function t3d_updateRampageOrb() {
    if (!latest || !latest.rampageOrb) {
        if (t3d_rampageMesh) {
            t3d_scene.remove(t3d_rampageMesh);
            t3d_rampageMesh = null;
        }
        return;
    }
    const ro = latest.rampageOrb;
    if (!t3d_rampageMesh) {
        t3d_rampageMesh = new THREE.Mesh(t3d_rampageGeo, t3d_rampageMat);
        t3d_scene.add(t3d_rampageMesh);
    }
    const r = Math.max(3, (ro.r || 20) * 0.15);
    const pulse = 1 + Math.sin(performance.now() / 140) * 0.15;
    t3d_rampageMesh.scale.set(r * pulse, r * pulse, r * pulse);
    t3d_rampageMesh.position.set(ro.x * 0.15, r, ro.y * 0.15);
}

window.addEventListener('resize', () => {
    t3d_camera.aspect = window.innerWidth / window.innerHeight;
    t3d_camera.updateProjectionMatrix();
    t3d_renderer.setSize(window.innerWidth, window.innerHeight);
});

function t3d_animate() {
    requestAnimationFrame(t3d_animate);
    t3d_updateWorm();
    t3d_updateOtherWorms();
    t3d_updateFood();
    t3d_updateCoins();
    t3d_updatePowerups();
    t3d_updateViruses();
    t3d_updateBoss();
    t3d_updatePortals();
    t3d_updateRampageOrb();
    t3d_renderer.render(t3d_scene, t3d_camera);
}
t3d_animate();