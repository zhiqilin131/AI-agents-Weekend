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

const MOODS = ['Calm', 'Anxious', 'Sad', 'Frustrated', 'Overwhelmed', 'Numb', 'Hopeful', 'Mixed'];
const GOALS = [
  'Calm down',
  'Untangle thoughts',
  'Relationship issue',
  'Make a small plan',
  'Just be heard',
  'Not sure',
] as const;

type Props = TherapyExerciseCallbacks & {
  onStepChange: (step: string) => void;
  onSafetyTriggered: () => void;
};

export function EmotionCheckInExercise({ onStart, onComplete, onSkip, onStepChange, onSafetyTriggered }: Props) {
  const [step, setStep] = useState<'mood' | 'intensity' | 'goal' | 'note'>('mood');
  const [mood, setMood] = useState('');
  const [intensity, setIntensity] = useState(5);
  const [goal, setGoal] = useState('');
  const [note, setNote] = useState('');
  const startedAt = useState(() => new Date().toISOString())[0];

  const go = (s: typeof step) => {
    setStep(s);
    onStepChange(s);
  };

  const finish = () => {
    if (scanTextFieldsForSafety([note, mood, goal])) {
      onSafetyTriggered();
      return;
    }
    onStart?.();
    const result = buildExerciseResult({
      exerciseType: 'emotion_check_in',
      startedAt,
      status: 'completed',
      beforeIntensity: intensity,
      resultSummary: `Check-in: ${mood || 'unspecified mood'}, goal "${goal || 'not sure'}", intensity ${intensity}/10.`,
      memoryOpts: { mood, goal, intensity },
      payload: { mood, goal, intensity, noteLength: note.trim().length },
      nextActions: [
        {
          id: 'reflect',
          label: 'Optional: share this theme with Rimumu in chat later',
        },
      ],
    });
    onComplete(result);
  };

  if (step === 'mood') {
    return (
      <TherapyLabStepCard title="What emotion is closest?" stepIndex={1} stepTotal={4}>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMood(m);
                go('intensity');
              }}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                mood === m ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-rose-100 bg-white text-slate-700 hover:border-rose-200'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <TherapyLabGhostButton onClick={() => { onSkip?.(); onComplete(buildExerciseResult({ exerciseType: 'emotion_check_in', startedAt, status: 'skipped', resultSummary: 'Check-in skipped.' })); }}>
          Skip
        </TherapyLabGhostButton>
      </TherapyLabStepCard>
    );
  }

  if (step === 'intensity') {
    return (
      <TherapyLabStepCard title="How strong is it?" stepIndex={2} stepTotal={4}>
        <IntensitySlider value={intensity} onChange={setIntensity} />
        <TherapyLabPrimaryButton onClick={() => go('goal')}>Next</TherapyLabPrimaryButton>
      </TherapyLabStepCard>
    );
  }

  if (step === 'goal') {
    return (
      <TherapyLabStepCard title="What would help most?" stepIndex={3} stepTotal={4}>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                setGoal(g);
                go('note');
              }}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                goal === g ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white hover:border-rose-200'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </TherapyLabStepCard>
    );
  }

  return (
    <TherapyLabStepCard title="Anything else? (optional)" stepIndex={4} stepTotal={4}>
      <p className="text-sm text-slate-600">One short line is enough. We avoid storing sensitive raw details.</p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Optional — keep it brief"
        className="w-full rounded-xl border border-rose-100 bg-white/90 px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <TherapyLabPrimaryButton onClick={finish}>Save check-in</TherapyLabPrimaryButton>
        <TherapyLabGhostButton onClick={finish}>Save without note</TherapyLabGhostButton>
      </div>
    </TherapyLabStepCard>
  );
}
