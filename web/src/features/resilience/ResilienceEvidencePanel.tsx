import { CheckCircle2, FlaskConical, RefreshCw, XCircle } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { innerCard, shellCard } from './resilienceStyles';

export type ChaosLegRow = {
  leg?: string;
  pass?: boolean;
  degradation_count?: number;
  degraded_sse_count?: number;
  decision_id?: string | null;
};

export function ResilienceEvidencePanel({
  legs,
  markdown,
  packLoading,
  packError,
  onRefresh,
}: {
  legs: ChaosLegRow[];
  markdown?: string;
  packLoading: boolean;
  packError: string | null;
  onRefresh: () => void;
}) {
  const passCount = legs.filter((r) => r.pass).length;

  return (
    <section id="resilience-evidence" className={cn(shellCard, 'scroll-mt-28 p-6 sm:p-8')}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" aria-hidden />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-600">Offline proof</p>
            <h2 className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">Chaos harness results</h2>
            <p className="mt-1 max-w-lg text-sm text-gray-600">
              Six injected fault legs from <code className="rounded bg-violet-50 px-1 text-xs">make chaos-demo</code>.
              Each leg must PASS with degradations recorded and a complete <code className="text-xs">decision_id</code>.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={packLoading}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/90 bg-white/80 px-4 py-2 text-xs font-semibold text-gray-800 shadow-sm hover:border-purple-200 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', packLoading && 'animate-spin')} aria-hidden />
          Refresh
        </button>
      </div>

      {packError ? (
        <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{packError}</p>
      ) : null}

      {legs.length > 0 ? (
        <>
          <p className="mb-3 text-sm font-semibold text-emerald-800">
            {passCount}/{legs.length} legs passed
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {legs.map((row) => (
              <div
                key={String(row.leg)}
                className={cn(
                  innerCard,
                  'flex items-center justify-between gap-3 px-4 py-3',
                  row.pass ? 'border-emerald-200/90' : 'border-rose-200/90',
                )}
              >
                <div>
                  <p className="font-semibold text-gray-900">{row.leg}</p>
                  <p className="text-xs text-gray-600">
                    {row.degradation_count ?? 0} degradations · {row.degraded_sse_count ?? 0} SSE degraded events
                  </p>
                  {row.decision_id ? (
                    <p className="mt-0.5 font-mono text-[10px] text-gray-500">
                      {String(row.decision_id).slice(0, 16)}…
                    </p>
                  ) : null}
                </div>
                {row.pass ? (
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <XCircle className="h-6 w-6 shrink-0 text-rose-600" aria-hidden />
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className={cn(innerCard, 'px-4 py-3 text-sm text-amber-900')}>
          Run <code className="rounded bg-amber-100 px-1">make chaos-demo</code> in the repo root, then refresh.
        </p>
      )}

      {markdown ? (
        <details className={cn(innerCard, 'mt-4')}>
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-gray-700">Raw report_card.md</summary>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap px-4 pb-4 text-[11px] text-gray-600">
            {markdown}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
