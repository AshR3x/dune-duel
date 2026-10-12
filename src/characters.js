// Rigged character models (Quaternius "Ultimate Animated Character Pack", CC0) used for the enemy bot's random
// skins and the player's skin picker in the menu. All 52 share one skeleton and animation set.
import * as THREE from 'three';
import { FBXLoader } from '../vendor/FBXLoader.js';

export const CHARACTERS = [
  'BaseCharacter', 'BlueSoldier_Female', 'BlueSoldier_Male', 'Casual2_Female', 'Casual2_Male', 'Casual3_Female', 'Casual3_Male',
  'Casual_Bald', 'Casual_Female', 'Casual_Male', 'Chef_Female', 'Chef_Hat', 'Chef_Male', 'Cow', 'Cowboy_Female', 'Cowboy_Hair',
  'Cowboy_Male', 'Doctor_Female_Old', 'Doctor_Female_Young', 'Doctor_Male_Old', 'Doctor_Male_Young', 'Elf', 'Goblin_Female',
  'Goblin_Male', 'Kimono_Female', 'Kimono_Male', 'Knight_Golden_Female', 'Knight_Golden_Male', 'Knight_Male', 'Ninja_Female',
  'Ninja_Male', 'Ninja_Male_Hair', 'Ninja_Sand', 'Ninja_Sand_Female', 'OldClassy_Female', 'OldClassy_Male', 'Pirate_Female',
  'Pirate_Male', 'Pug', 'Soldier_Female', 'Soldier_Male', 'Suit_Female', 'Suit_Male', 'Viking_Female', 'Viking_Male',
  'VikingHelmet', 'Witch', 'Wizard', 'Worker_Female', 'Worker_Male', 'Zombie_Female', 'Zombie_Male',
];
export const charLabel = (n) => n.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

const loader = new FBXLoader();
const HEIGHT = 1.78;                       // metres, standing
const TONES = [0xf1c9a5, 0xdcab80, 0xc08a5e, 0x94623e, 0x66402a];
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// The pack's material colours are very dark when loaded, so lift them and use flat lambert shading to match the
// rest of the game. Skin gets a tone from a small palette (or stays green for the undead).
function restyle(obj, name) {
  const tone = TONES[hash(name) % TONES.length];
  const undead = /Zombie/.test(name);
  obj.traverse((m) => {
    if (!m.isMesh) return;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    const out = list.map((old) => {
      const rgb = { r: 0, g: 0, b: 0 };
      old.color.getRGB(rgb, THREE.SRGBColorSpace);
      let c;
      if (old.name === 'Skin') c = new THREE.Color(undead ? 0x7c9a58 : tone);
      else if (old.name === 'Face') c = new THREE.Color().setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace);
      else c = new THREE.Color().setRGB(Math.pow(rgb.r, 0.55), Math.pow(rgb.g, 0.55), Math.pow(rgb.b, 0.55), THREE.SRGBColorSpace);
      return new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    });
    m.material = Array.isArray(m.material) ? out : out[0];
    m.frustumCulled = false;
  });
}

export class CharacterSkin {
  constructor(name, obj) {
    this.name = name;
    this.root = new THREE.Group();
    obj.scale.setScalar(HEIGHT / 323);
    obj.rotation.y = Math.PI;                 // the pack faces +Z, the game's characters face -Z
    this.root.add(obj);
    this.obj = obj;
    restyle(obj, name);
    this.mixer = new THREE.AnimationMixer(obj);
    this.clips = {};
    for (const c of obj.animations) this.clips[c.name.split('|').pop()] = c;
    this.cur = null; this.action = null;
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
  // Procedural crouch: the pack has no crouch clip, so after the animation has posed the rig we fold the hips, knees and
  // spine ourselves. k runs 0 (standing) to 1 (full crouch).
  crouch(k, sign = 1) {
    if (!this.bones) {
      this.bones = {};
      this.obj.traverse((b) => { if (b.isBone) this.bones[b.name] = b; });
    }
    this.crouchK = k;
    const b = this.bones, S = sign;
    this.obj.position.y = -0.4 * k;           // sink the body so the feet stay planted
    for (const side of ['L', 'R']) {
      b['UpperLeg' + side]?.rotateX(S * 1.05 * k);
      b['LowerLeg' + side]?.rotateX(-S * 1.7 * k);
      b['Foot' + side]?.rotateX(S * 0.65 * k);
    }
    b.Abdomen?.rotateX(S * 0.18 * k);
    b.Torso?.rotateX(-S * 0.12 * k);
  }
  update(dt) {
    this.mixer.update(dt);
    if (this.crouchK) { this.crouch(this.crouchK, this.crouchSign ?? 1); this.crouchApplied = true; }
    else if (this.crouchApplied) { this.obj.position.y = 0; this.crouchApplied = false; }
  }
  dispose() {
    this.mixer.stopAllAction();
    this.obj.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); } });
    this.root.parent?.remove(this.root);
  }
}

// fetches a fresh copy of the model each time (cheap: the file is cached by the browser), so skins can be reused
export async function loadCharacter(name) {
  const obj = await loader.loadAsync(`./assets/characters/${name}.fbx`);
  return new CharacterSkin(name, obj);
}
