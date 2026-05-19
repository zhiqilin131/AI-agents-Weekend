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

/** Text after the portion already spoken during stream (sentence 2+). */
export function remainderAfterSpokenPrefix(full: string, spokenPrefix: string): string {
  const fin = normalizeSpeechText(full);
  const pre = normalizeSpeechText(spokenPrefix);
  if (!fin) return '';
  if (!pre) return fin;
  if (fin.startsWith(pre)) return fin.slice(pre.length).trim();
  const idx = fin.indexOf(pre);
  if (idx === 0) return fin.slice(pre.length).trim();
  return fin;
}

/** Split assistant reply into speakable parts (one per sentence). */
export function splitSpeakableParts(text: string, maxParts = 4): string[] {
  const t = normalizeSpeechText(text);
  if (!t) return [];
  const parts = t.split(/(?<=[.!?。！？])\s+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return [t];
  return parts.slice(0, maxParts);
}

/** Merge adjacent sentences into fewer TTS requests (shorter gaps between phrases). */
export function groupSpeakableParts(parts: string[], maxChars = 340, maxGroups = 6): string[] {
  if (parts.length <= 1) return parts;
  const groups: string[] = [];
  let current = '';
  for (const part of parts) {
    const candidate = current ? `${current} ${part}` : part;
    if (current && candidate.length > maxChars) {
      groups.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) groups.push(current);
  if (groups.length <= maxGroups) return groups;
  const head = groups.slice(0, maxGroups - 1);
  const tail = groups.slice(maxGroups - 1).join(' ');
  return [...head, tail];
}

export function ttsPrefetchMatchesFinal(prefetched: string, finalText: string): boolean {
  const pf = normalizeSpeechText(prefetched);
  const fin = normalizeSpeechText(finalText);
  if (!pf || !fin) return false;
  if (fin.startsWith(pf)) return true;
  if (pf.length >= 12 && fin.slice(0, pf.length) === pf) return true;
  return false;
}

const SENTENCE_END_RE = /[.!?。！？]$/;

/** Sentence-boundary parts that are complete (trailing fragment without punctuation excluded). */
export function completeSpeakableParts(text: string, maxParts = 24): string[] {
  const parts = splitSpeakableParts(text, maxParts);
  if (!parts.length) return [];
  const last = parts[parts.length - 1];
  if (last && !SENTENCE_END_RE.test(last)) {
    return parts.slice(0, -1);
  }
  return parts;
}

/** Newly finished sentences since the last stream-TTS enqueue. */
export function newlyCompleteSpeakableParts(
  fullText: string,
  queuedSentenceCount: number,
  maxParts = 24,
): { newParts: string[]; completeCount: number } {
  const complete = completeSpeakableParts(fullText, maxParts);
  const start = Math.max(0, queuedSentenceCount);
  return { newParts: complete.slice(start), completeCount: complete.length };
}

/** Remaining speakable parts not yet queued (includes final fragment without punctuation). */
export function unqueuedSpeakableParts(
  fullText: string,
  queuedSentenceCount: number,
  maxParts = 24,
): string[] {
  return tailSpeakablePartsAfterQueue(fullText, queuedSentenceCount, maxParts);
}

/**
 * Parts still needing playback after stream queue — uses complete-sentence indexing
 * (not raw split index) so the last sentence is not replayed at turn end.
 */
export function tailSpeakablePartsAfterQueue(
  fullText: string,
  queuedCompleteCount: number,
  maxParts = 24,
): string[] {
  const parts = splitSpeakableParts(fullText, maxParts);
  const complete = completeSpeakableParts(fullText, maxParts);
  const tail: string[] = [];
  for (let i = Math.max(0, queuedCompleteCount); i < complete.length; i++) {
    tail.push(complete[i]);
  }
  if (parts.length > complete.length) {
    const fragment = parts.slice(complete.length).join(' ').trim();
    if (fragment) tail.push(fragment);
  }
  return tail;
}

/** Stable key for deduping stream TTS sentence chunks. */
export function speakPartDedupeKey(part: string): string {
  return normalizeSpeechText(part).toLowerCase();
}
