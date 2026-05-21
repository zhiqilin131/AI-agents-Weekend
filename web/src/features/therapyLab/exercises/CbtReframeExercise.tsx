import { useState } from 'react';
import { buildExerciseResult } from '../buildExerciseResult';
import { scanTextFieldsForSafety } from '../safetyEscalation';
import type { TherapyExerciseCallbacks } from '../types';
import {
  TherapyLabGhostButton,
  TherapyLabPrimaryButton,
  TherapyLabStepCard,
  therapyLabTheme,
} from '../components/TherapyLabChrome';

const STEPS = [
  { key: 'situation', title: 'What happened?', hint: 'Brief situation — facts, not labels.' },
  { key: 'thought', title: 'Automatic thought', hint: 'What popped into your mind?' },
  { key: 'emotion', title: 'Emotion', hint: 'Name the feeling in plain words.' },
  { key: 'evidence_for', title: 'Evidence for', hint: 'What supports the thought? Stay tentative.' },
  { key: 'evidence_against', title: 'Evidence against', hint: 'What might you be overlooking?' },
  { key: 'balanced', title: 'Balanced thought', hint: 'A kinder, more complete sentence — not forced positivity.' },
  { key: 'next', title: 'One small next step', hint: 'Something tiny you could try if you choose.' },
] as const;

type Props = TherapyExerciseCallbacks & {
  onStepChange: (step: string) => void;
  onSafetyTriggered: () => void;
};

export function CbtReframeExercise({ onStart, onComplete, onSkip, onStepChange, onSafetyTriggered }: Props) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [showCard, setShowCard] = useState(false);
  const startedAt = useState(() => new Date().toISOString())[0];

  const step = STEPS[index];

  const saveAndNext = () => {
    if (scanTextFieldsForSafety([draft, ...Object.values(answers)])) {
      onSafetyTriggered();
      return;
    }
    const next = { ...answers, [step.key]: draft.trim() };
    setAnswers(next);
    setDraft('');
    if (index < STEPS.length - 1) {
      const ni = index + 1;
      setIndex(ni);
      onStepChange(STEPS[ni]!.key);
    } else {
      onStart?.();
      setShowCard(true);
      onStepChange('reflection_card');
    }
  };

  if (showCard) {
    return (
      <TherapyLabStepCard title="Reflection card">
        <p className="text-xs text-slate-500">Supportive reflection only — not a diagnosis or treatment plan.</p>
        <div
          className="space-y-3 rounded-xl border p-4 text-sm leading-relaxed"
          style={{ borderColor: `${therapyLabTheme.border}88`, background: therapyLabTheme.highlight }}
        >
          <p>
            <span className="font-semibold" style={{ color: therapyLabTheme.heading }}>
              Situation:{' '}
            </span>
            {answers.situation || '—'}
          </p>
          <p>
            <span className="font-semibold">Balanced thought: </span>
            {answers.balanced || '—'}
          </p>
          <p>
            <span className="font-semibold">Possible next step: </span>
            {answers.next || '—'}
          </p>
        </div>
        <TherapyLabPrimaryButton
          onClick={() =>
            onComplete(
              buildExerciseResult({
                exerciseType: 'cbt_thought_reframe',
                startedAt,
                status: 'completed',
                resultSummary: 'Completed a gentle thought reframe (CBT-informed, non-clinical).',
                payload: { hasBalancedThought: Boolean(answers.balanced?.trim()) },
              }),
            )
          }
        >
          Save reflection
        </TherapyLabPrimaryButton>
      </TherapyLabStepCard>
    );
  }

  if (!step) return null;

  return (
    <TherapyLabStepCard title={step.title} stepIndex={index + 1} stepTotal={STEPS.length}>
      <p className="text-sm text-slate-600">{step.hint}</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        className="w-full rounded-xl border border-rose-100 px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <TherapyLabPrimaryButton onClick={saveAndNext} disabled={!draft.trim()}>
          {index < STEPS.length - 1 ? 'Next' : 'See reflection'}
        </TherapyLabPrimaryButton>
        <TherapyLabGhostButton
          onClick={() => {
            onSkip?.();
            onComplete(
              buildExerciseResult({
                exerciseType: 'cbt_thought_reframe',
                startedAt,
                status: 'skipped',
                resultSummary: 'Thought reframe skipped.',
              }),
            );
          }}
        >
          Skip
        </TherapyLabGhostButton>
      </div>
    </TherapyLabStepCard>
  );
}
