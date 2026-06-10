import { DegradedModeBanner } from '../DegradedModeBanner';
import { mapTraceToReport } from '../../../utils/mapTrace';
import { journeyStateFromProgress } from '../../../utils/reportAgentJourney';
import { ReportCompact } from '../ReportCompact';
import { ReportAgentJourney } from './ReportAgentJourney';
import { ScoringClarifyPanel } from '../report/ScoringClarifyPanel';
import type { ScoringClarifyPending } from '../../../utils/scoringClarifyGate';
import type { ElicitationSubmitPayload } from '../../../utils/featureAudit';

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
  scoringClarifyPending = null,
  gatePrefill,
  onScoringClarifyApply,
  onScoringClarifySkip,
  onTraceRescored,
}: {
  open: boolean;
  trace: Record<string, unknown> | null;
  progressStep: string;
  isStreaming: boolean;
  error: string | null;
  degradedWarnings?: string[];
  onRetryStage?: () => void;
  onClose: () => void;
  onContinueChat: () => void;
  onOpenExecutionCalendar: (decisionId: string) => void;
  onReviseReport: (decisionId: string) => void;
  shadowThreadId?: string | null;
  scoringClarifyPending?: ScoringClarifyPending | null;
  gatePrefill?: { levelAnswers: Record<string, string>; rankAnswers: Record<string, string[]> };
  onScoringClarifyApply?: (payload: ElicitationSubmitPayload) => void;
  onScoringClarifySkip?: () => void;
  onTraceRescored?: (trace: Record<string, unknown>) => void;
}) {
  if (!open) return null;
  const report = trace ? mapTraceToReport(trace) : null;
  const decisionId = typeof trace?.decision_id === 'string' ? trace.decision_id : '';
  const atGate = Boolean(scoringClarifyPending);
  const panelStatus: 'running' | 'complete' | 'error' = error
    ? 'error'
    : atGate
      ? 'running'
      : !isStreaming && trace && !error
        ? 'complete'
        : 'running';
  const { currentStep, completedSteps } = journeyStateFromProgress(progressStep, panelStatus);
  const doneJourney = journeyStateFromProgress('', 'complete');

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden bg-black/30 p-4">
      <div className="mx-auto mt-3 flex max-h-[93vh] w-[min(1240px,96vw)] flex-col overflow-hidden rounded-2xl border border-white/80 bg-white shadow-xl [isolation:isolate]">
        <div className="shrink-0 border-b border-gray-100/90 bg-white px-4 py-3">
          {degradedWarnings.length > 0 ? (
            <DegradedModeBanner messages={degradedWarnings} className="mb-3" />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900">
              {atGate
                ? 'Ground tradeoffs before recommending'
                : isStreaming
                  ? 'Generating Decision Report'
                  : 'Decision Report'}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-50"
                onClick={onContinueChat}
              >
                Continue chatting
              </button>
              {decisionId && !atGate ? (
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

        <div className="report-scroll-stability min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {error && !atGate ? (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <p>{error}</p>
              {onRetryStage ? (
                <button
                  type="button"
                  className="mt-2 rounded-full border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100"
                  onClick={onRetryStage}
                >
                  Retry this stage
                </button>
              ) : null}
            </div>
          ) : null}

          {atGate && scoringClarifyPending && onScoringClarifyApply && onScoringClarifySkip ? (
            <div className="mb-4">
              <ReportAgentJourney
                currentStep="evaluate"
                completedSteps={['enhance', 'perceive', 'retrieve', 'infer', 'simulate']}
                status="running"
              />
              <div className="mt-4">
                <ScoringClarifyPanel
                  variant="gate"
                  levelQuestions={scoringClarifyPending.levelQuestions}
                  comparativeQuestions={scoringClarifyPending.comparativeQuestions}
                  coverage={scoringClarifyPending.coverage}
                  discrimination={scoringClarifyPending.discrimination}
                  audit={scoringClarifyPending.audit}
                  optionNames={scoringClarifyPending.optionNames}
                  initialLevelAnswers={gatePrefill?.levelAnswers}
                  initialRankAnswers={gatePrefill?.rankAnswers}
                  elicitationRound={scoringClarifyPending.elicitationRound}
                  maxElicitationRounds={scoringClarifyPending.maxElicitationRounds}
                  validationErrors={scoringClarifyPending.validationErrors}
                  onApply={onScoringClarifyApply}
                  onSkip={onScoringClarifySkip}
                />
              </div>
            </div>
          ) : null}

          {!error && report && !isStreaming && !atGate ? (
            <div className="mb-4">
              <ReportAgentJourney
                currentStep={doneJourney.currentStep}
                completedSteps={doneJourney.completedSteps}
                status="complete"
              />
            </div>
          ) : null}
          {(isStreaming || (!report && !atGate)) && !error ? (
            <div className="mb-4">
              <ReportAgentJourney currentStep={currentStep} completedSteps={completedSteps} status={panelStatus} />
            </div>
          ) : null}

          {isStreaming && !report && !atGate ? (
            <p className="mb-3 text-sm text-gray-600">
              Sections appear below as they stream in — same layout as the main decision view.
            </p>
          ) : null}

          {report && trace && !atGate ? (
            <div className="mt-1">
              <ReportCompact
                report={report}
                fullTrace={trace}
                isStreaming={isStreaming}
                onExecutionCalendarNavigate={onOpenExecutionCalendar}
                shadowThreadId={shadowThreadId}
                onTraceRescored={onTraceRescored}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
