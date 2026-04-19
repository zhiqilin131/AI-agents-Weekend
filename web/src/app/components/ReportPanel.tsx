import { AppState, DecisionReport } from '../model';
import { LoadingState } from './LoadingState';
import { EmptyState } from './EmptyState';
import { ReportCompact } from './ReportCompact';

interface ReportPanelProps {
  state: AppState;
  report: DecisionReport | null;
  fullTrace: Record<string, unknown> | null;
  tier3Profile?: {
    profile?: {
      user_id?: string;
      values?: string[];
      risk_posture?: string;
      recurring_themes?: string[];
      current_goals?: string[];
      known_constraints?: string[];
      n_decisions_summarized?: number;
      last_updated?: string;
      confidence?: number;
    };
    used_in_recommender?: boolean;
    use_threshold?: number;
    source?: string;
  } | null;
  showJson: boolean;
  onToggleJson: () => void;
  onShowOutcome: () => void;
  canRecordOutcome: boolean;
  runProgress?: number;
  runStageLabel?: string;
  /** True while SSE is still streaming after first partial payload. */
  isStreaming?: boolean;
}

export function ReportPanel({
  state,
  report,
  fullTrace,
  tier3Profile,
  showJson,
  onToggleJson,
  onShowOutcome,
  canRecordOutcome,
  runProgress = 0,
  runStageLabel = 'Working…',
  isStreaming = false,
}: ReportPanelProps) {
  if (state === 'empty') {
    return (
      <div className="space-y-4">
        {tier3Profile?.profile && (
          <div className="rounded-xl border border-violet-200/80 bg-violet-50/70 px-4 py-3">
            <p className="text-xs text-violet-900" style={{ fontWeight: 700 }}>
              Tier 3 profile ready
            </p>
            <p className="text-[11px] text-violet-800 mt-1">
              Confidence {(tier3Profile.profile.confidence ?? 0).toFixed(2)} (threshold{' '}
              {(tier3Profile.use_threshold ?? 0.3).toFixed(2)}), risk posture:{' '}
              {tier3Profile.profile.risk_posture ?? 'unknown'}.
            </p>
          </div>
        )}
        <EmptyState />
      </div>
    );
  }

  if (state === 'loading' && !report) {
    return <LoadingState progress={runProgress} stageLabel={runStageLabel} />;
  }

  if (state === 'loading' && report) {
    return (
      <div className="space-y-4">
        <LoadingState compact progress={runProgress} stageLabel={runStageLabel} />
        <ReportCompact report={report} fullTrace={fullTrace} tier3Profile={tier3Profile} isStreaming />
      </div>
    );
  }

  if (state === 'result' && report) {
    return (
      <div className="space-y-5">
        <h3 className="text-lg text-gray-800 tracking-tight" style={{ fontWeight: 600 }}>
          Decision output
        </h3>
        <ReportCompact
          key={typeof fullTrace?.decision_id === 'string' ? fullTrace.decision_id : 'report'}
          report={report}
          fullTrace={fullTrace}
          tier3Profile={tier3Profile}
          isStreaming={false}
        />

        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            onClick={onShowOutcome}
            disabled={!canRecordOutcome}
            className="px-7 py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-full hover:shadow-2xl hover:shadow-purple-500/30 transition-all text-base disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontWeight: 600 }}
          >
            Record Outcome
          </button>
          <button
            type="button"
            onClick={onToggleJson}
            className="px-7 py-4 bg-white/50 backdrop-blur-2xl text-gray-700 border border-white/80 rounded-full hover:bg-white/70 hover:shadow-lg transition-all text-base"
            style={{ fontWeight: 500 }}
          >
            {showJson ? 'Hide' : 'Show'} JSON
          </button>
        </div>

        {showJson && fullTrace && (
          <div className="p-7 bg-white/50 backdrop-blur-2xl border border-white/80 rounded-[28px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] max-h-[420px] overflow-y-auto">
            <p className="text-xs text-gray-500 mb-2" style={{ fontWeight: 600 }}>
              Trace JSON (DecisionTrace)
            </p>
            <pre className="text-xs text-gray-900 overflow-x-auto whitespace-pre-wrap" style={{ fontWeight: 400 }}>
              {JSON.stringify(fullTrace, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return null;
}
