import { useCallback, useEffect, useRef, useState } from 'react';
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
  TherapyLabStepCard,
  therapyLabTheme,
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
  const [phase, setPhase] = useState<'intro' | 'running' | 'after'>('intro');
  const [justSaved, setJustSaved] = useState(false);
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
      phase === 'intro' ? 'before_intensity' : phase === 'after' ? 'after_intensity' : `breath_${current.id}`,
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

  const startBreathing = () => {
    setJustSaved(false);
    onStart?.();
    startedAtRef.current = new Date().toISOString();
    setPhase('running');
    setRunning(true);
    phaseIndexRef.current = 0;
    setPhaseIndex(0);
    setCountdown(BREATHING_PATTERN[0]!.seconds);
    phaseRemainingMsRef.current = BREATHING_PATTERN[0]!.seconds * 1000;
    setCyclesDone(0);
    lastAudioPhaseRef.current = null;
    therapyAudio.setMuted(false);
    resumePhaseAudio(BREATHING_PATTERN[0]!.id, BREATHING_PATTERN[0]!.seconds);
  };

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
              ? `Breathing practice (~${cyclesDone} cycles, 4-6 pattern).`
              : 'Breathing practice skipped.',
          payload: { cycles: cyclesDone, pattern: '4-6' },
        }),
      );
    },
    [cyclesDone, onComplete, therapyAudio],
  );

  if (phase === 'intro') {
    return (
      <TherapyLabStepCard title="Breathing" stepIndex={1} stepTotal={3}>
        <div className="space-y-3 text-center">
          <p className="text-sm text-slate-600">Follow the orb.</p>
          {justSaved ? <p className="text-xs font-semibold text-emerald-700">Saved</p> : null}
          <div className="flex justify-center py-1">
            <BreathingOrb phaseId="inhale" phaseSeconds={4} paused />
          </div>
        </div>
        <div className="rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-center text-[11px] font-medium text-slate-500 backdrop-blur-sm">
          Ambient sound is on
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <TherapyLabPrimaryButton onClick={startBreathing}>Start</TherapyLabPrimaryButton>
          <TherapyLabGhostButton
            onClick={() => {
              onSkip?.();
              endExercise('skipped');
            }}
          >
            Skip
          </TherapyLabGhostButton>
        </div>
      </TherapyLabStepCard>
    );
  }

  if (phase === 'running') {
    return (
      <TherapyLabStepCard title={current.label} stepIndex={2} stepTotal={3}>
        <div className="flex flex-col items-center gap-6 py-4">
          <BreathingOrb phaseId={current.id} phaseSeconds={current.seconds} paused={!running} onRender={onOrbRenderDebug} />
          <div className="text-center">
            <span className="font-semibold tabular-nums text-5xl" style={{ color: therapyLabTheme.heading }}>
              {countdown}
            </span>
            <div className="mt-1 text-xs text-slate-500">
              {current.label} · cycle {cyclesDone + 1}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
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
      </TherapyLabStepCard>
    );
  }

  return (
    <TherapyLabStepCard title="Nice work" stepIndex={3} stepTotal={3}>
      <p className="text-center text-sm text-slate-600">One cycle at a time.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <TherapyLabPrimaryButton
          onClick={() => {
            endExercise('completed');
            setJustSaved(true);
            setPhase('intro');
          }}
        >
          Save result
        </TherapyLabPrimaryButton>
        <TherapyLabGhostButton onClick={startBreathing}>Again</TherapyLabGhostButton>
      </div>
    </TherapyLabStepCard>
  );
}
