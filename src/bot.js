// The opponent. It plays by the same rules as the player: it needs line of sight,
// is blocked by smoke, can be flashed, and has to turn and aim before it hits you.
import * as THREE from 'three';
import { lineClear, findPath, pxToWorld, GOALS, resolveCircle, SPAWNS } from './map.js';
import { buildWorldGun } from './weapons.js';
import { makeMuzzleFlash, flashShow, flashTick } from './fx.js';
import { sfx } from './audio.js';

export const DIFFICULTY = {
  easy:   { react: 0.55, turn: 3.2, spread: 0.035, headChance: 0.08, pause: [0.5, 1.0] },
  normal: { react: 0.36, turn: 5.0, spread: 0.02,  headChance: 0.18, pause: [0.3, 0.7] },
  hard:   { react: 0.22, turn: 8.0, spread: 0.011, headChance: 0.3,  pause: [0.2, 0.45] },
};

const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const rnd = (a, b) => a + Math.random() * (b - a);
export const BOT_EYE = 1.62;

export function makeModel(color) {
  const root = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const add = (parent, w, h, d, c, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c));
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  const pants = color.pants, shirt = color.shirt;
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.13, 0.82, 0); legR.position.set(0.13, 0.82, 0);
  add(legL, 0.2, 0.82, 0.22, pants, 0, -0.41, 0);
  add(legR, 0.2, 0.82, 0.22, pants, 0, -0.41, 0);
  root.add(legL, legR);
  add(root, 0.5, 0.6, 0.28, shirt, 0, 1.12, 0);
  add(root, 0.54, 0.16, 0.3, color.vest, 0, 1.2, 0);
  const head = add(root, 0.24, 0.26, 0.26, 0xc99a73, 0, 1.6, 0);
  add(root, 0.28, 0.12, 0.3, color.helmet, 0, 1.73, 0);
  add(root, 0.28, 0.04, 0.06, color.helmet, 0, 1.69, -0.16);              // helmet brim
  add(root, 0.045, 0.04, 0.012, 0x15110d, -0.06, 1.61, -0.135);            // eyes mark the front
  add(root, 0.045, 0.04, 0.012, 0x15110d, 0.06, 1.61, -0.135);
  // gun arm group aims with pitch
  const aim = new THREE.Group();
  aim.position.set(0, 1.35, -0.1);
  root.add(aim);
  const gun = buildWorldGun('ak');
  gun.group.position.set(0.16, -0.08, -0.15);
  gun.group.scale.setScalar(1.15);
  aim.add(gun.group);
  add(aim, 0.12, 0.12, 0.45, shirt, 0.2, -0.05, 0.05);
  add(aim, 0.12, 0.12, 0.4, shirt, -0.05, -0.05, -0.2);
  const flash = makeMuzzleFlash(0.28);
  flash.position.copy(gun.muzzle.position);
  gun.group.add(flash);
  return { root, legL, legR, aim, flash, head };
}

export class Bot {
  constructor(scene, diffKey = 'normal') {
    this.scene = scene;
    this.d = DIFFICULTY[diffKey];
    this.model = makeModel({ shirt: 0x34495e, pants: 0x2b3440, vest: 0x1f2630, helmet: 0x1f2630 });
    scene.add(this.model.root);
    this.x = 0; this.z = 0; this.y = 0; this.yaw = 0; this.pitch = 0;
    this.eyeY = BOT_EYE;
    this.alive = true; this.hp = 100;
    this.deathT = 0;
    this.speed = 0; this.walkPhase = 0; this.stepT = 0;
    this.vx = 0; this.vz = 0;
  }

  setDifficulty(key) { this.d = DIFFICULTY[key]; }

  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = 0;
    this.hp = 100; this.alive = true; this.deathT = 0;
    this.mag = 30; this.reserve = 90; this.reloadT = 0;
    this.smokes = 1; this.flashes = 1;
    this.state = 'roam'; this.path = null; this.pathI = 0; this.goalT = 0;
    this.seenT = 0; this.engaged = false; this.lastSeen = null; this.sawRecently = 0;
    this.nextShot = 0; this.burst = 0; this.burstLen = 3; this.pauseT = 0;
    this.strafeDir = 1; this.strafeT = 0; this.moveT = 0;
    this.flashT = 0; this.lookT = 0; this.hurtT = 0; this.sinceHit = 99;
    this.throwCool = 0; this.walkMode = false; this.walkT = 0; this.waitT = 0; this.blindYaw = undefined; this.aimHead = undefined;
    this.model.root.rotation.set(0, 0, 0);
    this.model.root.position.y = 0;
    this.model.root.visible = true;
    this.model.aim.rotation.set(0, 0, 0);
    this.syncModel();
  }

  die() { this.alive = false; this.hp = 0; this.deathT = 0; this.speed = 0; }

  takeDamage(amount, fromX, fromZ) {
    this.hp -= amount;
    this.sinceHit = 0;
    if (this.alive) {
      // react to being shot: remember where it came from
      this.lastSeen = { x: fromX, z: fromZ, t: 0 };
      this.state = 'hunt'; this.path = null;
    }
  }

  blind(seconds) { this.flashT = Math.max(this.flashT, seconds); this.engaged = false; this.seenT = 0; }

  syncModel() {
    const r = this.model.root;
    r.position.x = this.x; r.position.z = this.z;
    r.rotation.y = this.yaw;
    this.model.aim.rotation.x = this.pitch;
    const sw = Math.sin(this.walkPhase) * Math.min(1, this.speed / 4) * 0.7;
    this.model.legL.rotation.x = sw; this.model.legR.rotation.x = -sw;
  }

  moveBy(dx, dz) {
    const p = { x: this.x + dx, z: this.z + dz };
    resolveCircle(p, 0.38);
    this.x = p.x; this.z = p.z;
  }

  steerTo(tx, tz, speed, dt) {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.01) return;
    const s = Math.min(speed * dt, d);
    this.moveBy((dx / d) * s, (dz / d) * s);
    this.vx = (dx / d) * speed; this.vz = (dz / d) * speed;
    this.speed = speed;
  }

  followPath(speed, dt, g) {
    if (!this.path || this.pathI >= this.path.length) return true;
    let wp = this.path[this.pathI];
    if (Math.hypot(wp.x - this.x, wp.z - this.z) < 0.7) {
      this.pathI++;
      if (this.pathI >= this.path.length) return true;
      wp = this.path[this.pathI];
    }
    this.steerTo(wp.x, wp.z, speed, dt);
    return false;
  }

  pickGoal(g) {
    // favour the sites and mid, avoid sitting in own spawn
    for (let tries = 0; tries < 6; tries++) {
      const [px, py] = GOALS[(Math.random() * GOALS.length) | 0];
      const w = pxToWorld(px, py);
      if (Math.hypot(w.x - this.x, w.z - this.z) > 10) return w;
    }
    return pxToWorld(...GOALS[0]);
  }

  setPath(g, x, z) {
    this.path = findPath(this.x, this.z, x, z);
    this.pathI = 0;
  }

  update(dt, g) {
    flashTick(this.model.flash, dt);
    if (!this.alive) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.5);
      this.model.root.rotation.x = -Math.PI / 2 * (1 - Math.pow(1 - k, 2));
      this.model.root.position.y = 0.12 * k;
      return;
    }
    const P = g.player;
    this.sinceHit += dt;
    this.nextShot -= dt; this.pauseT -= dt; this.strafeT -= dt; this.throwCool -= dt; this.walkT -= dt;
    if (this.flashT > 0) this.flashT -= dt;
    const flashed = this.flashT > 0;
    this.speed = 0; this.vx = 0; this.vz = 0;

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const n = Math.min(30 - this.mag, this.reserve); this.mag += n; this.reserve -= n; }
    }

    if (!g.live) { this.syncModel(); return; }

    // ---- perception ----
    const dx = P.x - this.x, dz = P.z - this.z, dist = Math.hypot(dx, dz);
    let sees = false;
    if (P.alive && !flashed) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const dot = (dx * fx + dz * fz) / (dist || 1);
      const fovCos = this.engaged ? -0.35 : 0.2;
      if (dist < 80 && dot > fovCos && lineClear(this.x, this.z, P.x, P.z)
        && !g.sightBlocked(this.x, this.eyeY, this.z, P.x, P.y + 1.3, P.z)) sees = true;
    }
    // hearing: gunshots and loud footsteps give away position (with some error)
    if (!sees && P.alive && P.noise > 0 && dist < P.noise && !flashed) {
      this.lastSeen = { x: P.x + rnd(-2.5, 2.5), z: P.z + rnd(-2.5, 2.5), t: 0 };
      if (this.state !== 'engage') { this.state = 'hunt'; this.path = null; }
    }
    if (sees) {
      this.seenT += dt;
      this.lastSeen = { x: P.x, z: P.z, t: 0, vx: P.vx, vz: P.vz };
      this.sawRecently = 1.2;
    } else {
      this.seenT = Math.max(0, this.seenT - dt * 2);
      this.sawRecently -= dt;
      if (this.lastSeen) this.lastSeen.t += dt;
    }
    this.engaged = sees && this.seenT > this.d.react;
    if (this.engaged) this.state = 'engage';
    else if (this.state === 'engage') { this.state = 'hunt'; this.path = null; }

    let wantYaw = this.yaw, wantPitch = 0, shootAt = null;

    if (flashed) {
      // blind: wander and spray at the last known spot
      this.lookT -= dt;
      if (this.lookT <= 0) { this.lookT = rnd(0.3, 0.8); this.blindYaw = this.yaw + rnd(-1.5, 1.5); }
      wantYaw = this.blindYaw ?? this.yaw;
      if (this.lastSeen && this.lastSeen.t < 3 && this.mag > 0 && this.nextShot <= 0 && this.reloadT <= 0 && Math.random() < dt * 3) {
        shootAt = { x: this.lastSeen.x, y: 1.2, z: this.lastSeen.z, wild: 0.18 };
      }
    } else if (this.state === 'engage') {
      wantYaw = Math.atan2(-dx, -dz);
      const headChance = this.d.headChance;
      if (this.aimHead === undefined || this.nextShot <= 0 && Math.random() < 0.3) this.aimHead = Math.random() < headChance;
      const ty = P.y + (this.aimHead ? 1.6 : 1.15);
      wantPitch = Math.atan2(ty - this.eyeY, dist);
      shootAt = { x: P.x, y: ty, z: P.z, wild: 0 };

      // move: strafe in bursts, advance when far, retreat to cover when hurt
      if (this.strafeT <= 0) {
        this.strafeT = rnd(0.35, 0.8);
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.moveT = Math.random() < 0.55 ? 0.35 : 0;   // sometimes stand still to shoot
      }
      if (this.moveT > 0) {
        this.moveT -= dt;
        const nx = -dz / (dist || 1), nz = dx / (dist || 1);
        this.moveBy(nx * this.strafeDir * 3.4 * dt, nz * this.strafeDir * 3.4 * dt);
        this.speed = 3.4;
        this.vx = nx * this.strafeDir * 3.4; this.vz = nz * this.strafeDir * 3.4;
      } else if (dist > 24) {
        this.steerTo(this.x + (dx / dist), this.z + (dz / dist), 3.2, dt);
      }

      // use utility: smoke the lane when losing a long-range fight
      if (this.smokes > 0 && this.throwCool <= 0 && dist > 14 && this.hp < 66 && this.sinceHit < 1.5 && Math.random() < dt * 1.5) {
        g.botThrow(this, 'smoke', this.x + dx * 0.45, this.z + dz * 0.45);
        this.smokes--; this.throwCool = 3;
        this.lastSeen = null; this.state = 'roam'; this.path = null; this.engaged = false;
      }
    } else if (this.state === 'hunt' && this.lastSeen) {
      // go to the last known position; flash the corner first if close
      const ls = this.lastSeen;
      const ld = Math.hypot(ls.x - this.x, ls.z - this.z);
      if (this.flashes > 0 && this.throwCool <= 0 && ld > 8 && ld < 22 && !lineClear(this.x, this.z, ls.x, ls.z) && Math.random() < dt * 1.2) {
        g.botThrow(this, 'flash', ls.x, ls.z);
        this.flashes--; this.throwCool = 2.2; this.waitT = 1.5;
      }
      if (this.waitT > 0) {
        this.waitT -= dt;
        wantYaw = Math.atan2(-(ls.x - this.x), -(ls.z - this.z));
      } else {
        if (!this.path || this.pathStamp !== ls) { this.setPath(g, ls.x, ls.z); this.pathStamp = ls; }
        const sp = this.walkMode ? 3.0 : 5.0;
        const done = this.followPath(sp, dt, g);
        if (done || ld < 1.6) { this.state = 'roam'; this.path = null; this.lastSeen = null; }
        else {
          const wp = this.path[Math.min(this.pathI, this.path.length - 1)];
          wantYaw = Math.atan2(-(wp.x - this.x), -(wp.z - this.z));
        }
      }
    } else {
      // roam between goals; sometimes walk quietly
      if (this.walkT <= 0) { this.walkT = rnd(1.5, 4); this.walkMode = Math.random() < 0.4; }
      if (!this.path || this.pathI >= this.path.length) {
        const w = this.pickGoal(g);
        this.setPath(g, w.x, w.z);
        if (!this.path) this.path = null;
      }
      const done = this.followPath(this.walkMode ? 3.0 : 5.0, dt, g);
      if (done) this.path = null;
      else if (this.path) {
        const wp = this.path[Math.min(this.pathI, this.path.length - 1)];
        wantYaw = Math.atan2(-(wp.x - this.x), -(wp.z - this.z));
      }
    }

    // ---- turn and aim ----
    const turn = (this.state === 'engage' ? this.d.turn * 1.4 : this.d.turn) * dt;
    const diff = wrap(wantYaw - this.yaw);
    this.yaw += Math.max(-turn, Math.min(turn, diff));
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 10);

    // ---- shoot ----
    if (shootAt && this.mag > 0 && this.reloadT <= 0 && this.nextShot <= 0 && this.pauseT <= 0) {
      const aimErr = Math.abs(wrap(Math.atan2(-(shootAt.x - this.x), -(shootAt.z - this.z)) - this.yaw));
      if (aimErr < 0.1 || shootAt.wild) {
        const origin = new THREE.Vector3(this.x - Math.sin(this.yaw) * 0.4, this.eyeY - 0.15, this.z - Math.cos(this.yaw) * 0.4);
        const dir = new THREE.Vector3(shootAt.x - origin.x, shootAt.y - origin.y, shootAt.z - origin.z).normalize();
        const moving = Math.min(1, this.speed / 4);
        const spread = shootAt.wild || (this.d.spread * (1 + this.burst * 0.45) + moving * 0.05);
        dir.x += (Math.random() - 0.5) * spread * 2;
        dir.y += (Math.random() - 0.5) * spread * 2;
        dir.z += (Math.random() - 0.5) * spread * 2;
        dir.normalize();
        this.mag--; this.burst++;
        this.nextShot = 0.1 + (Math.random() < 0.15 ? 0.04 : 0);
        flashShow(this.model.flash);
        g.botShoot(this, origin, dir);
        if (this.burst >= this.burstLen) {
          this.burst = 0; this.burstLen = 2 + ((Math.random() * 5) | 0);
          const [a, b] = this.d.pause;
          this.pauseT = rnd(a, b) * (dist > 20 ? 1.4 : 1);
        }
      }
    } else if (this.mag === 0 && this.reloadT <= 0 && this.reserve > 0) {
      this.reloadT = 2.4; sfx.reload({ x: this.x, z: this.z });
    } else if (!shootAt && this.mag < 12 && this.reloadT <= 0 && this.reserve > 0 && this.state !== 'engage') {
      this.reloadT = 2.4; sfx.reload({ x: this.x, z: this.z });
    }
    if (this.mag === 0 && this.reserve === 0) { this.mag = 30; this.reserve = 90; } // never let the bot run dry

    // footsteps (running is loud, walking is quiet)
    if (this.speed > 0.5) {
      this.walkPhase += dt * this.speed * 2.2;
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.4 * 5 / Math.max(this.speed, 2.5);
        const loud = this.speed > 4 ? 1 : this.speed > 2.5 ? 0.25 : 0;
        if (loud) sfx.step({ x: this.x, z: this.z }, loud);
      }
    }
    this.syncModel();
  }
}

export { SPAWNS };
