import { useState } from 'react';
import { X } from 'lucide-react';
import type { FollowupToastPayload } from './DecisionFollowupToast';
import { apiFetch } from '../../../utils/apiFetch';

const STATUSES = [
  ['went_well', 'Went well'],
  ['mixed', 'Mixed'],
  ['did_not_work', "Didn't work"],
  ['still_pending', 'Still pending'],
  ['changed_mind', 'Changed my mind'],
] as const;

type Props = {
  payload: FollowupToastPayload;
  /** When null, saves via ``POST /api/decisions/{decisionId}/reflective-outcome`` (e.g. History). */
  followupId: string | null;
  decisionId: string;
  onClose: () => void;
  onSaved: () => void;
};

export function OutcomeReviewCard({ payload, followupId, decisionId, onClose, onSaved }: Props) {
  const [status, setStatus] = useState<(typeof STATUSES)[number][0]>('went_well');
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState('');
  const [satisfaction, setSatisfaction] = useState<number | null>(4);
  const [saveLesson, setSaveLesson] = useState(false);
  const [confirmLesson, setConfirmLesson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (saveLesson && !confirmLesson) {
      setConfirmLesson(true);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = JSON.stringify({
        chosen_option: chosen.trim() || null,
        outcome_status: status,
        outcome_text: text.trim() || null,
        satisfaction,
        save_lesson_to_memory: saveLesson && confirmLesson,
      });
      const path = followupId
        ? `/api/followups/${encodeURIComponent(followupId)}/outcome`
        : `/api/decisions/${encodeURIComponent(decisionId)}/reflective-outcome`;
      const res = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-black/20 p-4 sm:items-center sm:p-8"
      role="dialog"
      aria-labelledby="outcome-review-title"
      data-modal="followup-outcome"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/50 bg-white/75 p-5 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          className="float-right rounded-full p-1 text-slate-500 hover:bg-white/60"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
        <h2 id="outcome-review-title" className="text-lg font-semibold text-slate-900">
          How did it go?
        </h2>
        <p className="mt-1 text-sm text-slate-600">Original decision</p>
        <p className="mt-0.5 text-sm font-medium text-slate-800">{payload.decision_title || payload.decision_prompt}</p>

        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Outcome</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {STATUSES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                status === id
                  ? 'bg-violet-600 text-white'
                  : 'border border-slate-200 bg-white/60 text-slate-800 hover:bg-white'
              }`}
              onClick={() => setStatus(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-xs font-medium text-slate-600" htmlFor="outcome-chosen">
          Chosen option (optional)
        </label>
        <input
          id="outcome-chosen"
          className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm"
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
          placeholder="What did you pick?"
        />

        <label className="mt-3 block text-xs font-medium text-slate-600" htmlFor="outcome-text">
          What happened? (optional)
        </label>
        <textarea
          id="outcome-text"
          className="mt-1 min-h-[72px] w-full resize-y rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <label className="mt-3 block text-xs font-medium text-slate-600" htmlFor="satisfaction">
          Satisfaction (1–5)
        </label>
        <input
          id="satisfaction"
          type="number"
          min={1}
          max={5}
          className="mt-1 w-24 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm"
          value={satisfaction ?? ''}
          onChange={(e) => setSatisfaction(e.target.value ? Number(e.target.value) : null)}
        />

        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-1"
            checked={saveLesson}
            onChange={(e) => {
              setSaveLesson(e.target.checked);
              setConfirmLesson(false);
            }}
          />
          <span>
            Also save a short lesson line to profile memory (extra confirmation step; outcome still updates retrieval
            memory when you save)
          </span>
        </label>

        {confirmLesson ? (
          <p className="mt-2 rounded-lg bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
            This adds an explicit lesson note to structured profile memory. Tap Save again to confirm.
          </p>
        ) : null}

        {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-800 hover:bg-white/80"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? 'Saving…' : saveLesson && !confirmLesson ? 'Continue' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
