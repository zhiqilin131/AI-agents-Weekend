import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { buildExerciseResult } from '../buildExerciseResult';
import type { TherapyExerciseCallbacks } from '../types';
import {
  BREATHING_PATTERN,
  BreathingOrb,
  type BreathingPhaseId,
} from '../components/BreathingOrb';
import {
  TherapyLabGhostButton,
  TherapyLabPrimaryButton,
} from '../components/TherapyLabChrome';
import { useTherapyAudio } from '../useTherapyAudio';

type Props = TherapyExerciseCallbacks & {
  onStepChange: (step: string) => void;
  /** Test hook: counts committed BreathingOrb renders. */
  onOrbRenderDebug?: () => void;
};

export function BreathingGuideExercise({
  onStart,
  onComplete,
  onSkip,
  onStepChange,
  onOrbRenderDebug,
}: Props) {
  const [phase, setPhase] = useState<'prepare' | 'countdown' | 'running' | 'after'>('prepare');
  const [preflightCount, setPreflightCount] = useState(3);
  const [running, setRunning] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [countdown, setCountdown] = useState(BREATHING_PATTERN[0]!.seconds);
  const [cyclesDone, setCyclesDone] = useState(0);
  const startedAtRef = useRef(new Date().toISOString());
  const phaseIndexRef = useRef(0);
  const phaseRemainingMsRef = useRef(BREATHING_PATTERN[0]!.seconds * 1000);
  const lastAudioPhaseRef = useRef<BreathingPhaseId | null>(null);
  const therapyAudio = useTherapyAudio();

  const current = BREATHING_PATTERN[phaseIndex]!;

  useEffect(() => {
    onStepChange(
      phase === 'after'
        ? 'after_intensity'
        : phase === 'prepare'
          ? 'breath_prepare'
          : phase === 'countdown'
            ? 'breath_countdown'
            : `breath_${current.id}`,
    );
  }, [phase, current.id, onStepChange]);

  const syncPhaseAudio = useCallback(
    (phaseId: BreathingPhaseId, phaseSeconds: number, withCue: boolean) => {
      if (lastAudioPhaseRef.current === phaseId) return;
      lastAudioPhaseRef.current = phaseId;
      if (withCue) therapyAudio.playPhaseTransitionCue(phaseId);
      therapyAudio.updateBreathPhase(phaseId, phaseSeconds);
    },
    [therapyAudio],
  );

  const playCountdownCue = useCallback(
    (count: number) => {
      const cuePhase: BreathingPhaseId = count >= 3 ? 'hold_out' : count === 2 ? 'hold_in' : 'inhale';
      void (async () => {
        await therapyAudio.resumeContext();
        therapyAudio.playPhaseTransitionCue(cuePhase);
      })();
    },
    [therapyAudio],
  );

  const resumePhaseAudio = useCallback(
    (phaseId: BreathingPhaseId, phaseSeconds: number) => {
      void (async () => {
        await therapyAudio.resumeContext();
        therapyAudio.startBreathBed();
        syncPhaseAudio(phaseId, phaseSeconds, false);
      })();
    },
    [syncPhaseAudio, therapyAudio],
  );

  useEffect(() => {
    if (!running) return;
    const TICK_MS = 200;
    const id = window.setInterval(() => {
      phaseRemainingMsRef.current -= TICK_MS;
      if (phaseRemainingMsRef.current > 0) {
        const display = Math.max(1, Math.ceil(phaseRemainingMsRef.current / 1000));
        setCountdown((prev) => (prev === display ? prev : display));
        return;
      }
      const next = (phaseIndexRef.current + 1) % BREATHING_PATTERN.length;
      phaseIndexRef.current = next;
      if (next === 0) setCyclesDone((n) => n + 1);
      const p = BREATHING_PATTERN[next]!;
      phaseRemainingMsRef.current = p.seconds * 1000;
      setPhaseIndex(next);
      setCountdown(p.seconds);
      const majorPhase = p.id === 'inhale' || p.id === 'exhale';
      syncPhaseAudio(p.id, p.seconds, majorPhase);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running, syncPhaseAudio]);

  useEffect(() => {
    return () => {
      therapyAudio.stopAll();
    };
  }, [therapyAudio]);

  const startBreathing = useCallback(() => {
    onStart?.();
    startedAtRef.current = new Date().toISOString();
    setRunning(true);
    phaseIndexRef.current = 0;
    setPhaseIndex(0);
    setCountdown(BREATHING_PATTERN[0]!.seconds);
    phaseRemainingMsRef.current = BREATHING_PATTERN[0]!.seconds * 1000;
    setCyclesDone(0);
    lastAudioPhaseRef.current = null;
    therapyAudio.setMuted(false);
    resumePhaseAudio(BREATHING_PATTERN[0]!.id, BREATHING_PATTERN[0]!.seconds);
  }, [onStart, resumePhaseAudio, therapyAudio]);

  const beginCountdown = useCallback(() => {
    setPhase('countdown');
  }, []);

  useEffect(() => {
    if (phase !== 'countdown') return;
    setRunning(false);
    lastAudioPhaseRef.current = null;
    therapyAudio.stopAll();
    setPreflightCount(3);
    const id = window.setInterval(() => {
      setPreflightCount((n) => {
        if (n > 1) return n - 1;
        window.clearInterval(id);
        setPhase('running');
        startBreathing();
        return 3;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, startBreathing, therapyAudio]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (preflightCount < 1 || preflightCount > 3) return;
    playCountdownCue(preflightCount);
  }, [phase, playCountdownCue, preflightCount]);

  const toggleRunning = () => {
    if (running) {
      setRunning(false);
      lastAudioPhaseRef.current = null;
      therapyAudio.stopAll();
      return;
    }
    const phaseNow = BREATHING_PATTERN[phaseIndexRef.current]!;
    phaseRemainingMsRef.current = Math.max(1, countdown) * 1000;
    setRunning(true);
    resumePhaseAudio(phaseNow.id, phaseNow.seconds);
  };

  const endExercise = useCallback(
    (status: 'completed' | 'skipped') => {
      setRunning(false);
      lastAudioPhaseRef.current = null;
      therapyAudio.stopAll();
      onComplete(
        buildExerciseResult({
          exerciseType: 'breathing_guide',
          startedAt: startedAtRef.current,
          status,
          beforeIntensity: 5,
          afterIntensity: status === 'completed' ? 4 : undefined,
          resultSummary:
            status === 'completed'
              ? `Breathing practice (~${cyclesDone} cycles, 4-2-6-2 pattern).`
              : 'Breathing practice skipped.',
          payload: { cycles: cyclesDone, pattern: '4-2-6-2' },
        }),
      );
    },
    [cyclesDone, onComplete, therapyAudio],
  );

  if (phase === 'countdown') {
    return (
      <div
        className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden px-4"
        style={{
          background: 'radial-gradient(circle at 50% 42%, #34232C 0%, #160E13 78%)',
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.08),transparent_62%)]" />
        <div className="relative flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/45">Guided Breathing</p>
          <BreathingOrb phaseId="hold_out" phaseSeconds={1} label="Ready" paused />
          <motion.div
            key={preflightCount}
            initial={{ opacity: 0.28, scale: 0.88, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 0.76, 0.24, 1] }}
            className="text-6xl font-semibold tabular-nums text-white/80"
          >
            {preflightCount}
          </motion.div>
          <p className="text-sm text-white/55">Follow Rimuru&apos;s rhythm</p>
        </div>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <TherapyLabGhostButton
            className="border-white/35 bg-white/15 text-white hover:bg-white/20"
            onClick={() => {
              onSkip?.();
              endExercise('skipped');
            }}
          >
            Skip
          </TherapyLabGhostButton>
        </div>
      </div>
    );
  }

  if (phase === 'prepare') {
    return (
      <div
        className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden px-4"
        style={{
          background: 'radial-gradient(circle at 50% 42%, #34232C 0%, #160E13 78%)',
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,0.08),transparent_66%)]" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[44vh] w-[44vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-200/8 blur-3xl" />

        <div className="relative flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/45">Calm Mode</p>
          <h2 className="text-3xl font-semibold tracking-tight text-white/95 sm:text-4xl">Take a breath</h2>
          <p className="max-w-md text-sm leading-relaxed text-white/65">Follow the rhythm as it expands and softens.</p>
          <BreathingOrb phaseId="hold_out" phaseSeconds={2} label="Ready" paused />
          <div className="flex flex-wrap justify-center gap-2">
            <TherapyLabPrimaryButton onClick={beginCountdown}>Start</TherapyLabPrimaryButton>
          </div>
        </div>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <TherapyLabGhostButton
            className="border-white/35 bg-white/15 text-white hover:bg-white/20"
            onClick={() => {
              onSkip?.();
              endExercise('skipped');
            }}
          >
            Skip
          </TherapyLabGhostButton>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    return (
      <div
        className="relative flex min-h-[100dvh] w-full flex-col justify-end overflow-hidden"
        data-phase={current.id}
        style={{
          background: 'radial-gradient(circle at 50% 42%, #34232C 0%, #160E13 78%)',
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.08),transparent_62%)]" />
        <div className="relative flex flex-1 flex-col items-center justify-center gap-5 px-4 py-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/45">Guided Breathing</p>
          <BreathingOrb
            phaseId={current.id}
            phaseSeconds={current.seconds}
            label={
              current.id === 'inhale' ? 'Breathe in' : current.id === 'exhale' ? 'Breathe out' : 'Hold'
            }
            paused={!running}
            onRender={onOrbRenderDebug}
          />
          <p
            className="text-xs font-light tracking-wide text-white/55 transition-all"
            style={{
              opacity: current.id === 'hold_out' ? 0.42 : current.id === 'exhale' ? 0.52 : 0.62,
              transform: current.id === 'inhale' || current.id === 'hold_in' ? 'translateY(0) scale(1.02)' : 'translateY(2px) scale(0.98)',
              transitionDuration: `${current.seconds}s`,
            }}
          >
            {countdown}
          </p>
          <p className="text-sm text-white/55">Follow Rimuru&apos;s rhythm</p>
        </div>
        <div className="relative z-10 flex flex-wrap justify-center gap-2 px-4 pb-5 pt-2">
          <TherapyLabPrimaryButton onClick={toggleRunning}>{running ? 'Pause' : 'Resume'}</TherapyLabPrimaryButton>
          <TherapyLabGhostButton
            onClick={() => {
              setRunning(false);
              lastAudioPhaseRef.current = null;
              therapyAudio.stopAll();
              setPhase('after');
            }}
          >
            End
          </TherapyLabGhostButton>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden px-4"
      style={{
        background: 'radial-gradient(circle at 50% 38%, #34232C 0%, #160E13 78%)',
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,0.08),transparent_64%)]" />
      <div className="relative w-full max-w-xl rounded-[2rem] border border-white/20 bg-white/10 p-6 text-center shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/45">Guided Breathing</p>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-emerald-200/40 bg-emerald-200/15 text-2xl text-emerald-100">
          ✓
        </div>
        <h3 className="text-2xl font-semibold tracking-tight text-white/95">Nice work</h3>
        <p className="mt-2 text-sm text-white/70">One cycle at a time.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <TherapyLabPrimaryButton
            onClick={() => {
              endExercise('completed');
            }}
          >
            Save result
          </TherapyLabPrimaryButton>
          <TherapyLabGhostButton className="border-white/35 bg-white/15 text-white hover:bg-white/20" onClick={() => setPhase('prepare')}>
            Again
          </TherapyLabGhostButton>
        </div>
        <p className="mt-3 text-[11px] text-white/45">Press Esc to exit session.</p>
      </div>
    </div>
  );
}
