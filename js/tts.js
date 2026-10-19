// Speech: pre-recorded natural clips (audio/, made by tools/make-audio.py) played through Web Audio, with the
// browser's speechSynthesis only as a last resort for text without a clip. Plus mic recording via MediaRecorder.
// Why Web Audio: on iOS an <audio> element fed by the service worker fails (no Range support) and is blocked from
// timer-driven playback; an AudioContext resumed once in a tap plays freely afterwards, from fetched bytes.
let voice = null;
let clips = {};                       // "f|text" / "fs|text" (slow) / "m|..." -> file, from audio/index.json
let ctx = null, stopClip = null, seq = 0, engine = '', recording = false;
const setSession = t => { try { if (navigator.audioSession && navigator.audioSession.type !== t) navigator.audioSession.type = t; } catch { /* */ } };
const buffers = new Map();
const clean = t => String(t).replace(/\s+/g, ' ').trim();
export async function loadClips(base = './') { try { clips = await (await fetch(base + 'audio/index.json')).json(); } catch { clips = {}; } }
const clipFor = (text, v, slow) => { const t = clean(text), r = slow ? 's' : ''; return clips[`${v}${r}|${t}`] || clips[`f${r}|${t}`] || clips[`${v}|${t}`] || clips[`f|${t}`]; };
export const lastEngine = () => engine;   // 'clip' | 'synth' | '' (for the settings screen)
const supported = typeof speechSynthesis !== 'undefined';
export const ttsSupported = supported;

// Novelty and legacy robotic voices that iOS/macOS list as en-US. Never pick these.
const BAD = /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;
function pickVoice() {
  if (!supported) return null;
  const all = speechSynthesis.getVoices().filter(v => !BAD.test(v.name));
  let vs = all.filter(v => /^en[-_]US$/i.test(v.lang));
  if (!vs.length) vs = all.filter(v => /^en[-_]/i.test(v.lang));
  if (!vs.length) return null;
  const pref = ['Ava', 'Zoe', 'Samantha', 'Allison', 'Evan', 'Nathan', 'Tom', 'Susan', 'Nicky', 'Joelle', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny'];
  const rank = v => {
    const i = pref.findIndex(p => v.name.includes(p));
    const q = /premium/i.test(v.name) ? -200 : /enhanced|natural|neural/i.test(v.name) ? -100 : 0;
    return (i < 0 ? 50 : i) + q;
  };
  return vs.slice().sort((a, b) => rank(a) - rank(b))[0];
}
if (supported) { speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); }; voice = pickVoice(); }

function audioCtx() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) try { ctx = new C(); } catch { ctx = null; } }
  return ctx;
}
export function unlockTTS() { // call from every tap: cheap once running; iOS may suspend the context again later
  if (!recording) setSession('playback'); // iOS 16.4+: play even with the silent switch on
  const c = audioCtx();
  if (c && c.state !== 'running') {
    try { c.resume(); const b = c.createBuffer(1, 1, 22050), src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start(0); } catch { /* */ }
  }
  if (supported && !unlockTTS.synthDone) { unlockTTS.synthDone = true; try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* */ } }
}
export function stopSpeaking() {
  seq++;
  if (stopClip) stopClip();
  if (supported) try { speechSynthesis.cancel(); } catch { /* */ }
}
function decode(ab) { return new Promise((res, rej) => { try { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } }); }
function bufferFor(file) {
  if (!buffers.has(file)) {
    const p = fetch('audio/' + file).then(r => { if (!r.ok) throw new Error('fetch ' + r.status); return r.arrayBuffer(); }).then(decode);
    p.catch(() => buffers.delete(file)); buffers.set(file, p);
  }
  return buffers.get(file);
}
export function preloadClips(texts) { const c = audioCtx(); if (!c) return; texts.forEach(t => { const f = t && clipFor(t, 'f', false); if (f) bufferFor(f).catch(() => {}); }); }
async function playClip(file, my) {
  const c = audioCtx(); if (!c) return false;
  if (c.state !== 'running') { try { await c.resume(); } catch { /* */ } }
  if (c.state !== 'running') return false;
  let buf; try { buf = await bufferFor(file); } catch { return false; }
  if (my !== seq) return true; // something else started speaking meanwhile
  return new Promise(resolve => {
    const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination);
    let done = false; const fin = ok => { if (done) return; done = true; if (stopClip === stop) stopClip = null; resolve(ok); };
    const stop = () => { try { src.stop(); } catch { /* */ } fin(true); };
    if (stopClip) stopClip(); stopClip = stop;
    src.onended = () => fin(true);
    try { src.start(0); } catch { fin(false); return; }
    setTimeout(() => fin(true), buf.duration * 1000 + 1500);
  });
}
// slow: the turtle button; pref 'slow': the reading-speed setting. voice: 'f' (main) | 'm' (male dialogue speaker).
export async function speak(text, { slow = false, pref = 'normal', pitch = 1, voice: v = 'f' } = {}) {
  if (!text) return false;
  const my = ++seq;
  if (stopClip) stopClip();
  if (supported) try { speechSynthesis.cancel(); } catch { /* */ }
  const file = clipFor(text, v, slow || pref === 'slow');
  if (file && await playClip(file, my)) { engine = 'clip'; return true; }
  if (my !== seq) return false;
  if (file && audioCtx()) { engine = 'blocked'; return false; } // has a natural clip: stay quiet rather than sound robotic
  engine = 'synth';
  return synth(text, { slow, pref, pitch: v === 'm' ? 0.9 : pitch });
}
function synth(text, { slow, pref, pitch }) {
  return new Promise(resolve => {
    if (!supported || !text) return resolve(false);
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; if (!voice) voice = pickVoice(); if (voice) u.voice = voice;
      u.rate = slow ? 0.7 : (pref === 'slow' ? 0.8 : 0.95); u.pitch = pitch;
      u.onend = () => resolve(true); u.onerror = () => resolve(false);
      speechSynthesis.speak(u);
      setTimeout(() => resolve(true), Math.max(4000, text.length * 160)); // safety if onend never fires
    } catch (e) { resolve(false); }
  });
}

// ---- recording --------------------------------------------------------------------------------
export async function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
  recording = true; setSession('play-and-record'); // 'playback' alone can block the microphone on iOS
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { recording = false; setSession('playback'); throw e; }
  const done = () => { recording = false; setSession('playback'); };
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start();
  return {
    stop() {
      return new Promise(res => {
        rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); done(); res(new Blob(chunks, { type: rec.mimeType || mime || 'audio/mp4' })); };
        try { rec.stop(); } catch (e) { stream.getTracks().forEach(t => t.stop()); done(); res(new Blob(chunks)); }
      });
    },
    cancel() { try { rec.stop(); } catch (e) { /* */ } stream.getTracks().forEach(t => t.stop()); done(); },
  };
}
export function playBlob(blob) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob); const a = new Audio(url);
    const done = () => { URL.revokeObjectURL(url); resolve(); };
    a.onended = done; a.onerror = done; a.play().catch(done);
  });
}
