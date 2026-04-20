import { useState } from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import type { DecisionReport } from '../model';

type CommitInfo = {
  chosen_option_id: string;
  matches_recommendation: boolean;
  committed_at: string;
};

interface CommitAdoptPanelProps {
  report: DecisionReport;
  decisionId: string;
  commitInfo: CommitInfo | null;
  onCommit: (chosenOptionId: string) => Promise<void>;
  busy?: boolean;
  error?: string | null;
}

export function CommitAdoptPanel({
  report,
  decisionId,
  commitInfo,
  onCommit,
  busy = false,
  error = null,
}: CommitAdoptPanelProps) {
  const recId = report.recommendation.chosenOption?.trim() ?? '';
  const [selectedId, setSelectedId] = useState(() => recId || report.options[0]?.id || '');

  if (commitInfo) {
    const label = report.options.find((o) => o.id === commitInfo.chosen_option_id)?.name || commitInfo.chosen_option_id;
    return (
      <div className="rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50/95 to-white px-5 py-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0 shadow-sm">
            <CheckCircle2 className="w-5 h-5 text-white" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-emerald-800" style={{ fontWeight: 700 }}>
              Option adopted
            </p>
            <p className="text-sm text-gray-900 mt-0.5" style={{ fontWeight: 600 }}>
              {label}
            </p>
            <p className="text-[11px] text-gray-500 mt-1">
              {commitInfo.committed_at.slice(0, 19).replace('T', ' ')} ·{' '}
              {commitInfo.matches_recommendation ? 'Matches system recommendation' : 'Differs from system recommendation'}
            </p>
            <p className="text-[11px] text-emerald-900/80 mt-2 leading-relaxed">
              You can record the outcome later under History; we use it to improve suggestions and review.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-violet-200/80 bg-white/80 px-5 py-4 shadow-sm backdrop-blur-sm">
      <p className="text-[11px] uppercase tracking-wide text-violet-800 mb-2" style={{ fontWeight: 700 }}>
        Adopt a decision
      </p>
      <p className="text-xs text-gray-600 mb-3 leading-relaxed">
        Choose the option you plan to follow (it may differ from the recommendation). You can still log the outcome
        later on the History page.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <select
            id={`adopt-select-${decisionId}`}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={busy || report.options.length === 0}
            className="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 pr-9 text-sm text-gray-900 focus:ring-2 focus:ring-violet-300 focus:border-violet-300 outline-none disabled:opacity-50"
          >
            {report.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.id === recId ? ' · Recommended' : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        </div>
        <button
          type="button"
          disabled={busy || !selectedId}
          onClick={() => void onCommit(selectedId)}
          className="shrink-0 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm disabled:opacity-45 shadow-md hover:shadow-lg transition-shadow"
          style={{ fontWeight: 600 }}
        >
          {busy ? 'Saving…' : 'Adopt this option'}
        </button>
      </div>
      {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
    </div>
  );
}
