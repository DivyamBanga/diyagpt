import { plainText } from './util';

// ---------- read aloud ----------

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let session = 0;
let currentEnd = null;

function pickVoice() {
  const voices = synth.getVoices();
  const lang = (navigator.language || 'en-US').slice(0, 2);
  const local = voices.filter((v) => v.lang?.startsWith(lang));
  return (
    local.find((v) => /Samantha|Ava|Allison|Google US English|Aria|Jenny|Serena|Karen/i.test(v.name)) ||
    local.find((v) => v.localService) ||
    local[0] ||
    null
  );
}

export const canSpeak = () => !!synth;

// Long utterances get cut off in some browsers, so speak sentence-sized chunks.
export function speak(markdown, onEnd) {
  stopSpeaking();
  const id = ++session;
  currentEnd = onEnd;
  const finish = () => {
    if (id !== session) return;
    currentEnd = null;
    onEnd?.();
  };
  const text = plainText(markdown);
  const chunks = text.match(/[^.!?\n]{1,220}(?:[.!?]+|$)|\S.{0,219}/g) || [text];
  const voice = pickVoice();
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk.trim());
    if (voice) u.voice = voice;
    u.rate = 1.03;
    if (i === chunks.length - 1) u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  });
}

// Stops whatever is being read and tells its owner it ended.
export function stopSpeaking() {
  session++;
  const end = currentEnd;
  currentEnd = null;
  if (synth?.speaking || synth?.pending) synth.cancel();
  end?.();
}

// ---------- dictation ----------

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const canDictate = () => !!Recognition;

export function startDictation({ onText, onEnd, onError }) {
  const r = new Recognition();
  r.lang = navigator.language || 'en-US';
  r.interimResults = true;
  r.continuous = true;
  r.onresult = (e) => {
    let final = '';
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    onText(final, interim);
  };
  r.onerror = (e) => onError?.(e.error);
  r.onend = () => onEnd?.();
  r.start();
  return () => r.stop();
}
