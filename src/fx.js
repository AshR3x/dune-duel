// Pooled visual effects: muzzle flashes, tracers, impacts, and low-poly smoke.
import * as THREE from 'three';

const flatBasic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, ...extra });

// A six-pointed star: the classic muzzle flash silhouette.
function starGeometry(outer, inner, points = 6) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer, a = (i / (points * 2)) * Math.PI * 2;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s);
}

export function makeMuzzleFlash(size = 0.2) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(starGeometry(size, size * 0.35), flatBasic(0xffa83a, { blending: THREE.AdditiveBlending }));
  const inner = new THREE.Mesh(starGeometry(size * 0.55, size * 0.2), flatBasic(0xfff3c4, { blending: THREE.AdditiveBlending }));
  inner.position.z = 0.002;
  const cross = outer.clone();
  cross.rotation.y = Math.PI / 2;
  g.add(outer, inner, cross);
  g.visible = false;
  g.userData.t = 0;
  return g;
}

export function flashShow(flash, dur = 0.055) {
  flash.visible = true;
  flash.userData.t = dur;
  flash.rotation.z = Math.random() * Math.PI;
  const s = 0.75 + Math.random() * 0.5;
  flash.scale.setScalar(s);
}
export function flashTick(flash, dt) {
  if (!flash.visible) return;
  flash.userData.t -= dt;
  if (flash.userData.t <= 0) flash.visible = false;
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.tracerMat = flatBasic(0xffe9a0, { blending: THREE.AdditiveBlending, opacity: 0.8 });
    const tg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tg, this.tracerMat);
      m.visible = false; m.userData.t = 0;
      scene.add(m); this.tracers.push(m);
    }
    this.puffs = [];
    const pg = new THREE.IcosahedronGeometry(0.12, 0);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(pg, new THREE.MeshLambertMaterial({ color: 0xcdb48a, flatShading: true, transparent: true }));
      m.visible = false; m.userData = { t: 0, v: new THREE.Vector3() };
      scene.add(m); this.puffs.push(m);
    }
    this.holes = [];
    const hg = new THREE.CircleGeometry(0.06, 5);
    const hm = new THREE.MeshBasicMaterial({ color: 0x2a2118, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(hg, hm);
      m.visible = false;
      scene.add(m); this.holes.push(m);
    }
    this.hi = 0; this.ti = 0; this.pi = 0;
    this.smokes = [];
    this.light = new THREE.PointLight(0xffb060, 0, 10, 2);
    scene.add(this.light);
    this.lightT = 0;
  }

  tracer(a, b) {
    const m = this.tracers[this.ti++ % this.tracers.length];
    const len = a.distanceTo(b);
    m.position.copy(a).lerp(b, 0.5);
    m.scale.set(0.012, 0.012, len);
    m.lookAt(b);
    m.visible = true; m.userData.t = 0.05;
  }

  impact(p, n, wall) {
    if (wall && n) {
      const h = this.holes[this.hi++ % this.holes.length];
      h.position.copy(p).addScaledVector(n, 0.012);
      h.lookAt(p.clone().add(n));
      h.visible = true;
    }
    for (let i = 0; i < 2; i++) {
      const m = this.puffs[this.pi++ % this.puffs.length];
      m.position.copy(p);
      m.userData.t = 0.35;
      m.userData.v.set((Math.random() - 0.5) * 1.2, Math.random() * 1.2, (Math.random() - 0.5) * 1.2);
      if (n) m.userData.v.addScaledVector(n, 1.4);
      m.material.opacity = 0.9;
      m.scale.setScalar(1);
      m.visible = true;
    }
  }

  worldFlash(pos) {
    this.light.position.copy(pos);
    this.light.intensity = 30;
    this.lightT = 0.06;
  }

  addSmoke(x, z) {
    const s = new Smoke(x, z);
    this.scene.add(s.group);
    this.smokes.push(s);
    return s;
  }

  update(dt) {
    for (const t of this.tracers) if (t.visible && (t.userData.t -= dt) <= 0) t.visible = false;
    for (const p of this.puffs) {
      if (!p.visible) continue;
      p.userData.t -= dt;
      if (p.userData.t <= 0) { p.visible = false; continue; }
      p.position.addScaledVector(p.userData.v, dt);
      p.userData.v.multiplyScalar(0.9);
      p.material.opacity = p.userData.t / 0.35;
      p.scale.setScalar(1 + (0.35 - p.userData.t) * 4);
    }
    if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.update(dt);
      if (s.t > s.life) { this.scene.remove(s.group); s.dispose(); this.smokes.splice(i, 1); }
    }
  }

  clear() {
    for (const s of this.smokes) { this.scene.remove(s.group); s.dispose(); }
    this.smokes.length = 0;
    for (const h of this.holes) h.visible = false;
    for (const t of this.tracers) t.visible = false;
    for (const p of this.puffs) p.visible = false;
  }
}

// A smoke cloud: a ball of low-poly puffs that grows, holds, then thins out.
const puffGeo = new THREE.IcosahedronGeometry(1, 1);
export class Smoke {
  constructor(x, z) {
    this.x = x; this.z = z; this.t = 0; this.life = 16;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    this.mat = new THREE.MeshLambertMaterial({ color: 0xd2d0cb, flatShading: true, transparent: true, opacity: 0.97 });
    this.puffs = [];
    const n = 22;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(puffGeo, this.mat);
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 2.3;
      m.position.set(Math.cos(a) * r, 0.8 + Math.random() * 2.4, Math.sin(a) * r);
      m.userData = { s: 1.6 + Math.random() * 0.9, ph: Math.random() * 6 };
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.group.add(m);
      this.puffs.push(m);
    }
  }
  get grow() { return 1 - Math.pow(1 - Math.min(this.t / 1.1, 1), 3); }
  get fade() { return this.t > this.life - 3.5 ? Math.max(0, (this.life - this.t) / 3.5) : 1; }
  // radius used for blocking line of sight
  get radius() { return 3.0 * this.grow * (0.4 + 0.6 * this.fade); }
  update(dt) {
    this.t += dt;
    const g = this.grow, f = this.fade;
    this.mat.opacity = 0.97 * Math.min(1, f * 1.4);
    for (const m of this.puffs) {
      const u = m.userData;
      m.scale.setScalar(u.s * g * (0.55 + 0.45 * f) * (1 + 0.04 * Math.sin(this.t * 1.5 + u.ph)));
      m.rotation.y += dt * 0.15;
    }
  }
  dispose() { this.mat.dispose(); }
}

// Does the segment a->b pass through any live smoke?
export function segmentBlockedBySmoke(smokes, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L2 = dx * dx + dy * dy + dz * dz;
  for (const s of smokes) {
    if (s.t < 0.5) continue;
    const r = s.radius;
    if (r < 0.5) continue;
    const cx = s.x, cy = 1.7, cz = s.z;
    let t = L2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
    if (px * px + py * py + pz * pz < r * r) return true;
  }
  return false;
}
