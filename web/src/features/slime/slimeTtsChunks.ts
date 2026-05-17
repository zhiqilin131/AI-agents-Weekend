/** Helpers to start Slime Buddy TTS earlier (first full sentence, then the rest). */

export function normalizeSpeechText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** First complete sentence — used for early stream playback. */
export function firstSpeakableSentence(text: string): string {
  const t = normalizeSpeechText(text);
  if (t.length < 8) return '';
  const sentence = t.match(/^(.{8,220}?[.!?。！？])(\s|$)/);
  return sentence?.[1]?.trim() ?? '';
}

/** Prefetch chunk — prefer a full sentence, else a short clause. */
export function firstSpeakableChunk(text: string): string {
  const sentence = firstSpeakableSentence(text);
  if (sentence) return sentence;
  const t = normalizeSpeechText(text);
  if (t.length < 28) return '';
  const slice = t.slice(0, 80);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace >= 14) return slice.slice(0, lastSpace).trim();
  return t.slice(0, Math.min(56, t.length)).trim();
}

export function ttsPrefetchMatchesFinal(prefetched: string, finalText: string): boolean {
  const pf = normalizeSpeechText(prefetched);
  const fin = normalizeSpeechText(finalText);
  if (!pf || !fin) return false;
  if (fin.startsWith(pf)) return true;
  if (pf.length >= 12 && fin.slice(0, pf.length) === pf) return true;
  return false;
}
