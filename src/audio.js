// Everything is synthesised with WebAudio, so there are no sound files to ship.
let ctx = null, master, noise, lowpass;
const listener = { x: 0, z: 0, yaw: 0 };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.55;
  lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 22000;
  master.connect(lowpass);
  lowpass.connect(ctx.destination);
  const len = ctx.sampleRate * 2;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

export function setListener(x, z, yaw) { listener.x = x; listener.z = z; listener.yaw = yaw; }

function spatial(pos) {
  if (!pos) return { vol: 1, pan: 0 };
  const dx = pos.x - listener.x, dz = pos.z - listener.z;
  const d = Math.hypot(dx, dz);
  const rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw);
  const pan = d > 0.01 ? (dx * rx + dz * rz) / d : 0;
  return { vol: 1 / (1 + d * d * 0.02), pan: Math.max(-1, Math.min(1, pan)) * Math.min(1, d / 3) };
}

// generic one-shot voice
function voice({ dur = 0.2, noiseSrc = false, f0 = 440, f1 = f0, type = 'sine', filt = null, q = 1,
  ff0 = 2000, ff1 = ff0, gain = 0.5, attack = 0.002, pos = null, delay = 0 }) {
  if (!ctx) return;
  const sp = spatial(pos);
  const t0 = ctx.currentTime + delay;
  const src = noiseSrc ? ctx.createBufferSource() : ctx.createOscillator();
  if (noiseSrc) { src.buffer = noise; src.loop = true; }
  else { src.type = type; src.frequency.setValueAtTime(f0, t0); src.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur); }
  let node = src;
  if (filt) {
    const f = ctx.createBiquadFilter();
    f.type = filt; f.Q.value = q;
    f.frequency.setValueAtTime(ff0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, ff1), t0 + dur);
    node.connect(f); node = f;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * sp.vol), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  node.connect(g);
  let out = g;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = sp.pan; g.connect(p); out = p; }
  out.connect(master);
  src.start(t0, noiseSrc ? Math.random() : undefined);
  src.stop(t0 + dur + 0.05);
}

export const sfx = {
  shot(kind, pos) {
    if (kind === 'deagle') {
      voice({ dur: 0.5, noiseSrc: true, filt: 'lowpass', ff0: 7000, ff1: 300, gain: 1.0, pos });
      voice({ dur: 0.35, f0: 150, f1: 38, type: 'sine', gain: 1.0, pos });
      voice({ dur: 0.12, noiseSrc: true, filt: 'highpass', ff0: 2500, ff1: 1500, gain: 0.5, pos });
    } else {
      voice({ dur: 0.3, noiseSrc: true, filt: 'lowpass', ff0: 6000, ff1: 500, gain: 0.85, pos });
      voice({ dur: 0.18, f0: 120, f1: 45, type: 'sine', gain: 0.8, pos });
      voice({ dur: 0.07, noiseSrc: true, filt: 'highpass', ff0: 3000, ff1: 2000, gain: 0.35, pos });
    }
  },
  knife(pos) { voice({ dur: 0.18, noiseSrc: true, filt: 'bandpass', q: 2, ff0: 600, ff1: 3000, gain: 0.35, attack: 0.06, pos }); },
  knifeHit(pos) { voice({ dur: 0.12, noiseSrc: true, filt: 'lowpass', ff0: 2500, ff1: 400, gain: 0.7, pos }); },
  hit(head) {
    voice({ dur: 0.07, f0: head ? 1900 : 1100, f1: head ? 1500 : 900, type: 'square', gain: 0.18 });
    if (head) voice({ dur: 0.09, f0: 2600, f1: 2200, type: 'square', gain: 0.12, delay: 0.04 });
  },
  hurt() { voice({ dur: 0.22, noiseSrc: true, filt: 'lowpass', ff0: 700, ff1: 150, gain: 0.7 }); },
  click(pos) { voice({ dur: 0.04, noiseSrc: true, filt: 'highpass', ff0: 2500, gain: 0.3, pos }); },
  reload(pos) {
    voice({ dur: 0.06, noiseSrc: true, filt: 'bandpass', ff0: 1800, q: 4, gain: 0.35, pos });
    voice({ dur: 0.07, noiseSrc: true, filt: 'bandpass', ff0: 900, q: 4, gain: 0.45, delay: 1.1, pos });
    voice({ dur: 0.05, noiseSrc: true, filt: 'highpass', ff0: 2200, gain: 0.4, delay: 1.9, pos });
  },
  bounce(pos) { voice({ dur: 0.12, f0: 700, f1: 380, type: 'triangle', gain: 0.3, pos }); voice({ dur: 0.05, noiseSrc: true, filt: 'highpass', ff0: 2000, gain: 0.2, pos }); },
  throwG(pos) { voice({ dur: 0.22, noiseSrc: true, filt: 'bandpass', ff0: 500, ff1: 1500, q: 1.5, gain: 0.3, attack: 0.08, pos }); },
  smokePop(pos) {
    voice({ dur: 0.2, f0: 220, f1: 70, type: 'sine', gain: 0.5, pos });
    voice({ dur: 1.8, noiseSrc: true, filt: 'bandpass', ff0: 3500, ff1: 600, q: 0.7, gain: 0.5, attack: 0.05, pos });
  },
  flashBang(pos) {
    voice({ dur: 0.35, noiseSrc: true, filt: 'lowpass', ff0: 9000, ff1: 400, gain: 1.0, pos });
    voice({ dur: 0.25, f0: 140, f1: 40, type: 'sine', gain: 0.9, pos });
  },
  step(pos, loud = 1) { voice({ dur: 0.07, noiseSrc: true, filt: 'lowpass', ff0: 700, ff1: 250, gain: 0.35 * loud, pos }); },
  death(pos) { voice({ dur: 0.3, f0: 180, f1: 50, type: 'sawtooth', filt: 'lowpass', ff0: 800, ff1: 100, gain: 0.5, pos }); },
  beep(freq = 880, dur = 0.12) { voice({ dur, f0: freq, f1: freq, type: 'square', gain: 0.12 }); },
  win() { [523, 659, 784].forEach((f, i) => voice({ dur: 0.18, f0: f, f1: f, type: 'triangle', gain: 0.2, delay: i * 0.12 })); },
  lose() { [330, 262, 196].forEach((f, i) => voice({ dur: 0.22, f0: f, f1: f * 0.98, type: 'triangle', gain: 0.2, delay: i * 0.15 })); },
};

// Tinnitus after a flashbang: a ring that fades, plus a muffled mix.
export function flashRing(seconds) {
  if (!ctx) return;
  const t = ctx.currentTime;
  voice({ dur: seconds, f0: 4200, f1: 3800, type: 'sine', gain: 0.18, attack: 0.05 });
  lowpass.frequency.cancelScheduledValues(t);
  lowpass.frequency.setValueAtTime(900, t);
  lowpass.frequency.exponentialRampToValueAtTime(22000, t + seconds);
}
