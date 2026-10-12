// Turns the grid into low-poly meshes: one floor mesh, one merged wall mesh,
// a few floor decals, and a static canvas for the minimap.
import * as THREE from 'three';
import { N, CELL, WALL_H, CRATE_H, grid, cellAt, ZONES, CALLOUTS, pxToWorld } from './map.js';

const HALF = (N * CELL) / 2;

class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; }
  quad(a, b, c, d, n, ca, cb, cc, cd) {
    const i = this.pos.length / 3;
    for (const p of [a, b, c, d]) { this.pos.push(...p); this.nor.push(...n); }
    for (const c_ of [ca, cb, cc, cd]) this.col.push(c_.r, c_.g, c_.b);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return new THREE.Mesh(g, material);
  }
}

const hash = (x, z) => {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
};
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function addBox(b, x0, z0, x1, z1, h, kind, seed) {
  const wall = kind === 1;
  const v = 0.94 + hash(seed, seed * 7) * 0.12;
  const top = shade(wall ? 0xe9cf9c : 0xa9855a, 0.95 * v);
  const hi = shade(wall ? 0xf3dcae : 0xc29a6a, v);
  const lo = shade(wall ? 0xcaa56f : 0x8a6842, v);
  const P = (x, y, z) => [x, y, z];
  b.quad(P(x0, h, z0), P(x0, h, z1), P(x1, h, z1), P(x1, h, z0), [0, 1, 0], top, top, top, top);
  b.quad(P(x0, 0, z1), P(x1, 0, z1), P(x1, h, z1), P(x0, h, z1), [0, 0, 1], lo, lo, hi, hi);
  b.quad(P(x1, 0, z0), P(x0, 0, z0), P(x0, h, z0), P(x1, h, z0), [0, 0, -1], lo, lo, hi, hi);
  b.quad(P(x1, 0, z1), P(x1, 0, z0), P(x1, h, z0), P(x1, h, z1), [1, 0, 0], lo, lo, hi, hi);
  b.quad(P(x0, 0, z0), P(x0, 0, z1), P(x0, h, z1), P(x0, h, z0), [-1, 0, 0], lo, lo, hi, hi);
}

function nearOpen(cx, cz) {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cellAt(cx + dx, cz + dz) === 1) return true;
  return false;
}

function labelTexture(text, color, fill, size = 256, border = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  if (fill) { x.fillStyle = fill; x.fillRect(0, 0, size, size); }
  if (border) { x.strokeStyle = color; x.lineWidth = size * 0.04; x.strokeRect(size * 0.03, size * 0.03, size * 0.94, size * 0.94); }
  x.fillStyle = color;
  x.font = `bold ${size * 0.55}px Arial Black, Arial, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, size / 2, size / 2 + size * 0.03);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export function buildWorld(scene) {
  // ---- floor ----
  const fb = new GeoBuilder();
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      if (cellAt(cx, cz) !== 1) continue;
      const x0 = cx * CELL - HALF, z0 = cz * CELL - HALF, x1 = x0 + CELL, z1 = z0 + CELL;
      let walls = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cellAt(cx + dx, cz + dz) !== 1) walls++;
      const k = (0.93 + hash(cx, cz) * 0.1) * (1 - Math.min(walls, 4) * 0.025);
      const c = shade(0xdcc394, k);
      fb.quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0], c, c, c, c);
    }
  }
  const floorMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  scene.add(fb.mesh(floorMat));

  // ---- walls and crates: merge runs of cells into boxes ----
  const wb = new GeoBuilder();
  const need = (cx, cz) => cellAt(cx, cz) !== 1 && nearOpen(cx, cz);
  const used = new Uint8Array(N * N);
  let seed = 1;
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const kind = cellAt(cx, cz);
      if (used[cz * N + cx] || kind === 1 || !need(cx, cz)) continue;
      let w = 1;
      while (cx + w < N && !used[cz * N + cx + w] && cellAt(cx + w, cz) === kind && need(cx + w, cz)) w++;
      let d = 1;
      grow: while (cz + d < N) {
        for (let i = 0; i < w; i++) if (used[(cz + d) * N + cx + i] || cellAt(cx + i, cz + d) !== kind || !need(cx + i, cz + d)) break grow;
        d++;
      }
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) used[(cz + j) * N + cx + i] = 1;
      addBox(wb, cx * CELL - HALF, cz * CELL - HALF, (cx + w) * CELL - HALF, (cz + d) * CELL - HALF,
        kind === 2 ? CRATE_H : WALL_H, kind, seed++);
    }
  }
  scene.add(wb.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

  // ---- floor decals ----
  const decalMat = (tex) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 });
  const decal = (px0, py0, px1, py1, tex) => {
    const a = pxToWorld(px0, py0), b = pxToWorld(px1, py1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.x - a.x, b.z - a.z), decalMat(tex));
    m.rotation.x = -Math.PI / 2;
    m.position.set((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2);
    scene.add(m);
  };
  decal(...ZONES.A, labelTexture('A', '#d9531e', 'rgba(217,83,30,0.18)'));
  decal(...ZONES.B, labelTexture('B', '#d9531e', 'rgba(217,83,30,0.18)'));
  decal(...ZONES.T, labelTexture('T', '#6fb04a', 'rgba(111,176,74,0.18)', 256, true));
  decal(...ZONES.CT, labelTexture('CT', '#4a8fd9', 'rgba(74,143,217,0.18)', 256, true));

  // ---- minimap (static layer) ----
  const mm = document.createElement('canvas');
  mm.width = mm.height = 180;
  const g = mm.getContext('2d');
  const s = mm.width / N;
  g.fillStyle = '#17120c';
  g.fillRect(0, 0, mm.width, mm.height);
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const v = cellAt(cx, cz);
      if (v === 0) continue;
      g.fillStyle = v === 1 ? '#c8ae7f' : '#7a5c3a';
      g.fillRect(cx * s, cz * s, s + 0.5, s + 0.5);
    }
  }
  g.font = 'bold 9px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(30,20,10,0.8)';
  for (const [name, px, py] of CALLOUTS) g.fillText(name, (px / 10) * s, (py / 10) * s + 3);

  return { minimap: mm };
}
