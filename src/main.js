import * as THREE from 'three';
import {
  N, CELL, SPAWNS, resolveCircle, raycast, lineClear, worldToCell, cellAt, CRATE_H,
} from './map.js';
import { buildWorld } from './world.js';
import {
  WEAPONS, GRENADES, GRENADE_ORDER, SHOP, CATEGORIES, itemOf, isGun, slotOf, defaultPistol,
  bulletDamage, armorSplit, buildViewModel, buildWorldGun, buildItemModel, tuning, isAuto, buildGrenadeMesh, loadGunAssets, KNIVES, KNIFE_ORDER, knifeStyle, setKnifeStyle,
} from './weapons.js';
import { FX, makeMuzzleFlash, flashShow, flashTick, segmentBlockedBySmoke } from './fx.js';
import { Bot, DIFFICULTY, makeModel } from './bot.js';
import { makeIcons, headIcon, refreshIcon } from './icons.js';
import { CHARACTERS, charLabel, loadCharacter, fetchMinecraftSkin } from './characters.js';
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
const settings = { diff: store.get('diff', 'normal'), sens: parseFloat(store.get('sens', '0.12')), mode: store.get('mode', 'classic') };
if (!DIFFICULTY[settings.diff]) settings.diff = 'normal';
// chosen knife and blade colour (the grip is always black)
setKnifeStyle(KNIVES[store.get('knife', 'bayonet')] ? store.get('knife', 'bayonet') : 'bayonet', parseInt(String(store.get('kcolor', '#d9dde3')).replace('#', ''), 16) || 0xd9dde3);

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
// photographic sky (Poly Haven "citrus orchard puresky", CC0, tone-mapped to a 2K JPEG); keeps the gradient above if it fails
try {
  const sky = await new THREE.TextureLoader().loadAsync('./assets/sky/sky.jpg');
  sky.mapping = THREE.EquirectangularReflectionMapping;
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
} catch (e) { console.warn('sky failed to load, using the gradient', e); }
// distant dunes fade toward a haze that sits between the sand and the sky's horizon colour
scene.fog = new THREE.Fog(new THREE.Color(0xe9d6a8).lerp(new THREE.Color(0x9fadba), 0.45), 22, 95);
scene.add(new THREE.HemisphereLight(0xfff4dc, 0xb59c70, 2.5));
const sun = new THREE.DirectionalLight(0xfff0cc, 1.6);
sun.position.set(10, 40, 33);          // same compass direction as the sun in the sky image, lifted for readable shading
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
await loadGunAssets();
const icons = makeIcons();      // item pictures for the wheel menus
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
const VM_POS = { rifle: [0.2, -0.2, -0.36], sniper: [0.2, -0.21, -0.34], lmg: [0.2, -0.22, -0.36], smg: [0.19, -0.19, -0.34], shotgun: [0.2, -0.2, -0.34], pistol: [0.13, -0.15, -0.34], knife: [0.17, -0.18, -0.28], zeus: [0.17, -0.18, -0.3], grenade: [0.17, -0.2, -0.3] };
const vmPosOf = (id) => VM_POS[WEAPONS[id]?.cls ?? 'grenade'];
const vmRoot = new THREE.Group();
vmScene.add(vmRoot);
function getVm(id) {
  if (vm[id]) return vm[id];
  const m = buildViewModel(id);
  m.group.visible = false;
  if (m.muzzle) { m.flash = makeMuzzleFlash(WEAPONS[id]?.flash ?? 0.18); m.muzzle.add(m.flash); }
  vmRoot.add(m.group);
  return (vm[id] = m);
}
for (const id of ['ak47', 'glock', 'usp', 'knife', 'smoke', 'flash']) getVm(id);   // pre-build the starters
const vmAnim = { kick: 0, bob: 0, swing: 0, swingType: 'slash', throwT: 0 };

// ------------------------------------------------------------------ state
const MAX_MONEY = 16000, START_MONEY = 800, WIN_REWARD = 3250, FOV = 78, HALF = 6, TARGET = 7;
const P = {
  x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, punchP: 0, punchY: 0,
  hp: 100, alive: true, onGround: true, eyeY: 1.7, crouch: 0, noiseT: 0, noiseR: 0, noise: 0,
  money: START_MONEY, armor: 0, helmet: false,
  primary: null, secondary: 'glock', zeus: false, ammo: {},
  grenades: { he: 0, flash: 0, smoke: 0, molotov: 0, incendiary: 0, decoy: 0 },
  cur: 'glock', last: 'knife', switchT: 0, nextFire: 0, reloadT: 0, spray: 0, stepDist: 0,
  melee: null, throwing: null, flashT: 0, flashDur: 0, flashFull: 0, walking: false, speed: 0,
  ads: 0, zoomLvl: 0, rescope: 0, fov: FOV, zeusT: 0, fireDmgT: 0, inspect: null,
};
const game = {
  phase: 'menu', t: 0, time: 0, round: 0, roundT: 75, score: { p: 0, b: 0 }, live: false, matchOver: false,
  sideT: true, locked: false, seeBotT: 0, liveT: 0, spawn: { x: 0, z: 0 }, streak: { p: 0, b: 0 }, pAlive: false, bAlive: false,
  player: P, smokes: fx.smokes, decoys: [],
};
const grenades = [];
const drops = [];
const keys = new Set();
const mouse = { l: false, r: false };
let view3 = 0;                                   // F5 camera: 0 first person, 1 behind you, 2 in front of you
let pressedFire = false;

const mySide = () => (game.sideT ? 'T' : 'CT');
const botSide = () => (game.sideT ? 'CT' : 'T');
const curW = () => WEAPONS[P.cur];
const isGrenadeId = (id) => !!GRENADES[id];
const gunNow = () => isGun(P.cur);
const owns = (id) => id === 'knife' || id === P.primary || id === P.secondary || (id === 'zeus' && P.zeus) || (isGrenadeId(id) && P.grenades[id] > 0);
const bestWeapon = () => P.primary || P.secondary || 'knife';
const grenadeCount = () => Object.values(P.grenades).reduce((a, b) => a + b, 0);
const fresh = (id) => ({ mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve });

// helpers shared by the player and the bot
game.sightBlocked = (ax, ay, az, bx, by, bz) => segmentBlockedBySmoke(fx.smokes, ax, ay, az, bx, by, bz);

function forwardVec(yaw, pitch, out = new THREE.Vector3()) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

function rayVsTarget(o, d, tMax, tg) {
  let best = null;
  // head: sphere
  const crouchK = tg.crouch || 0, headY = 1.6 - 0.45 * crouchK, top = 1.45 - 0.45 * crouchK, zs = top / 1.45;   // a crouched target is shorter
  const hx = tg.x, hy = tg.y + headY, hz = tg.z, hr = 0.23;
  const ox = o.x - hx, oy = o.y - hy, oz = o.z - hz;
  const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - hr * hr, disc = b * b - c;
  if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t >= 0 && t < tMax) best = { t, zone: 'head' }; }
  // body: vertical cylinder, split into legs / stomach / chest by height
  const r = 0.36, ex = o.x - tg.x, ez = o.z - tg.z, a = d.x * d.x + d.z * d.z;
  if (a > 1e-8) {
    const bb = ex * d.x + ez * d.z, cc = ex * ex + ez * ez - r * r, dd = bb * bb - a * cc;
    if (dd >= 0) {
      const s = Math.sqrt(dd);
      let t0 = (-bb - s) / a;
      if (t0 < 0) t0 = (-bb + s) / a;
      if (t0 >= 0 && t0 < tMax) {
        const y = o.y + d.y * t0, ry = y - tg.y;
        if (ry >= 0 && ry <= top && (!best || t0 < best.t)) best = { t: t0, zone: ry < 0.75 * zs ? 'legs' : ry < 1.05 * zs ? 'stomach' : 'chest' };
      }
    }
  }
  return best;
}

// casts a bullet; returns {t, kind: 'wall'|'floor'|'target'|'none', zone, point, normal}
function castBullet(o, d, target) {
  const hl = Math.hypot(d.x, d.z);
  let tWall = Infinity, kind = 'none';
  if (hl > 1e-6) { tWall = raycast(o.x, o.z, d.x, d.z, 150) / hl; kind = 'wall'; }
  if (d.y < -1e-4) { const tf = -o.y / d.y; if (tf < tWall) { tWall = tf; kind = 'floor'; } }
  if (!isFinite(tWall)) tWall = 150;
  let res = { t: Math.min(tWall, 150), kind: tWall >= 150 ? 'none' : kind, head: false, zone: null };
  if (target && target.alive) {
    const h = rayVsTarget(o, d, res.t, target);
    if (h) res = { t: h.t, kind: 'target', head: h.zone === 'head', zone: h.zone };
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
  ar: $('ar'), arl: $('arl'), money: $('money'), cashfeed: $('cashfeed'), prompt: $('prompt'), scope: $('scope'),
};
const mctx = hud.mini.getContext('2d');
let hurtA = 0, hitdirA = 0, markerT = 0, msgText = '', promptText = '';

function setMsg(main, sub = '') {
  const t = main + '|' + sub;
  if (t === msgText) return;
  msgText = t;
  hud.msg.innerHTML = main ? `${main}${sub ? `<small>${sub}</small>` : ''}` : '';
}
function setPrompt(html) {
  if (html === promptText) return;
  promptText = html; hud.prompt.innerHTML = html;
}
function feed(text) {
  const d = document.createElement('div');
  d.textContent = text;
  hud.feed.appendChild(d);
  setTimeout(() => d.remove(), 4500);
  while (hud.feed.children.length > 5) hud.feed.firstChild.remove();
}
const HS_SVG = '<svg viewBox="0 0 24 24" aria-label="headshot"><circle cx="12" cy="12" r="7"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></svg>';
let playerHead = null, botHead = null;
const playerName = () => store.get('name', 'You') || 'You';
// maps a damage label ("AK-47", "HE Grenade", "Fire") to an icon id
function iconIdFor(label) {
  for (const w of Object.values(WEAPONS)) if (w.name === label) return w.id;
  for (const g of Object.values(GRENADES)) if (g.name === label) return g.id;
  return label === 'Fire' ? 'molotov' : null;
}
// a kill-feed line: [head] name [gun] [headshot] [head] name
function killFeed({ killer, kHead, victim, vHead, label, head, mine }) {
  const d = document.createElement('div');
  d.className = 'kf' + (mine ? ' mine' : '');
  const img = (src, cls) => { if (!src) return null; const i = document.createElement('img'); i.src = src; i.className = cls; i.alt = ''; i.draggable = false; return i; };
  const name = (t, cls) => { const b = document.createElement('b'); b.className = cls; b.textContent = t; return b; };
  const gun = icons[iconIdFor(label)];
  const parts = [img(kHead, 'hd'), name(killer, mine ? 'me' : 'foe')];
  if (gun) parts.push(img(gun, 'gun')); else { const s = document.createElement('span'); s.textContent = `[${label}]`; parts.push(s); }
  if (head) { const w = document.createElement('span'); w.innerHTML = HS_SVG; parts.push(w.firstChild); }
  parts.push(img(vHead, 'hd'), name(victim, mine ? 'foe' : 'me'));
  for (const p of parts) if (p) d.appendChild(p);
  hud.feed.appendChild(d);
  setTimeout(() => d.remove(), 5500);
  while (hud.feed.children.length > 5) hud.feed.firstChild.remove();
}
function cashLine(n, why) {
  const d = document.createElement('div');
  d.className = n >= 0 ? 'plus' : 'minus';
  d.textContent = `${n >= 0 ? '+' : '-'}$${Math.abs(n)}  ${why}`;
  hud.cashfeed.appendChild(d);
  setTimeout(() => d.remove(), 3200);
  while (hud.cashfeed.children.length > 5) hud.cashfeed.firstChild.remove();
}
function addMoney(n, why) {
  if (n === 0) return;
  const before = P.money;
  P.money = Math.max(0, Math.min(MAX_MONEY, P.money + n));
  if (P.money === before) return;                    // already at the cap
  cashLine(P.money - before, why);
  if (n > 0) sfx.cash();
}
function hitMarker(head) {
  hud.marker.className = 'hud on' + (head ? ' head' : '');
  markerT = 0.12;
  sfx.hit(head);
}

// weapon list on the right: one picture per carried item, the current one highlighted
let slotKey = '';
function renderSlots() {
  const entries = [];
  if (P.primary) entries.push([1, P.primary, 1]);
  if (P.secondary) entries.push([2, P.secondary, 1]);
  entries.push([3, 'knife', 1]);
  for (const id of GRENADE_ORDER) if (P.grenades[id] > 0) entries.push([4, id, P.grenades[id]]);
  if (P.zeus) entries.push([5, 'zeus', 1]);
  const key = entries.map((e) => e.join(':')).join('|');
  if (key !== slotKey) {
    slotKey = key;
    hud.slots.textContent = '';
    for (const [n, id, count] of entries) {
      const el = document.createElement('div');
      el.className = 'slot'; el.dataset.id = id;
      el.innerHTML = `<b>${n}</b>${icons[id] ? `<img src="${icons[id]}" alt="" draggable="false">` : `<span>${itemOf(id)?.name ?? id}</span>`}${count > 1 ? `<em>x${count}</em>` : ''}`;
      hud.slots.appendChild(el);
    }
  }
  for (const el of hud.slots.children) el.classList.toggle('on', el.dataset.id === P.cur);
}
const slotNum = (id) => ({ primary: 1, secondary: 2, knife: 3, grenade: 4, zeus: 5 })[slotOf(id)] ?? 0;
const GSHORT = { he: 'HE', flash: 'Flash', smoke: 'Smoke', molotov: 'Molly', incendiary: 'Incen', decoy: 'Decoy' };
function slotLabels() {
  const g = GRENADE_ORDER.filter((id) => P.grenades[id] > 0).map((id) => `${GSHORT[id]}${P.grenades[id] > 1 ? ' x' + P.grenades[id] : ''}`).join(' ');
  return [P.primary ? WEAPONS[P.primary].name : '', P.secondary ? WEAPONS[P.secondary].name : '', 'Knife', g, P.zeus ? 'Zeus' : ''];
}

// scoreboard avatars: the character portraits, falling back to the side letters until they are ready
function setAvatar(el, src, side) {
  el.dataset.s = side;
  const img = el.firstChild;
  if (src) { if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; el.classList.add('has'); }
  else { img.hidden = true; el.classList.remove('has'); }
}

function updateHud(dt) {
  hud.hp.textContent = Math.max(0, Math.ceil(P.hp));
  hud.hp.className = 'num' + (P.hp <= 30 ? ' low' : '');
  hud.ar.textContent = P.armor;
  $('hpbar').style.width = Math.max(0, P.hp) + '%';
  $('arbar').style.width = P.armor + '%';
  $('hpbox').classList.toggle('lowb', P.hp <= 30);
  $('armor').classList.toggle('helm', P.helmet);
  hud.money.textContent = P.money;
  const w = curW();
  if (gunNow()) {
    const a = P.ammo[P.cur];
    hud.wname.textContent = w.name; hud.mag.textContent = a.mag; hud.res.textContent = '/ ' + a.reserve;
  } else if (isGrenadeId(P.cur)) {
    hud.wname.textContent = GRENADES[P.cur].name; hud.mag.textContent = P.grenades[P.cur]; hud.res.textContent = '';
  } else {
    hud.wname.textContent = P.cur === 'knife' ? KNIVES[knifeStyle.kind] : w ? w.name : ''; hud.mag.textContent = ''; hud.res.textContent = '';
  }
  renderSlots();
  hud.sp.textContent = game.score.p; hud.sb.textContent = game.score.b;
  const rt = Math.max(0, Math.ceil(game.roundT));
  hud.timer.textContent = `${Math.floor(rt / 60)}:${String(rt % 60).padStart(2, '0')}`;
  hud.timer.classList.toggle('low', game.phase === 'live' && rt <= 10);
  $('score').classList.toggle('pT', game.sideT);
  setAvatar($('sidep'), playerHead, game.sideT ? 'T' : 'CT'); setAvatar($('sideb'), botHead, game.sideT ? 'CT' : 'T');
  $('roundn').textContent = game.phase === 'freeze' ? 'BUY TIME' : `ROUND ${game.round}`;

  // crosshair gap follows current inaccuracy; scoped views swap it for the scope overlay
  const scoped = scopedNow();
  const gap = Math.min(40, 4 + currentSpread() * 700);
  hud.cross.style.setProperty('--g', gap);
  const [h1, h2, v1, v2] = hud.cross.querySelectorAll('i');
  h1.style.left = -(gap + 9) + 'px'; h2.style.left = gap + 'px';
  v1.style.top = -(gap + 9) + 'px'; v2.style.top = gap + 'px';
  if (settings.mode === 'tracking') $('ehpf').style.width = (game.round && bot.alive ? Math.max(0, bot.hp) : 0) + '%';
  hud.cross.style.display = P.alive && !scoped && (view3 > 0 || (gunNow() && P.ads < 0.3)) ? '' : 'none';   // hidden while aiming down sights; third person has no sights, so it stays up
  hud.scope.style.opacity = scoped ? 1 : 0;
  hud.scope.className = 'hud ' + (curW()?.scopeKind === 'aug' ? 'aug' : '');

  if (markerT > 0) { markerT -= dt; if (markerT <= 0) hud.marker.className = 'hud'; }

  // prompts: buy hint during the buy window, pickup hint next to dropped weapons
  const nd = nearestDrop();
  if (wheel.mode) setPrompt('');
  else if (nd && P.alive) setPrompt(`<b>E</b> pick up ${WEAPONS[nd.id].name}`);
  else if (canBuy() && P.alive) setPrompt(`<b>B</b> buy menu &nbsp; <b>C</b> weapon wheel`);
  else setPrompt('');

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

// Round radar: the map is drawn around you and turned so your view direction points up, like the CS:GO radar.
const RADAR_ZOOM = 1.9;
function drawMinimap() {
  const cw = hud.mini.width, ch = hud.mini.height, mm = world.minimap, s = mm.width / N;
  const toM = (x, z) => [((x / CELL) + N / 2) * s, ((z / CELL) + N / 2) * s];
  const [cx, cz] = toM(P.x, P.z);
  mctx.fillStyle = '#0b0906';
  mctx.fillRect(0, 0, cw, ch);
  mctx.save();
  mctx.translate(cw / 2, ch / 2);
  mctx.rotate(P.alive ? P.yaw : 0);
  mctx.scale(RADAR_ZOOM, RADAR_ZOOM);
  mctx.translate(-cx, -cz);
  mctx.drawImage(mm, 0, 0);
  for (const sm of fx.smokes) {
    const [mx, mz] = toM(sm.x, sm.z);
    mctx.fillStyle = 'rgba(235,235,235,0.7)';
    mctx.beginPath(); mctx.arc(mx, mz, Math.max(2, (sm.radius / CELL) * s), 0, 7); mctx.fill();
  }
  for (const f of fx.fires) {
    const [mx, mz] = toM(f.x, f.z);
    mctx.fillStyle = 'rgba(255,120,30,0.65)';
    mctx.beginPath(); mctx.arc(mx, mz, Math.max(2, (f.radius / CELL) * s), 0, 7); mctx.fill();
  }
  if (game.seeBotT > 0 && bot.alive) {
    const [bx, bz] = toM(bot.x, bot.z);
    mctx.fillStyle = '#ff4d3d';
    mctx.beginPath(); mctx.arc(bx, bz, 2.4, 0, 7); mctx.fill();
  }
  mctx.restore();
  if (P.alive) {
    mctx.save(); mctx.translate(cw / 2, ch / 2);
    mctx.fillStyle = '#7ed957'; mctx.strokeStyle = '#102008'; mctx.lineWidth = 1.5;
    mctx.beginPath(); mctx.moveTo(0, -8); mctx.lineTo(6, 7); mctx.lineTo(0, 3.5); mctx.lineTo(-6, 7); mctx.closePath(); mctx.fill(); mctx.stroke();
    mctx.restore();
  }
}

// ------------------------------------------------------------------ loadout
function resetLoadout() {
  P.primary = null; P.secondary = defaultPistol(mySide()); P.zeus = false; P.ammo = {};
  P.grenades = { he: 0, flash: 0, smoke: 0, molotov: 0, incendiary: 0, decoy: 0 };
  P.armor = 0; P.helmet = false;
  P.ammo[P.secondary] = fresh(P.secondary);
}

// puts a gun in its slot; the weapon it replaces drops to the floor when `dropOld` is set
function giveGun(id, ammo, dropOld = true) {
  const slot = slotOf(id), old = P[slot];
  if (old && old !== id && dropOld) spawnDrop(old, P.ammo[old], P.x, P.z, true);
  if (old && old !== id) delete P.ammo[old];
  P[slot] = id;
  P.ammo[id] = ammo || fresh(id);
  if (P.cur === old) P.cur = id;
}

function selectWeapon(id) {
  if (!P.alive || id === P.cur || !id || P.throwing) return;
  if (!owns(id)) return;
  P.last = P.cur; P.cur = id;
  P.switchT = id === 'knife' ? 0.3 : 0.45;
  P.reloadT = 0; P.melee = null; vmAnim.kick = 0; P.zoomLvl = 0; P.rescope = 0; P.inspect = null;
}

function selectSlot(n) {
  if (n === 1) selectWeapon(P.primary);
  else if (n === 2) selectWeapon(P.secondary);
  else if (n === 3) selectWeapon('knife');
  else if (n === 5) selectWeapon(P.zeus ? 'zeus' : null);
  else if (n === 4) {
    const own = GRENADE_ORDER.filter((id) => P.grenades[id] > 0);
    if (!own.length) return;
    const i = own.indexOf(P.cur);
    selectWeapon(own[(i + 1) % own.length]);
  }
}

function cycleWeapon(dir) {
  const list = ['primary', 'secondary', 'knife', 'zeus'].map((s) => (s === 'knife' ? 'knife' : s === 'zeus' ? (P.zeus ? 'zeus' : null) : P[s])).filter(Boolean)
    .concat(GRENADE_ORDER.filter((id) => P.grenades[id] > 0));
  if (!list.length) return;
  const i = Math.max(0, list.indexOf(P.cur));
  selectWeapon(list[(i + dir + list.length) % list.length]);
}

// F: look over the current weapon (cancelled by firing, reloading, switching or aiming, as in CS:GO)
function startInspect() {
  if (!P.alive || P.inspect || P.reloadT > 0 || P.switchT > 0 || P.throwing || P.melee || wheel.mode || P.ads > 0.1 || P.zeusT > 0) return;
  P.inspect = { t: 0, dur: P.cur === 'knife' ? 3.6 : isGrenadeId(P.cur) ? 2.2 : 3.2 };
  sfx.pickup();
}

function startReload() {
  const w = curW(), a = P.ammo[P.cur];
  if (!gunNow() || !a || P.reloadT > 0 || a.mag >= w.mag || a.reserve <= 0 || P.switchT > 0) return;
  P.reloadT = w.reload; P.zoomLvl = 0; P.rescope = 0; P.inspect = null;
  w.shell ? sfx.cycle() : sfx.reload();
}

// ---- dropped weapons ----
function spawnDrop(id, ammo, x, z, forward = false) {
  if (!id) return null;
  let px = x, pz = z;
  if (forward) {
    const f = forwardVec(P.yaw, 0);
    const tx = x + f.x * 1.3, tz = z + f.z * 1.3;
    if (lineClear(x, z, tx, tz)) { px = tx; pz = tz; }
  }
  const wrap = new THREE.Group();
  const gun = buildWorldGun(id).group;
  gun.scale.setScalar(1.7); gun.rotation.z = Math.PI / 2;
  wrap.add(gun);
  wrap.position.set(px, 0.25, pz);
  scene.add(wrap);
  const d = { id, ammo: ammo || fresh(id), x: px, z: pz, mesh: wrap, t: Math.random() * 6 };
  drops.push(d);
  sfx.pickup({ x: px, z: pz });
  return d;
}
function clearDrops() { for (const d of drops) scene.remove(d.mesh); drops.length = 0; }
function nearestDrop() {
  if (!P.alive) return null;
  let best = null, bd = 2.4;
  for (const d of drops) { const dd = Math.hypot(d.x - P.x, d.z - P.z); if (dd < bd) { bd = dd; best = d; } }
  return best;
}
function pickUp() {
  const d = nearestDrop();
  if (!d || !P.alive) return;
  scene.remove(d.mesh); drops.splice(drops.indexOf(d), 1);
  if (d.id === 'zeus') { P.zeus = true; selectWeapon('zeus'); }
  else {
    giveGun(d.id, d.ammo, true);
    if (P.cur !== d.id) { P.last = P.cur; P.cur = d.id; }
    P.switchT = 0.45; P.reloadT = 0; P.zoomLvl = 0;
  }
  sfx.pickup();
}
function dropCurrent() {
  if (!P.alive || P.throwing) return;
  const id = P.cur;
  if (id === 'zeus') { P.zeus = false; spawnDrop('zeus', null, P.x, P.z, true); }
  else if (gunNow()) { const a = P.ammo[id]; P[slotOf(id)] = null; delete P.ammo[id]; spawnDrop(id, a, P.x, P.z, true); }
  else return;
  P.cur = bestWeapon(); P.switchT = 0.4; P.reloadT = 0; P.zoomLvl = 0;
}

// ------------------------------------------------------------------ weapons
const scopedNow = () => P.alive && gunNow() && !!curW().zoom && P.zoomLvl > 0 && P.ads > 0.85;

function currentSpread() {
  const w = curW();
  if (!w || !isGun(P.cur)) return 0.002;
  const moveF = Math.min(1, P.speed / 5.5) * (P.walking ? 0.25 : 1);
  const zoomed = !!w.zoom && P.zoomLvl > 0;
  let s = w.spreadBase + moveF * w.spreadMove + (P.onGround ? 0 : w.spreadAir) + P.spray * w.spreadShot;
  if (w.needScope && !zoomed) s += 0.045;
  if (!zoomed) s *= 1 - P.ads * (1 - w.adsAcc);
  s *= 1 - 0.25 * P.crouch;                       // crouching steadies your aim
  s *= tuning.spread;
  return Math.min(w.spreadMax + (w.needScope && !zoomed ? 0.05 : 0), s);
}

function eyePos(out = new THREE.Vector3()) { return out.set(P.x, P.y + P.eyeY, P.z); }

function hurtPlayerFx(from) {
  hurtA = Math.min(1, 0.45 + 0.3);
  P.punchP += 0.03 * tuning.recoil; P.punchY += (Math.random() - 0.5) * 0.04 * tuning.recoil;
  sfx.hurt();
  if (from) {
    const ang = Math.atan2(from.x - P.x, -(from.z - P.z)); // world bearing, 0 = -z
    const rel = ang + P.yaw;
    hud.hitdir.style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
    hitdirA = 1;
  }
}

// `health` is already after armor; the bot earns `reward` when this kills
function damagePlayer(health, head, from, label = 'AK-47', reward = 300) {
  if (!P.alive || game.phase !== 'live') return;
  P.hp -= health * tuning.dmg;
  hurtPlayerFx(from);
  if (P.hp <= 0) {
    P.hp = 0; P.alive = false; P.zoomLvl = 0;
    sfx.death();
    bot.money = Math.min(MAX_MONEY, bot.money + reward);
    killFeed({ killer: bot.name || 'Bot', kHead: botHead, victim: playerName(), vHead: playerHead, label, head, mine: false });
    endRound('bot', 'You were eliminated');
  }
}
const applyPlayerDamage = (dmg, head, from) => damagePlayer(dmg, head, from);

function killBot(label, head, reward) {
  bot.die(); game.bAlive = false;
  sfx.death({ x: bot.x, z: bot.z });
  killFeed({ killer: playerName(), kHead: playerHead, victim: bot.name || 'Bot', vHead: botHead, label, head, mine: true });
  for (const id of bot.dropIds()) spawnDrop(id, bot.ammo[id], bot.x + (Math.random() - 0.5) * 1.2, bot.z + (Math.random() - 0.5) * 1.2);
  addMoney(reward, `Kill: ${label}`);
  endRound('player', head ? 'Headshot!' : 'Enemy eliminated');
}

// applies damage to the bot, handling armor; returns true when it died
function hurtBot(dmg, ap, zone, label, reward, atX, atZ) {
  const armored = zone === 'chest' || zone === 'stomach' || (zone === 'head' && bot.helmet);
  const r = armored ? armorSplit(dmg, ap, bot.armor) : { health: dmg, armor: bot.armor };
  bot.armor = Math.round(r.armor);
  bot.takeDamage(Math.round(r.health), atX, atZ);
  if (bot.hp <= 0 && bot.alive) { killBot(label, zone === 'head', reward); return true; }
  return false;
}

function playerShoot() {
  const w = curW(), a = P.ammo[P.cur];
  if (a.mag <= 0) {
    if (P.nextFire <= 0) { sfx.click(); P.nextFire = 0.25; startReload(); }
    return;
  }
  a.mag--;
  P.nextFire = w.rate;
  const spread = currentSpread();
  const o = eyePos();
  const pellets = w.pellets || 1;
  let health = 0, head = false, hit = false, ap = w.ap, zones = [];
  let lastRes = null;
  for (let i = 0; i < pellets; i++) {
    const cone = pellets > 1 ? w.pellet + spread : spread;
    const r = Math.sqrt(Math.random()) * cone, ang = Math.random() * Math.PI * 2;
    const yaw = P.yaw + P.punchY + Math.cos(ang) * r, pitch = P.pitch + P.punchP + Math.sin(ang) * r;
    const d = forwardVec(yaw, pitch);
    const res = castBullet(o, d, bot);
    lastRes = res;
    if (res.kind === 'target') {
      hit = true; head = head || res.head; zones.push([res, d]);
    } else if (res.kind !== 'none' && (pellets === 1 || i < 4)) fx.impact(res.point, res.normal, true);
    if (i < 3 || pellets === 1) {
      const rightV = new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
      const start = o.clone().addScaledVector(rightV, 0.14).addScaledVector(d, 0.6); start.y -= 0.1;
      if (res.t > 3) fx.tracer(start, res.point);
    }
  }
  P.spray = Math.min(w.auto ? 12 : 3, P.spray + 1);
  const adsKick = 1 - P.ads * 0.2;
  P.punchP = Math.min(0.32, P.punchP + w.kick * adsKick * (0.8 + Math.random() * 0.4) * tuning.recoil);
  P.punchY += (Math.random() - 0.5) * w.kick * (w.cls === 'rifle' || w.cls === 'lmg' ? 0.9 : 0.5) * tuning.recoil;
  vmAnim.kick = 1;
  const m = getVm(P.cur);
  if (m.flash) flashShow(m.flash, 0.05);
  if (m.muzzle) { vmLight.position.copy(m.muzzle.getWorldPosition(new THREE.Vector3())); vmLight.intensity = w.silenced ? 3 : 10; vmLight.userData.t = 0.05; }
  fx.worldFlash(o);
  sfx.shot(P.cur);
  P.noiseT = 0.3; P.noiseR = w.silenced ? 26 : w.noise;

  if (hit) {
    // each pellet is resolved separately so armor wears down between them
    let killed = false;
    for (const [res] of zones) {
      if (killed) break;
      const bd = bulletDamage(w, res.t, res.zone, bot.armor, bot.helmet);
      bot.armor = bd.armor;
      bot.takeDamage(bd.health, P.x, P.z);
      health += bd.health;
      fx.impact(res.point, null, false);
      if (bot.hp <= 0 && bot.alive) { killBot(w.name, res.zone === 'head', w.kill); killed = true; }
    }
    hitMarker(head);
  }
  if (a.mag === 0 && a.reserve > 0 && !w.bolt) setTimeout(() => { if (P.alive && gunNow()) startReload(); }, 250);
  // bolt-actions drop the scope between shots and bring it back when the bolt is cycled
  if (w.bolt && P.zoomLvl > 0) { P.rescope = P.zoomLvl; P.zoomLvl = 0; }
  if (w.bolt) sfx.cycle();
}

function zeusFire() {
  P.nextFire = 1; P.zeus = false; P.zeusT = 0.6;
  sfx.zeus();
  fx.worldFlash(eyePos().addScaledVector(forwardVec(P.yaw, P.pitch), 1.2));
  vmLight.position.set(0, 0, -0.5); vmLight.intensity = 14; vmLight.userData.t = 0.12;
  const dx = bot.x - P.x, dz = bot.z - P.z, dist = Math.hypot(dx, dz);
  if (!bot.alive || dist > 4.5) return;
  const f = forwardVec(P.yaw, 0);
  if ((dx * f.x + dz * f.z) / (dist || 1) < Math.cos(0.7) || !lineClear(P.x, P.z, bot.x, bot.z)) return;
  hitMarker(false);
  bot.takeDamage(500, P.x, P.z);
  if (bot.hp <= 0 && bot.alive) killBot('Zeus x27', false, 0);
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
  hurtBot(dmg, WEAPONS.knife.ap, 'chest', 'Knife', WEAPONS.knife.kill, P.x, P.z);
}

// ------------------------------------------------------------------ grenades
function throwFromPlayer(kind, soft = false) {
  const f = forwardVec(P.yaw, P.pitch);
  const pos = eyePos().addScaledVector(f, 0.55); pos.y -= 0.25;
  const vel = f.clone().multiplyScalar(soft ? 7 : 15).add(new THREE.Vector3(P.vx * 0.6, soft ? 2.2 : 3.2, P.vz * 0.6));
  spawnGrenade(kind, pos, vel, 'player');
  P.grenades[kind]--;
  sfx.throwG();
}

function spawnGrenade(kind, pos, vel, owner) {
  const mesh = buildGrenadeMesh(kind);
  mesh.scale.setScalar(2.2);
  scene.add(mesh);
  grenades.push({ kind, pos, vel, mesh, t: 0, owner, rest: 0, landed: false, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
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
    const g = grenades[i], def = GRENADES[g.kind];
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
        g.pos.y = 0.07; g.landed = true;
        if (g.vel.y < -1.5) { g.vel.y *= -0.38; bounceSound(g); } else g.vel.y = 0;
        g.vel.x *= 0.8; g.vel.z *= 0.8;
      }
      if (g.pos.y > 6) { g.pos.y = 6; g.vel.y = -Math.abs(g.vel.y) * 0.3; }
    }
    const speed = Math.hypot(g.vel.x, g.vel.y, g.vel.z);
    g.rest = speed < 0.8 ? g.rest + dt : 0;
    g.mesh.position.copy(g.pos);
    if (speed > 1) { g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.z += g.spin.z * dt; }
    let pop;
    if (g.kind === 'smoke') pop = (g.t > 0.9 && g.rest > 0.25) || g.t > 3.0;
    else if (def.fire) pop = (g.landed && g.t > 0.15) || g.t > 2.2;
    else if (g.kind === 'decoy') pop = (g.rest > 0.3 && g.t > 0.6) || g.t > 3.0;
    else pop = g.t > def.fuse;
    if (!pop) continue;
    scene.remove(g.mesh);
    grenades.splice(i, 1);
    if (g.kind === 'smoke') { fx.addSmoke(g.pos.x, g.pos.z); sfx.smokePop({ x: g.pos.x, z: g.pos.z }); extinguishAt(g.pos.x, g.pos.z, 3.4); }
    else if (g.kind === 'flash') flashPop(g.pos);
    else if (g.kind === 'he') explodeHE(g.pos, g.owner);
    else if (def.fire) startFire(g.pos, g.owner);
    else if (g.kind === 'decoy') { game.decoys.push({ x: g.pos.x, z: g.pos.z, t: 0, life: 12, next: 0.2 }); sfx.pickup({ x: g.pos.x, z: g.pos.z }); }
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

const HE_RADIUS = 6.5;
function heDamage(d) { return 98 * Math.pow(Math.max(0, 1 - d / HE_RADIUS), 1.25); }

function explodeHE(pos, owner) {
  const live = game.phase === 'live';              // after the round ends nothing more is scored
  sfx.explode({ x: pos.x, z: pos.z });
  fx.explosion(pos);
  if (P.alive) {
    const d = Math.hypot(pos.x - P.x, pos.y - (P.y + 1), pos.z - P.z);
    if (d < HE_RADIUS && lineClear(pos.x, pos.z, P.x, P.z)) {
      const r = armorSplit(heDamage(d), 0.57, P.armor);
      P.armor = Math.round(r.armor);
      if (r.health >= 1) damagePlayer(Math.round(r.health), false, pos, 'HE Grenade', owner === 'bot' ? GRENADES.he.kill : 0);
      P.punchP += 0.05;
    }
  }
  if (bot.alive && live) {
    const d = Math.hypot(pos.x - bot.x, pos.y - 1, pos.z - bot.z);
    if (d < HE_RADIUS && lineClear(pos.x, pos.z, bot.x, bot.z)) {
      const r = armorSplit(heDamage(d), 0.57, bot.armor);
      bot.armor = Math.round(r.armor);
      if (r.health >= 1) {
        bot.takeDamage(Math.round(r.health), pos.x, pos.z);
        if (bot.hp <= 0 && bot.alive) killBot('HE Grenade', false, owner === 'player' ? GRENADES.he.kill : 0);
      }
    }
  }
}

const FIRE_DPS = 22, FIRE_R = 2.4;
function startFire(pos, owner) {
  sfx.fire({ x: pos.x, z: pos.z });
  for (const s of fx.smokes) if (Math.hypot(s.x - pos.x, s.z - pos.z) < 2.6 && s.t > 0.5) return;   // smoke smothers it at once
  const f = fx.addFire(pos.x, pos.z, 7, FIRE_R);
  f.owner = owner; f.acc = { p: 0, b: 0 };
}
function extinguishAt(x, z, r) { for (const f of fx.fires) if (Math.hypot(f.x - x, f.z - z) < r + f.radius * 0.5) f.life = Math.min(f.life, f.t + 0.7); }

function updateFires(dt) {
  for (const f of fx.fires) {
    if (f.strength < 0.4) continue;
    for (const s of fx.smokes) if (s.t > 0.5 && Math.hypot(s.x - f.x, s.z - f.z) < 2.2) f.life = Math.min(f.life, f.t + 0.7);
    if (P.alive && P.y < 1 && Math.hypot(P.x - f.x, P.z - f.z) < f.radius) {
      f.acc.p += FIRE_DPS * dt;
      if (f.acc.p >= 4) { const h = Math.floor(f.acc.p); f.acc.p -= h; damagePlayer(h, false, { x: f.x, z: f.z }, f.owner === 'player' ? 'Fire' : 'Fire', f.owner === 'bot' ? 300 : 0); }
    }
    if (bot.alive && game.phase === 'live' && Math.hypot(bot.x - f.x, bot.z - f.z) < f.radius) {
      f.acc.b += FIRE_DPS * dt;
      if (f.acc.b >= 4) {
        const h = Math.floor(f.acc.b); f.acc.b -= h;
        bot.takeDamage(h, f.x, f.z);
        if (bot.hp <= 0 && bot.alive) killBot('Fire', false, f.owner === 'player' ? 300 : 0);
      }
    }
  }
  // decoys fake a gunfight the bot can hear
  for (let i = game.decoys.length - 1; i >= 0; i--) {
    const d = game.decoys[i];
    d.t += dt; d.next -= dt; d.r = 46;
    if (d.next <= 0) { d.next = 0.12 + Math.random() * 0.45; sfx.shot(Math.random() < 0.5 ? 'ak47' : 'm4a4', { x: d.x, z: d.z }); fx.worldFlash(new THREE.Vector3(d.x, 1.2, d.z)); }
    if (d.t > d.life) game.decoys.splice(i, 1);
  }
}

game.botShoot = (b, origin, dir) => {
  const w = b.w, pellets = w.pellets || 1;
  const bp = { x: b.x, z: b.z };
  sfx.shot(b.weapon, bp);
  fx.worldFlash(new THREE.Vector3(b.x - Math.sin(b.yaw) * 0.7, 1.4, b.z - Math.cos(b.yaw) * 0.7));
  const target = P.alive ? { x: P.x, y: P.y, z: P.z, alive: true, crouch: P.crouch } : null;
  let health = 0, head = false, hit = false;
  for (let i = 0; i < pellets; i++) {
    const d = dir.clone();
    if (pellets > 1) { d.x += (Math.random() - 0.5) * w.pellet * 2; d.y += (Math.random() - 0.5) * w.pellet * 2; d.z += (Math.random() - 0.5) * w.pellet * 2; d.normalize(); }
    const res = castBullet(origin, d, target);
    if (i < 3) fx.tracer(origin.clone().addScaledVector(d, 0.5), res.point);
    if (res.kind === 'target') {
      const bd = bulletDamage(w, res.t, res.zone, P.armor, P.helmet);
      P.armor = bd.armor; health += bd.health; hit = true; head = head || res.head;
    } else if (res.kind !== 'none') {
      fx.impact(res.point, res.normal, true);
      // near misses are loud: flinch the camera slightly
      if (i === 0 && distPointRay(P, origin, d, res.t) < 1.2) { P.punchP += 0.004; P.punchY += (Math.random() - 0.5) * 0.01; }
    }
  }
  if (hit) damagePlayer(health, head, bp, w.name, w.kill);
};
function distPointRay(p, o, d, tMax) {
  const t = Math.max(0, Math.min(tMax, (p.x - o.x) * d.x + (P.y + 1.4 - o.y) * d.y + (p.z - o.z) * d.z));
  return Math.hypot(o.x + d.x * t - p.x, o.y + d.y * t - (P.y + 1.4), o.z + d.z * t - p.z);
}

// ------------------------------------------------------------------ buy wheel + weapon wheel
// One radial menu serves both: B opens the buy wheel (two levels), holding C opens the weapon wheel.
const wheel = { mode: null, stage: 'cat', cat: null, items: [], vx: 0, vy: 0, sel: -1, els: [] };
const wheelEl = $('wheel');
const WHEEL_R = 205;

// CS:GO armor pricing: the helmet upgrade is $350 over any kevlar, and just $650 to refill kevlar when you already have the helmet
const priceOf = (it) => (it.id === 'helmet' && P.armor > 0 ? (P.helmet ? 650 : 350) : it.price);
function canBuy() {
  if (!P.alive) return false;
  if (game.phase === 'freeze') return true;
  return game.phase === 'live' && game.liveT < 6 && Math.hypot(P.x - game.spawn.x, P.z - game.spawn.z) < 9;
}
function buyCheck(it) {
  if (!canBuy()) return 'Buy time is over';
  if (it.side && it.side !== mySide()) return `${it.name} is not available on your side`;
  if (P.money < priceOf(it)) return 'Not enough money';
  if (it.kind === 'weapon' && (P.primary === it.id || P.secondary === it.id || (it.id === 'zeus' && P.zeus))) return `Already carrying ${it.name}`;
  if (it.id === 'kevlar' && P.armor >= 100) return 'Already wearing armor';
  if (it.id === 'helmet' && P.armor >= 100 && P.helmet) return 'Already wearing a helmet';
  if (it.kind === 'grenade') {
    if (P.grenades[it.id] >= GRENADES[it.id].max) return `Already carrying the maximum ${it.name}`;
    if (grenadeCount() >= 4) return 'Cannot carry more grenades';
  }
  return null;
}
function purchase(it) {
  const why = buyCheck(it);
  if (why) { feed(why); sfx.deny(); return false; }
  const price = priceOf(it);
  P.money -= price; cashLine(-price, it.name); sfx.buy();
  if (it.kind === 'weapon') {
    if (it.id === 'zeus') { P.zeus = true; selectWeapon('zeus'); }
    else { giveGun(it.id); if (P.cur !== it.id) { P.last = P.cur; P.cur = it.id; } P.switchT = 0.45; P.reloadT = 0; P.zoomLvl = 0; }
  } else if (it.kind === 'gear') {
    P.armor = 100; if (it.id === 'helmet') P.helmet = true;
  } else P.grenades[it.id]++;
  return true;
}

function wheelItems() {
  if (wheel.mode === 'buy') {
    if (wheel.stage === 'cat') {
      const rep = { pistols: 'deagle', smgs: 'mp7', rifles: 'ak47', heavy: 'nova', gear: 'helmet', grenades: 'he' };
      return CATEGORIES.map((c) => ({ key: c.id, icon: rep[c.id], label: c.name, sub: `${SHOP.filter((s) => s.cat === c.id && (!s.side || s.side === mySide())).length} items`, kind: 'cat' }));
    }
    return SHOP.filter((s) => s.cat === wheel.cat).map((s) => {
      const off = !!s.side && s.side !== mySide();
      const price = priceOf(s);
      return { key: s.id, label: s.name, sub: off ? `${s.side} only` : `$${price}`, item: s, off: off || P.money < price, own: s.kind === 'weapon' ? (P.primary === s.id || P.secondary === s.id || (s.id === 'zeus' && P.zeus)) : s.kind === 'grenade' ? P.grenades[s.id] > 0 : (s.id === 'kevlar' ? P.armor >= 100 : P.helmet), kind: 'item' };
    });
  }
  const list = [];
  if (P.primary) list.push(P.primary);
  if (P.secondary) list.push(P.secondary);
  list.push('knife');
  for (const id of GRENADE_ORDER) if (P.grenades[id] > 0) list.push(id);
  if (P.zeus) list.push('zeus');
  return list.map((id) => {
    const it = itemOf(id), a = P.ammo[id];
    return { key: id, label: it.name, sub: a ? `${a.mag}/${a.reserve}` : isGrenadeId(id) ? `x${P.grenades[id]}` : '', kind: 'inv', own: id === P.cur };
  });
}

function wheelRender() {
  for (const el of wheel.els) el.remove();
  wheel.els = [];
  wheel.items = wheelItems();
  const n = wheel.items.length;
  wheel.items.forEach((it, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
    const el = document.createElement('div');
    el.className = 'wi' + (it.off ? ' off' : '') + (it.own ? ' own' : '');
    el.style.left = `calc(50% + ${(Math.cos(a) * WHEEL_R).toFixed(1)}px)`;
    el.style.top = `calc(50% + ${(Math.sin(a) * WHEEL_R).toFixed(1)}px)`;
    const pic = icons[it.icon || it.key];
    el.innerHTML = `<i>${i + 1}</i>${pic ? `<img src="${pic}" alt="" draggable="false">` : ''}<span>${it.label}</span><small>${it.sub}</small>`;
    wheelEl.appendChild(el); wheel.els.push(el);
  });
  wheelSelect(-1);
}
function wheelSelect(i) {
  wheel.sel = i;
  wheel.els.forEach((el, k) => el.classList.toggle('sel', k === i));
  const it = wheel.items[i];
  const title = wheel.mode === 'buy' ? (wheel.stage === 'cat' ? 'BUY' : CATEGORIES.find((c) => c.id === wheel.cat).name.toUpperCase()) : 'WEAPONS';
  const big = $('wbig'), pic = it && icons[it.icon || it.key];
  if (pic) big.src = pic; else big.removeAttribute('src');
  $('wtitle').textContent = it ? it.label : title;
  $('wsub').textContent = it ? (it.item ? (it.off && it.item.side && it.item.side !== mySide() ? 'Other team only' : it.own ? 'Owned' : '') : '') : (wheel.mode === 'buy' ? 'Aim, click. RMB: back' : 'Release to select');
  $('wprice').textContent = it && it.item ? `$${priceOf(it.item)}` : wheel.mode === 'buy' ? `$${P.money}` : '';
}
function wheelOpen(mode) {
  if (wheel.mode || !P.alive) return;
  if (mode === 'buy' && !canBuy()) { feed('Buy time is over'); sfx.deny(); return; }
  wheel.mode = mode; wheel.stage = 'cat'; wheel.cat = null; wheel.vx = wheel.vy = 0;
  wheelEl.classList.add('on');
  mouse.l = mouse.r = false;
  wheelRender();
}
function wheelClose() {
  wheel.mode = null; wheelEl.classList.remove('on');
  for (const el of wheel.els) el.remove();
  wheel.els = [];
}
function wheelBack() {
  if (wheel.mode === 'buy' && wheel.stage === 'items') { wheel.stage = 'cat'; wheel.vx = wheel.vy = 0; wheelRender(); } else wheelClose();
}
function wheelMove(dx, dy) {
  wheel.vx += dx; wheel.vy += dy;
  const L = Math.hypot(wheel.vx, wheel.vy), max = 170;
  if (L > max) { wheel.vx *= max / L; wheel.vy *= max / L; }
  $('wdot').style.transform = `translate(${wheel.vx}px, ${wheel.vy}px)`;
  const n = wheel.items.length;
  let idx = -1;
  if (L > 50 && n) {
    const ang = (Math.atan2(wheel.vy, wheel.vx) + Math.PI / 2 + Math.PI * 4) % (Math.PI * 2);
    idx = Math.round(ang / ((Math.PI * 2) / n)) % n;
  }
  if (idx !== wheel.sel) { wheelSelect(idx); if (idx >= 0) sfx.tick(); }
}
// confirm the highlighted slice (click or number key)
function wheelPick(i) {
  const it = wheel.items[i];
  if (!it) return;
  if (wheel.mode === 'buy') {
    if (it.kind === 'cat') { wheel.stage = 'items'; wheel.cat = it.key; wheel.vx = wheel.vy = 0; wheelRender(); sfx.tick(); }
    else { purchase(it.item); wheelRender(); wheelSelect(i); }
  } else { selectWeapon(it.key); wheelClose(); }
}

// ------------------------------------------------------------------ rounds
function setupSides() {
  // first half you are T, then sides swap for the second half (and stay put for a deciding round)
  const playerT = game.round <= HALF;
  game.sideT = playerT;
  const ps = playerT ? SPAWNS.T : SPAWNS.CT, bs = playerT ? SPAWNS.CT : SPAWNS.T;
  return { ps, bs, pYaw: playerT ? 0 : Math.PI, bYaw: playerT ? Math.PI : 0 };
}

function startRound() {
  game.round++;
  wheelClose();
  const { ps, bs, pYaw, bYaw } = setupSides();
  const reset = game.round === 1 || game.round === HALF + 1;      // pistol rounds: everything resets
  fx.clear(); clearDrops();
  for (const g of grenades) scene.remove(g.mesh);
  grenades.length = 0; game.decoys.length = 0;
  if (reset) { P.money = START_MONEY; bot.money = START_MONEY; game.streak.p = game.streak.b = 0; }
  if (reset || !game.pAlive) resetLoadout();
  if (reset || !game.bAlive) bot.defaultLoadout(botSide());
  // no ammo purchases in this mode, so every carried gun starts the round with a full magazine and full reserve
  for (const id of [P.primary, P.secondary]) if (id) P.ammo[id] = fresh(id);
  for (const id of bot.dropIds()) bot.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  bot.side = botSide();
  Object.assign(P, {
    x: ps.x, z: ps.z, y: 0, vx: 0, vz: 0, vy: 0, yaw: pYaw, pitch: 0, punchP: 0, punchY: 0, hp: 100, alive: true,
    cur: bestWeapon(), last: 'knife', switchT: 0.4, nextFire: 0, reloadT: 0, spray: 0, melee: null, throwing: null,
    flashT: 0, flashDur: 0, flashFull: 0, noiseT: 0, noise: 0, ads: 0, zoomLvl: 0, rescope: 0, fov: FOV, zeusT: 0, inspect: null, crouch: 0, eyeY: 1.7,
  });
  bot.setDifficulty(settings.diff);
  bot.reset(bs.x, bs.z, bYaw);
  rollBotSkin();
  bot.buy(botSide(), reset ? 1 : game.round);
  game.spawn = { x: ps.x, z: ps.z };
  game.phase = 'freeze'; game.t = DEBUG ? 0.01 : 9; game.live = false; game.roundT = 75; game.seeBotT = 0; game.liveT = 0;
  const half = game.round === HALF + 1;
  setMsg(half ? 'Halftime' : `Round ${game.round}`, `${half ? 'Sides swapped, money reset. ' : ''}You are ${game.sideT ? 'T (bottom spawn)' : 'CT (top spawn)'}. Press B to buy`);
}

const lossBonus = (streak) => Math.min(3400, 1400 + 500 * Math.min(streak, 4));

function endRound(winner, reason) {
  if (game.phase === 'over') return;
  game.phase = 'over'; game.live = false; game.t = 3.2;
  game.pAlive = P.alive; game.bAlive = bot.alive;
  wheelClose();
  let note = '';
  const st = game.streak;
  if (winner === 'player') {
    game.score.p++; sfx.win();
    addMoney(WIN_REWARD, 'Round won');
    bot.money = Math.min(MAX_MONEY, bot.money + lossBonus(st.b)); st.b++; st.p = Math.max(0, st.p - 1);
    note = `+$${WIN_REWARD}`;
  } else if (winner === 'bot') {
    game.score.b++; sfx.lose();
    const lb = lossBonus(st.p);
    addMoney(lb, 'Loss bonus'); st.p++;
    bot.money = Math.min(MAX_MONEY, bot.money + WIN_REWARD); st.b = Math.max(0, st.b - 1);
    note = `+$${lb} loss bonus`;
  }
  if (game.score.p >= TARGET || game.score.b >= TARGET) {
    game.matchOver = true;
    const win = game.score.p > game.score.b;
    store.set(win ? 'wins' : 'losses', +store.get(win ? 'wins' : 'losses', 0) + 1);
    $('lw').textContent = `${store.get('wins', 0)} WINS`; $('ll').textContent = `${store.get('losses', 0)} LOSSES`;
    setMsg(win ? 'VICTORY' : 'DEFEAT', `${game.score.p} - ${game.score.b}   Click or press Enter to play again`);
    game.t = 1e9;
  } else {
    setMsg(winner === 'player' ? 'Round won' : 'Round lost', `${reason}   ${note}`);
  }
}

function restartMatch() {
  game.score.p = game.score.b = 0; game.round = 0; game.matchOver = false; game.pAlive = game.bAlive = false;
  startRound();
}

// ------------------------------------------------------------------ update
let stepClock = 0;
function updatePlayer(dt) {
  const can = P.alive && game.phase === 'live';
  P.walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
  P.punchP *= Math.exp(-dt * 6); P.punchY *= Math.exp(-dt * 6);
  P.spray = Math.max(0, P.spray - dt * (curW()?.auto ? 7 : 5));
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
  // hold Ctrl or X to crouch: lower view, slower, quieter and a smaller target
  const wantCrouch = (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyX')) ? 1 : 0;
  P.crouch += (wantCrouch - P.crouch) * Math.min(1, dt * 12);
  if (Math.abs(P.crouch - wantCrouch) < 0.01) P.crouch = wantCrouch;
  P.eyeY = 1.7 - 0.45 * P.crouch;
  let wm = (curW()?.speed ?? 1) * (P.walking ? 0.5 : 1) * (1 - 0.62 * P.crouch);
  if (scopedNow()) wm *= 0.7; else if (P.ads > 0.5) wm *= 0.88;
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
      if (!P.walking && P.crouch < 0.5) { sfx.step(null, 0.5); if (P.noiseT <= 0) { P.noiseT = 0.2; P.noiseR = 14; } }
    }
  }
  vmAnim.bob += dt * P.speed * 1.6;
}

// aim-down-sights / scope state, runs every frame so the zoom eases in and out
function updateAds(dt) {
  if (P.inspect) { P.inspect.t += dt; if (P.inspect.t >= P.inspect.dur || !P.alive || mouse.r || P.reloadT > 0) P.inspect = null; }
  const w = curW();
  const gun = P.alive && gunNow() && !wheel.mode;
  const scopedGun = gun && !!w.zoom;
  const want = gun && P.switchT <= 0 && P.reloadT <= 0 && (scopedGun ? P.zoomLvl > 0 : mouse.r) ? 1 : 0;
  if (scopedGun && P.zoomLvl > 0 && (P.reloadT > 0 || P.switchT > 0)) P.zoomLvl = 0;
  P.ads += (want - P.ads) * Math.min(1, dt * (scopedGun ? 14 : 10));
  if (Math.abs(P.ads - want) < 0.01) P.ads = want;
  let target = FOV;
  if (gun && P.ads > 0) target = scopedGun && P.zoomLvl > 0 ? w.zoom[P.zoomLvl - 1] : FOV + (w.adsFov - FOV) * P.ads;
  P.fov += (target - P.fov) * Math.min(1, dt * 14);
  if (Math.abs(camera.fov - P.fov) > 0.01) { camera.fov = P.fov; camera.updateProjectionMatrix(); }
  // bolt-action: bring the scope back once the bolt has cycled
  if (P.rescope && P.nextFire <= 0 && gun) { P.zoomLvl = P.rescope; P.rescope = 0; }
}

function toggleZoom() {
  const w = curW();
  if (!P.alive || !gunNow() || !w.zoom || P.reloadT > 0 || P.switchT > 0 || wheel.mode || game.phase === 'over') return;
  P.zoomLvl = (P.zoomLvl + 1) % (w.zoom.length + 1);
  P.rescope = 0;
  sfx.zoom();
}

function updateWeapons(dt) {
  if (!P.alive || game.phase !== 'live') { P.melee = null; return; }
  const w = curW() ?? {};   // grenades have no entry in the weapon table
  const a = P.ammo[P.cur];
  // reload completion (shotguns load one shell at a time and can be interrupted by firing)
  if (P.reloadT > 0 && w.mag && a) {
    if (w.shell) {
      if (mouse.l && a.mag > 0 && !wheel.mode) P.reloadT = 0;
      else {
        P.reloadT -= dt;
        if (P.reloadT <= 0) { a.mag++; a.reserve--; sfx.cycle(); if (a.mag < w.mag && a.reserve > 0) P.reloadT = w.reload; }
      }
    } else {
      P.reloadT -= dt;
      if (P.reloadT <= 0) { const n = Math.min(w.mag - a.mag, a.reserve); a.mag += n; a.reserve -= n; }
    }
  }
  // knife
  if (P.melee) {
    P.melee.t += dt;
    if (!P.melee.done && P.melee.t >= P.melee.hitAt) { P.melee.done = true; meleeHit(P.melee.type); }
    if (P.melee.t >= P.melee.dur) P.melee = null;
  }
  // zeus: single use, put away after the zap
  if (P.zeusT > 0) {
    P.zeusT -= dt;
    if (P.zeusT <= 0) { P.cur = bestWeapon(); P.switchT = 0.4; }
    return;
  }
  // grenade throw animation
  if (P.throwing) {
    P.throwing.t += dt;
    if (!P.throwing.thrown && P.throwing.t >= 0.28) { P.throwing.thrown = true; throwFromPlayer(P.throwing.kind, P.throwing.soft); }
    if (P.throwing.t >= 0.6) {
      const back = P.last && owns(P.last) && !isGrenadeId(P.last) ? P.last : bestWeapon();
      P.throwing = null; P.cur = back; P.last = P.last === back ? 'knife' : P.last;
      P.switchT = 0.4;
    }
    return;
  }
  if (P.switchT > 0) return;
  const fire = mouse.l && !wheel.mode, alt = mouse.r && !wheel.mode;
  if (P.inspect && (fire || alt)) P.inspect = null;
  if (w.melee) {
    if (fire) meleeStart('slash'); else if (alt) meleeStart('stab');
  } else if (P.cur === 'zeus') {
    if (fire && P.nextFire <= 0) zeusFire();
  } else if (isGrenadeId(P.cur)) {
    if ((fire || alt) && P.grenades[P.cur] > 0) P.throwing = { kind: P.cur, t: 0, thrown: false, soft: !fire };
  } else if (P.reloadT <= 0) {
    if (fire && P.nextFire <= 0) {
      if (isAuto(w) || !pressedFire) playerShoot();
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
    else if (n !== game._lastN) { game._lastN = n; if (n <= 3) sfx.beep(660, 0.08); }
  } else if (game.phase === 'live') {
    game.roundT -= dt; game.liveT += dt;
    // no bomb in a duel: when time runs out the CT side wins, as it does when the bomb is never planted
    if (game.roundT <= 0) endRound(game.sideT ? 'bot' : 'player', 'Time expired: CT wins');
    if (wheel.mode === 'buy' && !canBuy()) wheelClose();
  } else if (game.phase === 'over') {
    game.t -= dt;
    if (game.t <= 0 && !game.matchOver) startRound();
  }

  updatePlayer(dt);
  updateAds(dt);
  updateWeapons(dt);
  updateGrenades(dt);
  updateFires(dt);
  bot.update(dt, game);
  fx.update(dt);
  for (const id in vm) if (vm[id].flash) flashTick(vm[id].flash, dt);
  if (vmLight.intensity > 0 && (vmLight.userData.t -= dt) <= 0) vmLight.intensity = 0;
  for (const d of drops) { d.t += dt; d.mesh.rotation.y += dt * 0.8; d.mesh.position.y = 0.3 + Math.sin(d.t * 2) * 0.05; }

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
// ------------------------------------------------------------------ third person (F5)
// F5 cycles first person -> behind you -> in front of you. Your own body is only built and drawn in third person.
let frameDt = 0.016;
// Where the held weapon sits relative to the body (per weapon id). Edited live in the menu's "Adjust held weapon" panel and
// saved in localStorage; the numbers it copies can be pasted back here as new defaults.
const DEF_HOLD = { x: 0.5, y: 0.22, z: -0.58, rx: 0, ry: 0, rz: 0, s: 1.4 };   // taken from the USP-S placement you tuned; every weapon starts here
let holdTune = {};
try {
  const r = await fetch('./assets/hold.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('no hold.json');
  holdTune = await r.json();
} catch {
  try { holdTune = JSON.parse(store.get('holdtune', '{}')) || {}; } catch { holdTune = {}; }
}
const holdOf = (id) => ({ ...DEF_HOLD, ...(holdTune[id] || {}) });
function placeHeld(obj, id) {
  const h = holdOf(id);
  obj.position.set(h.x, h.y, h.z); obj.rotation.set(h.rx, h.ry, h.rz); obj.scale.setScalar(h.s);
}
const pBody = { group: new THREE.Group(), aim: new THREE.Group(), skin: null, name: null, loading: null, item: null, itemId: null, rest: null };
// the torso's position in the body group's own frame; the held weapon follows how far it has moved from standing still
const torsoLocal = (out) => { const t = pBody.skin.obj.getObjectByName('torso'); pBody.group.updateMatrixWorld(true); t.getWorldPosition(out); return pBody.group.worldToLocal(out); };
pBody.group.visible = false; pBody.group.add(pBody.aim); scene.add(pBody.group);
async function ensurePlayerBody() {
  const name = currentSkinName();
  if (pBody.name === name || pBody.loading === name) return;
  pBody.loading = name;
  try {
    const s = await loadCharacter(name);
    if (currentSkinName() !== name) s.dispose();
    else {
      pBody.skin?.dispose(); pBody.skin = s; pBody.name = name; pBody.group.add(s.root);
      s.play('Idle'); s.crouchK = 0; s.update(0); pBody.rest = torsoLocal(new THREE.Vector3());
    }
  } catch (e) { console.warn('player body failed', name, e); }
  pBody.loading = null;
}
function updatePlayerBody(show) {
  pBody.group.visible = show && !!pBody.skin;
  if (!show) return;
  ensurePlayerBody();
  const s = pBody.skin;
  if (!s) return;
  pBody.group.position.set(P.x, P.y, P.z);
  pBody.group.rotation.y = P.yaw;
  if (!P.alive) s.play('Death', { loop: false, fade: 0.1 });
  else if (P.speed > 3.6) s.play('Run_Carry', { speed: Math.min(1.3, P.speed / 5) });
  else if (P.speed > 0.4) s.play('Walk_Carry', { speed: Math.max(0.6, P.speed / 3) });
  else s.play('Idle');
  s.crouchK = P.alive ? P.crouch : 0;
  s.update(frameDt);
  if (pBody.itemId !== P.cur) {
    if (pBody.item) pBody.aim.remove(pBody.item);
    pBody.item = buildItemModel(P.cur);
    pBody.aim.add(pBody.item); pBody.itemId = P.cur;
  }
  placeHeld(pBody.item, P.cur);
  pBody.aim.visible = P.alive;
  // ride the torso: walking bob and crouching move the body, so the weapon moves with it instead of staying at a fixed height
  const t = torsoLocal(new THREE.Vector3());
  pBody.aim.position.set(t.x - pBody.rest.x, 1.1 + t.y - pBody.rest.y, -0.1 + t.z - pBody.rest.z);
  pBody.aim.rotation.x = P.pitch;
}

function renderView() {
  const tpp = view3 > 0 && !scopedNow() && !params.has('top');
  let eyeY = P.y + P.eyeY, tilt = 0;
  if (!P.alive) { eyeY = Math.max(0.3, P.y + 0.3); tilt = 0.5; }
  const pitch = Math.max(-1.55, Math.min(1.55, P.pitch + P.punchP)), yaw = P.yaw + P.punchY;
  if (tpp) {
    // pull the camera back along the view direction, stopping short of walls
    const D = 2.4, sgn = view3 === 1 ? -1 : 1;
    const f = forwardVec(yaw, pitch, new THREE.Vector3());
    const hx = f.x * sgn, hz = f.z * sgn, hLen = Math.hypot(hx, hz) * D;
    let k = 1;
    if (hLen > 1e-3) { const hit = raycast(P.x, P.z, hx, hz, hLen + 0.3); if (hit < hLen + 0.3) k = Math.max(0.12, (hit - 0.3) / hLen); }
    const ey = P.alive ? eyeY : P.y + 1.2;
    let cx = P.x + f.x * sgn * D * k, cz = P.z + f.z * sgn * D * k;
    if (view3 === 1) {
      // over the shoulder: slide the camera right so your body sits left of the crosshair
      const rx = Math.cos(yaw), rz = -Math.sin(yaw), side = Math.max(0, Math.min(0.65, raycast(cx, cz, rx, rz, 0.9) - 0.25));
      cx += rx * side; cz += rz * side;
    }
    camera.position.set(cx, Math.max(0.25, ey + f.y * sgn * D * k + (view3 === 1 ? 0.15 : 0)), cz);
    camera.rotation.set(view3 === 1 ? pitch : -pitch, view3 === 1 ? yaw : yaw + Math.PI, 0);
  } else {
    camera.position.set(P.x, eyeY, P.z);
    camera.rotation.set(pitch, yaw, tilt);
  }
  updatePlayerBody(tpp);
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
  if (scopedNow() || tpp) return;     // looking through the scope, or seeing your own body: no viewmodel

  // viewmodel pass
  renderer.clearDepth();
  const cur = getVm(P.cur);
  for (const id in vm) vm[id].group.visible = id === P.cur;
  const bp = vmPosOf(P.cur);
  const adsK = P.ads * P.ads * (3 - 2 * P.ads);
  const bob = Math.sin(vmAnim.bob * 2) * 0.004 * Math.min(1, P.speed / 5) * (1 - adsK), bobY = Math.abs(Math.sin(vmAnim.bob)) * 0.005 * Math.min(1, P.speed / 5) * (1 - adsK);
  vmAnim.kick = Math.max(0, vmAnim.kick - 0.016 * 9);
  const g = vmRoot;
  g.scale.setScalar(1.25);
  // aiming down sights slides the gun to the centre of the view so the sights line up with the crosshair
  const adsX = 0, adsY = -(cur.sightY ?? 0.055) * 1.25 - 0.004;
  g.position.set(bp[0] * 0.9 * (1 - adsK) + adsX * adsK + bob, (bp[1] + 0.01 - bobY) * (1 - adsK) + adsY * adsK, bp[2] + vmAnim.kick * 0.045 * (1 - adsK * 0.5));
  g.rotation.set(vmAnim.kick * 0.09 * (1 - adsK * 0.5), -0.03 * (1 - adsK), 0);
  if (P.cur === 'knife') {
    if (knifeStyle.kind === 'karambit') { g.rotation.y -= 1.15; g.rotation.x += 0.08; g.rotation.z += 0.08; g.position.x -= 0.15; g.position.y += 0.07; g.position.z += 0.03; }   // held across the view, hook curling up to the right
    else { g.rotation.y += 0.55; g.rotation.x += 0.42; g.rotation.z -= 0.12; g.position.x -= 0.04; g.position.y += 0.03; }
  }
  if (P.switchT > 0) { const r = P.switchT / 0.45; g.position.y -= 0.3 * r; g.rotation.x -= 0.9 * r; }
  if (P.reloadT > 0 && gunNow()) {
    const total = curW().reload, p = 1 - P.reloadT / total, s = Math.sin(Math.PI * Math.min(1, p));
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
  if (P.inspect) {
    const q = P.inspect.t / P.inspect.dur, env = Math.sin(Math.PI * Math.min(1, q)) ** 0.6, sw = Math.sin(q * Math.PI * 2);
    if (P.cur === 'knife') {
      // flip the blade over in the hand
      const flip = q < 0.15 ? 0 : q > 0.85 ? 1 : (q - 0.15) / 0.7;
      g.rotation.z -= env * 0.5 + (flip * flip * (3 - 2 * flip)) * Math.PI * 2;
      g.rotation.y += env * 0.7; g.rotation.x += env * 0.35 + sw * 0.12;
      g.position.x -= env * 0.1; g.position.y += env * 0.06; g.position.z += env * 0.08;
    } else {
      // turn the weapon to show its side, roll it slowly, then bring it back
      // (muzzle swings to the left so the gun's left side faces you, as in CS:GO)
      g.rotation.y += env * 0.95 + sw * 0.1;
      g.rotation.z -= env * 0.32 + Math.sin(q * Math.PI * 2 * 1.5) * 0.18 * env;
      g.rotation.x += env * 0.18 + sw * 0.1 * env;
      g.position.x -= env * 0.05; g.position.y += env * 0.035; g.position.z += env * 0.07;
    }
  }
  renderer.render(vmScene, vmCam);
}

// ------------------------------------------------------------------ input
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.target.tagName === 'INPUT') return;   // typing a name must not trigger game keys
  if (e.code === 'F5' && game.round && (game.locked || DEBUG)) { e.preventDefault(); view3 = (view3 + 1) % 3; return; }
  keys.add(e.code);
  if (e.code === 'Space' || (e.ctrlKey && game.locked)) e.preventDefault();
  if (!game.round || (!game.locked && !DEBUG)) return;
  const digit = /^Digit(\d)$/.exec(e.code);
  if (wheel.mode) {
    if (digit) { const n = +digit[1]; wheelPick(n === 0 ? 9 : n - 1); return; }
    if (e.code === 'KeyB' && wheel.mode === 'buy') { wheelClose(); return; }
    return;
  }
  if (digit && +digit[1] >= 1 && +digit[1] <= 5) selectSlot(+digit[1]);
  else if (e.code === 'KeyR') startReload();
  else if (e.code === 'KeyF') startInspect();
  else if (e.code === 'KeyQ' && P.last) selectWeapon(P.last);
  else if (e.code === 'KeyB') wheelOpen('buy');
  else if (e.code === 'KeyC') wheelOpen('inv');
  else if (e.code === 'KeyE') pickUp();
  else if (e.code === 'KeyG') dropCurrent();
  else if (e.code === 'Enter' && game.matchOver) restartMatch();
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyC' && wheel.mode === 'inv') {
    const i = wheel.sel;
    if (i >= 0) wheelPick(i); else wheelClose();
  }
});
window.addEventListener('blur', () => { keys.clear(); mouse.l = mouse.r = false; if (wheel.mode === 'inv') wheelClose(); });
window.addEventListener('mousedown', (e) => {
  if (!game.locked && !DEBUG) return;
  if (game.matchOver) { restartMatch(); return; }
  if (wheel.mode) {
    if (e.button === 0) { if (wheel.sel >= 0) wheelPick(wheel.sel); }
    else if (e.button === 2) wheelBack();
    return;
  }
  if (e.button === 0) mouse.l = true;
  if (e.button === 2) { mouse.r = true; toggleZoom(); }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => {
  if (!game.locked || !game.round || wheel.mode || !P.alive) return;
  cycleWeapon(e.deltaY > 0 ? 1 : -1);
}, { passive: true });
window.addEventListener('mousemove', (e) => {
  if (!game.locked) return;
  if (wheel.mode) { wheelMove(e.movementX, e.movementY); return; }
  // turn rate scales with zoom so a scoped view does not feel twitchy
  const zoom = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((FOV * Math.PI) / 360);
  const k = 0.0022 * settings.sens * zoom;
  P.yaw -= e.movementX * k;
  P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - e.movementY * k));
});

const menu = $('menu');
const DIFFS = ['easy', 'normal', 'hard'];
// Tracking mode: bots and you both have far more effective health, there is no recoil, spread is tight and most guns are
// full auto, so fights are won by keeping the crosshair on a strafing target rather than by one-tap flicks.
const modeLabel = () => `Mode: ${settings.mode === 'tracking' ? 'Tracking' : 'Classic'}`;
function applyMode() {
  const t = settings.mode === 'tracking';
  Object.assign(tuning, t ? { dmg: 0.3, spread: 0.35, recoil: 0, strafe: 0.5, auto: true } : { dmg: 1, spread: 1, recoil: 1, strafe: 1, auto: false });
  for (const id in WEAPONS) { const w = WEAPONS[id]; if (w.headMult) { w.hm0 ??= w.headMult; w.headMult = t ? 1.7 : w.hm0; } }
  $('ehp').classList.toggle('hidden', !t);
}
$('modelbl').textContent = modeLabel();
$('modebtn').addEventListener('click', () => {
  settings.mode = settings.mode === 'tracking' ? 'classic' : 'tracking';
  store.set('mode', settings.mode);
  $('modelbl').textContent = modeLabel();
  applyMode();
});
applyMode();
const diffLabel = () => `Difficulty: ${settings.diff[0].toUpperCase()}${settings.diff.slice(1)}`;
$('difflbl').textContent = diffLabel();
$('diffbtn').addEventListener('click', () => {
  settings.diff = DIFFS[(DIFFS.indexOf(settings.diff) + 1) % DIFFS.length];
  store.set('diff', settings.diff);
  $('difflbl').textContent = diffLabel();
  bot.setDifficulty(settings.diff);
});
// abandon the current match and go back to the start screen
function quitToMenu() {
  wheelClose();
  game.round = 0; game.phase = 'menu'; game.live = false; game.matchOver = false; game.pAlive = game.bAlive = false;
  game.score.p = game.score.b = 0; game.decoys.length = 0;
  fx.clear(); clearDrops();
  for (const g of grenades) scene.remove(g.mesh);
  grenades.length = 0;
  keys.clear(); mouse.l = mouse.r = false; msgText = ''; setMsg(''); setPrompt('');
  P.zoomLvl = 0; P.ads = 0; P.fov = FOV; camera.fov = FOV; camera.updateProjectionMatrix();
  bot.model.root.visible = false;
  $('quitbtn').classList.add('hidden'); $('picker').classList.remove('hidden'); $('nametag').classList.remove('hidden'); $('kpicker').classList.remove('hidden'); $('kcolors').classList.remove('hidden');
  $('spinhint').style.display = ''; $('playlbl').textContent = 'Deploy';
}
$('quitbtn').addEventListener('click', quitToMenu);
$('infobtn').addEventListener('click', () => { $('controls').classList.toggle('hidden'); menu.classList.toggle('ctl'); });

function lockChange() {
  game.locked = document.pointerLockElement === canvas;
  menu.classList.toggle('hidden', game.locked);
  if (!game.locked) {
    keys.clear(); mouse.l = mouse.r = false; wheelClose();
    $('playlbl').textContent = game.round && !game.matchOver ? 'Resume' : 'Deploy';
    $('quitbtn').classList.toggle('hidden', !game.round || game.matchOver);
    $('picker').classList.toggle('hidden', !!game.round && !game.matchOver);
    $('kpicker').classList.toggle('hidden', !!game.round && !game.matchOver); $('kcolors').classList.toggle('hidden', !!game.round && !game.matchOver);
    $('nametag').classList.toggle('hidden', !!game.round && !game.matchOver);
    $('spinhint').style.display = game.round && !game.matchOver ? 'none' : '';
  }
}
document.addEventListener('pointerlockchange', lockChange);

// Ctrl+W (crouch + forward) and Ctrl+1..9 are browser shortcuts a page cannot cancel. Keyboard Lock hands them to the game,
// but only in fullscreen and only in Chromium; elsewhere the leave prompt below is the safety net.
const LOCK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyE', 'KeyF', 'KeyQ', 'KeyB', 'KeyG', 'KeyC', 'KeyX',
  'ControlLeft', 'ControlRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];
function goFullscreenLocked() {
  try {
    const fs = document.fullscreenElement ? Promise.resolve() : document.documentElement.requestFullscreen();
    Promise.resolve(fs).then(() => navigator.keyboard?.lock(LOCK_KEYS)).catch(() => {});
  } catch { /* no fullscreen or keyboard lock: crouch on X instead */ }
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) navigator.keyboard?.unlock(); });
window.addEventListener('beforeunload', (e) => { if (game.round && !game.matchOver) { e.preventDefault(); e.returnValue = ''; } });
$('play').addEventListener('click', () => {
  if ($('play').disabled) return;
  initAudio();
  if (!game.round) restartMatch();
  goFullscreenLocked();
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => { $('note').textContent = 'Pointer lock was blocked by the browser. Click Deploy again.'; });
  } catch { $('note').textContent = 'Pointer lock is not available in this browser.'; }
});

$('sens').value = settings.sens; $('sensv').textContent = settings.sens.toFixed(2);
$('sens').addEventListener('input', (e) => { settings.sens = parseFloat(e.target.value); $('sensv').textContent = settings.sens.toFixed(2); store.set('sens', settings.sens); });

// ------------------------------------------------------------------ character picker (menu only)
// Your character is only ever seen here (the game is first person). Drag the backdrop to spin it.
let menuSkin = null, menuSpin = 0, skinToken = 0;
let skinIdx = Math.max(0, CHARACTERS.indexOf(store.get('skin', 'r')));
let mcName = store.get('mcuser', '');                  // an imported Minecraft username replaces the blocky picker choice
const currentSkinName = () => (mcName ? 'mc:' + mcName : CHARACTERS[skinIdx]);
async function showMenuSkin() {
  const name = currentSkinName(), tok = ++skinToken;
  $('skinlbl').textContent = mcName ? mcName : charLabel(name);
  store.set('skin', CHARACTERS[skinIdx]); store.set('mcuser', mcName);
  try {
    const s = await loadCharacter(name);
    if (tok !== skinToken) { s.dispose(); return; }
    if (menuSkin) menuSkin.dispose();
    menuSkin = s; scene.add(s.root); refreshMenuGun();
    headIcon(name).then((u) => { if (currentSkinName() === name) playerHead = u; });
  } catch (e) {
    console.warn('character failed to load', name, e);
    if (mcName && tok === skinToken) { mcName = ''; mcNote('Could not load that skin, using a default character.'); showMenuSkin(); }
  }
}
// ---- "Adjust held weapon": the menu character holds a weapon and sliders move it live
const menuHold = { aim: new THREE.Group(), item: null, id: null, open: false };
menuHold.aim.position.set(0, 1.1, -0.1);
function refreshMenuGun() {
  if (!menuSkin) return;
  menuSkin.root.add(menuHold.aim);
  menuSkin.play(menuHold.open ? 'Idle' : 'Relaxed');
  if (menuHold.item) { menuHold.aim.remove(menuHold.item); menuHold.item = null; }
  menuHold.aim.visible = menuHold.open;
  if (!menuHold.open) return;
  menuHold.item = buildItemModel(menuHold.id);
  menuHold.aim.add(menuHold.item);
  placeHeld(menuHold.item, menuHold.id);
}
{
  const ids = Object.keys(WEAPONS).filter((id) => isGun(id) || id === 'knife');
  menuHold.id = ids.includes('ak47') ? 'ak47' : ids[0];
  const SL = [['x', 'Right / left', -1.2, 1.2, 0.01], ['y', 'Up / down', -1, 1, 0.01], ['z', 'Forward / back', -1.2, 1.2, 0.01],
    ['rx', 'Tilt up / down', -3.2, 3.2, 0.02], ['ry', 'Turn left / right', -3.2, 3.2, 0.02], ['rz', 'Roll', -3.2, 3.2, 0.02], ['s', 'Size', 0.4, 3, 0.02]];
  const st = document.createElement('style');
  st.textContent = `#tune{position:fixed;right:14px;top:14px;width:290px;padding:12px;background:rgba(18,20,26,.92);color:#fff;border:2px solid #555a63;z-index:30;font:12px system-ui,sans-serif;letter-spacing:.04em}
#tune.hidden{display:none}#tune h4{margin:0 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase}
#tune label{display:grid;grid-template-columns:96px 1fr 44px;gap:6px;align-items:center;margin:4px 0}#tune select,#tune button{width:100%;margin:4px 0;padding:6px;background:#3a3e45;color:#fff;border:2px solid #555a63;font:inherit;cursor:pointer}
#tune button:hover{background:#d9731a;border-color:#fff}#tune .row2{display:flex;gap:6px}#tune small{opacity:.75;display:block;margin-top:6px}`;
  document.head.appendChild(st);
  const panel = document.createElement('div');
  panel.id = 'tune'; panel.className = 'hidden';
  panel.innerHTML = `<h4>Held weapon</h4><select id="tunew">${ids.map((id) => `<option value="${id}">${WEAPONS[id].name}</option>`).join('')}</select>` +
    SL.map(([k, name, lo, hi, step]) => `<label>${name}<input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${step}"><output data-o="${k}"></output></label>`).join('') +
    `<div class="row2"><button id="tunereset">Reset</button><button id="tunecls">Apply to same type</button></div><button id="tunecopy">Copy all values</button>` +
    `<small>Drag the background to rotate your character. Changes apply in third person.</small><small id="tunestat"></small>`;
  document.body.appendChild(panel);
  const sync = () => {
    const h = holdOf(menuHold.id);
    for (const [k] of SL) { panel.querySelector(`[data-k="${k}"]`).value = h[k]; panel.querySelector(`[data-o="${k}"]`).textContent = (+h[k]).toFixed(2); }
    $('tunew').value = menuHold.id;
  };
  // saved into assets/hold.json through devserver.py (open.py starts it); a plain static server falls back to this browser
  let saveT = 0;
  const status = (t) => { $('tunestat').textContent = t; };
  const save = () => {
    store.set('holdtune', JSON.stringify(holdTune));
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      try {
        const r = await fetch('/__save_hold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(holdTune) });
        status(r.ok ? 'Saved to assets/hold.json' : 'Save failed (' + r.status + ')');
      } catch { status('Saved in this browser only. Start the game with open.py to save into the project.'); }
    }, 300);
  };
  panel.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    holdTune[menuHold.id] = { ...holdOf(menuHold.id), [k]: parseFloat(e.target.value) };
    save(); sync();
    if (menuHold.item) placeHeld(menuHold.item, menuHold.id);
  });
  $('tunew').addEventListener('change', (e) => { menuHold.id = e.target.value; sync(); refreshMenuGun(); });
  $('tunereset').addEventListener('click', () => { delete holdTune[menuHold.id]; save(); sync(); if (menuHold.item) placeHeld(menuHold.item, menuHold.id); });
  $('tunecls').addEventListener('click', () => {
    const h = holdOf(menuHold.id), cls = WEAPONS[menuHold.id].cls;
    for (const id of ids) if (WEAPONS[id].cls === cls) holdTune[id] = { ...h };
    save();
  });
  $('tunecopy').addEventListener('click', () => {
    const text = JSON.stringify(Object.fromEntries(ids.map((id) => [id, holdOf(id)])), null, 1);
    (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(() => { $('tunecopy').textContent = 'Copied!'; }, () => { $('tunecopy').textContent = 'Copy failed (see console)'; console.log(text); });
    setTimeout(() => { $('tunecopy').textContent = 'Copy all values'; }, 1500);
  });
  if (params.has('dev')) $('tunebtn').hidden = false;      // developer tool: open the game with ?dev to see it
  window.__toggleTune = () => {
    menuHold.open = !menuHold.open;
    panel.classList.toggle('hidden', !menuHold.open);
    $('tunebtn').textContent = menuHold.open ? 'Close weapon adjuster' : 'Adjust held weapon';
    sync(); refreshMenuGun();
  };
}
$('skinprev').addEventListener('click', () => { mcName = ''; skinIdx = (skinIdx + CHARACTERS.length - 1) % CHARACTERS.length; mcNote(''); showMenuSkin(); });
$('skinnext').addEventListener('click', () => { mcName = ''; skinIdx = (skinIdx + 1) % CHARACTERS.length; mcNote(''); showMenuSkin(); });

// "Import Minecraft skin": ask for a username, load that skin onto the blocky model; an empty name keeps the defaults
function mcNote(t) { $('mcnote').textContent = t; }
function mcForm(open) {
  $('mcform').classList.toggle('hidden', !open);
  $('mcbtn').classList.toggle('hidden', open);
  if (open) { $('mcname').value = mcName; $('mcname').focus(); }
}
$('mcbtn').addEventListener('click', () => { mcNote(''); mcForm(true); });
$('mccancel').addEventListener('click', () => mcForm(false));
$('mcform').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('mcname').value.trim();
  mcForm(false);
  if (!name) { mcName = ''; mcNote('No name given, using the default characters.'); showMenuSkin(); return; }
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) { mcNote('Minecraft names are 1-16 letters, digits or underscores.'); return; }
  mcNote('Loading ' + name + '...');
  try {
    await fetchMinecraftSkin(name);
    mcName = name; mcNote(''); showMenuSkin();
  } catch { mcNote('Could not reach a skin server. Check your connection.'); }
});
{
  let drag = null;
  window.addEventListener('pointerdown', (e) => {
    if (game.locked || (game.round && !game.matchOver) || e.target.closest('.left, #nametag, #tune') || e.button !== 0) return;
    drag = e.clientX; $('menu').classList.add('spin');
  });
  window.addEventListener('pointermove', (e) => { if (drag !== null) { menuSpin += (e.clientX - drag) * 0.012; drag = e.clientX; } });
  window.addEventListener('pointerup', () => { drag = null; $('menu').classList.remove('spin'); });
}
showMenuSkin();

// knife picker: model + blade colour, with a live preview picture
const hex6 = (n) => '#' + n.toString(16).padStart(6, '0');
function applyKnife(save = true) {
  setKnifeStyle(knifeStyle.kind, knifeStyle.color);
  if (vm.knife) { vmRoot.remove(vm.knife.group); delete vm.knife; }          // rebuilt on demand with the new look
  const url = refreshIcon('knife');
  if (url) { icons.knife = url; $('knifeimg').src = url; }
  slotKey = '';
  $('knifelbl').textContent = KNIVES[knifeStyle.kind];
  $('kcolor').value = hex6(knifeStyle.color);
  for (const b of document.querySelectorAll('#kcolors .sw[data-c]')) b.classList.toggle('on', parseInt(b.dataset.c, 16) === knifeStyle.color);
  if (save) { store.set('knife', knifeStyle.kind); store.set('kcolor', hex6(knifeStyle.color)); }
}
const stepKnife = (d) => { knifeStyle.kind = KNIFE_ORDER[(KNIFE_ORDER.indexOf(knifeStyle.kind) + d + KNIFE_ORDER.length) % KNIFE_ORDER.length]; applyKnife(); };
$('knifeprev').addEventListener('click', () => stepKnife(-1));
$('knifenext').addEventListener('click', () => stepKnife(1));
for (const b of document.querySelectorAll('#kcolors .sw[data-c]')) b.addEventListener('click', () => { knifeStyle.color = parseInt(b.dataset.c, 16); applyKnife(); });
let kcolorRaf = 0;
$('kcolor').addEventListener('input', (e) => {
  knifeStyle.color = parseInt(e.target.value.replace('#', ''), 16);
  cancelAnimationFrame(kcolorRaf); kcolorRaf = requestAnimationFrame(() => applyKnife());
});
applyKnife(false);

// editable player name under the character; starts as a random handle and is remembered
const NAME_A = ['Sand', 'Dune', 'Desert', 'Dusty', 'Silent', 'Rogue', 'Iron', 'Swift', 'Lone', 'Crimson', 'Shadow', 'Rusty', 'Sly', 'Burning', 'Hollow', 'Wild'];
const NAME_B = ['Viper', 'Falcon', 'Jackal', 'Scorpion', 'Nomad', 'Ghost', 'Wolf', 'Hawk', 'Raider', 'Cobra', 'Camel', 'Sniper', 'Fox', 'Dingo', 'Bandit', 'Mirage'];
const randomName = () => NAME_A[(Math.random() * NAME_A.length) | 0] + NAME_B[(Math.random() * NAME_B.length) | 0] + ((Math.random() * 90 + 10) | 0);
const nameEl = $('uname');
nameEl.value = store.get('name', '') || randomName();
store.set('name', nameEl.value);
nameEl.addEventListener('input', () => store.set('name', nameEl.value));
nameEl.addEventListener('blur', () => { nameEl.value = nameEl.value.trim() || randomName(); store.set('name', nameEl.value); });
nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameEl.blur(); });
$('namerand').addEventListener('click', () => { nameEl.value = randomName(); store.set('name', nameEl.value); });
const tagPos = new THREE.Vector3();
function placeNameTag(x, y, z) {
  tagPos.set(x, y + 0.45, z).project(camera);          // a little above the feet; the feet are off screen when zoomed in
  $('nametag').style.left = ((tagPos.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  $('nametag').style.top = Math.min(window.innerHeight - 56, (-tagPos.y * 0.5 + 0.5) * window.innerHeight) + 'px';
}

// random enemy skin each round, never the one you picked
async function rollBotSkin() {
  const pool = mcName ? CHARACTERS : CHARACTERS.filter((n) => n !== CHARACTERS[skinIdx]);
  const name = pool[(Math.random() * pool.length) | 0];
  bot.name = randomName(); botHead = null;
  headIcon(name).then((u) => { botHead = u; });
  try { const s = await loadCharacter(name); bot.setSkin(s); } catch (e) { console.warn('bot skin failed', name, e); }
}

// ------------------------------------------------------------------ menu backdrop
// While no match is running, the camera drifts slowly across the map with a character in the foreground.
function renderMenu(now, dt = 0.016) {
  const t = now / 1000;
  const yaw = 0.62 + Math.sin(t * 0.13) * 0.3;
  camera.position.set(-8, 1.95 + Math.sin(t * 0.25) * 0.06, 33.5);
  camera.rotation.set(0.1, yaw, 0);
  camera.updateMatrixWorld();
  const p = camera.localToWorld(menuHold.open ? new THREE.Vector3(0.3, -1.45, -3.4) : new THREE.Vector3(0.85, -1.4, -1.45));   // stand back while adjusting the held weapon
  bot.model.root.visible = false;   // the opponent stays hidden until a match starts
  const facing = yaw + Math.PI - 0.2 + menuSpin;
  if (menuSkin) {
    menuChar.root.visible = false;
    menuSkin.root.visible = true;
    menuSkin.root.position.set(p.x, p.y, p.z);
    menuSkin.root.rotation.set(0, facing, 0);
    menuSkin.update(dt);
    placeNameTag(p.x, p.y, p.z);
  } else {
    menuChar.root.visible = true;
    menuChar.root.position.set(p.x, p.y + Math.sin(t * 1.8) * 0.012, p.z);
    menuChar.root.rotation.set(0, facing, 0);
    menuChar.aim.rotation.x = 0.05 + Math.sin(t * 1.4) * 0.025;
    menuChar.legL.rotation.x = menuChar.legR.rotation.x = 0;
    placeNameTag(p.x, p.y, p.z);
  }
  renderer.clear();
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; frameDt = dt;
  if ((game.locked || DEBUG) && game.round && !game.manual) update(dt);
  document.body.classList.toggle('nomatch', !game.round);
  if (!game.round && !DEBUG) renderMenu(now, dt);
  else { menuChar.root.visible = false; if (menuSkin) menuSkin.root.visible = false; updateHud(dt); renderView(); }
  requestAnimationFrame(frame);
}

// debug / test hooks (also used by the automated checks)
window.__game = {
  P, bot, game, fx, grenades, drops, camera, THREE, castBullet, rayVsTarget, flashPop, spawnGrenade, explodeHE, startFire,
  pBody, wheel, update, startRound, restartMatch, selectWeapon, selectSlot, playerShoot, applyPlayerDamage, damagePlayer, throwFromPlayer,
  purchase, giveGun, resetLoadout, addMoney, endRound, killBot, toggleZoom, wheelOpen, wheelPick, wheelMove, SHOP, WEAPONS,
  setMouse(l, r) { mouse.l = l; mouse.r = r; },
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
