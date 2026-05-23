import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BreathingPhaseId } from './components/BreathingOrb';

const STOP_FADE_SECONDS = 0.04;
export const THERAPY_AUDIO_MAX_GAIN = 0.72;

type RuntimeAudioCtx = AudioContext;

function now(ctx: RuntimeAudioCtx): number {
  return ctx.currentTime;
}

function holdParam(param: AudioParam, at: number) {
  const withHold = param as AudioParam & { cancelAndHoldAtTime?: (cancelTime: number) => void };
  if (typeof withHold.cancelAndHoldAtTime === 'function') {
    withHold.cancelAndHoldAtTime(at);
    return;
  }
  param.cancelScheduledValues(at);
  param.setValueAtTime(param.value, at);
}

function rampGain(gain: GainNode['gain'], value: number, at: number, seconds: number) {
  holdParam(gain, at);
  gain.linearRampToValueAtTime(value, at + Math.max(0.001, seconds));
}

function softStopGain(gain: GainNode, ctx: RuntimeAudioCtx, seconds = STOP_FADE_SECONDS) {
  const t = now(ctx);
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + seconds);
}

function safeStopNode(node: AudioScheduledSourceNode | null | undefined, when = 0) {
  if (!node) return;
  try {
    node.stop(when);
  } catch {
    /* already stopped */
  }
}

type CueVoice = {
  osc: OscillatorNode;
  gain: GainNode;
};

type BedVoice = {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
};

type DroneVoice = {
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  gain: GainNode;
};

export type TherapyAudioEngine = {
  setMuted: (value: boolean) => void;
  setVolume: (value: number) => void;
  startBreathBed: () => void;
  updateBreathPhase: (phaseId: BreathingPhaseId, phaseDurationSeconds: number) => void;
  playPhaseTransitionCue: (phaseId: BreathingPhaseId) => void;
  stopAll: () => void;
  resumeContext: () => Promise<void>;
  getDebugState: () => { bedActive: boolean; droneActive: boolean; cueActive: boolean };
};

export function createTherapyAudioEngine(
  contextFactory: () => RuntimeAudioCtx | null = () =>
    typeof window !== 'undefined' && 'AudioContext' in window
      ? new window.AudioContext()
      : null,
): TherapyAudioEngine {
  let ctx: RuntimeAudioCtx | null = null;
  let master: GainNode | null = null;
  let muted = true;
  let volume = 0.25;
  let bed: BedVoice | null = null;
  let drone: DroneVoice | null = null;
  let cue: CueVoice | null = null;

  const ensureCtx = () => {
    if (!ctx) {
      ctx = contextFactory();
      if (!ctx) return null;
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
    }
    return ctx;
  };

  const applyMaster = () => {
    if (!ctx || !master) return;
    const t = now(ctx);
    const target = muted ? 0 : Math.min(THERAPY_AUDIO_MAX_GAIN, Math.max(0, volume));
    rampGain(master.gain, target, t, 0.06);
  };

  const createNoiseBuffer = (audioCtx: RuntimeAudioCtx, seconds = 2) => {
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * seconds, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.12;
    }
    return buffer;
  };

  const ensureBed = () => {
    const audioCtx = ensureCtx();
    if (!audioCtx || !master) return;
    if (bed) return;
    const src = audioCtx.createBufferSource();
    src.buffer = createNoiseBuffer(audioCtx, 2);
    src.loop = true;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    bed = { src, filter, gain };
  };

  const ensureDrone = () => {
    const audioCtx = ensureCtx();
    if (!audioCtx || !master) return;
    if (drone) return;
    const oscA = audioCtx.createOscillator();
    const oscB = audioCtx.createOscillator();
    oscA.type = 'sine';
    oscB.type = 'triangle';
    oscA.frequency.value = 146.83;
    oscB.frequency.value = 220;
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    oscA.connect(gain);
    oscB.connect(gain);
    gain.connect(master);
    oscA.start();
    oscB.start();
    drone = { oscA, oscB, gain };
    rampGain(gain.gain, 0.05, now(audioCtx), 0.8);
  };

  const stopCue = (fadeSeconds = STOP_FADE_SECONDS) => {
    if (!ctx || !cue) return;
    softStopGain(cue.gain, ctx, fadeSeconds);
    safeStopNode(cue.osc, now(ctx) + fadeSeconds + 0.01);
    cue = null;
  };

  return {
    setMuted(value) {
      muted = value;
      applyMaster();
    },
    setVolume(value) {
      volume = Math.max(0, Math.min(THERAPY_AUDIO_MAX_GAIN, value));
      applyMaster();
    },
    async resumeContext() {
      const audioCtx = ensureCtx();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') {
        try {
          await audioCtx.resume();
        } catch {
          /* ignored */
        }
      }
      applyMaster();
    },
    startBreathBed() {
      const audioCtx = ensureCtx();
      if (!audioCtx) return;
      ensureBed();
      ensureDrone();
      applyMaster();
      if (bed) {
        const t = now(audioCtx);
        rampGain(bed.gain.gain, 0.12, t, 0.25);
      }
    },
    updateBreathPhase(phaseId, phaseDurationSeconds) {
      const audioCtx = ensureCtx();
      if (!audioCtx || !bed) return;
      const t = now(audioCtx);
      const dur = Math.max(0.08, phaseDurationSeconds);
      const cfg =
        phaseId === 'inhale'
          ? { amp: 0.2, hz: 860 }
          : phaseId === 'hold_in'
            ? { amp: 0.17, hz: 760 }
            : phaseId === 'exhale'
              ? { amp: 0.08, hz: 520 }
              : { amp: 0.05, hz: 430 };
      rampGain(bed.gain.gain, cfg.amp, t, dur * 0.96);
      holdParam(bed.filter.frequency, t);
      bed.filter.frequency.linearRampToValueAtTime(cfg.hz, t + dur * 0.96);
    },
    playPhaseTransitionCue(phaseId) {
      const audioCtx = ensureCtx();
      if (!audioCtx || !master) return;
      stopCue();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const base =
        phaseId === 'inhale'
          ? 392
          : phaseId === 'hold_in'
            ? 349.23
            : phaseId === 'exhale'
              ? 329.63
              : 293.66;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, now(audioCtx));
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      const t = now(audioCtx);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.06, t + 0.06);
      gain.gain.linearRampToValueAtTime(0.0, t + 0.75);
      osc.stop(t + 0.8);
      cue = { osc, gain };
      osc.onended = () => {
        if (cue?.osc === osc) cue = null;
      };
    },
    stopAll() {
      if (!ctx || !master) return;
      const t = now(ctx);
      // Re-entrant/idempotent: safe to call from safety path and unmount cleanup.
      rampGain(master.gain, 0, t, STOP_FADE_SECONDS);
      if (bed) {
        softStopGain(bed.gain, ctx, STOP_FADE_SECONDS);
        safeStopNode(bed.src, t + STOP_FADE_SECONDS + 0.01);
        bed = null;
      }
      if (drone) {
        softStopGain(drone.gain, ctx, STOP_FADE_SECONDS);
        safeStopNode(drone.oscA, t + STOP_FADE_SECONDS + 0.01);
        safeStopNode(drone.oscB, t + STOP_FADE_SECONDS + 0.01);
        drone = null;
      }
      stopCue(STOP_FADE_SECONDS);
    },
    getDebugState() {
      return { bedActive: Boolean(bed), droneActive: Boolean(drone), cueActive: Boolean(cue) };
    },
  };
}

let singleton: TherapyAudioEngine | null = null;
function getSingleton(): TherapyAudioEngine {
  if (!singleton) singleton = createTherapyAudioEngine();
  return singleton;
}

const MUTE_KEY = 'therapyLabAudioMuted';
const VOLUME_KEY = 'therapyLabAudioVolume';

function readMutedDefault(): boolean {
  return false;
}

function readVolumeDefault(): number {
  try {
    const raw = Number(localStorage.getItem(VOLUME_KEY));
    if (!Number.isNaN(raw) && raw >= 0 && raw <= THERAPY_AUDIO_MAX_GAIN) return raw;
  } catch {
    /* ignore */
  }
  return 0.42;
}

export function stopTherapyAudioNow() {
  getSingleton().stopAll();
}

export function useTherapyAudio() {
  const engine = useMemo(() => getSingleton(), []);
  const [muted, setMutedState] = useState<boolean>(() => readMutedDefault());
  const [volume, setVolumeState] = useState<number>(() => readVolumeDefault());
  const setMuted = useCallback(
    (value: boolean) => {
      setMutedState(value);
      engine.setMuted(value);
    },
    [engine],
  );
  const setVolume = useCallback(
    (value: number) => {
      const next = Math.max(0, Math.min(THERAPY_AUDIO_MAX_GAIN, value));
      setVolumeState(next);
      engine.setVolume(next);
    },
    [engine],
  );

  useEffect(() => {
    engine.setMuted(muted);
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [engine, muted]);

  useEffect(() => {
    engine.setVolume(volume);
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      /* ignore */
    }
  }, [engine, volume]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void engine.resumeContext();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [engine]);

  return useMemo(
    () => ({
      muted,
      volume,
      setMuted,
      setVolume,
      startBreathBed: engine.startBreathBed,
      updateBreathPhase: engine.updateBreathPhase,
      playPhaseTransitionCue: engine.playPhaseTransitionCue,
      stopAll: engine.stopAll,
      resumeContext: engine.resumeContext,
    }),
    [engine, muted, setMuted, setVolume, volume],
  );
}
