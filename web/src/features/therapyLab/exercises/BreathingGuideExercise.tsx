import { useCallback, useEffect, useRef, useState } from 'react';
import { buildExerciseResult } from '../buildExerciseResult';
import type { TherapyExerciseCallbacks } from '../types';
import {
  BREATHING_CYCLE_SECONDS,
  BREATHING_PATTERN,
  BreathingOrb,
} from '../components/BreathingOrb';
import {
  IntensitySlider,
  TherapyLabGhostButton,
  TherapyLabPrimaryButton,
  TherapyLabStepCard,
  therapyLabTheme,
} from '../components/TherapyLabChrome';
import { useTherapyLabTts } from '../useTherapyLabTts';

type Props = TherapyExerciseCallbacks & {
  onStepChange: (step: string) => void;
};

export function BreathingGuideExercise({ onStart, onComplete, onSkip, onStepChange }: Props) {
  const [phase, setPhase] = useState<'intro' | 'running' | 'after'>('intro');
  const [beforeIntensity, setBeforeIntensity] = useState(5);
  const [afterIntensity, setAfterIntensity] = useState(4);
  const [running, setRunning] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [countdown, setCountdown] = useState(BREATHING_PATTERN[0]!.seconds);
  const [elapsedInCycle, setElapsedInCycle] = useState(0);
  const [voiceOn, setVoiceOn] = useState(false);
  const [cyclesDone, setCyclesDone] = useState(0);
  const startedAtRef = useRef(new Date().toISOString());
  const phaseIndexRef = useRef(0);
  const { speak, speaking, ttsError } = useTherapyLabTts();

  const current = BREATHING_PATTERN[phaseIndex]!;

  useEffect(() => {
    onStepChange(
      phase === 'intro' ? 'before_intensity' : phase === 'after' ? 'after_intensity' : `breath_${current.id}`,
    );
  }, [phase, current.id, onStepChange]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setCountdown((c) => {
        if (c > 1) return c - 1;
        const next = (phaseIndexRef.current + 1) % BREATHING_PATTERN.length;
        phaseIndexRef.current = next;
        if (next === 0) setCyclesDone((n) => n + 1);
        const p = BREATHING_PATTERN[next]!;
        setPhaseIndex(next);
        if (voiceOn) void speak(p.label);
        return p.seconds;
      });
      setElapsedInCycle((e) => (e + 1 >= BREATHING_CYCLE_SECONDS ? 0 : e + 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, speak, voiceOn]);

  const startBreathing = () => {
    onStart?.();
    startedAtRef.current = new Date().toISOString();
    setPhase('running');
    setRunning(true);
    phaseIndexRef.current = 0;
    setPhaseIndex(0);
    setCountdown(BREATHING_PATTERN[0]!.seconds);
    setElapsedInCycle(0);
    setCyclesDone(0);
    if (voiceOn) void speak('Inhale');
  };

  const endExercise = useCallback(
    (status: 'completed' | 'skipped') => {
      setRunning(false);
      onComplete(
        buildExerciseResult({
          exerciseType: 'breathing_guide',
          startedAt: startedAtRef.current,
          status,
          beforeIntensity,
          afterIntensity: status === 'completed' ? afterIntensity : undefined,
          resultSummary:
            status === 'completed'
              ? `Breathing practice (~${cyclesDone} cycles, 4-2-6-2 pattern). Felt ${beforeIntensity}/10 → ${afterIntensity}/10.`
              : 'Breathing practice skipped.',
          payload: { cycles: cyclesDone, pattern: '4-2-6-2' },
        }),
      );
    },
    [afterIntensity, beforeIntensity, cyclesDone, onComplete],
  );

  if (phase === 'intro') {
    return (
      <TherapyLabStepCard title="Before we breathe" stepIndex={1} stepTotal={3}>
        <p className="text-sm text-slate-600">
          Follow the orb: grows as you inhale, holds, shrinks as you exhale, holds again. Not medical treatment.
        </p>
        <IntensitySlider value={beforeIntensity} onChange={setBeforeIntensity} />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} />
          Optional voice guidance (Rimumu TTS)
        </label>
        {ttsError ? <p className="text-xs text-amber-800">{ttsError}</p> : null}
        <div className="flex flex-wrap gap-2">
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
    const progressPct = Math.round((elapsedInCycle / BREATHING_CYCLE_SECONDS) * 100);
    return (
      <TherapyLabStepCard title={current.label} stepIndex={2} stepTotal={3}>
        <div className="flex flex-col items-center gap-5 py-2">
          <BreathingOrb
            phaseId={current.id}
            phaseSeconds={current.seconds}
            countdown={countdown}
            paused={!running}
            label={
              <>
                <span className="font-semibold" style={{ color: therapyLabTheme.heading }}>
                  {current.label}
                </span>
                <span className="text-slate-400"> · </span>
                Cycle {cyclesDone + 1}
                {speaking ? <span className="text-slate-400"> · voice…</span> : null}
              </>
            }
          />

          <div className="flex w-full max-w-xs gap-1">
            {BREATHING_PATTERN.map((p, i) => (
              <div
                key={p.id}
                className="h-1 flex-1 overflow-hidden rounded-full bg-rose-100/90"
                title={p.label}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: i < phaseIndex ? '100%' : i === phaseIndex ? `${((p.seconds - countdown) / p.seconds) * 100}%` : '0%',
                    background:
                      p.id === 'inhale' || p.id === 'hold_in'
                        ? `linear-gradient(90deg, ${therapyLabTheme.secondary}, ${therapyLabTheme.primary})`
                        : `linear-gradient(90deg, ${therapyLabTheme.accent}, ${therapyLabTheme.deep})`,
                  }}
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">4s in · 2s hold · 6s out · 2s hold</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TherapyLabPrimaryButton onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Resume'}</TherapyLabPrimaryButton>
          <TherapyLabGhostButton
            onClick={() => {
              setRunning(false);
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
    <TherapyLabStepCard title="How do you feel now?" stepIndex={3} stepTotal={3}>
      <IntensitySlider value={afterIntensity} onChange={setAfterIntensity} label="After breathing (0–10)" />
      <TherapyLabPrimaryButton onClick={() => endExercise('completed')}>Save result</TherapyLabPrimaryButton>
    </TherapyLabStepCard>
  );
}
