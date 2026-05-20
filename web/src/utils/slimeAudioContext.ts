/** Shared AudioContext: unlock on user gesture (e.g. stop recording) so later decode+play works after async fetch. */

import {
  resetSlimeSpeakAmplitude,
  setSlimeSpeakAmplitude,
} from '../features/slime/visual3d/slimeSpeakAmplitude';

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
  onStart?: () => void;
  onEnded: () => void;
  trackSource?: (node: AudioBufferSourceNode | null) => void;
};

function sampleSpeechAmplitude(analyser: AnalyserNode): number {
  const { fftSize, frequencyBinCount } = analyser;
  const time = new Uint8Array(fftSize);
  analyser.getByteTimeDomainData(time);
  let sumSq = 0;
  for (let i = 0; i < time.length; i += 1) {
    const v = (time[i]! - 128) / 128;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / time.length);

  const bins = new Uint8Array(frequencyBinCount);
  analyser.getByteFrequencyData(bins);
  const sampleRate = sharedAudioContext?.sampleRate ?? 48_000;
  const hzPerBin = sampleRate / fftSize;
  let speechEnergy = 0;
  let speechBins = 0;
  for (let i = 0; i < bins.length; i += 1) {
    const hz = i * hzPerBin;
    if (hz < 180 || hz > 4_200) continue;
    speechEnergy += bins[i]!;
    speechBins += 1;
  }
  const speechNorm = speechBins > 0 ? speechEnergy / (speechBins * 255) : 0;

  const mixed = rms * 0.62 + speechNorm * 0.38;
  return Math.min(1, mixed * 2.35);
}

function startAmplitudeLoop(analyser: AnalyserNode): () => void {
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.38;
  let ampRaf = 0;
  const tick = () => {
    setSlimeSpeakAmplitude(sampleSpeechAmplitude(analyser));
    ampRaf = requestAnimationFrame(tick);
  };
  ampRaf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(ampRaf);
    resetSlimeSpeakAmplitude();
  };
}

/**
 * Drive mouth amplitude from an HTMLAudioElement (TTS fallback path).
 * Returns cleanup — call on ended / cancel.
 */
export function connectHtmlAudioAmplitudeAnalyzer(audio: HTMLAudioElement): (() => void) | null {
  const ctx = unlockSlimeAudioContext();
  if (!ctx) return null;
  try {
    void ctx.resume();
  } catch {
    return null;
  }
  let analyser: AnalyserNode;
  try {
    const source = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    source.connect(analyser);
    analyser.connect(ctx.destination);
  } catch {
    return null;
  }
  return startAmplitudeLoop(analyser);
}

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
  const analyser = ctx.createAnalyser();
  src.connect(analyser);
  analyser.connect(ctx.destination);
  const stopAmp = startAmplitudeLoop(analyser);
  src.onended = () => {
    stopAmp();
    hooks.trackSource?.(null);
    hooks.onEnded();
  };
  try {
    src.start(0);
    hooks.onStart?.();
    return true;
  } catch {
    stopAmp();
    hooks.trackSource?.(null);
    return false;
  }
}
