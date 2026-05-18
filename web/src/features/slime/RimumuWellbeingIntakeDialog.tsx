import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../app/components/ui/dialog';
import { cn } from '../../app/components/ui/utils';
import { getSlimeIdentity } from './slimeIdentity';
import { SLIME_CTA_BTN_CLASS, slimeCtaButtonStyle } from './slimeCtaButton';
import { apiFetch } from '../../utils/apiFetch';

const CONCERNS = [
  { id: 'stress', label: 'Stress or overwhelm' },
  { id: 'anxiety', label: 'Anxiety or worry' },
  { id: 'low_mood', label: 'Low mood' },
  { id: 'sleep', label: 'Sleep or rest' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'work', label: 'Work or school' },
  { id: 'other', label: 'Something else' },
] as const;

export type WellbeingMemorySavedPayload = {
  message?: string;
  items?: string[];
  at?: string;
  details?: Array<{ action?: string; id?: string; text?: string; category?: string }>;
};

type Props = {
  open: boolean;
  threadId: string;
  onClose: () => void;
  onComplete: (payload?: WellbeingMemorySavedPayload) => void;
};

/** Single-screen Rimumu check-in — mood, concern chip, optional goal. */
export function RimumuWellbeingIntakeDialog({ open, threadId, onClose, onComplete }: Props) {
  const ident = getSlimeIdentity('wellbeing');
  const [mood, setMood] = useState(5);
  const [concern, setConcern] = useState<string>('stress');
  const [goal, setGoal] = useState('');
  const [supportPref, setSupportPref] = useState<'listen' | 'structured' | 'mixed'>('mixed');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const concernLabel = CONCERNS.find((c) => c.id === concern)?.label ?? 'General wellbeing';

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/shadow-chat/threads/${encodeURIComponent(threadId)}/wellbeing-intake`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mood_score: mood,
            primary_concern: concernLabel,
            session_goal: goal.trim() || 'Feel a bit steadier and clearer',
            optional_note: '',
            support_preference: supportPref,
          }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { memory_saved?: WellbeingMemorySavedPayload };
      onComplete(data.memory_saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save check-in');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        overlayClassName="z-[220] bg-slate-950/65 backdrop-blur-[3px]"
        className={cn(
          'z-[221] max-h-[min(90dvh,720px)] w-[min(calc(100vw-1.25rem),28rem)] max-w-[calc(100%-1.25rem)] overflow-y-auto border-rose-100/80 bg-gradient-to-b from-[#fff8f6] to-white sm:max-w-md',
        )}
        style={{ borderColor: ident.theme.border }}
      >
        <DialogHeader>
          <DialogTitle className="text-rose-950">Quick check-in</DialogTitle>
          <DialogDescription className="text-rose-900/70">
            About 30 seconds — helps {ident.shortName} remember what you are working on (not a diagnosis).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-rose-950">How are you feeling? (0–10)</p>
            <input
              type="range"
              min={0}
              max={10}
              value={mood}
              onChange={(e) => setMood(Number(e.target.value))}
              className="w-full accent-rose-400"
            />
            <p className="text-center text-2xl font-semibold tabular-nums text-rose-800">{mood}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-rose-950">Main focus today</p>
            <div className="flex flex-wrap gap-2">
              {CONCERNS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setConcern(c.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    concern === c.id
                      ? 'border-rose-300 bg-rose-100 text-rose-950'
                      : 'border-rose-100 bg-white/80 text-rose-900/80 hover:border-rose-200'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-rose-950">How would you like support today?</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'listen' as const, label: 'Mostly listen' },
                  { id: 'structured' as const, label: 'Gentle skills' },
                  { id: 'mixed' as const, label: 'Mix of both' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSupportPref(p.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    supportPref === p.id
                      ? 'border-rose-300 bg-rose-100 text-rose-950'
                      : 'border-rose-100 bg-white/80 text-rose-900/80 hover:border-rose-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium text-rose-950">Small win for today (optional)</p>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Sleep before midnight"
              className="w-full rounded-xl border border-rose-100 bg-white/90 px-3 py-2 text-sm"
              maxLength={200}
            />
          </div>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <DialogFooter className="gap-2">
          <button
            type="button"
            className="rounded-full border border-rose-200 px-4 py-2 text-sm text-rose-900"
            onClick={onClose}
            disabled={saving}
          >
            Later
          </button>
          <button
            type="button"
            className={cn('rounded-full px-4 py-2 text-sm', SLIME_CTA_BTN_CLASS)}
            style={slimeCtaButtonStyle(ident.theme)}
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save check-in'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
