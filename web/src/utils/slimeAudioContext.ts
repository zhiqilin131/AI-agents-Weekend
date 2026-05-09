/** Shared AudioContext: unlock on user gesture (e.g. stop recording) so later decode+play works after async fetch. */

let sharedAudioContext: AudioContext | null = null;

export function unlockSlimeAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
      sharedAudioContext = new AC();
    }
    if (sharedAudioContext.state === 'suspended') {
      void sharedAudioContext.resume();
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

export type PlayMp3WithWebAudioHooks = {
  onEnded: () => void;
  trackSource?: (node: AudioBufferSourceNode | null) => void;
};

/**
 * Play MP3 (or other decodeable) blob via Web Audio — often succeeds after async when
 * unlockSlimeAudioContext() ran in the same user gesture as starting the voice pipeline.
 */
export async function playMp3BlobWithWebAudio(blob: Blob, hooks: PlayMp3WithWebAudioHooks): Promise<boolean> {
  const ctx = unlockSlimeAudioContext();
  if (!ctx) return false;
  try {
    await ctx.resume();
  } catch {
    return false;
  }
  let audioBuffer: AudioBuffer;
  try {
    const raw = await blob.arrayBuffer();
    audioBuffer = await ctx.decodeAudioData(raw.slice(0));
  } catch {
    return false;
  }
  const src = ctx.createBufferSource();
  hooks.trackSource?.(src);
  src.buffer = audioBuffer;
  src.connect(ctx.destination);
  src.onended = () => {
    hooks.trackSource?.(null);
    hooks.onEnded();
  };
  try {
    src.start(0);
    return true;
  } catch {
    hooks.trackSource?.(null);
    return false;
  }
}
