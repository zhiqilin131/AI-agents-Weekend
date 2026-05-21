import { useState } from 'react';
import { buildExerciseResult } from '../buildExerciseResult';
import { scanTextFieldsForSafety } from '../safetyEscalation';
import type { TherapyExerciseCallbacks } from '../types';
import {
  IntensitySlider,
  TherapyLabGhostButton,
  TherapyLabPrimaryButton,
  TherapyLabStepCard,
} from '../components/TherapyLabChrome';

const STEPS = [
  { count: 5, sense: 'see', prompt: 'Name 5 things you can see around you.' },
  { count: 4, sense: 'touch', prompt: 'Name 4 things you can touch or feel.' },
  { count: 3, sense: 'hear', prompt: 'Name 3 things you can hear.' },
  { count: 2, sense: 'smell', prompt: 'Name 2 things you can smell (or like the smell of).' },
  { count: 1, sense: 'taste', prompt: 'Name 1 thing you can taste — or a flavor you enjoy.' },
] as const;

type Props = TherapyExerciseCallbacks & {
  onStepChange: (step: string) => void;
  onSafetyTriggered: () => void;
};

export function Grounding54321Exercise({ onStart, onComplete, onSkip, onStepChange, onSafetyTriggered }: Props) {
  const [phase, setPhase] = useState<'before' | 'steps' | 'after'>('before');
  const [stepIndex, setStepIndex] = useState(0);
  const [beforeIntensity, setBeforeIntensity] = useState(6);
  const [afterIntensity, setAfterIntensity] = useState(4);
  const [completed, setCompleted] = useState<boolean[]>(STEPS.map(() => false));
  const [entry, setEntry] = useState('');
  const startedAt = useState(() => new Date().toISOString())[0];

  const step = STEPS[stepIndex];

  const markDone = () => {
    if (scanTextFieldsForSafety([entry])) {
      onSafetyTriggered();
      return;
    }
    const nextCompleted = [...completed];
    nextCompleted[stepIndex] = true;
    setCompleted(nextCompleted);
    setEntry('');
    if (stepIndex < STEPS.length - 1) {
      const ni = stepIndex + 1;
      setStepIndex(ni);
      onStepChange(`grounding_${STEPS[ni]!.sense}`);
    } else {
      setPhase('after');
      onStepChange('after_intensity');
    }
  };

  if (phase === 'before') {
    return (
      <TherapyLabStepCard title="Grounding check-in" stepIndex={1} stepTotal={STEPS.length + 2}>
        <IntensitySlider value={beforeIntensity} onChange={setBeforeIntensity} />
        <TherapyLabPrimaryButton
          onClick={() => {
            onStart?.();
            setPhase('steps');
            onStepChange('grounding_see');
          }}
        >
          Begin 5-4-3-2-1
        </TherapyLabPrimaryButton>
        <TherapyLabGhostButton
          onClick={() => {
            onSkip?.();
            onComplete(
              buildExerciseResult({
                exerciseType: 'grounding_54321',
                startedAt,
                status: 'skipped',
                resultSummary: 'Grounding skipped.',
              }),
            );
          }}
        >
          Skip
        </TherapyLabGhostButton>
      </TherapyLabStepCard>
    );
  }

  if (phase === 'steps' && step) {
    return (
      <TherapyLabStepCard title={`${step.count} — ${step.sense}`} stepIndex={stepIndex + 2} stepTotal={STEPS.length + 2}>
        <p className="text-sm leading-relaxed text-slate-700">{step.prompt}</p>
        <textarea
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          rows={2}
          placeholder="Optional jot — not stored verbatim in memory"
          className="w-full rounded-xl border border-rose-100 px-3 py-2 text-sm"
        />
        <div className="flex gap-1">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${completed[i] ? 'bg-rose-400' : i === stepIndex ? 'bg-rose-200' : 'bg-slate-100'}`}
            />
          ))}
        </div>
        <TherapyLabPrimaryButton onClick={markDone}>
          {stepIndex < STEPS.length - 1 ? 'Next step' : 'Finish steps'}
        </TherapyLabPrimaryButton>
      </TherapyLabStepCard>
    );
  }

  return (
    <TherapyLabStepCard title="After grounding" stepIndex={STEPS.length + 2} stepTotal={STEPS.length + 2}>
      <IntensitySlider value={afterIntensity} onChange={setAfterIntensity} label="Intensity now (0–10)" />
      <TherapyLabPrimaryButton
        onClick={() =>
          onComplete(
            buildExerciseResult({
              exerciseType: 'grounding_54321',
              startedAt,
              status: 'completed',
              beforeIntensity,
              afterIntensity,
              resultSummary: `Completed 5-4-3-2-1 grounding. Intensity ${beforeIntensity} → ${afterIntensity}/10.`,
              payload: { stepsCompleted: completed.filter(Boolean).length },
            }),
          )
        }
      >
        Save result
      </TherapyLabPrimaryButton>
    </TherapyLabStepCard>
  );
}
