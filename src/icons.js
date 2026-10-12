// Renders small transparent preview pictures of every purchasable item (guns, grenades, armor) for the wheel menus.
import * as THREE from 'three';
import { buildItemModel, SHOP, GRENADE_ORDER } from './weapons.js';
import { loadCharacter } from './characters.js';

const W = 256, H = 128;
const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

function vest(withHelmet) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const add = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); body.add(m); return m; };
  add(0.42, 0.5, 0.1, 0x3d4a35, 0, 0, 0);                    // chest plate
  add(0.3, 0.2, 0.02, 0x2b3426, 0, 0.08, 0.06);              // front pouch panel
  add(0.12, 0.2, 0.1, 0x2b3426, -0.17, 0.35, 0);             // shoulder straps
  add(0.12, 0.2, 0.1, 0x2b3426, 0.17, 0.35, 0);
  add(0.46, 0.1, 0.13, 0x2b3426, 0, -0.22, 0);               // belt
  add(0.08, 0.08, 0.03, 0xc9c9c0, 0.12, 0.2, 0.065);         // velcro tab
  g.add(body);
  if (withHelmet) {
    const helm = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3a4a24));
    helm.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.025, 10), mat(0x2e3a1f));
    brim.position.y = 0.0; helm.add(brim);
    helm.position.set(0.5, -0.22, 0.12);
    helm.rotation.z = -0.1;
    g.add(helm);
  }
  return g;
}

function modelFor(id) {
  if (id === 'kevlar') return vest(false);
  if (id === 'helmet') return vest(true);
  return buildItemModel(id);
}

// one shared offscreen renderer, created on first use
let iconR = null, iconScene = null, iconCam = null;
function setupIconRenderer() {
  if (iconR) return true;
  try { iconR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return false; }
  iconR.setSize(W, H, false);
  iconR.setClearColor(0x000000, 0);
  iconScene = new THREE.Scene();
  iconScene.add(new THREE.HemisphereLight(0xfff4dc, 0x8a7a5a, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(3, 4, 5); iconScene.add(sun);
  iconCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  return true;
}

// renders one item to a data URL (or null)
function renderIcon(id) {
  let obj;
  try { obj = modelFor(id); } catch { return null; }
  if (!obj) return null;
  const wrap = new THREE.Group();
  wrap.add(obj);
  // grenades are upright; guns are laid out side-on with the muzzle to the right; armor and knives get their own angles
  const upright = GRENADE_ORDER.includes(id);
  const gear = id === 'kevlar' || id === 'helmet';
  const knife = id === 'knife';
  wrap.rotation.set(upright ? 0.25 : knife ? 0.0 : 0.12, upright ? 0.5 : gear ? -Math.PI / 2 : 0.0, knife ? 0.5 : 0);
  iconScene.add(wrap);
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap);
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  // the camera sits on the +X side looking at the model, so -Z runs left to right on screen
  const spanX = upright ? Math.max(s.x, s.z) : s.z, spanY = s.y;
  const halfW = Math.max(spanX / 2, (spanY / 2) * (W / H)) * 1.12, halfH = halfW * (H / W);
  iconCam.left = -halfW; iconCam.right = halfW; iconCam.top = halfH; iconCam.bottom = -halfH;
  iconCam.updateProjectionMatrix();
  iconCam.position.set(c.x + 10, c.y + 0.35, c.z + 1.2);
  iconCam.up.set(0, 1, 0);
  iconCam.lookAt(c);
  iconR.render(iconScene, iconCam);
  const url = iconR.domElement.toDataURL('image/png');
  iconScene.remove(wrap);
  obj.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); } });
  return url;
}

export function makeIcons() {
  const icons = {};
  if (!setupIconRenderer()) return icons;
  for (const id of new Set(['knife', ...SHOP.map((s) => s.id), ...GRENADE_ORDER])) { const u = renderIcon(id); if (u) icons[id] = u; }
  return icons;
}

// re-render a single icon (used when the knife style changes)
export function refreshIcon(id) { return setupIconRenderer() ? renderIcon(id) : null; }

// ---- head portraits for the kill feed ----
let headR = null, headScene = null, headCam = null;
const headCache = {};
export async function headIcon(name) {
  if (headCache[name]) return headCache[name];
  const skin = await loadCharacter(name);
  try {
    if (!headR) {
      headR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      headR.setSize(96, 96, false);
      headR.setClearColor(0x000000, 0);
      headScene = new THREE.Scene();
      headScene.add(new THREE.HemisphereLight(0xfff4dc, 0x8a7a5a, 2.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1.5, 2.5, -4); headScene.add(sun);
      headCam = new THREE.PerspectiveCamera(20, 1, 0.1, 20);
      headCam.position.set(0, 1.6, -3.1);          // characters face -Z, so the camera goes on the -Z side
      headCam.lookAt(0, 1.52, 0);
    }
    skin.play('Idle', { at: 0.4 });
    skin.update(0.001);
    headScene.add(skin.root);
    headR.render(headScene, headCam);
    headCache[name] = headR.domElement.toDataURL('image/png');
  } catch { headCache[name] = null; }
  skin.dispose();
  return headCache[name];
}
