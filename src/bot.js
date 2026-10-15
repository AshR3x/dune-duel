// The opponent. It plays by the same rules as the player: it needs line of sight,
// is blocked by smoke, can be flashed, and has to turn and aim before it hits you.
import * as THREE from 'three';
import { lineClear, findPath, pxToWorld, GOALS, resolveCircle, SPAWNS } from './map.js';
import { buildWorldGun, WEAPONS, GRENADES, SHOP, allowedFor, defaultPistol, isGun, tuning, isAuto } from './weapons.js';
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
  add(aim, 0.12, 0.12, 0.45, shirt, 0.2, -0.05, 0.05);
  add(aim, 0.12, 0.12, 0.4, shirt, -0.05, -0.05, -0.2);
  const model = { root, legL, legR, aim, flash: null, head, gunGroup: null, gunId: null };
  // swap the held weapon (the model is rebuilt per weapon; it is cheap and happens once per round)
  model.setGun = (id) => {
    if (model.gunId === id) return;
    if (model.gunGroup) aim.remove(model.gunGroup);
    const gun = buildWorldGun(id);
    gun.group.position.set(0.16, -0.08, -0.15);
    gun.group.scale.setScalar(1.15);
    aim.add(gun.group);
    const flash = makeMuzzleFlash(Math.max(0.18, (WEAPONS[id]?.flash ?? 0.2) * 1.4));
    flash.position.copy(gun.muzzle ? gun.muzzle.position : new THREE.Vector3(0, 0, -0.3));
    gun.group.add(flash);
    model.flash = flash; model.gunGroup = gun.group; model.gunId = id;
  };
  model.setGun('ak47');
  return model;
}

export class Bot {
  constructor(scene, diffKey = 'normal') {
    this.scene = scene;
    this.d = DIFFICULTY[diffKey];
    this.model = makeModel({ shirt: 0x34495e, pants: 0x2b3440, vest: 0x1f2630, helmet: 0x1f2630 });
    scene.add(this.model.root);
    this.x = 0; this.z = 0; this.y = 0; this.yaw = 0; this.pitch = 0;
    this.eyeY = BOT_EYE;
    this.crouch = 0; this.wantCrouch = false; this.crouchPick = false;
    this.alive = true; this.hp = 100;
    this.deathT = 0;
    this.speed = 0; this.walkPhase = 0; this.stepT = 0;
    this.vx = 0; this.vz = 0;
    this.money = 800; this.side = 'T';
    this.defaultLoadout('T');
  }

  // ---- loadout ----
  defaultLoadout(side) {
    this.side = side;
    this.primary = null; this.secondary = defaultPistol(side); this.armor = 0; this.helmet = false;
    this.nades = { he: 0, flash: 0, smoke: 0, molotov: 0, incendiary: 0, decoy: 0 };
    this.ammo = {};
    this.equip(this.secondary);
  }

  equip(id) {
    const w = WEAPONS[id];
    if (!this.ammo[id]) this.ammo[id] = { mag: w.mag, reserve: w.reserve };
    this.weapon = id; this.w = w; this.cur = this.ammo[id];
    this.reloadT = 0;
    this.model.setGun(id);
  }

  get mag() { return this.cur.mag; }
  set mag(v) { this.cur.mag = v; }
  get reserve() { return this.cur.reserve; }
  set reserve(v) { this.cur.reserve = v; }

  give(id) {
    const w = WEAPONS[id];
    if (w.cls === 'pistol') this.secondary = id; else this.primary = id;
    this.ammo[id] = { mag: w.mag, reserve: w.reserve };
  }

  dropIds() { return [this.primary, this.secondary].filter(Boolean); }

  // Spends money the way a CS bot would: full buy when rich, force or save when not.
  buy(side, roundInHalf) {
    let m = this.money;
    const bought = [];
    const buyW = (id) => { const w = WEAPONS[id]; if (!w || w.price > m || !allowedFor(w, side)) return false; m -= w.price; this.give(id); bought.push(w.name); return true; };
    const buyArmor = (helm) => {
      const p = helm ? (this.armor > 0 ? (this.helmet ? 650 : 350) : 1000) : 650;
      if (m < p || (this.armor >= 70 && (this.helmet || !helm))) return false;
      m -= p; this.armor = 100; this.helmet = this.helmet || helm; bought.push(helm ? 'Kevlar+Helmet' : 'Kevlar'); return true;
    };
    const total = () => Object.values(this.nades).reduce((a, b) => a + b, 0);
    const buyNade = (id) => {
      const g = GRENADES[id];
      if (!allowedFor(g, side) || m < g.price || total() >= 4 || this.nades[id] >= g.max) return false;
      m -= g.price; this.nades[id]++; bought.push(g.name); return true;
    };
    const fire = side === 'T' ? 'molotov' : 'incendiary';
    const pickFrom = (ids, budget = m) => {
      const ok = ids.filter((id) => allowedFor(WEAPONS[id], side) && WEAPONS[id].price <= budget);
      return ok.length ? ok[(Math.random() * ok.length) | 0] : null;
    };
    const pistolRound = roundInHalf === 1;
    if (this.primary && m >= 650 && this.armor < 40) buyArmor(true);
    if (!this.primary) {
      if (pistolRound) {
        const r = Math.random();
        if (r < 0.5) { buyArmor(false); buyNade('flash'); }
        else if (r < 0.8) { buyW(pickFrom(['p250', 'tec9', 'fiveseven', 'cz75', 'dualies'])); buyNade('flash'); buyNade('smoke'); }
        else buyW('deagle');
      } else if (m >= 3700) {
        const rifles = side === 'T' ? ['ak47', 'ak47', 'ak47', 'galil', 'sg553'] : ['m4a4', 'm4a4', 'm4a1s', 'famas', 'aug'];
        if (m >= 5600 && Math.random() < 0.18) buyW('awp'); else buyW(pickFrom(rifles));
        buyArmor(true);
        for (const id of ['flash', 'smoke', 'he', fire]) if (Math.random() < 0.7) buyNade(id);
      } else if (m >= 2000 && Math.random() < 0.65) {
        const pool = m >= 3000 ? ['mp7', 'ump45', 'p90', 'bizon', 'nova', 'xm1014', 'mag7', 'sawedoff', 'galil', 'famas'] : ['mac10', 'mp9', 'mp7', 'ump45', 'bizon', 'nova', 'mag7', 'sawedoff'];
        const id = pickFrom(pool, m - 650);
        if (id) buyW(id);
        buyArmor(false); buyNade('flash');
      } else if (m < 2000 && Math.random() < 0.55) {
        // save round
      } else {
        if (m >= 1000 && Math.random() < 0.5) buyW(pickFrom(['p250', 'deagle', 'fiveseven', 'tec9', 'cz75', 'dualies'], m - 650));
        buyArmor(false); buyNade('flash');
      }
    } else if (m > 1500) {
      for (const id of ['flash', 'smoke', 'he', fire]) if (Math.random() < 0.6) buyNade(id);
    }
    this.money = m;
    if (this.primary) this.equip(this.primary); else this.equip(this.secondary);
    return bought;
  }

  setDifficulty(key) { this.d = DIFFICULTY[key]; }

  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = 0;
    this.hp = 100; this.alive = true; this.deathT = 0; this.crouch = 0; this.crouchPick = false; this.eyeY = BOT_EYE;
    for (const id of this.dropIds()) { const w = WEAPONS[id], a = this.ammo[id]; const need = Math.min(w.mag - a.mag, a.reserve); a.mag += need; a.reserve -= need; }
    this.equip(this.primary || this.secondary);
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
    if (this.skin) this.skin.play('Idle', { fade: 0 });
    this.syncModel();
  }

  // Swaps the blocky body for a rigged character; the gun and muzzle flash stay on the aim group.
  setSkin(skin) {
    if (this.skin) this.skin.dispose();
    this.skin = skin;
    if (!skin) return;
    const m = this.model;
    m.root.add(skin.root);
    for (const c of m.root.children) if (c !== m.aim && c !== skin.root) c.visible = false;
    for (const c of m.aim.children) if (c !== m.gunGroup) c.visible = false;
    m.aim.position.y = 1.1;                       // hold the gun at chest height on the taller rig
    skin.play('Idle', { fade: 0 });
  }

  updateSkin(dt) {
    const k = this.skin;
    if (!this.alive) k.play('Death', { loop: false, fade: 0.1 });
    else if (this.speed > 3.6) k.play('Run_Carry', { speed: Math.min(1.3, this.speed / 5) });
    else if (this.speed > 0.4) k.play('Walk_Carry', { speed: Math.max(0.6, this.speed / 3) });
    else k.play('Idle');
    k.crouchK = this.alive ? this.crouch : 0;
    this.model.aim.position.y = 1.1 - 0.4 * this.crouch;          // the gun sinks with the body
    k.update(dt);
  }

  die() { this.alive = false; this.hp = 0; this.deathT = 0; this.speed = 0; }

  takeDamage(amount, fromX, fromZ) {
    this.hp -= amount * tuning.dmg;
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
    if (!this.skin) this.model.root.scale.y = 1 - 0.3 * this.crouch;   // blocky fallback body just squashes
    const sw = Math.sin(this.walkPhase) * Math.min(1, this.speed / 4) * 0.7;
    this.model.legL.rotation.x = sw; this.model.legR.rotation.x = -sw;
  }

  moveBy(dx, dz) {
    const p = { x: this.x + dx, z: this.z + dz };
    resolveCircle(p, 0.38);
    this.x = p.x; this.z = p.z;
  }

  startReload() {
    this.reloadT = this.w.shell ? this.w.reload * (this.w.mag - this.mag) : this.w.reload;
    sfx.reload({ x: this.x, z: this.z });
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
    if (this.skin) this.updateSkin(dt);
    if (!this.alive) {
      this.deathT += dt;
      if (this.skin) return;
      const k = Math.min(1, this.deathT / 0.5);
      this.model.root.rotation.x = -Math.PI / 2 * (1 - Math.pow(1 - k, 2));
      this.model.root.position.y = 0.12 * k;
      return;
    }
    const P = g.player;
    const sf = Math.min(1.15, this.w.speed / 0.86), cls = this.w.cls;
    this.sinceHit += dt;
    this.nextShot -= dt; this.pauseT -= dt; this.strafeT -= dt; this.throwCool -= dt; this.walkT -= dt;
    if (this.flashT > 0) this.flashT -= dt;
    const flashed = this.flashT > 0;
    this.speed = 0; this.vx = 0; this.vz = 0;
    // crouching: eased in and out; set again each frame by the fight logic below
    this.wantCrouch = false;

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const n = Math.min(this.w.mag - this.mag, this.reserve); this.mag += n; this.reserve -= n; }
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
    if (!sees && !flashed && g.decoys) {
      for (const dc of g.decoys) {
        if (Math.hypot(dc.x - this.x, dc.z - this.z) < dc.r && this.state !== 'engage') {
          this.lastSeen = { x: dc.x + rnd(-1.5, 1.5), z: dc.z + rnd(-1.5, 1.5), t: 0 };
          this.state = 'hunt'; this.path = null;
        }
      }
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
    this.engaged = sees && this.seenT > this.d.react * (cls === 'sniper' ? 1.5 : 1);
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
      const ty = P.y + (this.aimHead ? 1.6 - 0.45 * (P.crouch || 0) : 1.15 - 0.35 * (P.crouch || 0));
      wantPitch = Math.atan2(ty - this.eyeY, dist);
      shootAt = { x: P.x, y: ty, z: P.z, wild: 0 };

      // move: strafe in bursts, advance when far, retreat to cover when hurt
      if (this.strafeT <= 0) {
        this.strafeT = rnd(0.35, 0.8) * tuning.strafe;
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.moveT = Math.random() < 0.55 ? 0.35 : 0;   // sometimes stand still to shoot
        this.crouchPick = this.moveT <= 0 && dist > 7 && Math.random() < 0.5;   // ...and when standing still, often crouch to shoot
        if (this.crouchPick) this.strafeT = rnd(0.9, 1.7);
      }
      if (this.moveT > 0) {
        this.moveT -= dt;
        const nx = -dz / (dist || 1), nz = dx / (dist || 1);
        this.moveBy(nx * this.strafeDir * 3.4 * sf * dt, nz * this.strafeDir * 3.4 * sf * dt);
        this.speed = 3.4 * sf;
        this.vx = nx * this.strafeDir * 3.4 * sf; this.vz = nz * this.strafeDir * 3.4 * sf;
      } else if (dist > 24) {
        this.steerTo(this.x + (dx / dist), this.z + (dz / dist), 3.2 * sf, dt);
      }

      // use utility: smoke the lane when losing a long-range fight
      if (this.nades.smoke > 0 && this.throwCool <= 0 && dist > 14 && this.hp < 66 && this.sinceHit < 1.5 && Math.random() < dt * 1.5) {
        g.botThrow(this, 'smoke', this.x + dx * 0.45, this.z + dz * 0.45);
        this.nades.smoke--; this.throwCool = 3;
        this.lastSeen = null; this.state = 'roam'; this.path = null; this.engaged = false;
      }
    } else if (this.state === 'hunt' && this.lastSeen) {
      // go to the last known position; flash the corner first if close
      const ls = this.lastSeen;
      const ld = Math.hypot(ls.x - this.x, ls.z - this.z);
      if (this.throwCool <= 0 && ld > 8 && ld < 22 && !lineClear(this.x, this.z, ls.x, ls.z) && Math.random() < dt * 1.2) {
        const fireId = this.nades.molotov > 0 ? 'molotov' : 'incendiary';
        const opts = ['flash', 'he', fireId].filter((k) => this.nades[k] > 0);
        if (opts.length) {
          const k = opts[(Math.random() * opts.length) | 0];
          g.botThrow(this, k, ls.x, ls.z);
          this.nades[k]--; this.throwCool = 2.2; this.waitT = k === 'flash' ? 1.5 : 0.8;
        }
      }
      if (this.waitT > 0) {
        this.waitT -= dt;
        wantYaw = Math.atan2(-(ls.x - this.x), -(ls.z - this.z));
      } else {
        if (!this.path || this.pathStamp !== ls) { this.setPath(g, ls.x, ls.z); this.pathStamp = ls; }
        const sp = (this.walkMode ? 3.0 : 5.0) * sf;
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
      const done = this.followPath((this.walkMode ? 3.0 : 5.0) * sf, dt, g);
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
    const w = this.w;
    if (shootAt && this.mag > 0 && this.reloadT <= 0 && this.nextShot <= 0 && this.pauseT <= 0) {
      const aimErr = Math.abs(wrap(Math.atan2(-(shootAt.x - this.x), -(shootAt.z - this.z)) - this.yaw));
      if (aimErr < 0.1 || shootAt.wild) {
        const origin = new THREE.Vector3(this.x - Math.sin(this.yaw) * 0.4, this.eyeY - 0.15, this.z - Math.cos(this.yaw) * 0.4);
        const dir = new THREE.Vector3(shootAt.x - origin.x, shootAt.y - origin.y, shootAt.z - origin.z).normalize();
        const moving = Math.min(1, this.speed / 4);
        const clsAcc = cls === 'sniper' ? 0.35 : cls === 'pistol' ? 1.2 : cls === 'smg' ? 1.1 : 1;
        const spread = shootAt.wild || (this.d.spread * clsAcc * (1 + this.burst * (isAuto(w) ? 0.45 : 0.2)) * (1 - 0.22 * this.crouch) + moving * (cls === 'sniper' ? 0.14 : 0.05));
        dir.x += (Math.random() - 0.5) * spread * 2;
        dir.y += (Math.random() - 0.5) * spread * 2;
        dir.z += (Math.random() - 0.5) * spread * 2;
        dir.normalize();
        this.mag--; this.burst++;
        this.nextShot = w.rate + (w.auto ? (Math.random() < 0.15 ? 0.04 : 0) : 0.06 + Math.random() * 0.14);
        flashShow(this.model.flash);
        g.botShoot(this, origin, dir);
        const burstMax = { rifle: 7, smg: 10, lmg: 22, pistol: 3, shotgun: 1, sniper: 1 }[cls] ?? 5;
        if (this.burst >= this.burstLen) {
          this.burst = 0; this.burstLen = 1 + ((Math.random() * burstMax) | 0);
          const [a, b] = this.d.pause;
          this.pauseT = rnd(a, b) * (dist > 20 ? 1.4 : 1) * (cls === 'sniper' ? 0.2 : 1);
        }
      }
    } else if (this.mag === 0 && this.reloadT <= 0 && this.reserve > 0) {
      this.startReload();
    } else if (!shootAt && this.mag < w.mag * 0.4 && this.reloadT <= 0 && this.reserve > 0 && this.state !== 'engage') {
      this.startReload();
    }
    if (this.mag === 0 && this.reserve === 0) {
      if (this.weapon !== this.secondary && this.secondary) this.equip(this.secondary);
      else { this.mag = w.mag; this.reserve = w.reserve; }    // never let the bot run dry
    }

    // crouch only while holding position in a fight; moving or losing the target stands the bot back up
    const wantC = this.state === 'engage' && this.moveT <= 0 && this.speed < 0.5 && this.crouchPick && !flashed ? 1 : 0;
    this.crouch += (wantC - this.crouch) * Math.min(1, dt * 8);
    if (Math.abs(this.crouch - wantC) < 0.01) this.crouch = wantC;
    this.eyeY = BOT_EYE - 0.45 * this.crouch;

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
