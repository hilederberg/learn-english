// Text-to-speech via the browser's speechSynthesis (en-US), plus mic recording via MediaRecorder.
let voice = null, unlocked = false;
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
  if (!supported || unlocked) return; unlocked = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
}
export function stopSpeaking() { if (supported) try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
// rate: 'normal' | 'slow'; resolves when finished (or immediately if unsupported)
export function speak(text, { slow = false, pref = 'normal', pitch = 1 } = {}) {
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
