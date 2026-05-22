import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...rest }: { children?: unknown }) => <div {...rest}>{children}</div>,
  },
}));

const audioApi = {
  muted: true,
  volume: 0.18,
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  startBreathBed: vi.fn(),
  updateBreathPhase: vi.fn(),
  playPhaseTransitionCue: vi.fn(),
  stopAll: vi.fn(),
  resumeContext: vi.fn(async () => {}),
};

vi.mock('../useTherapyLabTts', () => ({
  useTherapyLabTts: () => ({
    speak: vi.fn(async () => {}),
    stop: vi.fn(),
    speaking: false,
    ttsError: null,
  }),
}));

vi.mock('../useTherapyAudio', () => ({
  THERAPY_AUDIO_MAX_GAIN: 0.72,
  useTherapyAudio: () => audioApi,
}));

function buttonText(node: { props: { children?: unknown } }): string {
  const v = node.props.children;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join('');
  return '';
}

describe('BreathingGuideExercise render behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { window?: typeof globalThis }).window = globalThis;
    Object.values(audioApi).forEach((v) => {
      if (typeof v === 'function') (v as ReturnType<typeof vi.fn>).mockClear();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not re-render BreathingOrb on per-second countdown ticks', async () => {
    const { BreathingGuideExercise } = await import('./BreathingGuideExercise');
    const onOrbRenderDebug = vi.fn();
    const renderer = create(
      <BreathingGuideExercise
        onStart={vi.fn()}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
        onStepChange={vi.fn()}
        onOrbRenderDebug={onOrbRenderDebug}
      />,
    );

    const startButton = renderer.root
      .findAllByType('button')
      .find((btn) => buttonText(btn).includes('Start'));
    expect(startButton).toBeTruthy();

    act(() => {
      startButton!.props.onClick();
    });

    const rendersAtPhaseStart = onOrbRenderDebug.mock.calls.length;
    expect(rendersAtPhaseStart).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onOrbRenderDebug.mock.calls.length).toBe(rendersAtPhaseStart);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onOrbRenderDebug.mock.calls.length).toBeGreaterThan(rendersAtPhaseStart);

    act(() => {
      renderer.unmount();
    });
  });
});
