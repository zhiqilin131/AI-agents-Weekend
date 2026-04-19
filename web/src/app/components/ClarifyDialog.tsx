"use client";

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';

export interface ClarifyOption {
  value: string;
  label: string;
}

export interface ClarifyQuestion {
  id: string;
  prompt: string;
  options: ClarifyOption[];
}

interface ClarifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note?: string;
  questions: ClarifyQuestion[];
  onConfirm: (answers: Record<string, string>, saveToProfile: boolean) => void;
}

export function ClarifyDialog({
  open,
  onOpenChange,
  note,
  questions,
  onConfirm,
}: ClarifyDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saveToProfile, setSaveToProfile] = useState(true);

  const setAnswer = (qid: string, label: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: label }));
  };

  const canSubmit = questions.every((q) => Boolean(answers[q.id]?.trim()));

  const handleConfirm = () => {
    if (!canSubmit) return;
    onConfirm(answers, saveToProfile);
    setAnswers({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>A quick clarification</DialogTitle>
          <DialogDescription>
            Your message is a bit underspecified for a confident analysis. Pick the closest options below (you can
            change them later in Profile).
            {note ? ` ${note}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-2">
          {questions.map((q) => (
            <div key={q.id} className="space-y-2">
              <Label className="text-sm text-gray-900" style={{ fontWeight: 600 }}>
                {q.prompt}
              </Label>
              <RadioGroup
                value={q.options.find((o) => o.label === answers[q.id])?.value ?? ''}
                onValueChange={(v) => {
                  const opt = q.options.find((o) => o.value === v);
                  setAnswer(q.id, opt?.label ?? v);
                }}
                className="gap-2"
              >
                {q.options.map((o) => (
                  <div key={o.value} className="flex items-center gap-2 rounded-xl border border-gray-200/80 px-3 py-2">
                    <RadioGroupItem value={o.value} id={`${q.id}-${o.value}`} />
                    <Label htmlFor={`${q.id}-${o.value}`} className="cursor-pointer flex-1 text-sm font-normal">
                      {o.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={saveToProfile}
              onChange={(e) => setSaveToProfile(e.target.checked)}
              className="rounded border-gray-300"
            />
            Save these choices to my profile for future decisions
          </label>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canSubmit}>
            Continue analysis
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
