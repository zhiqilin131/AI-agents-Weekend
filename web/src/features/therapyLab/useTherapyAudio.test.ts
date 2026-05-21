import { describe, expect, it, vi } from 'vitest';
import { createTherapyAudioEngine } from './useTherapyAudio';

class FakeAudioParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn((v: number) => {
    this.value = v;
  });
  linearRampToValueAtTime = vi.fn((v: number) => {
    this.value = v;
  });
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connect = vi.fn();
}

class FakeBiquadFilterNode {
  type = 'lowpass';
  frequency = new FakeAudioParam();
  connect = vi.fn();
}

class FakeBufferSourceNode {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn(() => {
    this.onended?.();
  });
}

class FakeOscillatorNode {
  type: OscillatorType = 'sine';
  frequency = new FakeAudioParam();
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn(() => {
    this.onended?.();
  });
}

class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  destination = {};
  oscillators: FakeOscillatorNode[] = [];
  bufferSources: FakeBufferSourceNode[] = [];

  createGain() {
    return new FakeGainNode() as unknown as GainNode;
  }
  createBiquadFilter() {
    return new FakeBiquadFilterNode() as unknown as BiquadFilterNode;
  }
  createBufferSource() {
    const src = new FakeBufferSourceNode();
    this.bufferSources.push(src);
    return src as unknown as AudioBufferSourceNode;
  }
  createOscillator() {
    const osc = new FakeOscillatorNode();
    this.oscillators.push(osc);
    return osc as unknown as OscillatorNode;
  }
  createBuffer(_channels: number, length: number) {
    return {
      getChannelData: () => new Float32Array(length),
    } as unknown as AudioBuffer;
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
}

describe('createTherapyAudioEngine', () => {
  it('does not stack overlapping cue sources on rapid phase changes', () => {
    const fake = new FakeAudioContext();
    const engine = createTherapyAudioEngine(() => fake as unknown as AudioContext);
    engine.setMuted(false);
    engine.startBreathBed();

    engine.playPhaseTransitionCue('inhale');
    engine.playPhaseTransitionCue('hold_in');
    engine.playPhaseTransitionCue('exhale');
    engine.playPhaseTransitionCue('hold_out');

    const cueOscs = fake.oscillators.slice(2); // first 2 are drone voices
    expect(cueOscs.length).toBe(4);
    cueOscs.slice(0, -1).forEach((osc) => {
      expect(osc.stop).toHaveBeenCalled();
    });
    expect(cueOscs[cueOscs.length - 1]?.start).toHaveBeenCalled();
  });

  it('stopAll is idempotent and re-entrant', () => {
    const fake = new FakeAudioContext();
    const engine = createTherapyAudioEngine(() => fake as unknown as AudioContext);
    engine.setMuted(false);
    engine.startBreathBed();
    engine.playPhaseTransitionCue('inhale');

    expect(() => engine.stopAll()).not.toThrow();
    expect(() => engine.stopAll()).not.toThrow();
    expect(fake.bufferSources[0]?.stop).toHaveBeenCalled();
  });
});
