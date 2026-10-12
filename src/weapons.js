// Weapon stats and low-poly models (built from boxes and cylinders, no assets).
import * as THREE from 'three';

export const WEAPONS = {
  ak: {
    id: 'ak', name: 'AK-47', slot: 1, auto: true, dmg: 34, headMult: 4, rate: 0.1,
    mag: 30, reserve: 90, reload: 2.4, speed: 0.88,
    kick: 0.011, spreadBase: 0.0025, spreadMove: 0.05, spreadAir: 0.09, spreadShot: 0.0022, spreadMax: 0.04,
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 2, auto: false, dmg: 53, headMult: 4, rate: 0.225,
    mag: 7, reserve: 35, reload: 2.2, speed: 0.96,
    kick: 0.05, spreadBase: 0.002, spreadMove: 0.065, spreadAir: 0.1, spreadShot: 0.02, spreadMax: 0.07,
  },
  knife: {
    id: 'knife', name: 'Knife', slot: 3, melee: true, speed: 1.05,
    slash: { dmg: 40, time: 0.45, range: 2.3 }, stab: { dmg: 75, time: 1.0, range: 2.0 }, backstab: 150,
  },
};

export const GRENADES = {
  smoke: { id: 'smoke', name: 'Smoke', slot: 4 },
  flash: { id: 'flash', name: 'Flashbang', slot: 5 },
};

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

const SKIN = 0xc99a73, SLEEVE = 0x55633e, GLOVE = 0x2b2b2b;

function arm(parent, hx, hy, hz, rot = 0) {
  const g = new THREE.Group();
  box(g, 0.055, 0.055, 0.07, GLOVE, 0, 0, 0);                  // hand
  const sleeve = box(g, 0.075, 0.075, 0.4, SLEEVE, 0, -0.01, 0.24); // forearm
  sleeve.rotation.x = -0.12;
  g.position.set(hx, hy, hz);
  g.rotation.y = rot;
  parent.add(g);
  return g;
}

function ak(withHands) {
  const g = new THREE.Group();
  box(g, 0.05, 0.075, 0.34, 0x2b2d30, 0, 0, -0.04);
  cyl(g, 0.011, 0.34, 0x1a1a1a, 0, 0.012, -0.38);
  box(g, 0.054, 0.055, 0.22, 0x7a4a24, 0, -0.004, -0.3);
  box(g, 0.018, 0.035, 0.025, 0x1a1a1a, 0, 0.04, -0.5);
  const stock = box(g, 0.045, 0.095, 0.2, 0x7a4a24, 0, -0.02, 0.25); stock.rotation.x = -0.12;
  const mag = box(g, 0.04, 0.15, 0.07, 0x1e1f22, 0, -0.11, -0.03); mag.rotation.x = 0.28;
  const grip = box(g, 0.04, 0.09, 0.05, 0x1e1f22, 0, -0.08, 0.12); grip.rotation.x = -0.2;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.56); g.add(muzzle);
  if (withHands) { arm(g, 0.015, -0.1, 0.12, 0.05); arm(g, -0.02, -0.07, -0.28, -0.05); }
  return { group: g, muzzle };
}

function deagle(withHands) {
  const g = new THREE.Group();
  box(g, 0.042, 0.062, 0.27, 0xb9bcc2, 0, 0.012, -0.05);
  box(g, 0.036, 0.04, 0.2, 0x9a9da4, 0, -0.03, -0.08);
  const grip = box(g, 0.042, 0.11, 0.065, 0x1d1d1f, 0, -0.085, 0.07); grip.rotation.x = -0.22;
  box(g, 0.012, 0.03, 0.05, 0x1d1d1f, 0, -0.04, 0.005);
  box(g, 0.014, 0.018, 0.02, 0x222222, 0, 0.05, -0.17);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.2); g.add(muzzle);
  if (withHands) { arm(g, 0.012, -0.1, 0.09, 0.04); arm(g, -0.02, -0.095, 0.06, 0.18); }
  return { group: g, muzzle };
}

function knife(withHands) {
  const g = new THREE.Group();
  const blade = box(g, 0.008, 0.045, 0.2, 0xd9dde3, 0, 0, -0.15);
  box(g, 0.006, 0.02, 0.05, 0xd9dde3, 0, -0.012, -0.275).rotation.x = 0.4;
  box(g, 0.02, 0.03, 0.01, 0x2a2a2a, 0, 0, -0.045);
  box(g, 0.026, 0.03, 0.11, 0x1b1b1b, 0, 0, 0.02);
  if (withHands) arm(g, 0.0, -0.02, 0.05, 0.04);
  return { group: g, muzzle: null, blade };
}

function grenade(kind, withHands) {
  const g = new THREE.Group();
  const body = kind === 'smoke' ? 0x70806a : 0xe8e8ea;
  const band = kind === 'smoke' ? 0x3d4a3a : 0xe0b020;
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8), mat(body));
  g.add(c);
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0365, 0.0365, 0.025, 8), mat(band));
  b.position.y = 0.02; g.add(b);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.03, 8), mat(0x555a5e));
  cap.position.y = 0.075; g.add(cap);
  box(g, 0.012, 0.012, 0.07, 0x888b90, 0.03, 0.09, 0);
  if (withHands) arm(g, 0, -0.07, 0.04, 0.0);
  return { group: g, muzzle: null };
}

export function buildViewModel(id) {
  if (id === 'ak') return ak(true);
  if (id === 'deagle') return deagle(true);
  if (id === 'knife') return knife(true);
  return grenade(id, true);
}

export function buildWorldGun(id) {
  return id === 'deagle' ? deagle(false) : ak(false);
}

export function buildGrenadeMesh(kind) {
  return grenade(kind, false).group;
}
