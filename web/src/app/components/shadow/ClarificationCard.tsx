"use client";

import { useState } from 'react';
import type { ClarifyQuestion } from '../ClarifyDialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';

export type ClarificationGateMeta = {
  domain?: string;
  target_dimension?: string;
  why_this_question?: string;
  user_intent?: string;
};

type Props = {
  questions: ClarifyQuestion[];
  meta?: ClarificationGateMeta | null;
  disabled?: boolean;
  onSkip: () => void;
  onAnswer: (answers: Record<string, string>, saveToProfile: boolean) => void;
};

export function ClarificationCard({ questions, meta, disabled, onSkip, onAnswer }: Props) {
  const [showWhy, setShowWhy] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [saveToProfile, setSaveToProfile] = useState(true);

  const q0 = questions[0];
  const dim = (meta?.target_dimension || questions.map((q) => q.id).join(",") || "").trim();
  const why =
    (meta?.why_this_question || "").trim() ||
    (dim
      ? `This helps me understand ${dim.replace(/_/g, " ")}, which is currently uncertain and relevant to your question.`
      : "This reduces guesswork so the next response matches what you actually care about.");

  const canSubmit = questions.every((q) => Boolean(picked[q.id]?.trim()));

  return (
    <div className="rounded-2xl border border-violet-200/90 bg-gradient-to-br from-white/95 via-violet-50/50 to-indigo-50/40 px-4 py-3 shadow-[0_8px_28px_rgba(99,102,241,0.12)]">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-900">One thing I need to understand</p>
      {questions.length === 1 && q0 ? (
        <p className="mt-1.5 text-sm font-medium leading-snug text-slate-900">{q0.prompt}</p>
      ) : questions.length > 1 ? (
        <p className="mt-1.5 text-sm font-medium leading-snug text-slate-900">Two quick choices will sharpen the next step:</p>
      ) : null}

      {showWhy ? (
        <p className="mt-2 rounded-lg border border-violet-100 bg-white/80 px-3 py-2 text-xs leading-relaxed text-slate-700">
          {why}
        </p>
      ) : null}

      {answering && q0 ? (
        <div className="mt-3 space-y-4">
          {questions.map((q) => (
            <div key={q.id} className="space-y-2">
              <p className="text-xs font-medium text-slate-800">{q.prompt}</p>
              <RadioGroup
                value={q.options.find((o) => o.label === picked[q.id])?.value ?? ''}
                onValueChange={(v) => {
                  const opt = q.options.find((o) => o.value === v);
                  setPicked((prev) => ({ ...prev, [q.id]: opt?.label ?? v }));
                }}
                className="gap-2"
              >
                {q.options.map((o) => (
                  <div
                    key={o.value}
                    className="flex items-center gap-2 rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2"
                  >
                    <RadioGroupItem value={o.value} id={`clarify-${q.id}-${o.value}`} />
                    <Label
                      htmlFor={`clarify-${q.id}-${o.value}`}
                      className="cursor-pointer flex-1 text-sm font-normal text-slate-800"
                    >
                      {o.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          ))}
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={saveToProfile}
              onChange={(e) => setSaveToProfile(e.target.checked)}
              className="rounded border-gray-300"
            />
            Remember for future sessions (durable preferences only)
          </label>
          <div className="flex flex-wrap gap-2">
            <BuddyTooltip content="Send your choices and continue — optional durable preferences if the box is checked.">
              <Button
                type="button"
                size="sm"
                disabled={!canSubmit || disabled}
                onClick={() => {
                  if (!canSubmit) return;
                  onAnswer(picked, saveToProfile);
                  setAnswering(false);
                  setPicked({});
                }}
              >
                Submit answer
              </Button>
            </BuddyTooltip>
            <BuddyTooltip content="Return to the short clarification card without submitting.">
              <Button type="button" size="sm" variant="outline" onClick={() => setAnswering(false)}>
                Back
              </Button>
            </BuddyTooltip>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <BuddyTooltip content="Skip clarification; the assistant will continue with best-effort assumptions.">
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void onSkip()}>
              Skip
            </Button>
          </BuddyTooltip>
          <BuddyTooltip content="Show why this clarification improves the next response.">
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setShowWhy((s) => !s)}>
              Why ask this?
            </Button>
          </BuddyTooltip>
          <BuddyTooltip content="Pick answers from multiple-choice options before continuing.">
            <Button type="button" size="sm" disabled={disabled} onClick={() => setAnswering(true)}>
              Answer
            </Button>
          </BuddyTooltip>
        </div>
      )}
    </div>
  );
}
