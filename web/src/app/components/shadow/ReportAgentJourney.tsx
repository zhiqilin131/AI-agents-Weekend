import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { REPORT_JOURNEY_STEPS, type ReportJourneyStepId } from '../../../utils/reportAgentJourney';

export type ReportAgentJourneyProps = {
  currentStep: ReportJourneyStepId;
  completedSteps: ReportJourneyStepId[];
  status?: 'running' | 'complete' | 'error';
};

export function ReportAgentJourney({ currentStep, completedSteps, status = 'running' }: ReportAgentJourneyProps) {
  const doneSet = new Set(completedSteps);
  const curIdx = REPORT_JOURNEY_STEPS.findIndex((s) => s.id === currentStep);
  const safeIdx = curIdx >= 0 ? curIdx : 0;
  const n = REPORT_JOURNEY_STEPS.length;
  const max = n - 1;
  const agentPct = n <= 0 ? 0 : ((safeIdx + 0.5) / n) * 100;
  const fillPct = status === 'complete' ? 100 : max <= 0 ? 0 : (safeIdx / max) * 100;

  const desc = REPORT_JOURNEY_STEPS[safeIdx]?.description ?? '';

  return (
    <div className="rounded-[20px] border border-white/80 bg-gradient-to-br from-white/90 via-violet-50/40 to-indigo-50/50 p-4 shadow-[0_12px_40px_rgba(99,102,241,0.08)] backdrop-blur-md">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-800/90">Agent journey</p>
      <p className="mt-0.5 text-xs text-gray-600">Your report is being composed step by step</p>

      <div className="relative mt-6 px-2 pb-2">
        <div className="absolute left-4 right-4 top-[11px] h-[3px] rounded-full bg-gray-200/90" />
        <motion.div
          className="absolute left-4 top-[11px] h-[3px] rounded-full bg-gradient-to-r from-violet-400 via-indigo-400 to-sky-400"
          initial={false}
          animate={{ width: `calc((100% - 32px) * ${Math.min(1, Math.max(0, fillPct / 100))})` }}
          transition={{ type: 'spring', stiffness: 100, damping: 22 }}
        />

        <div className="relative flex justify-between">
          {REPORT_JOURNEY_STEPS.map((step) => {
            const done = doneSet.has(step.id) || status === 'complete';
            const active = step.id === currentStep && status !== 'complete';
            const errored = status === 'error' && step.id === currentStep;
            return (
              <div key={step.id} className="flex w-0 flex-1 flex-col items-center">
                <div
                  className={`relative z-[1] flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 shadow-sm transition-colors ${
                    errored
                      ? 'border-amber-400 bg-amber-50 text-amber-700'
                      : done
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                        : active
                          ? 'border-violet-500 bg-white text-violet-700 shadow-[0_0_14px_rgba(139,92,246,0.35)]'
                          : 'border-gray-200/90 bg-white/70 text-gray-300'
                  }`}
                >
                  {done && !errored ? (
                    <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full ${active || errored ? 'bg-current' : 'bg-gray-300'}`} />
                  )}
                </div>
                <span
                  className={`mt-2 max-w-[76px] text-center text-[10px] leading-tight ${
                    active || errored ? 'font-semibold text-gray-900' : done ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {status !== 'complete' ? (
          <motion.div
            className="pointer-events-none absolute left-0 top-[-2px] z-[2] -translate-x-1/2"
            initial={false}
            animate={{ left: `${agentPct}%` }}
            transition={{ type: 'spring', stiffness: 140, damping: 18 }}
          >
            <div className="flex flex-col items-center">
              <motion.div
                animate={{ y: status === 'running' ? [0, -3, 0] : 0 }}
                transition={{ repeat: status === 'running' ? Infinity : 0, duration: 2.4, ease: 'easeInOut' }}
                className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/90 shadow-lg ${
                  status === 'error'
                    ? 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/30'
                    : 'bg-gradient-to-br from-violet-500 to-indigo-600 shadow-violet-500/35'
                }`}
              >
                <span className="flex gap-0.5">
                  <span className="h-1 w-1 rounded-full bg-white/95 shadow-[0_0_5px_rgba(255,255,255,0.9)]" />
                  <span className="h-1 w-1 rounded-full bg-white/95 shadow-[0_0_5px_rgba(255,255,255,0.9)]" />
                </span>
              </motion.div>
              <div className="mt-0.5 h-1 w-5 rounded-full bg-gray-900/12 blur-[1px]" />
            </div>
          </motion.div>
        ) : null}
      </div>

      <motion.p
        key={currentStep + status}
        initial={{ opacity: 0.55, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        className={`mt-2 text-sm leading-snug ${status === 'error' ? 'text-amber-900' : 'text-gray-700'}`}
      >
        {status === 'complete'
          ? 'Report ready — sections below are up to date.'
          : status === 'error'
            ? 'Generation paused — see the error above.'
            : desc}
      </motion.p>
    </div>
  );
}
