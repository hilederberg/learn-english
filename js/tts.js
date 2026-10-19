// Speech: pre-recorded natural clips (audio/, made by tools/make-audio.py) with the browser's speechSynthesis
// as a fallback for any text without a clip. Plus mic recording via MediaRecorder.
let voice = null, unlocked = false;
let clips = {};                                                   // "f|text" -> file, from audio/index.json
const player = typeof Audio !== 'undefined' ? new Audio() : null; // one element, unlocked once on a tap (iOS)
let stopClip = null;
const clean = t => String(t).replace(/\s+/g, ' ').trim();
export async function loadClips(base = './') { try { clips = await (await fetch(base + 'audio/index.json')).json(); } catch { clips = {}; } }
const clipFor = (text, v) => clips[`${v}|${clean(text)}`] || clips[`f|${clean(text)}`];
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

export function unlockTTS() { // must be called from a user gesture once (iOS)
  if (unlocked) return; unlocked = true;
  if (player) { // a muted play inside the tap lets later, timer-driven plays of this element through on iOS
    const f = Object.values(clips)[0];
    if (f) { player.muted = true; player.src = 'audio/' + f; player.play().then(() => { if (player.muted) { player.pause(); player.muted = false; } }).catch(() => { player.muted = false; }); } // a real clip may already have taken over
  }
  if (supported) try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
}
export function stopSpeaking() {
  if (stopClip) stopClip();
  if (supported) try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
}
function playClip(file, rate) {
  return new Promise(resolve => {
    let done = false;
    const fin = ok => { if (done) return; done = true; stopClip = null; player.onended = player.onerror = null; resolve(ok); };
    stopClip = () => { try { player.pause(); } catch { /* */ } fin(true); };
    player.muted = false; player.src = 'audio/' + file;
    player.preservesPitch = player.webkitPreservesPitch = true; // slower, not deeper
    player.defaultPlaybackRate = player.playbackRate = rate;
    player.onended = () => fin(true); player.onerror = () => fin(false);
    player.play().catch(() => fin(false));
    setTimeout(() => fin(true), 20000);
  });
}
// rate: 'normal' | 'slow'; voice: 'f' (main) | 'm' (male dialogue speaker). Resolves when finished.
export async function speak(text, { slow = false, pref = 'normal', pitch = 1, voice: v = 'f' } = {}) {
  if (!text) return false;
  const file = player && clipFor(text, v);
  if (file) {
    if (stopClip) stopClip();
    if (supported) try { speechSynthesis.cancel(); } catch { /* */ }
    if (await playClip(file, slow ? 0.72 : pref === 'slow' ? 0.85 : 1)) return true;
  }
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
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start();
  return {
    stop() {
      return new Promise(res => {
        rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(chunks, { type: rec.mimeType || mime || 'audio/mp4' })); };
        try { rec.stop(); } catch (e) { stream.getTracks().forEach(t => t.stop()); res(new Blob(chunks)); }
      });
    },
    cancel() { try { rec.stop(); } catch (e) { /* */ } stream.getTracks().forEach(t => t.stop()); },
  };
}
export function playBlob(blob) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob); const a = new Audio(url);
    const done = () => { URL.revokeObjectURL(url); resolve(); };
    a.onended = done; a.onerror = done; a.play().catch(done);
  });
}
