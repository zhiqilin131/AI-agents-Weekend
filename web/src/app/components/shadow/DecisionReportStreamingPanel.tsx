import { useState } from 'react';
import { useResilienceHealth } from '../../../hooks/useResilienceHealth';
import { mapTraceToReport } from '../../../utils/mapTrace';
import { journeyStateFromProgress } from '../../../utils/reportAgentJourney';
import {
  canRetryDegradation,
  RESILIENCE_STAGE_LABEL,
  type ResilienceDegradationNotice,
} from '../../../utils/resilienceUi';
import { ReportCompact } from '../ReportCompact';
import { ReportAgentJourney } from './ReportAgentJourney';

export function DecisionReportStreamingPanel({
  open,
  trace,
  progressStep,
  isStreaming,
  error,
  degradedWarnings = [],
  onRetryStage,
  onClose,
  onContinueChat,
  onOpenExecutionCalendar,
  onReviseReport,
  shadowThreadId = null,
}: {
  open: boolean;
  trace: Record<string, unknown> | null;
  progressStep: string;
  isStreaming: boolean;
  error: string | null;
  degradedWarnings?: ResilienceDegradationNotice[];
  onRetryStage?: (stage?: string) => void;
  onClose: () => void;
  onContinueChat: () => void;
  onOpenExecutionCalendar: (decisionId: string) => void;
  onReviseReport: (decisionId: string) => void;
  shadowThreadId?: string | null;
}) {
  const resilience = useResilienceHealth();
  const [dismissedWarnings, setDismissedWarnings] = useState<string[]>([]);
  if (!open) return null;
  const report = trace ? mapTraceToReport(trace) : null;
  const decisionId = typeof trace?.decision_id === 'string' ? trace.decision_id : '';
  const panelStatus: 'running' | 'complete' | 'error' = error ? 'error' : !isStreaming && trace && !error ? 'complete' : 'running';
  const { currentStep, completedSteps } = journeyStateFromProgress(progressStep, panelStatus);
  const doneJourney = journeyStateFromProgress('', 'complete');

  return (
    <div className="fixed inset-0 z-[200] bg-black/30 p-4">
      <div className="mx-auto mt-3 flex max-h-[93vh] w-[min(1240px,96vw)] flex-col overflow-hidden rounded-2xl border border-white/80 bg-white shadow-xl">
        <div className="shrink-0 border-b border-gray-100/90 bg-white/95 px-4 py-3 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900">
              {isStreaming ? 'Generating Decision Report' : 'Decision Report'}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-50"
                onClick={onContinueChat}
              >
                Continue chatting
              </button>
              {decisionId ? (
                <>
                  <button
                    type="button"
                    className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-900 hover:bg-violet-100"
                    onClick={() => onReviseReport(decisionId)}
                  >
                    Revise report
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-indigo-200 bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                    onClick={() => onOpenExecutionCalendar(decisionId)}
                  >
                    Execution calendar
                  </button>
                </>
              ) : null}
              <button type="button" className="rounded-full border border-gray-300 px-3 py-1.5 text-xs" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {degradedWarnings.filter((w) => !dismissedWarnings.includes(w.id)).length > 0 ? (
            <div className="mb-3 space-y-2">
              {degradedWarnings
                .filter((w) => !dismissedWarnings.includes(w.id))
                .map((w) => {
                  const retryable = canRetryDegradation(w, resilience.health);
                  return (
                    <div
                      key={w.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
                    >
                      <div>
                        <p className="font-semibold">
                          {RESILIENCE_STAGE_LABEL[w.stage] || w.stage || 'Runtime'} running in safe mode
                        </p>
                        <p className="mt-0.5">{w.message}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {retryable && onRetryStage ? (
                          <button
                            type="button"
                            className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                            onClick={() => onRetryStage(w.stage)}
                          >
                            Retry this step
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="rounded-full px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                          onClick={() =>
                            setDismissedWarnings((prev) => (prev.includes(w.id) ? prev : [...prev, w.id]))
                          }
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : null}
          {error ? (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <p>{error}</p>
              {onRetryStage ? (
                <button
                  type="button"
                  className="mt-2 rounded-full border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100"
                  onClick={() => onRetryStage?.()}
                >
                  Retry this stage
                </button>
              ) : null}
            </div>
          ) : null}

          {!error && report && !isStreaming ? (
            <div className="mb-4">
              <ReportAgentJourney
                currentStep={doneJourney.currentStep}
                completedSteps={doneJourney.completedSteps}
                status="complete"
              />
            </div>
          ) : null}
          {(isStreaming || !report) && !error ? (
            <div className="mb-4">
              <ReportAgentJourney currentStep={currentStep} completedSteps={completedSteps} status={panelStatus} />
            </div>
          ) : null}

          {isStreaming && !report ? (
            <p className="mb-3 text-sm text-gray-600">
              Sections appear below as they stream in — same layout as the main decision view.
            </p>
          ) : null}

          {report && trace ? (
            <div className="mt-1">
              <ReportCompact
                report={report}
                fullTrace={trace}
                isStreaming={isStreaming}
                onExecutionCalendarNavigate={onOpenExecutionCalendar}
                shadowThreadId={shadowThreadId}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
