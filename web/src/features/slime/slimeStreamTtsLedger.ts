/**
 * Industrial stream-TTS ledger: single source of truth for enqueue / play / heard state.
 * Prevents duplicate reads via normalized keys, spoken-prefix coverage, and a strict cursor.
 */

import {
  normalizeSpeechText,
  newlyCompleteSpeakableParts,
  orderedSpeakableParts,
  speakPartDedupeKey,
} from './slimeTtsChunks';

export type StreamTtsChunkState = 'queued' | 'playing' | 'done' | 'failed';

export type StreamTtsChunk = {
  key: string;
  text: string;
  state: StreamTtsChunkState;
  failCount: number;
};

/** Aggressive normalization so minor punctuation drift does not bypass dedupe. */
export function normalizeSpeakKey(part: string): string {
  return speakPartDedupeKey(part)
    .replace(/[''`´]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/[^a-z0-9\s.!?。！？'"()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact audio heard so far (concatenation of successfully played chunks). */
export function appendToSpokenPrefix(prefix: string, chunk: string): string {
  const pre = normalizeSpeechText(prefix);
  const c = normalizeSpeechText(chunk);
  if (!c) return pre;
  if (!pre) return c;
  if (pre === c) return pre;
  if (pre.endsWith(c)) return pre;
  if (pre.includes(c)) return pre;
  if (c.startsWith(pre)) return c;
  const idx = c.indexOf(pre);
  if (idx >= 0 && idx <= 8) return c;
  return normalizeSpeechText(`${pre} ${c}`);
}

/** True when this chunk text is already covered by heard audio or an active ledger entry. */
export function isChunkAlreadySpoken(
  text: string,
  spokenPrefix: string,
  activeKeys: ReadonlySet<string>,
): boolean {
  const key = normalizeSpeakKey(text);
  if (!key) return true;
  if (activeKeys.has(key)) return true;

  const spoken = normalizeSpeechText(spokenPrefix);
  const chunk = normalizeSpeechText(text);
  if (!spoken) return false;
  if (!chunk) return true;
  if (spoken.includes(chunk)) return true;

  const spokenKey = normalizeSpeakKey(spoken);
  if (spokenKey.includes(key) && key.length >= 12) return true;
  if (key.includes(spokenKey) && spokenKey.length >= 20) return true;

  const chunkWords = chunk.split(' ').filter(Boolean);
  if (chunkWords.length >= 4) {
    const head = chunkWords.slice(0, 4).join(' ');
    if (spoken.includes(head)) return true;
  }
  return false;
}

export class StreamTtsLedger {
  chunks: StreamTtsChunk[] = [];

  /** Index of the next chunk to play (only advances on markDone or markFailedPermanent). */
  playCursor = 0;

  /** Normalized text confirmed heard via completed audio playback. */
  spokenPrefix = '';

  turnDone = false;

  /** Incremental feed: complete sentences already considered for enqueue this turn. */
  feedCompleteCount = 0;

  reset(): void {
    this.chunks = [];
    this.playCursor = 0;
    this.spokenPrefix = '';
    this.turnDone = false;
    this.feedCompleteCount = 0;
  }

  activeKeys(): Set<string> {
    const keys = new Set<string>();
    for (const c of this.chunks) {
      if (c.state === 'queued' || c.state === 'playing' || c.state === 'done') {
        keys.add(c.key);
      }
    }
    return keys;
  }

  shouldEnqueue(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    return !isChunkAlreadySpoken(trimmed, this.spokenPrefix, this.activeKeys());
  }

  /** Returns queue index or null if deduped. */
  enqueue(text: string): number | null {
    const trimmed = text.trim();
    if (!this.shouldEnqueue(trimmed)) return null;
    const key = normalizeSpeakKey(trimmed);
    const idx = this.chunks.length;
    this.chunks.push({ key, text: trimmed, state: 'queued', failCount: 0 });
    return idx;
  }

  orderedTexts(): string[] {
    return this.chunks.map((c) => c.text);
  }

  chunkAtPlayCursor(): StreamTtsChunk | null {
    return this.chunks[this.playCursor] ?? null;
  }

  prefetchKey(gen: number, chunk: StreamTtsChunk): string {
    return `pf-${gen}-${chunk.key}`;
  }

  markPlaying(): void {
    const c = this.chunks[this.playCursor];
    if (c && c.state === 'queued') c.state = 'playing';
  }

  markDone(text: string): void {
    const c = this.chunks[this.playCursor];
    if (!c) return;
    c.state = 'done';
    this.spokenPrefix = appendToSpokenPrefix(this.spokenPrefix, text);
    this.playCursor += 1;
  }

  /** Retry same cursor up to maxRetries; then skip permanently. */
  markFailed(maxRetries = 3): void {
    const c = this.chunks[this.playCursor];
    if (!c) return;
    c.failCount += 1;
    if (c.failCount >= maxRetries) {
      c.state = 'failed';
      this.playCursor += 1;
    } else {
      c.state = 'queued';
    }
  }

  /** New complete sentences from stream canon since last feed. */
  feedNewParts(canon: string, maxParts = 24): string[] {
    const { newParts, completeCount } = newlyCompleteSpeakableParts(
      canon,
      this.feedCompleteCount,
      maxParts,
    );
    this.feedCompleteCount = completeCount;
    return newParts.filter((p) => this.shouldEnqueue(p));
  }

  /** At turn end: canon sentences not yet scheduled or heard. */
  remainingCanonParts(canon: string, maxParts = 24): string[] {
    return orderedSpeakableParts(canon, maxParts).filter((p) => this.shouldEnqueue(p));
  }

  hasMoreToPlay(): boolean {
    return this.playCursor < this.chunks.length;
  }

  sequenceHasMore(): boolean {
    const idx = this.playCursor;
    return idx < this.chunks.length - 1 || !this.turnDone;
  }
}
