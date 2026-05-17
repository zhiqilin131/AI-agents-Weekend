import { useCallback, useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { Link } from 'react-router';
import { MainNavButtons } from '../app/components/MainNavButtons';
import { OutcomeReviewCard } from '../app/components/followup/OutcomeReviewCard';
import type { FollowupToastPayload } from '../app/components/followup/DecisionFollowupToast';
import { SavedOutcomeModal } from '../app/components/SavedOutcomeModal';
import { BuddyTooltip } from '../features/slime/BuddyTooltip';
import { apiFetch } from '../utils/apiFetch';

interface TraceRow {
  decision_id: string;
  timestamp: string;
  decision_type: string;
  preview: string;
  has_outcome?: boolean;
  has_commit?: boolean;
  followup_status?: string;
  followup_next_checkin?: string | null;
  followup_outcome_label?: string;
}

function formatCheckin(iso: string | null | undefined): string {
  if (!iso || !String(iso).trim()) return '';
  const d = Date.parse(String(iso));
  if (Number.isNaN(d)) return String(iso).slice(0, 16);
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HistoryPage() {
  const [rows, setRows] = useState<TraceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reflectiveFor, setReflectiveFor] = useState<{
    decisionId: string;
    payload: FollowupToastPayload;
  } | null>(null);
  const [savedOutcomeForId, setSavedOutcomeForId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch('/api/traces');
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as TraceRow[];
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onDelete = async (id: string) => {
    if (!window.confirm(`Delete trace ${id}? Linked outcome file (if any) will be removed too.`)) {
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const res = await apiFetch(`/api/traces/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto w-full max-w-[1500px]">
        <MainNavButtons layout="topbar" className="!mb-6" />
      </div>
      <div className="mx-auto mt-1 w-full max-w-3xl">
        <div className="mb-8 flex items-center gap-2">
          <h1 className="text-3xl text-gray-900" style={{ fontWeight: 700 }}>
            Decision history
          </h1>
          <BuddyTooltip content="Every structured decision you run in Shadow Chat or the studio leaves a trace here. Badges show adoption, whether an outcome was saved, and follow-up scheduling. Open a row for the full timeline; use the buttons to review outcomes, record what happened, or delete after confirmation.">
            <button
              type="button"
              className="rounded-full p-1.5 text-violet-700/80 transition hover:bg-violet-100/90 hover:text-violet-900"
              aria-label="What is decision history?"
            >
              <Info className="h-5 w-5" aria-hidden />
            </button>
          </BuddyTooltip>
        </div>

        {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">{error}</div>}

        <ul className="space-y-3">
          {rows.length === 0 && !error && (
            <li className="text-gray-500 text-sm">
              <BuddyTooltip content="Run a structured decision in Shadow Chat (or save a trace from the studio) and it will appear in this list.">
                <span className="inline-block cursor-default border-b border-dotted border-gray-400/60">
                  No saved traces yet.
                </span>
              </BuddyTooltip>
            </li>
          )}
          {rows.map((r) => (
            <li
              key={r.decision_id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-white/60 border border-white/80 shadow-sm"
            >
              <BuddyTooltip content="Open the full trace viewer: timeline, artifacts, and metadata for this decision id.">
                <Link to={`/trace/${encodeURIComponent(r.decision_id)}`} className="min-w-0 flex-1 text-left group">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-gray-400">{r.decision_id}</span>
                    {r.has_commit ? (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-900 border border-violet-200/80"
                        style={{ fontWeight: 600 }}
                      >
                        Adopted
                      </span>
                    ) : null}
                    {r.has_outcome ? (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-200/80"
                        style={{ fontWeight: 600 }}
                      >
                        Outcome saved
                      </span>
                    ) : (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200/70"
                        style={{ fontWeight: 600 }}
                      >
                        Outcome pending
                      </span>
                    )}
                    {r.followup_status === 'dismissed' ? (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200/80"
                        style={{ fontWeight: 600 }}
                      >
                        Follow-up dismissed
                      </span>
                    ) : null}
                    {r.followup_status && ['scheduled', 'snoozed', 'due'].includes(r.followup_status) ? (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-900 border border-sky-200/80"
                        style={{ fontWeight: 600 }}
                      >
                        Check-in scheduled
                      </span>
                    ) : null}
                    {r.followup_outcome_label ? (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-50 text-fuchsia-900 border border-fuchsia-200/70"
                        style={{ fontWeight: 600 }}
                      >
                        {r.followup_outcome_label}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-gray-800 group-hover:text-purple-800 transition-colors">
                    {r.preview || '(empty)'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {r.timestamp} · {r.decision_type}
                  </div>
                  {r.followup_next_checkin && ['scheduled', 'snoozed', 'due'].includes(r.followup_status || '') ? (
                    <div className="text-[11px] text-violet-700/90 mt-1">
                      Next check-in: {formatCheckin(r.followup_next_checkin)}
                    </div>
                  ) : null}
                </Link>
              </BuddyTooltip>
              <div className="flex flex-wrap gap-2 shrink-0">
                <BuddyTooltip content="Open the saved outcome bundle (if any) for this decision in a modal viewer.">
                  <button
                    type="button"
                    onClick={() => setSavedOutcomeForId(r.decision_id)}
                    className="px-4 py-2 text-sm rounded-full border border-indigo-200 text-indigo-900 hover:bg-indigo-50"
                  >
                    Saved outcome
                  </button>
                </BuddyTooltip>
                <BuddyTooltip content="Run a short reflective check-in to record what happened; updates flags on this list when saved.">
                  <button
                    type="button"
                    onClick={() =>
                      setReflectiveFor({
                        decisionId: r.decision_id,
                        payload: {
                          id: '',
                          decision_id: r.decision_id,
                          decision_title: r.preview || r.decision_id,
                          decision_prompt: (r.preview || '').slice(0, 280),
                          title: 'Decision check-in',
                          body: 'Want to close the loop on this decision?',
                        },
                      })
                    }
                    className="px-4 py-2 text-sm rounded-full border border-purple-200 text-purple-900 hover:bg-purple-50"
                  >
                    Record outcome
                  </button>
                </BuddyTooltip>
                <BuddyTooltip content="Remove this trace from the server after confirmation; linked outcome files are deleted too.">
                  <span className="inline-flex rounded-full">
                    <button
                      type="button"
                      onClick={() => void onDelete(r.decision_id)}
                      disabled={busy === r.decision_id}
                      className="px-4 py-2 text-sm rounded-full border border-red-200 text-red-800 hover:bg-red-50 disabled:opacity-50"
                    >
                      {busy === r.decision_id ? 'Deleting…' : 'Delete'}
                    </button>
                  </span>
                </BuddyTooltip>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {reflectiveFor ? (
        <OutcomeReviewCard
          payload={reflectiveFor.payload}
          followupId={null}
          decisionId={reflectiveFor.decisionId}
          onClose={() => setReflectiveFor(null)}
          onSaved={() => {
            setReflectiveFor(null);
            void load();
          }}
        />
      ) : null}

      {savedOutcomeForId && (
        <SavedOutcomeModal decisionId={savedOutcomeForId} onClose={() => setSavedOutcomeForId(null)} />
      )}
    </div>
  );
}
