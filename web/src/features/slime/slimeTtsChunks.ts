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
  if (fin === pre) return '';
  if (fin.startsWith(pre)) return fin.slice(pre.length).trim();
  if (pre.startsWith(fin)) return '';
  const finParts = completeSpeakableParts(fin);
  const preParts = completeSpeakableParts(pre);
  let shared = 0;
  for (let i = 0; i < Math.min(finParts.length, preParts.length); i++) {
    if (speakPartDedupeKey(finParts[i]) !== speakPartDedupeKey(preParts[i])) break;
    shared += 1;
  }
  if (shared > 0) {
    const tailParts = finParts.slice(shared);
    const fragmentParts = splitSpeakableParts(fin).slice(completeSpeakableParts(fin).length);
    return [...tailParts, ...fragmentParts].join(' ').trim();
  }
  const idx = fin.indexOf(pre);
  if (idx === 0) return fin.slice(pre.length).trim();
  // Avoid replaying the full reply when stream/final strings diverge slightly.
  return '';
}

/** Split assistant reply into speakable parts (one per sentence). */
export function splitSpeakableParts(text: string, maxParts = 24): string[] {
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

/** Bubble text during stream TTS — only sentences already queued for playback. */
export function streamBubbleDisplayText(fullText: string, queuedCompleteCount: number): string {
  const complete = completeSpeakableParts(fullText);
  if (!complete.length || queuedCompleteCount <= 0) return '';
  return complete.slice(0, Math.min(queuedCompleteCount, complete.length)).join(' ');
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
  return normalizeSpeechText(part)
    .toLowerCase()
    .replace(/[''`´\u2018\u2019]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[^a-z0-9\s.!?。！？'"()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** All speakable parts in order (complete sentences, then trailing fragment). */
export function orderedSpeakableParts(text: string, maxParts = 24): string[] {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return [];
  const complete = completeSpeakableParts(normalized, maxParts);
  const parts = splitSpeakableParts(normalized, maxParts);
  const ordered = [...complete];
  if (parts.length > complete.length) {
    const fragment = parts.slice(complete.length).join(' ').trim();
    if (fragment) ordered.push(fragment);
  }
  return ordered;
}

/** Parts in `text` not yet heard (by sentence key), preserving order. */
export function missingPlayedParts(text: string, playedKeys: ReadonlySet<string>, maxParts = 24): string[] {
  return orderedSpeakableParts(text, maxParts).filter((part) => !playedKeys.has(speakPartDedupeKey(part)));
}

/** True when this exact TTS chunk is already waiting in the ordered play queue. */
export function chunkPendingInQueue(part: string, pendingChunks: readonly string[]): boolean {
  const key = speakPartDedupeKey(part);
  return pendingChunks.some((c) => speakPartDedupeKey(c) === key);
}

/**
 * Stream-only tail: sentences from the SSE canon not yet played and not already
 * waiting in the ordered queue. Never pulls from API final text (avoids re-reading
 * reworded duplicates when display/spoken_sequence diverges from stream).
 */
export function streamRemainingSpeakParts(
  streamText: string,
  playedKeys: ReadonlySet<string>,
  pendingChunks: readonly string[],
  maxParts = 24,
): string[] {
  const pendingKeys = new Set<string>();
  for (const chunk of pendingChunks) {
    for (const sentence of splitSpeakableParts(chunk, maxParts)) {
      pendingKeys.add(speakPartDedupeKey(sentence));
    }
  }
  return orderedSpeakableParts(streamText, maxParts).filter((part) => {
    const key = speakPartDedupeKey(part);
    return !playedKeys.has(key) && !pendingKeys.has(key);
  });
}

/** @deprecated Use streamRemainingSpeakParts — extension path caused duplicate reads. */
export function streamFinishTailParts(
  streamText: string,
  _displayText: string,
  _queuedCompleteCount: number,
  playedKeys: ReadonlySet<string>,
  pendingChunks: readonly string[],
  maxParts = 24,
): string[] {
  return streamRemainingSpeakParts(streamText, playedKeys, pendingChunks, maxParts);
}

/** True if any sentence in `chunk` is already reserved for stream TTS. */
export function hasQueuedSpeakPart(
  chunk: string,
  queuedKeys: ReadonlySet<string>,
  maxParts = 24,
): boolean {
  return splitSpeakableParts(chunk, maxParts).some((s) => queuedKeys.has(speakPartDedupeKey(s)));
}

/** Reserve queue keys for every sentence in a (possibly grouped) TTS chunk. */
export function markQueuedSpeakParts(
  chunk: string,
  queuedKeys: Set<string>,
  maxParts = 24,
): void {
  for (const sentence of splitSpeakableParts(chunk, maxParts)) {
    queuedKeys.add(speakPartDedupeKey(sentence));
  }
}

export function unmarkQueuedSpeakParts(
  chunk: string,
  queuedKeys: Set<string>,
  maxParts = 24,
): void {
  for (const sentence of splitSpeakableParts(chunk, maxParts)) {
    queuedKeys.delete(speakPartDedupeKey(sentence));
  }
}

/** Mark every sentence key covered by a (possibly grouped) spoken TTS chunk. */
export function markPlayedSpeakParts(
  spokenChunk: string,
  playedKeys: Set<string>,
  maxParts = 24,
): void {
  for (const sentence of splitSpeakableParts(spokenChunk, maxParts)) {
    playedKeys.add(speakPartDedupeKey(sentence));
  }
}

/** Parts of `text` not yet successfully queued for stream TTS this turn. */
export function unspokenStreamParts(text: string, playedKeys: ReadonlySet<string>, maxParts = 24): string[] {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return [];
  const complete = completeSpeakableParts(normalized, maxParts);
  const parts = splitSpeakableParts(normalized, maxParts);
  const all: string[] = [...complete];
  if (parts.length > complete.length) {
    const fragment = parts.slice(complete.length).join(' ').trim();
    if (fragment) all.push(fragment);
  }
  return all.filter((part) => !playedKeys.has(speakPartDedupeKey(part)));
}

/** Bubble text at turn end — extend with API final only when it continues the stream. */
export function resolveVoiceDisplayText(streamed: string, apiFinal: string): string {
  const s = normalizeSpeechText(streamed);
  const f = normalizeSpeechText(apiFinal);
  if (!s) return f;
  if (!f) return s;
  if (f.startsWith(s)) return f;
  if (s.startsWith(f)) return s;
  return s;
}

/**
 * Speakable parts present in API final but not covered by the streamed prefix.
 * Used once at turn end so a late closing line is not mistaken for a full re-read.
 */
export function extensionSpeakParts(
  apiFinal: string,
  streamed: string,
  playedKeys: ReadonlySet<string>,
  maxParts = 24,
): string[] {
  const ext = remainderAfterSpokenPrefix(apiFinal, streamed);
  if (!ext) return [];
  return unspokenStreamParts(ext, playedKeys, maxParts);
}

/** @deprecated Use resolveVoiceDisplayText + stream-only TTS. */
export function resolveVoiceTurnText(streamed: string, apiFinal: string): string {
  return resolveVoiceDisplayText(streamed, apiFinal);
}

