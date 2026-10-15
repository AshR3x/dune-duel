// Blocky characters (Kenney "Blocky Characters", CC0) used for the enemy bot's random skins and the player's picker in
// the menu, plus a Minecraft-layout model that wears any 64x64 skin fetched by username. Both share one node rig
// (head, torso, two arms, two legs), so one set of animation clips drives them all.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

export const CHARACTERS = ['i', 'j', 'm', 'q', 'r'];
export const charLabel = (n) => (n.startsWith('mc:') ? n.slice(3) : 'Blocky ' + n.toUpperCase());

const loader = new GLTFLoader();
const HEIGHT = 1.78;                       // metres, standing
const MODEL_H = 2.7;                       // the pack's characters are 2.7 units tall
const SCALE = HEIGHT / MODEL_H;
const CROUCH_DROP = 0.38;                  // fraction of the leg length lost when fully crouched

// ------------------------------------------------------------------ animation
// The pack has one clip per activity, each moving the whole body. The game wants a gun carried while walking, so the
// arms come from the "holding" pose and the legs from the movement clip.
let baseClips = null, clipsPromise = null;
function compose(src) {
  const by = (n) => src.find((c) => c.name === n);
  const node = (t) => t.name.split('.')[0];
  const isArm = (t) => node(t) === 'arm-left' || node(t) === 'arm-right';
  const isLeg = (t) => node(t) === 'leg-left' || node(t) === 'leg-right' || node(t) === 'root';
  const take = (clip, pred) => clip.tracks.filter(pred).map((t) => t.clone());
  const make = (name, ...parts) => {
    const clip = new THREE.AnimationClip(name, -1, parts.flat());
    if (clip.duration < 0.5) clip.duration = 1;
    return clip;
  };
  const hold = by('holding-both'), walk = by('walk'), sprint = by('sprint');
  return {
    Idle: make('Idle', take(hold, isArm)),
    Relaxed: by('idle'),
    Walk_Carry: make('Walk_Carry', take(walk, isLeg), take(hold, isArm)),
    Run_Carry: make('Run_Carry', take(sprint, isLeg), take(hold, isArm)),
    Death: by('die'),
  };
}
function getClips() {
  clipsPromise ||= loader.loadAsync('./assets/blocky/character-r.glb').then((g) => (baseClips = compose(g.animations)));
  return baseClips ? Promise.resolve(baseClips) : clipsPromise;
}

// ------------------------------------------------------------------ the skin object
export class CharacterSkin {
  constructor(name, obj, clips, disposables = []) {
    this.name = name;
    this.root = new THREE.Group();
    this.holder = new THREE.Group();
    this.holder.scale.setScalar(SCALE);
    this.holder.rotation.y = Math.PI;         // the pack faces +Z, the game's characters face -Z
    this.holder.add(obj);
    this.root.add(this.holder);
    this.obj = obj;
    this.disposables = disposables;
    obj.traverse((m) => { if (m.isMesh) m.frustumCulled = false; });
    this.legs = ['leg-left', 'leg-right'].map((n) => obj.getObjectByName(n)).filter(Boolean);
    this.mixer = new THREE.AnimationMixer(obj);
    this.clips = clips;
    this.cur = null; this.action = null; this.crouchK = 0;
  }
  play(name, { loop = true, fade = 0.15, speed = 1, at = null } = {}) {
    if (this.cur === name && !at) return;
    const clip = this.clips[name];
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset(); next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop; next.timeScale = speed;
    if (at !== null) { next.play(); next.time = at; next.paused = true; } else next.play();
    if (this.action && this.action !== next) this.action.crossFadeTo(next, fade, false);
    this.action = next; this.cur = name;
  }
  // Crouch: the blocky legs shorten and the body sinks so the feet stay planted. k runs 0 (standing) to 1.
  crouch(k) {
    this.crouchK = k;
    this.holder.position.y = -CROUCH_DROP * k * SCALE;
    for (const l of this.legs) l.scale.y = 1 - CROUCH_DROP * k;
  }
  update(dt) {
    this.mixer.update(dt);
    this.crouch(this.crouchK);
  }
  dispose() {
    this.mixer.stopAllAction();
    this.obj.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); } });
    for (const d of this.disposables) d.dispose();
    this.root.parent?.remove(this.root);
  }
}

// fetches a fresh copy of the model each time (cheap: the file is cached by the browser), so skins can be reused
export async function loadCharacter(name) {
  if (name.startsWith('mc:')) return loadMinecraftSkin(name.slice(3));
  const [gltf, clips] = await Promise.all([loader.loadAsync(`./assets/blocky/character-${name}.glb`), getClips()]);
  const disposables = [];
  gltf.scene.traverse((m) => {
    if (!m.isMesh) return;
    const old = m.material;
    if (old.map) { old.map.magFilter = THREE.NearestFilter; old.map.minFilter = THREE.NearestFilter; old.map.generateMipmaps = false; old.map.needsUpdate = true; disposables.push(old.map); }
    m.material = new THREE.MeshLambertMaterial({ map: old.map });
    old.dispose();
  });
  return new CharacterSkin(name, gltf.scene, clips, disposables);
}

// ------------------------------------------------------------------ Minecraft skins
// Standard 64x64 layout: each limb is a box whose faces sit in a fixed strip of the texture. Sizes are in texels.
const faceRects = (u, v, w, h, d) => ({
  top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
  right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
});

// 64x32 skins predate separate left limbs: mirror the right ones into the new slots
function modernise(img) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  if (img.height >= 64) return c;
  const flip = (sx, sy, w, h, dx, dy) => { g.save(); g.translate(dx + w, dy); g.scale(-1, 1); g.drawImage(c, sx, sy, w, h, 0, 0, w, h); g.restore(); };
  const copyLimb = (from, to) => {
    const a = faceRects(from[0], from[1], 4, 12, 4), b = faceRects(to[0], to[1], 4, 12, 4);
    for (const f of ['top', 'bottom', 'front', 'back']) flip(...a[f], b[f][0], b[f][1]);
    flip(...a.left, b.right[0], b.right[1]);      // a mirrored limb swaps its outer and inner faces
    flip(...a.right, b.left[0], b.left[1]);
  };
  copyLimb([0, 16], [16, 48]);
  copyLimb([40, 16], [32, 48]);
  return c;
}

// Alex-style skins have 3 texel arms: the 4th column of the arm strip is left transparent
const isSlim = (canvas) => canvas.getContext('2d').getImageData(55, 20, 1, 12).data.every((v, i) => i % 4 !== 3 || v === 0);

// one limb: an inner box plus a slightly larger second layer (hat, jacket, sleeves, pants) that is cut out by alpha
function limb(tex, size, min, uv, over, texels, extra = 0.05) {
  const make = (grow, at, overlay) => {
    const [w, h, d] = size, [tw, th, td] = texels;
    const g = new THREE.BoxGeometry(w + 2 * grow, h + 2 * grow, d + 2 * grow);
    g.translate(min[0] + w / 2, min[1] + h / 2, min[2] + d / 2);
    const r = faceRects(at[0], at[1], tw, th, td), attr = g.attributes.uv;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z; the model faces +Z, so +x is the character's left
    [r.left, r.right, r.top, r.bottom, r.front, r.back].forEach(([x, y, fw, fh], i) => {
      const u0 = x / 64, u1 = (x + fw) / 64, v0 = 1 - y / 64, v1 = 1 - (y + fh) / 64;
      attr.setXY(i * 4, u0, v0); attr.setXY(i * 4 + 1, u1, v0); attr.setXY(i * 4 + 2, u0, v1); attr.setXY(i * 4 + 3, u1, v1);
    });
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, alphaTest: overlay ? 0.5 : 0 }));
  };
  return [make(0, uv, false), make(extra, over, true)];
}

// Same node names and pivots as the Kenney rig, so its animation clips drive this body unchanged.
function buildMinecraftBody(tex, slim) {
  const aw = slim ? 0.3 : 0.4, at = slim ? 3 : 4;
  const group = new THREE.Group(); group.name = 'character';
  const node = (name, x, y, z, parent) => { const n = new THREE.Group(); n.name = name; n.position.set(x, y, z); parent.add(n); return n; };
  const root = node('root', 0, 0, 0, group);
  const legL = node('leg-left', 0.2, 1, 0, root), legR = node('leg-right', -0.2, 1, 0, root), torso = node('torso', 0, 0.7, 0, root);
  const armL = node('arm-left', 0.4, 1.1, -0.1, torso), armR = node('arm-right', -0.4, 1.1, -0.1, torso), head = node('head', 0, 1.2, 0, torso);
  legL.add(...limb(tex, [0.4, 1, 0.4], [-0.2, -1, -0.2], [16, 48], [0, 48], [4, 12, 4]));
  legR.add(...limb(tex, [0.4, 1, 0.4], [-0.2, -1, -0.2], [0, 16], [0, 32], [4, 12, 4]));
  torso.add(...limb(tex, [0.8, 0.9, 0.6], [-0.4, 0.3, -0.3], [16, 16], [16, 32], [8, 12, 4]));
  armL.add(...limb(tex, [aw, 1.1, 0.4], [0, -1, -0.2], [32, 48], [48, 48], [at, 12, 4]));
  armR.add(...limb(tex, [aw, 1.1, 0.4], [-aw, -1, -0.2], [40, 16], [40, 32], [at, 12, 4]));
  head.add(...limb(tex, [0.8, 0.8, 0.8], [-0.4, 0, -0.4], [0, 0], [32, 0], [8, 8, 8], 0.08));
  return group;
}

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('skin not reachable'));
  img.src = url;
});

// public skin mirrors that allow cross-origin image use; the first that answers wins
const SKIN_SOURCES = (n) => [`https://minotar.net/skin/${n}`, `https://mc-heads.net/skin/${n}`];

export async function fetchMinecraftSkin(username) {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) throw new Error('Minecraft names are 1-16 letters, digits or underscores');
  for (const url of SKIN_SOURCES(encodeURIComponent(username))) {
    try { return await loadImage(url); } catch { /* try the next mirror */ }
  }
  throw new Error('Could not reach a skin server');
}

export async function loadMinecraftSkin(username, img = null) {
  const [skinImg, clips] = await Promise.all([img || fetchMinecraftSkin(username), getClips()]);
  const canvas = modernise(skinImg);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  return new CharacterSkin('mc:' + username, buildMinecraftBody(tex, isSlim(canvas)), clips, [tex]);
}
