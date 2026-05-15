/** Helpers to start Slime Buddy TTS earlier (smaller first chunk, fuzzy prefetch match). */

export function normalizeSpeechText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** First chunk worth sending to TTS — lower bar than a full sentence. */
export function firstSpeakableChunk(text: string): string {
  const t = normalizeSpeechText(text);
  if (t.length < 10) return '';
  const sentence = t.match(/^(.{10,200}?[.!?。！？])(\s|$)/);
  if (sentence?.[1]) return sentence[1].trim();
  if (t.length >= 28) {
    const slice = t.slice(0, 80);
    const lastSpace = slice.lastIndexOf(' ');
    if (lastSpace >= 14) return slice.slice(0, lastSpace).trim();
  }
  return t.slice(0, Math.min(56, t.length)).trim();
}

/** @deprecated Use firstSpeakableChunk — kept for tests migrating from old helper name. */
export function firstSpeakableSentence(text: string): string {
  return firstSpeakableChunk(text);
}

export function ttsPrefetchMatchesFinal(prefetched: string, finalText: string): boolean {
  const pf = normalizeSpeechText(prefetched);
  const fin = normalizeSpeechText(finalText);
  if (!pf || !fin) return false;
  if (fin.startsWith(pf)) return true;
  if (pf.length >= 12 && fin.slice(0, pf.length) === pf) return true;
  return false;
}
