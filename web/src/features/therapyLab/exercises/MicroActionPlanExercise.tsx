import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { buildExerciseResult } from '../buildExerciseResult';
import { calendarSafeTitle } from '../calendarSafeTitle';
import { scanTextFieldsForSafety } from '../safetyEscalation';
import type { TherapyExerciseCallbacks, TherapyNextAction } from '../types';
import {
  TherapyLabGhostButton,
  TherapyLabPrimaryButton,
  TherapyLabStepCard,
} from '../components/TherapyLabChrome';

const ENERGY = ['Very low', 'Low', 'Medium', 'Okay'] as const;

type Props = TherapyExerciseCallbacks & {
  onStepChange: (step: string) => void;
  onSafetyTriggered: () => void;
  storageUserKey: string | null;
  storageReady: boolean;
};

export function MicroActionPlanExercise({
  onStart,
  onComplete,
  onSkip,
  onAddToCalendar,
  onStepChange,
  onSafetyTriggered,
  storageUserKey,
  storageReady,
}: Props) {
  const [step, setStep] = useState<'energy' | 'action' | 'duration' | 'done'>('energy');
  const [energy, setEnergy] = useState('');
  const [action, setAction] = useState('');
  const [minutes, setMinutes] = useState<2 | 5 | 10>(5);
  const [calendarMsg, setCalendarMsg] = useState<string | null>(null);
  const startedAt = useState(() => new Date().toISOString())[0];

  const variants = (base: string): Record<2 | 5 | 10, string> => ({
    2: `${base} (2 min version)`,
    5: `${base} (5 min version)`,
    10: `${base} (10 min version)`,
  });

  const finish = (addedCalendar?: boolean) => {
    if (scanTextFieldsForSafety([action, energy])) {
      onSafetyTriggered();
      return;
    }
    onStart?.();
    const safeTitle = calendarSafeTitle(action);
    const nextAction: TherapyNextAction = {
      id: 'micro_action',
      label: safeTitle,
      calendarTitle: safeTitle,
      durationMinutes: minutes,
    };
    onComplete(
      buildExerciseResult({
        exerciseType: 'micro_action_plan',
        startedAt,
        status: 'completed',
        resultSummary: `Micro action (${minutes} min) at ${energy} energy: ${safeTitle}.`,
        nextActions: [nextAction],
        payload: { energy, minutes, addedCalendar },
      }),
    );
  };

  if (step === 'energy') {
    return (
      <TherapyLabStepCard title="Current energy" stepIndex={1} stepTotal={3}>
        <div className="flex flex-wrap gap-2">
          {ENERGY.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setEnergy(e);
                setStep('action');
                onStepChange('pick_action');
              }}
              className="rounded-full border border-rose-100 bg-white px-3 py-1.5 text-sm hover:border-rose-300"
            >
              {e}
            </button>
          ))}
        </div>
        <TherapyLabGhostButton
          onClick={() => {
            onSkip?.();
            onComplete(
              buildExerciseResult({
                exerciseType: 'micro_action_plan',
                startedAt,
                status: 'skipped',
                resultSummary: 'Micro action plan skipped.',
              }),
            );
          }}
        >
          Skip
        </TherapyLabGhostButton>
      </TherapyLabStepCard>
    );
  }

  if (step === 'action') {
    const v = action.trim() ? variants(action.trim()) : null;
    return (
      <TherapyLabStepCard title="One tiny action" stepIndex={2} stepTotal={3}>
        <p className="text-sm text-slate-600">Something small enough for your energy — not a full life overhaul.</p>
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="e.g. Drink water, text a friend, tidy one surface"
          className="w-full rounded-xl border border-rose-100 px-3 py-2 text-sm"
        />
        {v ? (
          <ul className="space-y-1 text-xs text-slate-600">
            <li>2 min: {calendarSafeTitle(v[2])}</li>
            <li>5 min: {calendarSafeTitle(v[5])}</li>
            <li>10 min: {calendarSafeTitle(v[10])}</li>
          </ul>
        ) : null}
        <TherapyLabPrimaryButton
          disabled={!action.trim()}
          onClick={() => {
            setStep('duration');
            onStepChange('pick_duration');
          }}
        >
          Next
        </TherapyLabPrimaryButton>
      </TherapyLabStepCard>
    );
  }

  if (step === 'duration') {
    return (
      <TherapyLabStepCard title="How long feels doable?" stepIndex={3} stepTotal={3}>
        <div className="flex gap-2">
          {([2, 5, 10] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMinutes(m)}
              className={`flex-1 rounded-xl border py-3 text-sm font-semibold ${
                minutes === m ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-slate-200 bg-white'
              }`}
            >
              {m} min
            </button>
          ))}
        </div>
        <TherapyLabPrimaryButton onClick={() => { setStep('done'); onStepChange('confirm'); }}>Continue</TherapyLabPrimaryButton>
      </TherapyLabStepCard>
    );
  }

  const safeTitle = calendarSafeTitle(action);
  const nextAction: TherapyNextAction = {
    id: 'micro_action',
    label: safeTitle,
    calendarTitle: safeTitle,
    durationMinutes: minutes,
  };

  return (
    <TherapyLabStepCard title="Ready to save">
      <p className="text-sm font-medium text-slate-800">{safeTitle}</p>
      <p className="text-sm text-slate-600">{minutes} minutes · {energy} energy</p>
      {calendarMsg ? <p className="text-xs text-emerald-800">{calendarMsg}</p> : null}
      <div className="flex flex-wrap gap-2">
        <TherapyLabPrimaryButton onClick={() => finish(false)}>Save plan</TherapyLabPrimaryButton>
        {storageReady && storageUserKey ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-900"
            onClick={async () => {
              await onAddToCalendar?.(nextAction);
              setCalendarMsg('Added to Execution Calendar (or saved locally).');
              finish(true);
            }}
          >
            <CalendarPlus className="h-4 w-4" aria-hidden />
            Add to Execution Calendar
          </button>
        ) : (
          <p className="text-xs text-slate-500">Sign in to add to Execution Calendar.</p>
        )}
      </div>
    </TherapyLabStepCard>
  );
}
