// Grid-based map. One top-down layout drives rendering, collision, bot pathing,
// line of sight, and bullets, so they can never disagree.
// The layout is a condensed 1v1 take on a classic three-lane desert map:
// Long A on the right, Mid down the centre, B Tunnels on the left,
// with T spawn at the bottom and CT spawn at the top.
// Coordinates below are in "radar pixels" (0..900) taken from a top-down overview.

export const N = 90;            // grid size (cells)
export const CELL = 0.9;        // world units per cell
const PX = 10;                  // radar pixels per cell
const HALF = (N * CELL) / 2;

export const WALL_H = 4.6;
export const CRATE_H = 2.3;

// walkable rectangles [x0, y0, x1, y1]
const OPEN = [
  [70, 20, 120, 110],     // B back corner
  [60, 70, 235, 300],     // B site
  [60, 230, 115, 340],    // B left lane
  [55, 340, 290, 440],    // upper tunnels
  [150, 440, 185, 525],   // tunnel stairs
  [80, 520, 240, 770],    // outside tunnels
  [50, 760, 590, 880],    // T spawn strip
  [340, 540, 565, 780],   // T mid yard
  [545, 540, 655, 770],   // toward long
  [600, 400, 860, 605],   // outside long
  [750, 30, 855, 605],    // long lane
  [545, 30, 760, 200],    // A site
  [600, 195, 760, 245],   // short / catwalk exit
  [440, 140, 610, 240],   // CT spawn
  [545, 235, 600, 335],   // CT mid
  [440, 330, 600, 620],   // mid right
  [395, 230, 445, 600],   // mid corridor
  [235, 105, 445, 235],   // B doors corridor
];

// solid rectangles carved out of open space (buildings)
const WALLS = [
  [420, 590, 520, 740],   // T-side building
  [470, 385, 600, 545],   // centre block
  [215, 640, 240, 690],   // small block
];

// low cover (crates, cars)
const CRATES = [
  [655, 95, 695, 125], [560, 100, 590, 140], [715, 160, 745, 195],   // A
  [100, 170, 140, 205], [175, 230, 215, 265], [75, 130, 105, 160],   // B
  [350, 700, 380, 730], [530, 560, 555, 590],                          // T yard
  [790, 300, 820, 330], [700, 470, 730, 500], [620, 430, 650, 460],  // long
  [120, 380, 150, 410],                                                // tunnels
  [150, 810, 180, 840], [470, 800, 500, 830],                          // T spawn
  [470, 180, 500, 210],                                                // CT
];

export const ZONES = {
  A: [690, 120, 745, 185],
  B: [150, 75, 225, 150],
  T: [262, 780, 435, 850],
  CT: [510, 140, 600, 235],
};

// Places the bot likes to visit, in radar pixels.
export const GOALS = [
  [650, 150], [130, 200], [420, 420], [800, 480], [150, 390],
  [555, 190], [420, 300], [330, 170], [450, 560], [640, 660], [150, 640],
];

export const CALLOUTS = [
  ['A', 690, 160], ['B', 150, 120], ['MID', 420, 440], ['LONG', 805, 360],
  ['TUNNELS', 170, 395], ['CT', 555, 190], ['T', 345, 820],
];

export function pxToWorld(px, py) {
  return { x: (px / PX) * CELL - HALF, z: (py / PX) * CELL - HALF };
}
export function worldToCell(x, z) {
  return [Math.floor((x + HALF) / CELL), Math.floor((z + HALF) / CELL)];
}
export function cellCenter(cx, cz) {
  return { x: (cx + 0.5) * CELL - HALF, z: (cz + 0.5) * CELL - HALF };
}

export const SPAWNS = {
  T: pxToWorld(345, 825),
  CT: pxToWorld(560, 190),
};

// 0 = wall, 1 = open, 2 = crate
export const grid = new Uint8Array(N * N);
function fill(rects, v) {
  for (const [x0, y0, x1, y1] of rects) {
    for (let cz = Math.floor(y0 / PX); cz < Math.ceil(y1 / PX); cz++) {
      for (let cx = Math.floor(x0 / PX); cx < Math.ceil(x1 / PX); cx++) {
        if (cx >= 0 && cz >= 0 && cx < N && cz < N) grid[cz * N + cx] = v;
      }
    }
  }
}
fill(OPEN, 1);
fill(WALLS, 0);
fill(CRATES, 2);

export const cellAt = (cx, cz) => (cx < 0 || cz < 0 || cx >= N || cz >= N ? 0 : grid[cz * N + cx]);
export const isSolidCell = (cx, cz) => cellAt(cx, cz) !== 1;
export function isSolid(x, z) {
  const [cx, cz] = worldToCell(x, z);
  return isSolidCell(cx, cz);
}
export const heightOf = (v) => (v === 2 ? CRATE_H : WALL_H);

// Push a circle out of walls. Mutates and returns p.
export function resolveCircle(p, r) {
  const [cx, cz] = worldToCell(p.x, p.z);
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const gx = cx + dx, gz = cz + dz;
      if (!isSolidCell(gx, gz)) continue;
      const minX = gx * CELL - HALF, maxX = minX + CELL;
      const minZ = gz * CELL - HALF, maxZ = minZ + CELL;
      const nx = Math.max(minX, Math.min(p.x, maxX));
      const nz = Math.max(minZ, Math.min(p.z, maxZ));
      const ddx = p.x - nx, ddz = p.z - nz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < r * r) {
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), push = r - d;
          p.x += (ddx / d) * push;
          p.z += (ddz / d) * push;
        } else {
          p.x += r; // exactly inside a wall: nudge out
        }
      }
    }
  }
  return p;
}

// Distance along a ray to the first solid cell (grid DDA). Returns maxDist if clear.
export function raycast(ox, oz, dx, dz, maxDist) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return maxDist;
  dx /= len; dz /= len;
  let [cx, cz] = worldToCell(ox, oz);
  if (isSolidCell(cx, cz)) return 0;
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
  const gx = (ox + HALF) / CELL, gz = (oz + HALF) / CELL;
  let tMaxX = dx !== 0 ? ((dx > 0 ? cx + 1 - gx : gx - cx) * CELL) / Math.abs(dx) : Infinity;
  let tMaxZ = dz !== 0 ? ((dz > 0 ? cz + 1 - gz : gz - cz) * CELL) / Math.abs(dz) : Infinity;
  let t = 0;
  while (t < maxDist) {
    if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; }
    else { t = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; }
    if (t >= maxDist) break;
    if (isSolidCell(cx, cz)) return t;
  }
  return maxDist;
}

export function lineClear(x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const d = Math.hypot(dx, dz);
  return raycast(x0, z0, dx, dz, d) >= d - 1e-4;
}

// ---- navigation: A* over cells that keep clearance from walls ----
const nav = new Uint8Array(N * N);
for (let cz = 0; cz < N; cz++) {
  for (let cx = 0; cx < N; cx++) {
    if (isSolidCell(cx, cz)) continue;
    let ok = 1;
    for (let dz = -1; dz <= 1 && ok; dz++) {
      for (let dx = -1; dx <= 1; dx++) if (isSolidCell(cx + dx, cz + dz)) { ok = 0; break; }
    }
    nav[cz * N + cx] = ok;
  }
}
export const isNav = (cx, cz) => cx >= 0 && cz >= 0 && cx < N && cz < N && nav[cz * N + cx] === 1;

export function nearestNav(cx, cz) {
  if (isNav(cx, cz)) return [cx, cz];
  for (let r = 1; r < 8; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) === r && isNav(cx + dx, cz + dz)) return [cx + dx, cz + dz];
      }
    }
  }
  return null;
}

export function findPath(sx, sz, gx, gz) {
  const s = nearestNav(...worldToCell(sx, sz)), g = nearestNav(...worldToCell(gx, gz));
  if (!s || !g) return null;
  const si = s[1] * N + s[0], gi = g[1] * N + g[0];
  const cost = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1);
  cost[si] = 0;
  const h = (i) => Math.hypot((i % N) - g[0], ((i / N) | 0) - g[1]);
  const heap = [[h(si), si]];
  const push = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [, cur] = pop();
    if (cur === gi) break;
    const cx = cur % N, cz = (cur / N) | 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!isNav(nx, nz)) continue;
        if (dx && dz && (!isNav(cx + dx, cz) || !isNav(cx, cz + dz))) continue;
        const ni = nz * N + nx, c = cost[cur] + (dx && dz ? 1.414 : 1);
        if (c < cost[ni]) { cost[ni] = c; from[ni] = cur; push([c + h(ni), ni]); }
      }
    }
  }
  if (from[gi] === -1 && si !== gi) return null;
  const path = [];
  for (let i = gi; i !== -1; i = from[i]) path.push(cellCenter(i % N, (i / N) | 0));
  return path.reverse();
}
