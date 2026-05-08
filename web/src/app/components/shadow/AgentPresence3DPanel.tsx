import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Agent3DCompanion } from './Agent3DCompanion';
import type { AgentStatus, ShadowSuggestion } from './types';

const statusLabel: Record<AgentStatus, string> = {
  idle: 'Idle',
  reading_memory: 'Reading memory',
  thinking: 'Thinking',
  responding: 'Responding',
  updating_profile: 'Updating profile',
  decision_detected: 'Decision detected',
  report_generating: 'Building report',
  report_complete: 'Report ready',
  report_open: 'Report open',
  scheduling: 'Scheduling',
  error: 'Needs attention',
};

const statusHint: Record<AgentStatus, string> = {
  idle: 'Standing by for your next request.',
  reading_memory: "I'm reading relevant memory before responding.",
  thinking: "I'm weighing options and trade-offs.",
  responding: "I'm composing the response now.",
  updating_profile: "I'm updating long-term profile signals.",
  decision_detected: "I've detected a decision moment in your thread.",
  report_generating: "I'm assembling the decision report trace.",
  report_complete: 'The report is complete and ready to inspect.',
  report_open: 'The report panel is open for review.',
  scheduling: "I'm aligning available time blocks for execution.",
  error: 'A recoverable issue happened. Retry when ready.',
};

type ActivityStep = { label: string; state: 'done' | 'active' | 'pending' };

export function buildActivitySteps(status: AgentStatus): ActivityStep[] {
  if (status === 'scheduling') {
    return [
      { label: 'Message received', state: 'done' },
      { label: 'Reading memory', state: 'done' },
      { label: 'Thinking', state: 'done' },
      { label: 'Scheduling', state: 'active' },
    ];
  }

  const rank: Record<AgentStatus, number> = {
    idle: 0,
    reading_memory: 1,
    thinking: 2,
    responding: 3,
    updating_profile: 4,
    decision_detected: 5,
    report_generating: 6,
    report_complete: 7,
    report_open: 7,
    scheduling: 4,
    error: 0,
  };
  const current = rank[status];
  const labels = ['Message received', 'Reading memory', 'Thinking', 'Responding'];
  return labels.map((label, idx) => {
    const stepRank = idx;
    if (status === 'error') return { label, state: idx === 0 ? 'active' : 'pending' };
    if (current > stepRank) return { label, state: 'done' };
    if (current === stepRank) return { label, state: 'active' };
    return { label, state: 'pending' };
  });
}

export function AgentPresence3DPanel({
  status,
  timeline,
  suggestion,
  onGenerateReport,
  forceFallback = false,
}: {
  status: AgentStatus;
  timeline: string[];
  suggestion?: ShadowSuggestion | null;
  onGenerateReport?: () => void;
  forceFallback?: boolean;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const steps = useMemo(() => buildActivitySteps(status), [status]);
  const recent = timeline.slice(-3);

  return (
    <aside className="rounded-3xl border border-white/90 bg-white/65 p-4 shadow-[0_10px_28px_rgba(99,102,241,0.10)] backdrop-blur-md">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Shadow Chat</p>
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500/90 shadow-[0_0_12px_rgba(99,102,241,0.9)]" />
      </div>

      <div className="mt-3">
        <Agent3DCompanion mode={status} onToggleTooltip={() => setTooltipOpen((s) => !s)} forceFallback={forceFallback} />
      </div>

      <div className="mt-3 rounded-xl border border-indigo-100/80 bg-indigo-50/50 px-3 py-2">
        <p className="text-xs text-indigo-700">Current</p>
        <p className="text-sm font-medium text-indigo-950">{statusLabel[status]}</p>
      </div>

      {tooltipOpen ? (
        <div className="mt-2 rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2 text-xs text-violet-900">
          {statusHint[status]}
        </div>
      ) : null}

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Activity</p>
        <div className="mt-2 space-y-1.5">
          {steps.map((step) => (
            <div key={step.label} className="flex items-center gap-2 text-xs text-gray-700">
              <span>
                {step.state === 'done' ? '✓' : step.state === 'active' ? '●' : '○'}
              </span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      </div>

      {status === 'decision_detected' && suggestion?.type === 'decision_report' ? (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/70 p-3">
          <div className="flex items-center gap-2 text-amber-900">
            <Sparkles size={14} />
            <p className="text-xs font-semibold uppercase tracking-wide">Decision detected</p>
          </div>
          <p className="mt-1 text-xs text-amber-900/90">{suggestion.message || 'A high-value decision moment was detected.'}</p>
          <button
            type="button"
            className="mt-2 w-full rounded-lg bg-amber-500/90 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500"
            onClick={onGenerateReport}
          >
            Generate report
          </button>
        </div>
      ) : null}

      <div className="mt-4 space-y-1.5">
        {recent.map((entry, i) => (
          <div key={`${entry}-${i}`} className="rounded-lg border border-indigo-100/80 bg-white/60 px-2 py-1.5 text-[11px] text-indigo-900/90">
            {entry}
          </div>
        ))}
      </div>
    </aside>
  );
}
