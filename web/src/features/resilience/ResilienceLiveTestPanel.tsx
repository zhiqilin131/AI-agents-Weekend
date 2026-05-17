import { CheckCircle2, CircleDot, ShieldCheck } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { SMOKE_TEST_SPEC } from './resilienceModel';
import { innerCard, shellCard } from './resilienceStyles';
import { SmokeTestInteractiveRunner } from './SmokeTestInteractiveRunner';
import { useSmokeTestStream } from './useSmokeTestStream';

export function ResilienceLiveTestPanel() {
  const spec = SMOKE_TEST_SPEC;
  const stream = useSmokeTestStream();

  return (
    <section id="resilience-live-test" className="scroll-mt-8">
      <div className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-600">Step 3 · For graders</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{spec.title}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-gray-600">{spec.purpose}</p>
      </div>

      <div className={cn(shellCard, 'overflow-hidden p-6 sm:p-8')}>
        <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
          <div className="space-y-6">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <ShieldCheck className="h-4 w-4 text-violet-600" aria-hidden />
                What this test verifies
              </h3>
              <ul className="mt-3 space-y-3">
                {spec.whatWeTest.map((item) => (
                  <li key={item.label} className={cn(innerCard, 'p-3')}>
                    <p className="text-xs font-bold text-violet-800">{item.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-700">{item.detail}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-bold text-gray-900">How it runs (isolated)</h3>
              <ol className="mt-2 space-y-2">
                {spec.howItRuns.map((step, i) => (
                  <li key={step} className="flex gap-2 text-sm text-gray-700">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-800">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/60 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Pass criteria</p>
              <ul className="mt-2 space-y-1.5">
                {spec.passCriteria.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-sm text-emerald-900">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <aside className="space-y-4">
            <div className={cn(innerCard, 'p-4')}>
              <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Live stream</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">
                Uses{' '}
                <code className="rounded bg-violet-50 px-1 text-xs">POST /api/resilience/smoke-run/stream</code> — SSE
                phases, per-stage pipeline events, then a graded payload with assertions.
              </p>
              <ul className="mt-3 space-y-2 text-xs text-gray-600">
                <li className="flex gap-2">
                  <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" />
                  Seven stages light up in real time
                </li>
                <li className="flex gap-2">
                  <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" />
                  Terminal log mirrors backend events
                </li>
                <li className="flex gap-2">
                  <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" />
                  Stability score + grader assertions at the end
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Explicitly not touched</p>
              <ul className="mt-2 space-y-1">
                {spec.whatWeDoNotTouch.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-sm text-slate-700">
                    <CircleDot className="mt-1 h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>

        <div className="mt-8">
          <SmokeTestInteractiveRunner
            busy={stream.busy}
            error={stream.error}
            result={stream.result}
            phases={stream.phases}
            liveLog={stream.liveLog}
            activeStages={stream.activeStages}
            completedStages={stream.completedStages}
            currentStage={stream.currentStage}
            stageOrder={stream.stageOrder}
            onRun={() => void stream.run()}
            onReset={stream.reset}
          />
        </div>
      </div>
    </section>
  );
}
