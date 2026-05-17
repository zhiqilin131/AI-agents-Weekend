import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  CheckCircle2,
  Circle,
  Loader2,
  Play,
  RotateCcw,
  Terminal,
  XCircle,
} from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { innerCard, shellCard } from './resilienceStyles';
import type { SmokeAssertion, SmokeRun } from './smokeTestTypes';

function StabilityRing({ score, pass }: { score: number; pass?: boolean }) {
  const clamped = Math.max(0, Math.min(100, score));
  const r = 44;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  return (
    <div className="relative mx-auto h-28 w-28">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r / 2.2} fill="none" stroke="#ede9fe" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r / 2.2}
          fill="none"
          stroke={pass ? '#10b981' : '#f43f5e'}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c / 2.2}
          strokeDashoffset={offset / 2.2}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-gray-900">{clamped}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">stability</span>
      </div>
    </div>
  );
}

function StageStrip({
  order,
  completed,
  active,
}: {
  order: string[];
  completed: Set<string>;
  active: Set<string>;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {order.map((stage) => {
        const isActive = active.has(stage);
        const isDone = completed.has(stage);
        return (
          <motion.div
            key={stage}
            layout
            className={cn(
              'rounded-lg border px-2 py-1 text-[10px] font-semibold capitalize transition-all',
              isActive && 'border-violet-400 bg-violet-100 text-violet-900 shadow-sm ring-2 ring-violet-300/50',
              isDone && !isActive && 'border-emerald-200 bg-emerald-50 text-emerald-800',
              !isDone && !isActive && 'border-gray-200 bg-white text-gray-400',
            )}
          >
            {stage}
          </motion.div>
        );
      })}
    </div>
  );
}

export function SmokeTestInteractiveRunner({
  busy,
  error,
  result,
  phases,
  liveLog,
  activeStages,
  completedStages,
  currentStage,
  stageOrder,
  onRun,
  onReset,
}: {
  busy: boolean;
  error: string | null;
  result: SmokeRun | null;
  phases: { id?: string; label?: string; status?: string; detail?: string }[];
  liveLog: { t_ms?: number; summary?: string; type?: string; stage?: string }[];
  activeStages: Set<string>;
  completedStages: Set<string>;
  currentStage: string | null;
  stageOrder: string[];
  onRun: () => void;
  onReset: () => void;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const prevLogLenRef = useRef(0);

  useEffect(() => {
    // Only follow the terminal during an active run — never scroll the page on first paint.
    if (!busy || liveLog.length === 0 || liveLog.length <= prevLogLenRef.current) {
      prevLogLenRef.current = liveLog.length;
      return;
    }
    prevLogLenRef.current = liveLog.length;
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [busy, liveLog.length]);

  const assertions = result?.assertions ?? [];
  const passCount = assertions.filter((a) => a.pass).length;
  const degradations = result?.degradations_detail ?? [];
  const liveScore = busy
    ? Math.min(85, Math.round((completedStages.size / Math.max(stageOrder.length, 1)) * 85))
    : (result?.stability_score ?? 0);

  return (
    <div className={cn(shellCard, 'overflow-hidden')}>
      <div className="border-b border-violet-100/80 bg-gradient-to-r from-violet-50/80 via-white to-sky-50/60 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600">Live grader test</p>
            <p className="mt-1 text-sm text-gray-600">
              Real <code className="rounded bg-white px-1 text-xs">iter_pipeline_events</code> with{' '}
              <strong>llm=None</strong> — watch stages light up via SSE.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onReset}
              disabled={busy && !result}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
            <button
              type="button"
              onClick={onRun}
              disabled={busy}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lg',
                'bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:brightness-[1.03] disabled:opacity-55',
              )}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {busy ? 'Running live…' : 'Launch live test'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_320px] lg:p-6">
        <div className="space-y-5">
          <div className={cn(innerCard, 'p-4')}>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">Pipeline stages (live)</p>
            <StageStrip order={stageOrder} completed={completedStages} active={activeStages} />
            {currentStage && busy ? (
              <p className="mt-3 text-center text-xs text-violet-700">
                <Activity className="mr-1 inline h-3.5 w-3.5 animate-pulse" />
                Running <strong className="capitalize">{currentStage}</strong>…
              </p>
            ) : null}
          </div>

          <div className={cn(innerCard, 'p-4')}>
            <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500">
              <Terminal className="h-3.5 w-3.5" />
              Event stream
            </p>
            <div className="max-h-48 overflow-y-auto rounded-xl bg-gray-950 p-3 font-mono text-[11px] leading-relaxed text-emerald-400/95">
              {liveLog.length === 0 ? (
                <p className="text-gray-500">// events appear here as the pipeline runs</p>
              ) : (
                liveLog.map((row, i) => (
                  <motion.div
                    key={`${row.t_ms}-${i}`}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                  >
                    <span className="text-gray-500">{String(row.t_ms ?? 0).padStart(4, '0')}ms</span>{' '}
                    <span className="text-violet-300">{row.type}</span>{' '}
                    {row.stage ? <span className="text-sky-300">{row.stage} </span> : null}
                    <span className="text-gray-300">{row.summary}</span>
                  </motion.div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Setup phases</p>
            {phases.map((ph) => (
              <motion.div
                key={ph.id}
                layout
                initial={false}
                className={cn(
                  'flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm',
                  ph.status === 'done' && 'border-emerald-200 bg-emerald-50/80',
                  ph.status === 'running' || ph.status === 'start'
                    ? 'border-violet-200 bg-violet-50/80'
                    : 'border-gray-200 bg-white',
                  ph.status === 'failed' && 'border-rose-200 bg-rose-50/80',
                )}
              >
                {ph.status === 'done' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : ph.status === 'start' || ph.status === 'running' ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-violet-600" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
                )}
                <div>
                  <p className="font-medium text-gray-900">{ph.label}</p>
                  {ph.detail ? <p className="mt-0.5 text-xs text-gray-500">{ph.detail}</p> : null}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <AnimatePresence mode="wait">
            {result || busy ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className={cn(innerCard, 'p-4')}
              >
                <StabilityRing score={liveScore} pass={result?.pass} />
                <div className="mt-4 text-center">
                  {busy && !result ? (
                    <p className="flex items-center justify-center gap-2 text-lg font-bold text-violet-800">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      RUNNING
                    </p>
                  ) : result?.pass ? (
                    <p className="flex items-center justify-center gap-2 text-xl font-bold text-emerald-800">
                      <CheckCircle2 className="h-6 w-6" />
                      STABLE
                    </p>
                  ) : (
                    <p className="flex items-center justify-center gap-2 text-xl font-bold text-rose-800">
                      <XCircle className="h-6 w-6" />
                      FAILED
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    {busy && !result
                      ? 'Streaming pipeline events…'
                      : `${result?.elapsed_ms ?? '—'} ms · ${result?.mode ?? 'full_pipeline'}`}
                  </p>
                </div>
                {result ? (
                  <dl className="mt-4 space-y-2 text-xs">
                    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                      <dt className="font-semibold text-gray-500">decision_id</dt>
                      <dd className="truncate font-mono text-gray-800">{result.decision_id}</dd>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                      <dt className="font-semibold text-gray-500">chosen_option_id</dt>
                      <dd className="font-mono font-semibold text-gray-900">{result.chosen_option_id}</dd>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-violet-50 px-2 py-1.5">
                        <dt className="font-semibold text-violet-700">Degradations</dt>
                        <dd className="text-lg font-bold text-gray-900">{result.degradation_count ?? 0}</dd>
                      </div>
                      <div className="rounded-lg bg-violet-50 px-2 py-1.5">
                        <dt className="font-semibold text-violet-700">Stages</dt>
                        <dd className="text-lg font-bold text-gray-900">
                          {result.pipeline_stages_seen?.length ?? 0}/{result.pipeline_stages_expected?.length ?? 7}
                        </dd>
                      </div>
                    </div>
                  </dl>
                ) : null}
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={cn(innerCard, 'p-4 text-center text-xs text-gray-500')}
              >
                Launch the test to see stability score and grader assertions.
              </motion.div>
            )}
          </AnimatePresence>

          {degradations.length > 0 ? (
            <div className={cn(innerCard, 'p-4')}>
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                Fallbacks exercised ({degradations.length})
              </p>
              <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                {degradations.map((d, i) => (
                  <li
                    key={`${d.stage}-${d.provider}-${i}`}
                    className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-2.5 py-2 text-xs"
                  >
                    <p className="font-semibold capitalize text-amber-950">
                      {d.stage} · {d.provider}
                    </p>
                    <p className="mt-0.5 text-amber-900/90">{d.reason}</p>
                    {d.fallback ? (
                      <p className="mt-1 font-mono text-[10px] text-amber-800">→ {d.fallback}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(result?.assertions?.length ?? 0) > 0 ? (
            <div className={cn(innerCard, 'p-4')}>
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                Grader assertions ({passCount}/{assertions.length})
              </p>
              <ul className="mt-3 space-y-2">
                {assertions.map((a: SmokeAssertion) => (
                  <li
                    key={a.id}
                    className={cn(
                      'rounded-lg border px-2.5 py-2 text-xs',
                      a.pass ? 'border-emerald-200 bg-emerald-50/80' : 'border-rose-200 bg-rose-50/80',
                    )}
                  >
                    <p className="flex items-center gap-1.5 font-semibold text-gray-900">
                      {a.pass ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-rose-600" />
                      )}
                      {a.label}
                    </p>
                    <p className="mt-1 text-gray-600">{a.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
