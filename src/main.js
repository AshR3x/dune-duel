import * as THREE from 'three';
import {
  N, CELL, SPAWNS, resolveCircle, raycast, lineClear, worldToCell, cellAt, CRATE_H,
} from './map.js';
import { buildWorld } from './world.js';
import { WEAPONS, buildViewModel, buildGrenadeMesh } from './weapons.js';
import { FX, makeMuzzleFlash, flashShow, flashTick, segmentBlockedBySmoke } from './fx.js';
import { Bot, DIFFICULTY, makeModel } from './bot.js';
import { initAudio, setListener, sfx, flashRing } from './audio.js';

// ------------------------------------------------------------------ setup
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const $ = (id) => document.getElementById(id);
const canvas = $('view');

// ---- loading screen: the bar follows real start-up stages ----
const loadBar = $('loadbar');
for (let i = 0; i < 12; i++) loadBar.appendChild(document.createElement('i'));
const load = { target: 0, shown: 0 };
(function paintLoad() {
  load.shown += (load.target - load.shown) * 0.1 + (load.target > load.shown ? 0.0015 : 0);
  if (load.target - load.shown < 0.002) load.shown = load.target;
  if (DEBUG) load.shown = load.target;
  const n = Math.floor(load.shown * 12 + 0.001);
  for (let i = 0; i < 12; i++) loadBar.children[i].classList.toggle('on', i < n);
  if (load.shown < 1) requestAnimationFrame(paintLoad);
})();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
async function stage(label, p) { $('loadlabel').textContent = label; load.target = p; await nextFrame(); }

const store = {
  get(k, d) { try { const v = localStorage.getItem('dd_' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dd_' + k, v); } catch { /* storage may be unavailable */ } },
};
$('lw').textContent = `${store.get('wins', 0)} WINS`; $('ll').textContent = `${store.get('losses', 0)} LOSSES`;
const settings = { diff: store.get('diff', 'normal'), sens: parseFloat(store.get('sens', '1')) };
if (!DIFFICULTY[settings.diff]) settings.diff = 'normal';

await stage('STARTING', 0.1);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.autoClear = false;

const scene = new THREE.Scene();
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#7fb2dc'); g.addColorStop(0.55, '#cfe0e6'); g.addColorStop(1, '#f1dcae');
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  scene.background = new THREE.CanvasTexture(c);
}
scene.fog = new THREE.Fog(0xe9d6a8, 22, 95);
scene.add(new THREE.HemisphereLight(0xfff4dc, 0xb59c70, 2.5));
const sun = new THREE.DirectionalLight(0xfff0cc, 1.6);
sun.position.set(30, 50, 18);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 200);
camera.rotation.order = 'YXZ';
const vmScene = new THREE.Scene();
vmScene.add(new THREE.HemisphereLight(0xfff0d2, 0x806a4a, 2.4));
const vmSun = new THREE.DirectionalLight(0xffffff, 1.6); vmSun.position.set(1, 2, 1.5); vmScene.add(vmSun);
const vmCam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
const vmLight = new THREE.PointLight(0xffa850, 0, 3, 2);
vmScene.add(vmLight);

await stage('BUILDING MAP', 0.3);
const world = buildWorld(scene);
await stage('SPAWNING', 0.6);
const fx = new FX(scene);
const bot = new Bot(scene, settings.diff);
const menuChar = makeModel({ shirt: 0x6b7f3a, pants: 0x4a4030, vest: 0x2e3a1f, helmet: 0x3a4a24 });
scene.add(menuChar.root);
await stage('LOADING WEAPONS', 0.8);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = vmCam.aspect = w / h;
  camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ viewmodels
const vm = {};
const VM_POS = { ak: [0.2, -0.2, -0.36], deagle: [0.17, -0.17, -0.3], knife: [0.17, -0.18, -0.28], smoke: [0.17, -0.2, -0.3], flash: [0.17, -0.2, -0.3] };
const vmRoot = new THREE.Group();
vmScene.add(vmRoot);
for (const id of ['ak', 'deagle', 'knife', 'smoke', 'flash']) {
  const m = buildViewModel(id);
  m.group.visible = false;
  if (m.muzzle) { m.flash = makeMuzzleFlash(id === 'deagle' ? 0.22 : 0.18); m.muzzle.add(m.flash); }
  vmRoot.add(m.group);
  vm[id] = m;
}
const vmAnim = { kick: 0, bob: 0, swing: 0, swingType: 'slash', throwT: 0 };

// ------------------------------------------------------------------ state
const P = {
  x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, punchP: 0, punchY: 0,
  hp: 100, alive: true, onGround: true, eyeY: 1.7, noiseT: 0, noiseR: 0, noise: 0,
  inv: { ak: { mag: 30, reserve: 90 }, deagle: { mag: 7, reserve: 35 } },
  grenades: { smoke: 1, flash: 1 },
  cur: 'ak', last: 'deagle', switchT: 0, nextFire: 0, reloadT: 0, spray: 0, stepDist: 0,
  melee: null, throwing: null, flashT: 0, flashDur: 0, flashFull: 0, walking: false, speed: 0,
};
const game = {
  phase: 'menu', t: 0, time: 0, round: 0, roundT: 75, score: { p: 0, b: 0 }, live: false, matchOver: false,
  sideT: true, locked: false, seeBotT: 0,
  player: P, smokes: fx.smokes,
};
const grenades = [];
const keys = new Set();
const mouse = { l: false, r: false };
let pressedFire = false;

// helpers shared by the player and the bot
game.sightBlocked = (ax, ay, az, bx, by, bz) => segmentBlockedBySmoke(fx.smokes, ax, ay, az, bx, by, bz);

function forwardVec(yaw, pitch, out = new THREE.Vector3()) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

function rayVsTarget(o, d, tMax, tg) {
  let best = null;
  // head: sphere
  const hx = tg.x, hy = tg.y + 1.6, hz = tg.z, hr = 0.23;
  const ox = o.x - hx, oy = o.y - hy, oz = o.z - hz;
  const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - hr * hr, disc = b * b - c;
  if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t >= 0 && t < tMax) best = { t, head: true }; }
  // body: vertical cylinder
  const r = 0.36, ex = o.x - tg.x, ez = o.z - tg.z, a = d.x * d.x + d.z * d.z;
  if (a > 1e-8) {
    const bb = ex * d.x + ez * d.z, cc = ex * ex + ez * ez - r * r, dd = bb * bb - a * cc;
    if (dd >= 0) {
      const s = Math.sqrt(dd);
      let t0 = (-bb - s) / a;
      if (t0 < 0) t0 = (-bb + s) / a;
      if (t0 >= 0 && t0 < tMax) {
        const y = o.y + d.y * t0;
        if (y >= tg.y && y <= tg.y + 1.45 && (!best || t0 < best.t)) best = { t: t0, head: false };
      }
    }
  }
  return best;
}

// casts a bullet; returns {t, kind: 'wall'|'floor'|'target'|'none', head, point, normal}
function castBullet(o, d, target) {
  const hl = Math.hypot(d.x, d.z);
  let tWall = Infinity, kind = 'none';
  if (hl > 1e-6) { tWall = raycast(o.x, o.z, d.x, d.z, 150) / hl; kind = 'wall'; }
  if (d.y < -1e-4) { const tf = -o.y / d.y; if (tf < tWall) { tWall = tf; kind = 'floor'; } }
  if (!isFinite(tWall)) tWall = 150;
  let res = { t: Math.min(tWall, 150), kind: tWall >= 150 ? 'none' : kind, head: false };
  if (target && target.alive) {
    const h = rayVsTarget(o, d, res.t, target);
    if (h) res = { t: h.t, kind: 'target', head: h.head };
  }
  res.point = new THREE.Vector3().copy(d).multiplyScalar(res.t).add(o);
  if (res.kind === 'wall') {
    const back = new THREE.Vector3().copy(d).multiplyScalar(-0.03).add(res.point);
    const [bx, bz] = worldToCell(back.x, back.z), [hx, hz] = worldToCell(res.point.x + d.x * 0.03, res.point.z + d.z * 0.03);
    const nx = bx - hx, nz = bz - hz;
    res.normal = new THREE.Vector3(nx, 0, nz);
    if (res.normal.lengthSq() === 0) res.normal.set(-Math.sign(d.x), 0, 0);
    res.normal.normalize();
  } else if (res.kind === 'floor') res.normal = new THREE.Vector3(0, 1, 0);
  return res;
}

// ------------------------------------------------------------------ HUD
const hud = {
  hp: $('hp'), mag: $('mag'), res: $('res'), wname: $('wname'), slots: $('slots'), timer: $('timer'),
  sp: $('sp'), sb: $('sb'), msg: $('msg'), feed: $('feed'), cross: $('cross'), marker: $('marker'),
  flash: $('flash'), smoke: $('smoke'), hurt: $('hurt'), hitdir: $('hitdir'), mini: $('minimap'),
};
const mctx = hud.mini.getContext('2d');
let hurtA = 0, hitdirA = 0, markerT = 0, msgText = '';

function setMsg(main, sub = '') {
  const t = main + '|' + sub;
  if (t === msgText) return;
  msgText = t;
  hud.msg.innerHTML = main ? `${main}${sub ? `<small>${sub}</small>` : ''}` : '';
}
function feed(text) {
  const d = document.createElement('div');
  d.textContent = text;
  hud.feed.appendChild(d);
  setTimeout(() => d.remove(), 4500);
  while (hud.feed.children.length > 5) hud.feed.firstChild.remove();
}
function hitMarker(head) {
  hud.marker.className = 'hud on' + (head ? ' head' : '');
  markerT = 0.12;
  sfx.hit(head);
}

const SLOT_DEFS = [['ak', '1', 'AK-47'], ['deagle', '2', 'Deagle'], ['knife', '3', 'Knife'], ['smoke', '4', 'Smoke'], ['flash', '5', 'Flash']];
const slotEls = {};
for (const [id, key, label] of SLOT_DEFS) {
  const el = document.createElement('div');
  el.className = 'slot'; el.innerHTML = `<b>${key}</b>${label}`;
  hud.slots.appendChild(el); slotEls[id] = el;
}

function updateHud(dt) {
  hud.hp.textContent = Math.max(0, Math.ceil(P.hp));
  hud.hp.className = P.hp <= 30 ? 'low' : '';
  const w = WEAPONS[P.cur];
  if (P.inv[P.cur]) {
    hud.wname.textContent = w.name;
    hud.mag.textContent = P.inv[P.cur].mag;
    hud.res.textContent = '/ ' + P.inv[P.cur].reserve;
  } else {
    hud.wname.textContent = w ? w.name : (P.cur === 'smoke' ? 'Smoke' : 'Flashbang');
    hud.mag.textContent = P.grenades[P.cur] ?? '';
    hud.res.textContent = '';
  }
  for (const [id] of SLOT_DEFS) {
    const el = slotEls[id];
    const count = P.grenades[id];
    el.classList.toggle('on', P.cur === id);
    el.classList.toggle('empty', count === 0);
  }
  hud.sp.textContent = game.score.p; hud.sb.textContent = game.score.b;
  const rt = Math.max(0, Math.ceil(game.roundT));
  hud.timer.textContent = `${Math.floor(rt / 60)}:${String(rt % 60).padStart(2, '0')}`;

  // crosshair gap follows current inaccuracy
  const gap = Math.min(40, 4 + currentSpread() * 700);
  hud.cross.style.setProperty('--g', gap);
  const [h1, h2, v1, v2] = hud.cross.querySelectorAll('i');
  h1.style.left = -(gap + 9) + 'px'; h2.style.left = gap + 'px';
  v1.style.top = -(gap + 9) + 'px'; v2.style.top = gap + 'px';
  hud.cross.style.display = P.alive && !WEAPONS[P.cur]?.melee ? '' : 'none';

  if (markerT > 0) { markerT -= dt; if (markerT <= 0) hud.marker.className = 'hud'; }

  // overlays
  let fa = 0;
  if (P.flashT > 0) {
    const e = P.flashDur - P.flashT;
    fa = e < P.flashFull ? 1 : Math.max(0, 1 - (e - P.flashFull) / Math.max(0.01, P.flashDur - P.flashFull));
    fa = Math.min(1, fa * 1.05) * Math.min(1, e / 0.04 + 0.2);
  }
  hud.flash.style.opacity = fa.toFixed(3);
  let sa = 0;
  for (const s of fx.smokes) {
    const d = Math.hypot(s.x - P.x, 1.7 - P.eyeY, s.z - P.z), r = s.radius * 1.1;
    if (d < r) sa = Math.max(sa, Math.min(0.97, (r - d) / (r * 0.45)));
  }
  hud.smoke.style.opacity = sa.toFixed(3);
  hurtA = Math.max(0, hurtA - dt * 1.2);
  hud.hurt.style.opacity = Math.min(1, hurtA + (P.alive && P.hp < 30 ? 0.25 : 0)).toFixed(3);
  hitdirA = Math.max(0, hitdirA - dt * 0.9);
  hud.hitdir.style.opacity = hitdirA.toFixed(3);
  drawMinimap();
}

function drawMinimap() {
  const s = hud.mini.width / N;
  mctx.drawImage(world.minimap, 0, 0);
  const toM = (x, z) => [((x / CELL) + N / 2) * s, ((z / CELL) + N / 2) * s];
  for (const sm of fx.smokes) {
    const [mx, mz] = toM(sm.x, sm.z);
    mctx.fillStyle = 'rgba(235,235,235,0.7)';
    mctx.beginPath(); mctx.arc(mx, mz, Math.max(2, (sm.radius / CELL) * s), 0, 7); mctx.fill();
  }
  if (game.seeBotT > 0 && bot.alive) {
    const [bx, bz] = toM(bot.x, bot.z);
    mctx.fillStyle = '#ff4d3d';
    mctx.beginPath(); mctx.arc(bx, bz, 3.5, 0, 7); mctx.fill();
  }
  if (P.alive) {
    const [px, pz] = toM(P.x, P.z);
    mctx.save(); mctx.translate(px, pz); mctx.rotate(-P.yaw);
    mctx.fillStyle = '#7ed957'; mctx.strokeStyle = '#102008';
    mctx.beginPath(); mctx.moveTo(0, -6); mctx.lineTo(4.5, 5); mctx.lineTo(-4.5, 5); mctx.closePath(); mctx.fill(); mctx.stroke();
    mctx.restore();
  }
}

// ------------------------------------------------------------------ weapons
function currentSpread() {
  const w = WEAPONS[P.cur];
  if (!w || w.melee) return 0.002;
  const moveF = Math.min(1, P.speed / 5.5) * (P.walking ? 0.25 : 1);
  return Math.min(w.spreadMax, w.spreadBase + moveF * w.spreadMove + (P.onGround ? 0 : w.spreadAir) + P.spray * w.spreadShot);
}

function eyePos(out = new THREE.Vector3()) { return out.set(P.x, P.y + P.eyeY, P.z); }

function selectWeapon(id) {
  if (!P.alive || id === P.cur) return;
  if (P.grenades[id] === 0) return;
  if (P.throwing) return;
  P.last = P.cur; P.cur = id;
  P.switchT = id === 'knife' ? 0.3 : 0.45;
  P.reloadT = 0; P.melee = null; vmAnim.kick = 0;
}

function startReload() {
  const w = WEAPONS[P.cur], inv = P.inv[P.cur];
  if (!w || w.melee || !inv || P.reloadT > 0 || inv.mag >= w.mag || inv.reserve <= 0 || P.switchT > 0) return;
  P.reloadT = w.reload;
  sfx.reload();
}

function applyPlayerDamage(dmg, head, from) {
  if (!P.alive || game.phase !== 'live') return;
  P.hp -= dmg;
  hurtA = Math.min(1, 0.45 + dmg / 80);
  P.punchP += 0.03; P.punchY += (Math.random() - 0.5) * 0.04;
  sfx.hurt();
  if (from) {
    const ang = Math.atan2(from.x - P.x, -(from.z - P.z)); // world bearing, 0 = -z
    const rel = ang + P.yaw;
    hud.hitdir.style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
    hitdirA = 1;
  }
  if (P.hp <= 0) {
    P.hp = 0; P.alive = false;
    sfx.death();
    feed(`Bot killed You${head ? ' (headshot)' : ''}`);
    endRound('bot', 'You were eliminated');
  }
}

function killBot(weaponName, head) {
  bot.die();
  sfx.death({ x: bot.x, z: bot.z });
  feed(`You [${weaponName}] Bot${head ? ' (headshot)' : ''}`);
  endRound('player', head ? 'Headshot!' : 'Enemy eliminated');
}

function playerShoot() {
  const w = WEAPONS[P.cur], inv = P.inv[P.cur];
  if (inv.mag <= 0) {
    if (P.nextFire <= 0) { sfx.click(); P.nextFire = 0.25; startReload(); }
    return;
  }
  inv.mag--;
  P.nextFire = w.rate;
  const spread = currentSpread();
  const r = Math.sqrt(Math.random()) * spread, a = Math.random() * Math.PI * 2;
  const yaw = P.yaw + P.punchY + Math.cos(a) * r, pitch = P.pitch + P.punchP + Math.sin(a) * r;
  const o = eyePos(), d = forwardVec(yaw, pitch);
  const res = castBullet(o, d, bot);
  P.spray = Math.min(P.cur === 'ak' ? 12 : 3, P.spray + 1);
  P.punchP = Math.min(0.32, P.punchP + w.kick * (0.8 + Math.random() * 0.4));
  P.punchY += (Math.random() - 0.5) * w.kick * (P.cur === 'ak' ? 0.9 : 0.5);
  vmAnim.kick = 1;
  const m = vm[P.cur];
  flashShow(m.flash, 0.05);
  vmLight.position.copy(m.muzzle.getWorldPosition(new THREE.Vector3()));
  vmLight.intensity = 10; vmLight.userData.t = 0.05;
  fx.worldFlash(o);
  sfx.shot(P.cur);
  P.noiseT = 0.3; P.noiseR = 48;

  // tracer from the muzzle area to the hit point
  const rightV = new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  const start = o.clone().addScaledVector(rightV, 0.14).addScaledVector(d, 0.6); start.y -= 0.1;
  if (res.t > 3) fx.tracer(start, res.point);

  if (res.kind === 'target') {
    const base = w.dmg;
    const dmg = res.head ? base * w.headMult : base;
    fx.impact(res.point, null, false);
    hitMarker(res.head);
    bot.takeDamage(dmg, P.x, P.z);
    if (bot.hp <= 0 && bot.alive) killBot(w.name, res.head);
  } else if (res.kind !== 'none') fx.impact(res.point, res.normal, true);
  if (inv.mag === 0 && inv.reserve > 0) setTimeout(() => { if (P.alive && P.cur) startReload(); }, 250);
}

function meleeStart(type) {
  if (P.melee || P.switchT > 0) return;
  const k = WEAPONS.knife[type];
  P.melee = { type, t: 0, hitAt: type === 'slash' ? 0.14 : 0.28, dur: k.time, done: false };
  vmAnim.swing = 1; vmAnim.swingType = type;
  sfx.knife();
}

function meleeHit(type) {
  const k = WEAPONS.knife[type];
  const o = eyePos();
  const dx = bot.x - P.x, dz = bot.z - P.z, dist = Math.hypot(dx, dz);
  if (!bot.alive || dist > k.range) return;
  const f = forwardVec(P.yaw, 0);
  if ((dx * f.x + dz * f.z) / (dist || 1) < Math.cos(0.9)) return;
  if (!lineClear(P.x, P.z, bot.x, bot.z)) return;
  // back-stab: attacker is behind the target's facing direction
  const bf = forwardVec(bot.yaw, 0);
  const behind = ((P.x - bot.x) * bf.x + (P.z - bot.z) * bf.z) / (dist || 1) < -0.3;
  const dmg = behind ? WEAPONS.knife.backstab : k.dmg;
  sfx.knifeHit({ x: bot.x, z: bot.z });
  hitMarker(false);
  bot.takeDamage(dmg, P.x, P.z);
  if (bot.hp <= 0 && bot.alive) killBot('Knife', false);
}

function throwFromPlayer(kind) {
  const f = forwardVec(P.yaw, P.pitch + P.punchP * 0);
  const pos = eyePos().addScaledVector(f, 0.55); pos.y -= 0.25;
  const vel = f.clone().multiplyScalar(15).add(new THREE.Vector3(P.vx * 0.6, 3.2, P.vz * 0.6));
  spawnGrenade(kind, pos, vel, 'player');
  P.grenades[kind]--;
  sfx.throwG();
}

function spawnGrenade(kind, pos, vel, owner) {
  const mesh = buildGrenadeMesh(kind);
  mesh.scale.setScalar(2.2);
  scene.add(mesh);
  grenades.push({ kind, pos, vel, mesh, t: 0, owner, rest: 0, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
}

game.botThrow = (b, kind, tx, tz) => {
  const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz) || 1;
  const th = 0.62, v = Math.min(23, Math.sqrt((18 * d) / Math.sin(2 * th)));
  const pos = new THREE.Vector3(b.x, 1.5, b.z);
  const vel = new THREE.Vector3((dx / d) * v * Math.cos(th), v * Math.sin(th), (dz / d) * v * Math.cos(th));
  b.yaw = Math.atan2(-dx, -dz);
  spawnGrenade(kind, pos, vel, 'bot');
  sfx.throwG({ x: b.x, z: b.z });
};

function updateGrenades(dt) {
  const G = 18;
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.t += dt;
    const steps = 3, h = dt / steps;
    for (let s = 0; s < steps; s++) {
      g.vel.y -= G * h;
      // x
      let nx = g.pos.x + g.vel.x * h;
      let [cx, cz] = worldToCell(nx, g.pos.z);
      if (blocksAt(cx, cz, g.pos.y)) { g.vel.x *= -0.45; g.vel.z *= 0.85; bounceSound(g); } else g.pos.x = nx;
      const nz = g.pos.z + g.vel.z * h;
      [cx, cz] = worldToCell(g.pos.x, nz);
      if (blocksAt(cx, cz, g.pos.y)) { g.vel.z *= -0.45; g.vel.x *= 0.85; bounceSound(g); } else g.pos.z = nz;
      g.pos.y += g.vel.y * h;
      if (g.pos.y < 0.07) {
        g.pos.y = 0.07;
        if (g.vel.y < -1.5) { g.vel.y *= -0.38; bounceSound(g); } else g.vel.y = 0;
        g.vel.x *= 0.8; g.vel.z *= 0.8;
      }
      if (g.pos.y > 6) { g.pos.y = 6; g.vel.y = -Math.abs(g.vel.y) * 0.3; }
    }
    const speed = Math.hypot(g.vel.x, g.vel.y, g.vel.z);
    g.rest = speed < 0.8 ? g.rest + dt : 0;
    g.mesh.position.copy(g.pos);
    if (speed > 1) { g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.z += g.spin.z * dt; }
    const pop = g.kind === 'smoke' ? (g.t > 0.9 && g.rest > 0.25) || g.t > 3.0 : g.t > 1.6;
    if (pop) {
      scene.remove(g.mesh);
      grenades.splice(i, 1);
      if (g.kind === 'smoke') { fx.addSmoke(g.pos.x, g.pos.z); sfx.smokePop({ x: g.pos.x, z: g.pos.z }); }
      else flashPop(g.pos);
    }
  }
}
function blocksAt(cx, cz, y) {
  const v = cellAt(cx, cz);
  if (v === 1) return false;
  if (v === 2 && y > CRATE_H + 0.05) return false;
  return true;
}
function bounceSound(g) { if (Math.hypot(g.vel.x, g.vel.z) > 1.5 || Math.abs(g.vel.y) > 2) sfx.bounce({ x: g.pos.x, z: g.pos.z }); }

function flashPop(pos) {
  sfx.flashBang({ x: pos.x, z: pos.z });
  fx.worldFlash(pos); fx.light.intensity = 140; fx.lightT = 0.15;
  // player
  if (P.alive) {
    const eye = eyePos();
    const d = eye.distanceTo(pos);
    if (d < 50 && lineClear(pos.x, pos.z, P.x, P.z) && !game.sightBlocked(pos.x, pos.y, pos.z, eye.x, eye.y, eye.z)) {
      const to = pos.clone().sub(eye).normalize();
      const f = forwardVec(P.yaw, P.pitch);
      const facing = (to.dot(f) + 1) / 2;
      const near = 1 - d / 50;
      const dur = Math.max(0.5, (0.7 + 3.6 * facing * facing) * (0.4 + 0.6 * near));
      P.flashT = Math.max(P.flashT, dur); P.flashDur = Math.max(P.flashDur, dur); P.flashFull = dur * 0.3 * (0.4 + 0.6 * facing);
      flashRing(dur + 1.5);
    }
  }
  // bot
  if (bot.alive) {
    const d = Math.hypot(bot.x - pos.x, bot.z - pos.z);
    if (d < 50 && lineClear(pos.x, pos.z, bot.x, bot.z) && !game.sightBlocked(pos.x, pos.y, pos.z, bot.x, bot.eyeY, bot.z)) {
      const to = new THREE.Vector3(pos.x - bot.x, 0, pos.z - bot.z).normalize();
      const f = forwardVec(bot.yaw, 0);
      const facing = (to.dot(f) + 1) / 2;
      const dur = Math.max(0.5, (0.7 + 3.4 * facing * facing) * (0.4 + 0.6 * (1 - d / 50)));
      bot.blind(dur);
    }
  }
}

game.botShoot = (b, origin, dir) => {
  const o = origin.clone();
  const res = castBullet(o, dir, P.alive ? { x: P.x, y: P.y, z: P.z, alive: true } : null);
  const bp = { x: b.x, z: b.z };
  sfx.shot('ak', bp);
  fx.worldFlash(new THREE.Vector3(b.x - Math.sin(b.yaw) * 0.7, 1.4, b.z - Math.cos(b.yaw) * 0.7));
  const start = o.clone().addScaledVector(dir, 0.5);
  fx.tracer(start, res.point);
  if (res.kind === 'target') {
    const dmg = res.head ? WEAPONS.ak.dmg * WEAPONS.ak.headMult : WEAPONS.ak.dmg;
    applyPlayerDamage(dmg, res.head, bp);
  } else if (res.kind !== 'none') {
    fx.impact(res.point, res.normal, true);
    // near misses are loud: flinch the camera slightly
    const dd = distPointRay(P, o, dir, res.t);
    if (dd < 1.2) { P.punchP += 0.004; P.punchY += (Math.random() - 0.5) * 0.01; }
  }
};
function distPointRay(p, o, d, tMax) {
  const t = Math.max(0, Math.min(tMax, (p.x - o.x) * d.x + (P.y + 1.4 - o.y) * d.y + (p.z - o.z) * d.z));
  return Math.hypot(o.x + d.x * t - p.x, o.y + d.y * t - (P.y + 1.4), o.z + d.z * t - p.z);
}

// ------------------------------------------------------------------ rounds
function setupSides() {
  // sides alternate each round so neither player owns a spawn
  const playerT = game.round % 2 === 1;
  game.sideT = playerT;
  const ps = playerT ? SPAWNS.T : SPAWNS.CT, bs = playerT ? SPAWNS.CT : SPAWNS.T;
  return { ps, bs, pYaw: playerT ? 0 : Math.PI, bYaw: playerT ? Math.PI : 0 };
}

function startRound() {
  game.round++;
  const { ps, bs, pYaw, bYaw } = setupSides();
  fx.clear();
  for (const g of grenades) scene.remove(g.mesh);
  grenades.length = 0;
  Object.assign(P, {
    x: ps.x, z: ps.z, y: 0, vx: 0, vz: 0, vy: 0, yaw: pYaw, pitch: 0, punchP: 0, punchY: 0, hp: 100, alive: true,
    cur: 'ak', last: 'deagle', switchT: 0.4, nextFire: 0, reloadT: 0, spray: 0, melee: null, throwing: null,
    flashT: 0, flashDur: 0, flashFull: 0, noiseT: 0, noise: 0,
  });
  P.inv.ak = { mag: 30, reserve: 90 }; P.inv.deagle = { mag: 7, reserve: 35 };
  P.grenades = { smoke: 1, flash: 1 };
  bot.setDifficulty(settings.diff);
  bot.reset(bs.x, bs.z, bYaw);
  game.phase = 'freeze'; game.t = DEBUG ? 0.01 : 3.2; game.live = false; game.roundT = 75; game.seeBotT = 0;
  setMsg(`Round ${game.round}`, game.sideT ? 'You start at the bottom (T side)' : 'You start at the top (CT side)');
}

function endRound(winner, reason) {
  if (game.phase === 'over') return;
  game.phase = 'over'; game.live = false; game.t = 3.2;
  if (winner === 'player') { game.score.p++; sfx.win(); }
  else if (winner === 'bot') { game.score.b++; sfx.lose(); }
  const target = 7;
  if (game.score.p >= target || game.score.b >= target) {
    game.matchOver = true;
    const win = game.score.p > game.score.b;
    store.set(win ? 'wins' : 'losses', +store.get(win ? 'wins' : 'losses', 0) + 1);
    $('lw').textContent = `${store.get('wins', 0)} WINS`; $('ll').textContent = `${store.get('losses', 0)} LOSSES`;
    setMsg(win ? 'VICTORY' : 'DEFEAT', `${game.score.p} - ${game.score.b}   Click or press Enter to play again`);
    game.t = 1e9;
  } else {
    setMsg(winner === 'player' ? 'Round won' : winner === 'bot' ? 'Round lost' : 'Time up', reason);
  }
}

function restartMatch() {
  game.score.p = game.score.b = 0; game.round = 0; game.matchOver = false;
  startRound();
}

// ------------------------------------------------------------------ update
let stepClock = 0;
function updatePlayer(dt) {
  const can = P.alive && game.phase === 'live';
  P.walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
  P.punchP *= Math.exp(-dt * 6); P.punchY *= Math.exp(-dt * 6);
  P.spray = Math.max(0, P.spray - dt * (P.cur === 'ak' ? 7 : 5));
  if (P.noiseT > 0) { P.noiseT -= dt; P.noise = P.noiseR; } else P.noise = 0;
  if (P.flashT > 0) P.flashT = Math.max(0, P.flashT - dt);
  P.switchT = Math.max(0, P.switchT - dt);
  P.nextFire -= dt;

  if (!P.alive) { P.vx *= 0.9; P.vz *= 0.9; return; }

  // movement
  let ix = 0, iz = 0;
  if (can) {
    if (keys.has('KeyW')) iz -= 1; if (keys.has('KeyS')) iz += 1;
    if (keys.has('KeyA')) ix -= 1; if (keys.has('KeyD')) ix += 1;
  }
  const len = Math.hypot(ix, iz) || 1;
  const wm = (WEAPONS[P.cur]?.speed ?? 1) * (P.walking ? 0.5 : 1);
  const maxV = 5.8 * wm;
  const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
  // right = (c, -s), forward = (-s, -c) in (x, z)
  const wx = ((ix / len) * c + (iz / len) * s) * maxV, wz = ((ix / len) * -s + (iz / len) * c) * maxV;
  const k = Math.min(1, dt * (P.onGround ? 11 : 1.8));
  P.vx += (wx - P.vx) * k; P.vz += (wz - P.vz) * k;
  if (can && keys.has('Space') && P.onGround) { P.vy = 6.4; P.onGround = false; }
  P.vy -= 20 * dt; P.y += P.vy * dt;
  if (P.y <= 0) { P.y = 0; P.vy = 0; P.onGround = true; }
  P.x += P.vx * dt; P.z += P.vz * dt;
  resolveCircle(P, 0.38);
  P.speed = Math.hypot(P.vx, P.vz);

  // footsteps: running is audible to the bot
  if (P.onGround && P.speed > 1) {
    P.stepDist += P.speed * dt;
    if (P.stepDist > 2.2) {
      P.stepDist = 0;
      if (!P.walking) { sfx.step(null, 0.5); if (P.noiseT <= 0) { P.noiseT = 0.2; P.noiseR = 14; } }
    }
  }
  vmAnim.bob += dt * P.speed * 1.6;
}

function updateWeapons(dt) {
  if (!P.alive || game.phase !== 'live') { P.melee = null; return; }
  const w = WEAPONS[P.cur] ?? {};   // grenades have no entry in the weapon table
  // reload completion
  if (P.reloadT > 0 && w.mag) {
    P.reloadT -= dt;
    if (P.reloadT <= 0) {
      const inv = P.inv[P.cur], need = w.mag - inv.mag, n = Math.min(need, inv.reserve);
      inv.mag += n; inv.reserve -= n;
    }
  }
  // knife
  if (P.melee) {
    P.melee.t += dt;
    if (!P.melee.done && P.melee.t >= P.melee.hitAt) { P.melee.done = true; meleeHit(P.melee.type); }
    if (P.melee.t >= P.melee.dur) P.melee = null;
  }
  // grenade throw animation
  if (P.throwing) {
    P.throwing.t += dt;
    if (!P.throwing.thrown && P.throwing.t >= 0.28) { P.throwing.thrown = true; throwFromPlayer(P.throwing.kind); }
    if (P.throwing.t >= 0.6) {
      const back = P.last && P.last !== 'smoke' && P.last !== 'flash' ? P.last : 'ak';
      P.throwing = null; P.cur = back; P.last = P.last === back ? 'knife' : P.last;
      P.switchT = 0.4;
    }
    return;
  }
  if (P.switchT > 0) return;
  const fire = mouse.l, alt = mouse.r;
  if (w.melee) {
    if (fire) meleeStart('slash'); else if (alt) meleeStart('stab');
  } else if (P.cur === 'smoke' || P.cur === 'flash') {
    if (fire && P.grenades[P.cur] > 0) P.throwing = { kind: P.cur, t: 0, thrown: false };
  } else if (P.reloadT <= 0) {
    if (fire && P.nextFire <= 0) {
      if (w.auto || !pressedFire) playerShoot();
    }
  }
  if (!fire) pressedFire = false; else pressedFire = true;
}

function update(dt) {
  game.time += dt;
  // phase timers
  if (game.phase === 'freeze') {
    game.t -= dt;
    const n = Math.ceil(game.t);
    if (game.t <= 0) { game.phase = 'live'; game.live = true; setMsg(''); sfx.beep(1200, 0.18); }
    else if (n !== game._lastN) { game._lastN = n; sfx.beep(660, 0.08); }
  } else if (game.phase === 'live') {
    game.roundT -= dt;
    if (game.roundT <= 0) endRound('draw', 'No point awarded');
  } else if (game.phase === 'over') {
    game.t -= dt;
    if (game.t <= 0 && !game.matchOver) startRound();
  }

  updatePlayer(dt);
  updateWeapons(dt);
  updateGrenades(dt);
  bot.update(dt, game);
  fx.update(dt);
  flashTick(vm.ak.flash, dt); flashTick(vm.deagle.flash, dt);
  if (vmLight.intensity > 0 && (vmLight.userData.t -= dt) <= 0) vmLight.intensity = 0;

  // can the player see the bot? (drives the minimap dot)
  if (bot.alive && P.alive && game.phase === 'live') {
    const f = forwardVec(P.yaw, 0);
    const dx = bot.x - P.x, dz = bot.z - P.z, d = Math.hypot(dx, dz) || 1;
    if ((dx * f.x + dz * f.z) / d > 0.3 && lineClear(P.x, P.z, bot.x, bot.z) && !game.sightBlocked(P.x, P.y + P.eyeY, P.z, bot.x, 1.3, bot.z)) game.seeBotT = 0.8;
  }
  game.seeBotT = Math.max(0, game.seeBotT - dt);
  setListener(P.x, P.z, P.yaw);
}

// ------------------------------------------------------------------ render
function renderView() {
  let eyeY = P.y + P.eyeY, tilt = 0;
  if (!P.alive) { eyeY = Math.max(0.3, P.y + 0.3); tilt = 0.5; }
  camera.position.set(P.x, eyeY, P.z);
  camera.rotation.set(Math.max(-1.55, Math.min(1.55, P.pitch + P.punchP)), P.yaw + P.punchY, tilt);
  renderer.clear();
  if (params.has('top')) {
    const s = (N * CELL) / 2 + 2, ortho = new THREE.OrthographicCamera(-s, s, s, -s, 0.1, 200);
    ortho.position.set(0, 100, 0); ortho.up.set(0, 0, -1); ortho.lookAt(0, 0, 0);
    scene.fog = null;
    renderer.render(scene, ortho);
    return;
  }
  renderer.render(scene, camera);
  if (!P.alive) return;

  // viewmodel pass
  renderer.clearDepth();
  for (const id in vm) vm[id].group.visible = id === P.cur;
  const bp = VM_POS[P.cur];
  const bob = Math.sin(vmAnim.bob * 2) * 0.004 * Math.min(1, P.speed / 5), bobY = Math.abs(Math.sin(vmAnim.bob)) * 0.005 * Math.min(1, P.speed / 5);
  vmAnim.kick = Math.max(0, vmAnim.kick - 0.016 * 9);
  const g = vmRoot;
  g.scale.setScalar(1.25);
  g.position.set(bp[0] * 0.9 + bob, bp[1] - bobY + 0.01, bp[2] + vmAnim.kick * 0.045);
  g.rotation.set(vmAnim.kick * 0.09, -0.03, 0);
  if (P.switchT > 0) { const r = P.switchT / 0.45; g.position.y -= 0.3 * r; g.rotation.x -= 0.9 * r; }
  if (P.reloadT > 0 && WEAPONS[P.cur]) {
    const total = WEAPONS[P.cur].reload, p = 1 - P.reloadT / total, s = Math.sin(Math.PI * Math.min(1, p));
    g.position.y -= s * 0.16; g.rotation.z = s * 0.55; g.rotation.x += s * 0.25;
  } else g.rotation.z = 0;
  if (P.melee) {
    const p = P.melee.t / P.melee.dur;
    if (P.melee.type === 'slash') {
      const q = Math.min(1, p / 0.4);
      g.rotation.y = 0.7 - q * 1.7 + (p > 0.4 ? (p - 0.4) * 1.2 : 0);
      g.rotation.z = -0.5 + q * 0.9; g.position.z -= Math.sin(Math.PI * Math.min(1, q)) * 0.1;
    } else {
      const q = Math.min(1, p / 0.28), back = p < 0.28 ? -q * 0.07 : 0;
      g.position.z += back - (p > 0.28 && p < 0.55 ? 0.28 : 0);
      g.rotation.x += p < 0.55 ? -0.15 : 0;
    }
  }
  if (P.throwing) {
    const p = P.throwing.t / 0.6, back = p < 0.45 ? p / 0.45 : 1 - (p - 0.45) / 0.55 * 1.0;
    g.position.y -= 0.02 + Math.sin(Math.min(1, p) * Math.PI) * 0.1;
    g.rotation.x += p < 0.45 ? back * 0.7 : -0.6 * (1 - (p - 0.45) / 0.55);
    g.position.z += p < 0.45 ? back * 0.1 : -0.12;
  }
  renderer.render(vmScene, vmCam);
}

// ------------------------------------------------------------------ input
const fireKeys = { Digit1: 'ak', Digit2: 'deagle', Digit3: 'knife', Digit4: 'smoke', Digit5: 'flash' };
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (fireKeys[e.code]) selectWeapon(fireKeys[e.code]);
  else if (e.code === 'KeyR') startReload();
  else if (e.code === 'KeyQ' && P.last) selectWeapon(P.last);
  else if (e.code === 'Enter' && game.matchOver) restartMatch();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse.l = mouse.r = false; });
window.addEventListener('mousedown', (e) => {
  if (!game.locked && !DEBUG) return;
  if (game.matchOver) { restartMatch(); return; }
  if (e.button === 0) mouse.l = true; if (e.button === 2) mouse.r = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousemove', (e) => {
  if (!game.locked) return;
  const k = 0.0022 * settings.sens;
  P.yaw -= e.movementX * k;
  P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - e.movementY * k));
});

const menu = $('menu');
const DIFFS = ['easy', 'normal', 'hard'];
const diffLabel = () => `Difficulty: ${settings.diff[0].toUpperCase()}${settings.diff.slice(1)}`;
$('difflbl').textContent = diffLabel();
$('diffbtn').addEventListener('click', () => {
  settings.diff = DIFFS[(DIFFS.indexOf(settings.diff) + 1) % DIFFS.length];
  store.set('diff', settings.diff);
  $('difflbl').textContent = diffLabel();
  bot.setDifficulty(settings.diff);
});
$('infobtn').addEventListener('click', () => { $('controls').classList.toggle('hidden'); menu.classList.toggle('ctl'); });

function lockChange() {
  game.locked = document.pointerLockElement === canvas;
  menu.classList.toggle('hidden', game.locked);
  if (!game.locked) {
    keys.clear(); mouse.l = mouse.r = false;
    $('playlbl').textContent = game.round && !game.matchOver ? 'Resume' : 'Deploy';
  }
}
document.addEventListener('pointerlockchange', lockChange);
$('play').addEventListener('click', () => {
  if ($('play').disabled) return;
  initAudio();
  if (!game.round) restartMatch();
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => { $('note').textContent = 'Pointer lock was blocked by the browser. Click Deploy again.'; });
  } catch { $('note').textContent = 'Pointer lock is not available in this browser.'; }
});

$('sens').value = settings.sens; $('sensv').textContent = settings.sens.toFixed(2);
$('sens').addEventListener('input', (e) => { settings.sens = parseFloat(e.target.value); $('sensv').textContent = settings.sens.toFixed(2); store.set('sens', settings.sens); });

// ------------------------------------------------------------------ menu backdrop
// While no match is running, the camera drifts slowly across the map with a character in the foreground.
function renderMenu(now) {
  const t = now / 1000;
  const yaw = 0.62 + Math.sin(t * 0.13) * 0.3;
  camera.position.set(-8, 1.95 + Math.sin(t * 0.25) * 0.06, 33.5);
  camera.rotation.set(0.1, yaw, 0);
  camera.updateMatrixWorld();
  const p = camera.localToWorld(new THREE.Vector3(1.0, -1.9, -2.5));
  menuChar.root.visible = true;
  bot.model.root.visible = false;   // the opponent stays hidden until a match starts
  menuChar.root.position.set(p.x, Math.sin(t * 1.8) * 0.012, p.z);
  menuChar.root.rotation.set(0, yaw + Math.PI - 0.2, 0);
  menuChar.aim.rotation.x = 0.05 + Math.sin(t * 1.4) * 0.025;
  menuChar.legL.rotation.x = menuChar.legR.rotation.x = 0;
  renderer.clear();
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if ((game.locked || DEBUG) && game.round && !game.manual) update(dt);
  document.body.classList.toggle('nomatch', !game.round);
  if (!game.round && !DEBUG) renderMenu(now);
  else { menuChar.root.visible = false; updateHud(dt); renderView(); }
  requestAnimationFrame(frame);
}

// debug / test hooks (also used by the automated checks)
window.__game = {
  P, bot, game, fx, grenades, camera, THREE, castBullet, rayVsTarget, flashPop, spawnGrenade,
  update, startRound, restartMatch, selectWeapon, playerShoot, applyPlayerDamage, throwFromPlayer,
  manual(on = true) { game.manual = on; },
  advance(sec, step = 1 / 60) { for (let t = 0; t < sec; t += step) update(step); },
  pose(x, z, yaw, pitch = 0) { Object.assign(P, { x, z, yaw, pitch, vx: 0, vz: 0 }); },
  render: renderView,
};

if (DEBUG) {
  menu.classList.add('hidden');
  settings.diff = params.get('diff') || settings.diff;
  startRound();
  if (params.has('nobot')) { bot.alive = false; bot.model.root.visible = false; }
  const cam = params.get('cam');
  if (cam) { const [x, z, yaw, pitch] = cam.split(',').map(Number); P.x = x; P.z = z; P.yaw = yaw; P.pitch = pitch || 0; }
}
await stage('READY', 1);
while (load.shown < 0.999) await nextFrame();
$('loadlabel').textContent = 'READY';
$('play').disabled = false;
requestAnimationFrame(frame);
