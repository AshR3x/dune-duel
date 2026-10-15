// Weapon stats (CS:GO-style arsenal) and low-poly models (boxes and cylinders, no assets).
import * as THREE from 'three';
import { FBXLoader } from '../vendor/FBXLoader.js';

// ------------------------------------------------------------------ data
// price/kill in dollars; dmg = body damage at point blank; ap = armor penetration (0..1);
// rm = range modifier (damage *= rm ^ (units / 500), 1 unit = 2.54 cm); rate = seconds between shots;
// speed = movement multiplier (CS run speed / 250); zoom = FOV per scope level; side = 'T' | 'CT' | null.
const CLS = {
  pistol:  { kick: 0.028, spreadBase: 0.003,  spreadMove: 0.05,  spreadAir: 0.09, spreadShot: 0.014,  spreadMax: 0.06, adsFov: 70, adsAcc: 0.75, flash: 0.16, noise: 40 },
  smg:     { kick: 0.008, spreadBase: 0.004,  spreadMove: 0.045, spreadAir: 0.09, spreadShot: 0.003,  spreadMax: 0.05, adsFov: 68, adsAcc: 0.6,  flash: 0.17, noise: 44 },
  rifle:   { kick: 0.011, spreadBase: 0.0025, spreadMove: 0.05,  spreadAir: 0.09, spreadShot: 0.0022, spreadMax: 0.04, adsFov: 66, adsAcc: 0.55, flash: 0.18, noise: 50 },
  sniper:  { kick: 0.04,  spreadBase: 0.0008, spreadMove: 0.14,  spreadAir: 0.2,  spreadShot: 0.0,    spreadMax: 0.2,  adsFov: 66, adsAcc: 0.5,  flash: 0.24, noise: 62 },
  shotgun: { kick: 0.05,  spreadBase: 0.0,    spreadMove: 0.03,  spreadAir: 0.06, spreadShot: 0.0,    spreadMax: 0.05, adsFov: 70, adsAcc: 0.8,  flash: 0.26, noise: 52 },
  lmg:     { kick: 0.012, spreadBase: 0.004,  spreadMove: 0.07,  spreadAir: 0.1,  spreadShot: 0.0025, spreadMax: 0.06, adsFov: 68, adsAcc: 0.6,  flash: 0.22, noise: 54 },
};

// Game-mode knobs read by the player, the bot and the HUD. Classic is CS-like; Tracking trades one-shot kills and recoil for
// longer fights where you have to keep your crosshair on a moving target.
export const tuning = { dmg: 1, spread: 1, recoil: 1, strafe: 1, auto: false };
export const isAuto = (w) => !!w.auto || (tuning.auto && (w.cls === 'pistol' || w.cls === 'smg' || w.cls === 'rifle' || w.cls === 'lmg'));

const defs = [];
function W(id, name, cls, cat, side, price, kill, dmg, ap, rm, rate, auto, mag, reserve, reload, csSpeed, x = {}) {
  defs.push({ id, name, cls, cat, side, price, kill, dmg, ap, rm, rate, auto, mag, reserve, reload, speed: csSpeed / 250, headMult: 4, ...CLS[cls], ...x });
}

//  id          name              cls       cat        side  $     kill  dmg ap     rm    rate   auto   mag res  reload spd
W('glock',     'Glock-18',       'pistol', 'pistols', 'T',  200,  300,  30, 0.47,  0.85, 0.15,  false, 20, 120, 2.3,  240, { model: { slide: 0x2a2b2e, frame: 0x1d1d1f } });
W('usp',       'USP-S',          'pistol', 'pistols', 'CT', 200,  300,  35, 0.505, 0.79, 0.15,  false, 12, 24,  2.2,  240, { silenced: true, model: { slide: 0x9a9da4, frame: 0x2a2b2e, sup: true } });
W('p250',      'P250',           'pistol', 'pistols', null, 300,  300,  38, 0.64,  0.85, 0.15,  false, 13, 26,  2.2,  240, { model: { slide: 0x7d8087, frame: 0x2a2b2e } });
W('dualies',   'Dual Berettas',  'pistol', 'pistols', null, 400,  300,  38, 0.575, 0.79, 0.12,  false, 30, 120, 3.8,  240, { model: { slide: 0x8a8d94, frame: 0x1d1d1f, dual: true } });
W('tec9',      'Tec-9',          'pistol', 'pistols', 'T',  500,  300,  33, 0.906, 0.79, 0.12,  false, 18, 90,  2.4,  240, { model: { slide: 0x3a3b3f, frame: 0x2a2b2e, long: true } });
W('fiveseven', 'Five-SeveN',     'pistol', 'pistols', 'CT', 500,  300,  32, 0.911, 0.81, 0.15,  false, 20, 100, 2.2,  240, { model: { slide: 0x5a5d63, frame: 0x6b6f45 } });
W('cz75',      'CZ75-Auto',      'pistol', 'pistols', null, 500,  100,  31, 0.776, 0.85, 0.1,   true,  12, 12,  2.7,  240, { model: { slide: 0xb9bcc2, frame: 0x2a2b2e } });
W('deagle',    'Desert Eagle',   'pistol', 'pistols', null, 700,  300,  63, 0.932, 0.81, 0.225, false, 7,  35,  2.2,  230, { kick: 0.05, spreadShot: 0.02, spreadMax: 0.07, model: { slide: 0xb9bcc2, frame: 0x9a9da4, big: true } });

W('mac10',     'MAC-10',         'smg',    'smgs',    'T',  1050, 600,  29, 0.575, 0.84, 0.075, true,  30, 100, 2.6,  240, { model: { body: 0x2f3033, mag: 0x1e1f22, tiny: true } });
W('mp9',       'MP9',            'smg',    'smgs',    'CT', 1250, 600,  26, 0.60,  0.87, 0.07,  true,  30, 120, 2.1,  240, { model: { body: 0x4a4d52, mag: 0x1e1f22, tiny: true } });
W('mp7',       'MP7',            'smg',    'smgs',    null, 1500, 600,  29, 0.625, 0.84, 0.08,  true,  30, 120, 3.1,  220, { model: { body: 0x3b3d40, mag: 0x1e1f22, stock: true } });
W('ump45',     'UMP-45',         'smg',    'smgs',    null, 1200, 600,  35, 0.65,  0.85, 0.09,  true,  25, 100, 3.5,  230, { model: { body: 0x4b4e53, mag: 0x2a2b2e, stock: true, long: true } });
W('p90',       'P90',            'smg',    'smgs',    null, 2350, 300,  26, 0.69,  0.86, 0.07,  true,  50, 100, 3.3,  230, { model: { body: 0x3a3d3a, mag: 0x6b6f66, bullpup: true } });
W('bizon',     'PP-Bizon',       'smg',    'smgs',    null, 1400, 600,  27, 0.575, 0.8,  0.08,  true,  64, 120, 2.4,  240, { model: { body: 0x4a3d2e, mag: 0x2a2b2e, helical: true, stock: true } });

W('galil',     'Galil AR',       'rifle',  'rifles',  'T',  1800, 300,  30, 0.775, 0.98, 0.09,  true,  35, 90,  3.0,  215, { model: { body: 0x6b6f45, guard: 0x4a4d38, stock: 'fold', mag: 'curved', magCol: 0x2a2b2e } });
W('famas',     'FAMAS',          'rifle',  'rifles',  'CT', 2050, 300,  30, 0.70,  0.96, 0.09,  true,  25, 90,  3.3,  220, { model: { body: 0x5e6350, guard: 0x5e6350, stock: 'bullpup', mag: 'straight', magCol: 0x2a2b2e, carry: true } });
W('ak47',      'AK-47',          'rifle',  'rifles',  'T',  2700, 300,  36, 0.775, 0.98, 0.1,   true,  30, 90,  2.5,  215, { model: { body: 0x2b2d30, guard: 0x7a4a24, stock: 'wood', mag: 'curved', magCol: 0x1e1f22 } });
W('m4a4',      'M4A4',           'rifle',  'rifles',  'CT', 3100, 300,  33, 0.70,  0.97, 0.09,  true,  30, 90,  3.1,  225, { model: { body: 0x2a2b2e, guard: 0x2a2b2e, stock: 'poly', mag: 'straight', magCol: 0x1e1f22, carry: true } });
W('m4a1s',     'M4A1-S',         'rifle',  'rifles',  'CT', 2900, 300,  38, 0.70,  0.99, 0.1,   true,  20, 40,  3.1,  225, { silenced: true, model: { body: 0x9a9da4, guard: 0x4a4d52, stock: 'poly', mag: 'straight', magCol: 0x2a2b2e, carry: true, sup: true } });
W('sg553',     'SG 553',         'rifle',  'rifles',  'T',  3000, 300,  30, 1.0,   0.98, 0.09,  true,  30, 90,  2.8,  210, { zoom: [42], scopeKind: 'aug', model: { body: 0x3d3f43, guard: 0x3d3f43, stock: 'fold', mag: 'curved', magCol: 0x2a2b2e, scope: true } });
W('aug',       'AUG',            'rifle',  'rifles',  'CT', 3300, 300,  28, 0.90,  0.98, 0.09,  true,  30, 90,  3.8,  220, { zoom: [42], scopeKind: 'aug', model: { body: 0x4e5a3c, guard: 0x4e5a3c, stock: 'bullpup', mag: 'straight', magCol: 0xb8b8b0, scope: true } });
W('ssg08',     'SSG 08',         'sniper', 'rifles',  null, 1700, 300,  88, 0.85,  0.99, 1.25,  false, 10, 90,  3.7,  230, { zoom: [36, 14], scopeKind: 'sniper', needScope: true, bolt: true, model: { body: 0x4a5238, guard: 0x4a5238, stock: 'poly', scope: true, blen: 0.42 } });
W('awp',       'AWP',            'sniper', 'rifles',  null, 4750, 100,  115, 0.975, 0.99, 1.455, false, 10, 30,  3.7,  200, { zoom: [36, 12], scopeKind: 'sniper', needScope: true, bolt: true, model: { body: 0x4d5c3a, guard: 0x4d5c3a, stock: 'poly', scope: true, blen: 0.5, big: true } });
W('g3sg1',     'G3SG1',          'sniper', 'rifles',  'T',  5000, 300,  80, 0.825, 0.98, 0.25,  true,  20, 90,  4.7,  215, { zoom: [36, 14], scopeKind: 'sniper', needScope: true, model: { body: 0x3c3e3a, guard: 0x2a2b2e, stock: 'poly', mag: 'straight', magCol: 0x1e1f22, scope: true, blen: 0.4 } });
W('scar20',    'SCAR-20',        'sniper', 'rifles',  'CT', 5000, 300,  80, 0.825, 0.99, 0.25,  true,  20, 90,  3.1,  215, { zoom: [36, 14], scopeKind: 'sniper', needScope: true, model: { body: 0x6b6a52, guard: 0x4a4938, stock: 'poly', mag: 'straight', magCol: 0x1e1f22, scope: true, blen: 0.4 } });

W('nova',      'Nova',           'shotgun', 'heavy',  null, 1050, 900,  26, 0.50,  0.7,  0.88,  false, 8,  32,  0.55, 220, { pellets: 9, pellet: 0.03,  shell: true, model: { body: 0x3a3d3f, wood: 0x7a4a24, len: 0.5 } });
W('xm1014',    'XM1014',         'shotgun', 'heavy',  null, 2000, 900,  20, 0.80,  0.7,  0.35,  true,  7,  32,  0.5,  215, { pellets: 6, pellet: 0.035, shell: true, model: { body: 0x2f3134, wood: 0x2f3134, len: 0.52, semi: true } });
W('sawedoff',  'Sawed-Off',      'shotgun', 'heavy',  'T',  1100, 900,  32, 0.75,  0.45, 0.85,  false, 7,  32,  0.5,  210, { pellets: 8, pellet: 0.06,  shell: true, model: { body: 0x2a2b2e, wood: 0x7a4a24, len: 0.3, dbl: true } });
W('mag7',      'MAG-7',          'shotgun', 'heavy',  'CT', 1300, 900,  30, 0.75,  0.45, 0.85,  false, 5,  32,  2.6,  225, { pellets: 4, pellet: 0.045, model: { body: 0x4a4d52, wood: 0x2a2b2e, len: 0.42 } });
W('m249',      'M249',           'lmg',    'heavy',   null, 5200, 300,  32, 0.80,  0.97, 0.08,  true,  100, 200, 5.7, 195, { model: { body: 0x3b3d3a, guard: 0x2a2b2e, stock: 'poly', box: true, blen: 0.4 } });
W('negev',     'Negev',          'lmg',    'heavy',   null, 1700, 300,  35, 0.75,  0.97, 0.06,  true,  150, 200, 5.7, 150, { model: { body: 0x4a4d52, guard: 0x3b3d3a, stock: 'poly', box: true, blen: 0.42 } });

defs.push({ id: 'knife', name: 'Knife', cls: 'knife', melee: true, speed: 1, kill: 1500, ap: 0.85,
  slash: { dmg: 40, time: 0.45, range: 2.3 }, stab: { dmg: 75, time: 1.0, range: 2.0 }, backstab: 150 });
defs.push({ id: 'zeus', name: 'Zeus x27', cls: 'zeus', cat: 'gear', side: null, price: 200, kill: 0, dmg: 500, ap: 1, range: 4.5, speed: 1, rate: 1.0, mag: 1, reserve: 0 });

export const WEAPONS = Object.fromEntries(defs.map((d) => [d.id, d]));

export const GRENADES = {
  he:         { id: 'he',         name: 'HE Grenade',  slot: 4, price: 300, kill: 300, side: null, max: 1, fuse: 1.6 },
  flash:      { id: 'flash',      name: 'Flashbang',   slot: 4, price: 200, kill: 0,   side: null, max: 2, fuse: 1.6 },
  smoke:      { id: 'smoke',      name: 'Smoke',       slot: 4, price: 300, kill: 0,   side: null, max: 1 },
  molotov:    { id: 'molotov',    name: 'Molotov',     slot: 4, price: 400, kill: 300, side: 'T',  max: 1, fire: true },
  incendiary: { id: 'incendiary', name: 'Incendiary',  slot: 4, price: 600, kill: 300, side: 'CT', max: 1, fire: true },
  decoy:      { id: 'decoy',      name: 'Decoy',       slot: 4, price: 50,  kill: 0,   side: null, max: 1 },
};
export const GRENADE_ORDER = ['he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy'];

export const GEAR = {
  kevlar:   { id: 'kevlar',   name: 'Kevlar Vest',          price: 650,  cat: 'gear' },
  helmet:   { id: 'helmet',   name: 'Kevlar + Helmet',      price: 1000, cat: 'gear' },
};

export const CATEGORIES = [
  { id: 'pistols', name: 'Pistols' },
  { id: 'smgs', name: 'SMGs' },
  { id: 'rifles', name: 'Rifles' },
  { id: 'heavy', name: 'Heavy' },
  { id: 'gear', name: 'Gear' },
  { id: 'grenades', name: 'Grenades' },
];

// everything purchasable, as {id, kind, name, price, side, cat}
export const SHOP = [
  ...defs.filter((d) => d.cat && d.price).map((d) => ({ id: d.id, kind: 'weapon', name: d.name, price: d.price, side: d.side, cat: d.cat })),
  ...Object.values(GEAR).map((g) => ({ id: g.id, kind: 'gear', name: g.name, price: g.price, side: null, cat: 'gear' })),
  ...GRENADE_ORDER.map((id) => ({ id, kind: 'grenade', name: GRENADES[id].name, price: GRENADES[id].price, side: GRENADES[id].side, cat: 'grenades' })),
];
// Zeus lives in the gear tab after the armor
SHOP.sort((a, b) => (a.id === 'zeus') - (b.id === 'zeus'));

export const itemOf = (id) => WEAPONS[id] || GRENADES[id] || null;
export const isGun = (id) => { const w = WEAPONS[id]; return !!w && w.cls !== 'knife' && w.cls !== 'zeus'; };
export const slotOf = (id) => {
  const w = WEAPONS[id];
  if (w) return w.cls === 'pistol' ? 'secondary' : w.cls === 'knife' ? 'knife' : w.cls === 'zeus' ? 'zeus' : 'primary';
  return GRENADES[id] ? 'grenade' : null;
};
export const defaultPistol = (side) => (side === 'T' ? 'glock' : 'usp');
export const allowedFor = (item, side) => !item.side || item.side === side;
export const grenadeName = (id) => GRENADES[id]?.name ?? id;

// ------------------------------------------------------------------ damage model
export const M_TO_UNITS = 1 / 0.0254;
export const ZONE_MULT = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };

// Applies armor the way CS does: armor soaks (1 - ap) of the damage, losing half of what it soaked.
export function armorSplit(dmg, ap, armor) {
  if (armor <= 0) return { health: dmg, armor: 0 };
  let health = dmg * ap, loss = (dmg - health) * 0.5;
  if (loss > armor) { loss = armor; health = dmg - loss * 2; }
  return { health, armor: armor - loss };
}

// damage for one bullet of weapon w landing at distance (metres) on a body zone
export function bulletDamage(w, dist, zone, armor, helmet) {
  let d = w.dmg * Math.pow(w.rm ?? 1, (dist * M_TO_UNITS) / 500) * (zone === 'head' ? w.headMult : ZONE_MULT[zone] ?? 1);
  const protectedZone = zone === 'chest' || zone === 'stomach' || (zone === 'head' && helmet);
  const r = protectedZone ? armorSplit(d, w.ap ?? 1, armor) : { health: d, armor };
  return { health: Math.round(r.health), armor: Math.round(r.armor), raw: d };
}

// ------------------------------------------------------------------ models
const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
function box(parent, w, h, d, c, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cyl(parent, r, len, c, x, y, z, seg = 6) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat(c));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

const SLEEVE = 0x55633e, GLOVE = 0x2b2b2b;

function arm(parent, hx, hy, hz, rot = 0) {
  const g = new THREE.Group();
  box(g, 0.055, 0.055, 0.07, GLOVE, 0, 0, 0);
  const sleeve = box(g, 0.075, 0.075, 0.4, SLEEVE, 0, -0.01, 0.24);
  sleeve.rotation.x = -0.12;
  g.position.set(hx, hy, hz);
  g.rotation.y = rot;
  parent.add(g);
  return g;
}

const BLACK = 0x1a1a1a, MAG = 0x1e1f22;

function pistolModel(o, hands) {
  const g = new THREE.Group();
  const big = o.big ? 1.25 : 1, len = (o.long ? 0.3 : 0.27) * (o.big ? 1.08 : 1);
  const one = (dx) => {
    box(g, 0.042 * big, 0.062 * big, len, o.slide, dx, 0.012, -0.05);
    box(g, 0.036, 0.04, len * 0.74, o.frame, dx, -0.03, -0.08);
    const grip = box(g, 0.042, 0.11, 0.065, o.grip ?? 0x1d1d1f, dx, -0.085, 0.07); grip.rotation.x = -0.22;
    box(g, 0.012, 0.03, 0.05, 0x1d1d1f, dx, -0.04, 0.005);
    box(g, 0.014, 0.018, 0.02, 0x222222, dx, 0.05, -0.17);
    box(g, 0.014, 0.014, 0.02, 0x222222, dx, 0.05, 0.07);
  };
  if (o.dual) { one(-0.05); one(0.05); } else one(0);
  let mz = -(0.05 + len / 2);
  if (o.sup) { cyl(g, 0.016, 0.14, 0x25262a, 0, 0.012, mz - 0.07, 8); mz -= 0.14; }
  const muzzle = new THREE.Object3D(); muzzle.position.set(o.dual ? 0.05 : 0, 0.012, mz - 0.005); g.add(muzzle);
  if (hands) {
    if (o.dual) { arm(g, 0.05, -0.1, 0.09, 0.04); arm(g, -0.05, -0.1, 0.09, -0.04); }
    else { arm(g, 0.012, -0.1, 0.09, 0.04); arm(g, -0.02, -0.095, 0.06, 0.18); }
  }
  return { group: g, muzzle, sightY: 0.056 };
}

function smgModel(o, hands) {
  const g = new THREE.Group();
  const bull = o.bullpup, tiny = o.tiny, L = tiny ? 0.2 : bull ? 0.3 : 0.26;
  box(g, 0.05, 0.07, L, o.body, 0, 0, bull ? 0.02 : -0.02);
  if (!tiny && !bull) box(g, 0.054, 0.05, 0.16, o.body, 0, -0.005, -0.2);
  const bl = o.long ? 0.28 : 0.2;
  const bz = bull ? -0.2 : -(0.02 + L / 2 + bl / 2);
  cyl(g, 0.011, bl, BLACK, 0, 0.012, bz, 6);
  box(g, 0.016, 0.03, 0.022, BLACK, 0, 0.05, bz - bl / 2 + 0.03);
  if (o.stock) { const s = box(g, 0.04, 0.07, 0.18, o.mag, 0, -0.01, 0.2); s.rotation.x = -0.1; }
  if (bull) box(g, 0.05, 0.03, 0.34, o.mag, 0, 0.055, -0.02);              // top-mounted P90 magazine
  else if (o.helical) { const m = box(g, 0.05, 0.05, 0.3, o.mag, 0, -0.07, -0.08); m.rotation.x = 0.0; }
  else { const m = box(g, 0.036, 0.16, 0.05, o.mag, 0, -0.11, -0.04); m.rotation.x = 0.1; }
  const grip = box(g, 0.04, 0.09, 0.05, MAG, 0, -0.08, 0.1); grip.rotation.x = -0.2;
  const mzz = bz - bl / 2 - 0.01;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, mzz); g.add(muzzle);
  if (hands) { arm(g, 0.015, -0.1, 0.1, 0.05); arm(g, -0.02, -0.07, bull ? -0.12 : -0.22, -0.05); }
  return { group: g, muzzle, sightY: 0.05 };
}

function rifleModel(o, hands) {
  const g = new THREE.Group();
  const bl = o.blen ?? 0.34, bull = o.stock === 'bullpup';
  box(g, 0.05, 0.075, bull ? 0.46 : 0.34, o.body, 0, 0, bull ? 0.05 : -0.04);
  cyl(g, 0.011, bl, BLACK, 0, 0.012, -(0.21 + bl / 2));
  const gl = o.snip ? 0.1 : 0.22;
  if (!bull) box(g, 0.054, 0.055, gl, o.guard, 0, -0.004, -(0.19 + gl / 2));
  else box(g, 0.05, 0.05, 0.18, o.guard, 0, 0, -0.26);
  box(g, 0.018, 0.035, 0.025, BLACK, 0, 0.04, -(0.21 + bl - 0.04));
  if (o.sup) cyl(g, 0.017, 0.15, 0x25262a, 0, 0.012, -(0.21 + bl + 0.06), 8);
  if (o.stock === 'wood' || o.stock === 'poly') {
    const s = box(g, 0.045, 0.095, 0.2, o.stock === 'wood' ? 0x7a4a24 : o.body, 0, -0.02, 0.25); s.rotation.x = -0.12;
  } else if (o.stock === 'fold') box(g, 0.02, 0.07, 0.2, o.body, 0, -0.02, 0.25);
  if (o.mag) {
    const mc = o.magCol ?? MAG;
    if (o.mag === 'curved') { const m = box(g, 0.04, 0.15, 0.07, mc, 0, -0.11, -0.03); m.rotation.x = 0.28; }
    else { const m = box(g, 0.04, 0.13, 0.055, mc, 0, -0.1, -0.02); m.rotation.x = 0.06; }
  }
  const grip = box(g, 0.04, 0.09, 0.05, MAG, 0, -0.08, 0.12); grip.rotation.x = -0.2;
  if (o.carry) box(g, 0.02, 0.03, 0.12, o.body, 0, 0.055, 0.0);
  let sightY = 0.055;
  if (o.scope) {
    const tube = cyl(g, 0.02, o.snip ? 0.3 : 0.2, 0x202225, 0, 0.085, -0.04, 8);
    cyl(g, 0.026, 0.05, 0x202225, 0, 0.085, -0.17, 8); cyl(g, 0.026, 0.05, 0x202225, 0, 0.085, 0.09, 8);
    box(g, 0.012, 0.025, 0.03, 0x202225, 0, 0.055, -0.07); box(g, 0.012, 0.025, 0.03, 0x202225, 0, 0.055, 0.0);
    sightY = 0.085; tube.userData.scope = true;
  }
  if (o.bolt) { const b = box(g, 0.012, 0.012, 0.05, 0x9a9da4, 0.045, 0.02, 0.07); b.rotation.y = 0.0; box(g, 0.02, 0.02, 0.02, 0x9a9da4, 0.065, 0.02, 0.07); }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -(0.22 + bl + (o.sup ? 0.14 : 0))); g.add(muzzle);
  if (hands) { arm(g, 0.015, -0.1, 0.12, 0.05); arm(g, -0.02, -0.07, o.snip ? -0.2 : -0.28, -0.05); }
  return { group: g, muzzle, sightY };
}

function shotgunModel(o, hands) {
  const g = new THREE.Group();
  const L = o.len ?? 0.45;
  box(g, 0.05, 0.07, 0.24, o.body, 0, 0, 0);
  if (o.dbl) { cyl(g, 0.014, L, BLACK, -0.016, 0.01, -0.12 - L / 2, 6); cyl(g, 0.014, L, BLACK, 0.016, 0.01, -0.12 - L / 2, 6); }
  else {
    cyl(g, 0.016, L, BLACK, 0, 0.012, -0.12 - L / 2, 6);
    cyl(g, 0.014, L * 0.85, 0x2a2b2e, 0, -0.025, -0.12 - L * 0.425, 6);          // tube magazine
    if (!o.semi) box(g, 0.05, 0.045, 0.14, o.wood, 0, -0.03, -0.22);                // pump
  }
  const s = box(g, 0.045, 0.1, 0.22, o.wood, 0, -0.02, 0.22); s.rotation.x = -0.15;
  box(g, 0.014, 0.03, 0.02, BLACK, 0, 0.05, -0.12 - L + 0.03);
  const grip = box(g, 0.04, 0.09, 0.05, MAG, 0, -0.08, 0.1); grip.rotation.x = -0.2;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.13 - L); g.add(muzzle);
  if (hands) { arm(g, 0.015, -0.1, 0.11, 0.05); arm(g, -0.02, -0.06, -0.2, -0.05); }
  return { group: g, muzzle, sightY: 0.055 };
}

function lmgModel(o, hands) {
  const g = new THREE.Group();
  const bl = o.blen ?? 0.4;
  box(g, 0.06, 0.085, 0.36, o.body, 0, 0, -0.04);
  cyl(g, 0.013, bl, BLACK, 0, 0.015, -(0.22 + bl / 2));
  box(g, 0.06, 0.06, 0.2, o.guard, 0, -0.005, -0.28);
  box(g, 0.014, 0.04, 0.025, BLACK, 0, 0.05, -(0.22 + bl - 0.03));
  const s = box(g, 0.045, 0.1, 0.2, o.body, 0, -0.02, 0.26); s.rotation.x = -0.1;
  box(g, 0.1, 0.1, 0.12, 0x3e4a30, 0, -0.1, -0.03);                                // ammo box
  box(g, 0.012, 0.012, 0.18, 0x2a2b2e, 0, -0.06, -0.12);                           // belt
  const grip = box(g, 0.04, 0.09, 0.05, MAG, 0, -0.08, 0.14); grip.rotation.x = -0.2;
  const bp = box(g, 0.01, 0.12, 0.012, 0x2a2b2e, 0.025, -0.07, -0.42); bp.rotation.z = 0.5;
  const bq = box(g, 0.01, 0.12, 0.012, 0x2a2b2e, -0.025, -0.07, -0.42); bq.rotation.z = -0.5;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.015, -(0.23 + bl)); g.add(muzzle);
  if (hands) { arm(g, 0.015, -0.1, 0.14, 0.05); arm(g, -0.02, -0.07, -0.3, -0.05); }
  return { group: g, muzzle, sightY: 0.06 };
}

// ---- knives: the blade is an extruded outline (flat side facing left/right, edge down), grips are always black ----
export const KNIVES = { bayonet: 'Combat Knife', karambit: 'Karambit', butterfly: 'Butterfly Knife' };
export const KNIFE_ORDER = ['bayonet', 'karambit', 'butterfly'];
export const knifeStyle = { kind: 'bayonet', color: 0xd9dde3 };
export function setKnifeStyle(kind, color) {
  if (KNIVES[kind]) knifeStyle.kind = kind;
  if (color !== undefined) knifeStyle.color = color;
}
const GRIP = 0x141416;

// outline drawn with x = along the blade, y = height; comes out pointing along -Z, thin in X
function blade(outline, thick, color) {
  const shape = new THREE.Shape();
  outline(shape);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -thick / 2);
  g.rotateY(Math.PI / 2);
  return new THREE.Mesh(g, mat(color));
}
const tint = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

function knife(withHands) {
  const g = new THREE.Group();
  const col = knifeStyle.color, kind = knifeStyle.kind;
  let bladeMesh;
  if (kind === 'karambit') {
    bladeMesh = blade((s) => {
      s.moveTo(0, -0.02); s.quadraticCurveTo(0.08, -0.03, 0.14, 0.064);         // spine sweeps forward and up to the tip
      s.quadraticCurveTo(0.07, 0.006, 0, 0.016); s.closePath();                 // concave cutting edge on the inside of the hook
    }, 0.007, col);
    bladeMesh.position.set(0, 0.0, -0.03);
    g.add(bladeMesh);
    box(g, 0.026, 0.036, 0.07, GRIP, 0, -0.004, 0.005);                         // short handle
    box(g, 0.03, 0.044, 0.01, tint(col, 0.5), 0, 0, -0.032);                    // bolster
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 14), mat(GRIP));
    ring.rotation.y = Math.PI / 2; ring.position.set(0, -0.022, 0.05);           // finger ring hangs off the back
    g.add(ring);
  } else if (kind === 'butterfly') {
    bladeMesh = blade((s) => {
      s.moveTo(0, -0.018); s.lineTo(0, 0.022); s.lineTo(0.1, 0.024); s.quadraticCurveTo(0.17, 0.02, 0.19, -0.006); s.lineTo(0.14, -0.02); s.lineTo(0, -0.018);
    }, 0.006, col);
    bladeMesh.position.set(0, 0.0, -0.03);
    g.add(bladeMesh);
    for (const side of [-1, 1]) {                                                // two split handles that fold around the blade
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.011, -0.003, -0.026);
      pivot.rotation.y = -side * 0.1;
      const half = box(pivot, 0.011, 0.034, 0.13, GRIP, 0, 0, 0.065);
      box(pivot, 0.012, 0.014, 0.12, 0x2a2a2e, side * 0.0004, -0.012, 0.065);
      g.add(pivot);
    }
    box(g, 0.036, 0.03, 0.014, tint(col, 0.5), 0, -0.002, -0.028);               // pivot block
    box(g, 0.012, 0.008, 0.02, tint(col, 0.5), 0, 0.02, 0.1);                    // latch
  } else {
    bladeMesh = blade((s) => {
      s.moveTo(0, -0.022); s.lineTo(0, 0.026); s.lineTo(0.17, 0.026); s.lineTo(0.255, 0.004); s.lineTo(0.26, -0.002); s.lineTo(0.21, -0.022); s.lineTo(0, -0.022);
    }, 0.007, col);
    bladeMesh.position.set(0, 0.0, -0.04);
    g.add(bladeMesh);
    for (const side of [-1, 1]) box(g, 0.0012, 0.006, 0.17, tint(col, 0.55), side * 0.0042, 0.011, -0.15);   // fuller groove
    box(g, 0.02, 0.058, 0.012, tint(col, 0.5), 0, 0, -0.036);                    // guard
    box(g, 0.026, 0.034, 0.12, GRIP, 0, 0, 0.03);                                // handle
    box(g, 0.03, 0.038, 0.014, tint(col, 0.5), 0, 0, 0.095);                     // pommel
  }
  // the karambit is held across the screen, so its forearm is turned back the other way to keep coming from below
  if (withHands) arm(g, 0.0, -0.02, 0.05, kind === 'karambit' ? 1.2 : 0.04);
  return { group: g, muzzle: null, blade: bladeMesh, sightY: 0.05 };
}

function zeus(withHands) {
  const g = new THREE.Group();
  box(g, 0.05, 0.08, 0.16, 0xe3c33a, 0, 0, 0);
  box(g, 0.054, 0.05, 0.04, 0x2a2b2e, 0, 0, -0.1);
  box(g, 0.008, 0.008, 0.05, 0xcfd6dc, -0.012, 0, -0.145);
  box(g, 0.008, 0.008, 0.05, 0xcfd6dc, 0.012, 0, -0.145);
  const grip = box(g, 0.04, 0.09, 0.05, MAG, 0, -0.07, 0.04); grip.rotation.x = -0.15;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -0.17); g.add(muzzle);
  if (withHands) { arm(g, 0.015, -0.1, 0.08, 0.05); }
  return { group: g, muzzle, sightY: 0.05 };
}

function grenade(kind, withHands) {
  const g = new THREE.Group();
  const bottle = kind === 'molotov' || kind === 'incendiary';
  if (bottle) {
    const col = kind === 'molotov' ? 0x6a4a2a : 0x8a2a20;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.12, 8), mat(col)));
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.07, 8), mat(col));
    neck.position.y = 0.09; g.add(neck);
    const rag = box(g, 0.03, 0.05, 0.02, 0xd8d0b8, 0, 0.14, 0); rag.rotation.z = 0.3;
    box(g, 0.02, 0.025, 0.02, 0xff8a1e, 0.01, 0.18, 0);
  } else {
    const body = { smoke: 0x70806a, flash: 0xe8e8ea, he: 0x4a5a3a, decoy: 0x5a6670 }[kind] ?? 0x70806a;
    const band = { smoke: 0x3d4a3a, flash: 0xe0b020, he: 0xc43a2a, decoy: 0xe8e8ea }[kind] ?? 0x3d4a3a;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8), mat(body)));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0365, 0.0365, 0.025, 8), mat(band));
    b.position.y = 0.02; g.add(b);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.03, 8), mat(0x555a5e));
    cap.position.y = 0.075; g.add(cap);
    box(g, 0.012, 0.012, 0.07, 0x888b90, 0.03, 0.09, 0);
  }
  if (withHands) arm(g, 0, -0.07, 0.04, 0.0);
  return { group: g, muzzle: null, sightY: 0.05 };
}

// ------------------------------------------------------------------ Quaternius "Ultimate Gun Pack" models (CC0)
// Each entry maps a weapon to a model file; `len` is the in-game length in metres, `tint` recolours the body parts,
// `acc` attaches an accessory model. Weapons without an entry keep the procedural models above.
const FBX_MAP = {
  glock:     { file: 'Pistol_1', len: 0.21, tint: 0x2f3236 },
  usp:       { file: 'Pistol_2', len: 0.23, tint: 0x4a4d52, acc: { file: 'Accessories/Silencer_Short', at: 1 } },
  p250:      { file: 'Pistol_5', len: 0.21, tint: 0x5a5d63 },
  dualies:   { file: 'Pistol_1', len: 0.21, tint: 0x6b6e75, dual: true },
  tec9:      { file: 'Pistol_6', len: 0.23, tint: 0x3a3b3f },
  fiveseven: { file: 'Pistol_3', len: 0.23, tint: 0x575c40 },
  cz75:      { file: 'Pistol_5', len: 0.21, tint: 0x8a8d94 },
  deagle:    { file: 'Pistol_4', len: 0.27, tint: 0x9a9da4 },
  mac10:     { file: 'SubmachineGun_3', len: 0.42, tint: 0x33353a },
  mp9:       { file: 'SubmachineGun_5', len: 0.5, tint: 0x3f4247 },
  mp7:       { file: 'SubmachineGun_2', len: 0.52, tint: 0x34373b },
  ump45:     { file: 'SubmachineGun_1', len: 0.5, tint: 0x4b4e53 },
  bizon:     { file: 'SubmachineGun_4', len: 0.52, tint: 0x4a3d2e },
  galil:     { file: 'AssaultRifle_4', len: 0.9, tint: 0x4a4d38 },
  famas:     { file: 'Bullpup_1', len: 0.78, tint: 0x4e5240 },
  ak47:      { file: 'AssaultRifle_2', len: 0.9, tint: 0x2b2d30 },
  m4a4:      { file: 'AssaultRifle2_1', len: 0.88, tint: 0x2a2b2e },
  m4a1s:     { file: 'AssaultRifle2_2', len: 0.84, tint: 0x8a8d94, acc: { file: 'Accessories/Silencer_1', at: 1 } },
  sg553:     { file: 'AssaultRifle_5', len: 0.9, tint: 0x3d3f43 },
  aug:       { file: 'Bullpup_2', len: 0.8, tint: 0x4e5a3c },
  ssg08:     { file: 'SniperRifle_1', len: 1.05, tint: 0x4a5238 },
  awp:       { file: 'SniperRifle_3', len: 1.15, tint: 0x4d5c3a },
  g3sg1:     { file: 'SniperRifle_6', len: 1.05, tint: 0x3c3e3a },
  scar20:    { file: 'SniperRifle_5', len: 1.05, tint: 0x6b6a52 },
  nova:      { file: 'Shotgun_1', len: 1.0, tint: 0x3a3d3f },
  xm1014:    { file: 'Shotgun_3', len: 1.0, tint: 0x2f3134 },
  sawedoff:  { file: 'Shotgun_SawedOff', len: 0.62, tint: 0x2a2b2e },
  mag7:      { file: 'Shotgun_ShortStock', len: 0.78, tint: 0x4a4d52 },
};
const PALETTE = { Black: 0x202226, Black2: 0x1a1b1e, DarkMetal: 0x2c2f34, Metal: 0x4d5158, LightMetal: 0x80848c, Wood: 0x7a4a24, DarkWood: 0x58341a };
const fbxCache = {};

export async function loadGunAssets() {
  const loader = new FBXLoader();
  const files = new Set();
  for (const m of Object.values(FBX_MAP)) { files.add(m.file); if (m.acc) files.add(m.acc.file); }
  await Promise.all([...files].map(async (f) => {
    try {
      const o = await loader.loadAsync(`./assets/guns/${f}.fbx`);
      const box = new THREE.Box3().setFromObject(o);
      o.userData.box = box;
      fbxCache[f] = o;
    } catch (e) { console.warn('gun model failed, using the built-in one:', f, e.message); }
  }));
}

// recolours a template's materials: named parts from PALETTE, the generic "Main*" body parts from the weapon's tint
function recolor(obj, tint) {
  obj.traverse((m) => {
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((old) => {
      const n = old.name || '';
      let c = PALETTE[n];
      if (c === undefined) c = n === 'MainDark' ? new THREE.Color(tint).multiplyScalar(0.6).getHex() : n === 'MainLight' ? new THREE.Color(tint).multiplyScalar(1.35).getHex() : tint;
      return mat(c);
    });
    m.material = Array.isArray(m.material) ? mats : mats[0];
  });
}

// builds a gun from the pack: centred, muzzle toward -Z, grip hanging down -Y, with hands placed along its length
function fbxGunModel(id, hands) {
  const spec = FBX_MAP[id], tpl = spec && fbxCache[spec.file];
  if (!tpl) return null;
  const w = WEAPONS[id], len = spec.len, box = tpl.userData.box;
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const s = len / size.x;
  const g = new THREE.Group();
  const place = (src, dx = 0) => {
    const inner = src.clone(true);
    recolor(inner, spec.tint);
    inner.position.set(-ctr.x, -ctr.y, -ctr.z);
    const pivot = new THREE.Group();
    pivot.add(inner);
    pivot.scale.setScalar(s);
    pivot.rotation.y = Math.PI / 2;             // pack models point along +X; the game looks down -Z
    pivot.position.set(dx, 0, -0.12 * len);
    g.add(pivot);
    return pivot;
  };
  place(tpl, spec.dual ? -0.05 : 0);
  if (spec.dual) place(tpl, 0.05);
  const rear = 0.38 * len, front = -0.62 * len;
  const halfH = (size.y / 2) * s, minY = -halfH;
  let muzzleZ = front;
  if (spec.acc && fbxCache[spec.acc.file]) {
    const a = fbxCache[spec.acc.file], ab = a.userData.box, as = ab.getSize(new THREE.Vector3()), ac = ab.getCenter(new THREE.Vector3());
    const inner = a.clone(true); recolor(inner, 0x25262a);
    inner.position.set(-ac.x, -ac.y, -ac.z);
    const pivot = new THREE.Group(); pivot.add(inner);
    pivot.scale.setScalar(s * 1.0); pivot.rotation.y = Math.PI / 2;
    const alen = as.x * s;
    pivot.position.set(0, halfH * 0.18, front - alen / 2 + 0.01);
    g.add(pivot);
    muzzleZ = front - alen;
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, halfH * 0.2, muzzleZ - 0.01); g.add(muzzle);
  if (hands) {
    const pistol = w.cls === 'pistol';
    if (spec.dual) { arm(g, 0.05, minY * 0.8, rear - 0.22 * len, 0.04); arm(g, -0.05, minY * 0.8, rear - 0.22 * len, -0.04); }
    else if (pistol) { arm(g, 0.012, minY * 0.78, rear - 0.2 * len, 0.04); arm(g, -0.02, minY * 0.72, rear - 0.24 * len, 0.18); }
    else { arm(g, 0.015, minY * 0.8, rear - 0.2 * len, 0.05); arm(g, -0.02, minY * 0.4, front + len * 0.36, -0.05); }
  }
  return { group: g, muzzle, sightY: Math.max(0.04, halfH - 0.004) };
}

function gunModel(id, hands) {
  const fb = fbxGunModel(id, hands);
  if (fb) return fb;
  const w = WEAPONS[id], o = w.model ?? {};
  switch (w.cls) {
    case 'pistol': return pistolModel(o, hands);
    case 'smg': return smgModel(o, hands);
    case 'shotgun': return shotgunModel(o, hands);
    case 'lmg': return lmgModel(o, hands);
    default: return rifleModel({ ...o, snip: w.cls === 'sniper' }, hands);
  }
}

export function buildViewModel(id) {
  if (id === 'knife') return knife(true);
  if (id === 'zeus') return zeus(true);
  if (GRENADES[id]) return grenade(id, true);
  return gunModel(id, true);
}

export function buildWorldGun(id) {
  if (id === 'zeus') return zeus(false);
  return gunModel(WEAPONS[id] && isGun(id) ? id : 'ak47', false);
}

// a hands-free model of any item (gun, knife, Zeus, grenade) for previews
export function buildItemModel(id) {
  if (id === 'knife') return knife(false).group;
  if (id === 'zeus') return zeus(false).group;
  if (GRENADES[id]) return grenade(id, false).group;
  return gunModel(id, false).group;
}

export function buildGrenadeMesh(kind) {
  return grenade(kind, false).group;
}
