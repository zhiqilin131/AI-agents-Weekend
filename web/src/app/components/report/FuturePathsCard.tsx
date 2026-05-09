import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ChevronRight, Compass, GitBranch, Route } from 'lucide-react';
import type { EvidenceReference, FuturePath } from '../../model';
import type { TraceMemoryBlockLite, TraceUserStateLite } from '../../../utils/evidenceDetailFromTrace';
import { resolveEvidenceDetail } from '../../../utils/evidenceDetailFromTrace';
import { cn } from '../ui/utils';
import { EvidenceChips } from './EvidenceChips';
import { EvidenceDetailPopover } from './EvidenceDetailPopover';

function pathMeta(pathType: FuturePath['pathType']): {
  rail: string;
  badge: string;
  Icon: LucideIcon;
} {
  switch (pathType) {
    case 'expected':
      return {
        rail: 'from-emerald-400 to-teal-500',
        badge: 'bg-emerald-100 text-emerald-900 border-emerald-200/90',
        Icon: Route,
      };
    case 'friction':
      return {
        rail: 'from-amber-400 to-orange-500',
        badge: 'bg-amber-100 text-amber-900 border-amber-200/90',
        Icon: AlertTriangle,
      };
    default:
      return {
        rail: 'from-indigo-400 to-violet-600',
        badge: 'bg-indigo-100 text-indigo-900 border-indigo-200/90',
        Icon: Compass,
      };
  }
}

function headlineFromSummary(summary: string, maxLen = 140): string {
  const t = summary.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const last = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf(' '));
  const slice = last > 40 ? cut.slice(0, last + 1) : cut;
  return `${slice.trim()}...`;
}

export function FuturePathsCard({
  paths,
  memoryTrace,
  userState,
}: {
  paths: FuturePath[];
  memoryTrace?: TraceMemoryBlockLite;
  userState?: TraceUserStateLite;
}) {
  const [detailRef, setDetailRef] = useState<EvidenceReference | null>(null);
  const detailContent = detailRef ? resolveEvidenceDetail(detailRef, { memoryTrace, userState }) : null;

  return (
    <section className="rounded-2xl border border-white/90 bg-white/78 backdrop-blur-md p-5 shadow-sm">
      <div className="flex items-start gap-3 border-b border-gray-100/80 pb-4 mb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
          <GitBranch className="h-5 w-5 text-slate-700" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900">Three future paths</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            Skim the headline; open breakdown only when you want triggers, watch-outs, and sources.
          </p>
        </div>
      </div>

      <ol className="relative space-y-0">
        {paths.map((p, idx) => {
          const { rail, badge, Icon } = pathMeta(p.pathType);
          const headline = headlineFromSummary(p.summary);
          const nTriggers = p.triggerConditions.length;
          const nWatch = p.watchSignals.length;
          const nSources = p.basedOn.length;
          return (
            <li key={p.pathType} className="relative flex gap-0 pb-1 last:pb-0">
              {idx < paths.length - 1 ? (
                <div
                  className="absolute left-[18px] top-10 bottom-0 w-px bg-gradient-to-b from-gray-200 to-gray-100"
                  aria-hidden
                />
              ) : null}
              <div className={cn('mr-3 mt-1 h-9 w-1 shrink-0 rounded-full bg-gradient-to-b', rail)} aria-hidden />
              <article className="min-w-0 flex-1 rounded-xl border border-gray-100/90 bg-white/90 py-3 pl-1 pr-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-700 ring-1 ring-gray-100">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                        badge,
                      )}
                    >
                      {p.title}
                    </span>
                  </div>
                </div>

                <p
                  className="mt-2 text-sm font-semibold leading-snug tracking-tight text-gray-900 line-clamp-2"
                  title={p.summary}
                >
                  {headline}
                </p>

                <details className="group mt-2 rounded-lg border border-gray-100 bg-gray-50/50 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50/60 rounded-lg">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-indigo-500 transition-transform group-open:rotate-90" />
                    <span>
                      Breakdown
                      <span className="ml-1 font-normal text-gray-500">
                        · {nTriggers} triggers · {nWatch} watch-outs
                        {nSources > 0 ? ` · ${nSources} sources` : ''}
                      </span>
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-gray-100/90 px-3 pb-3 pt-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Full picture</p>
                      <p className="mt-1 text-xs leading-relaxed text-gray-700">{p.summary}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Triggers</p>
                        <ul className="mt-1 space-y-1 text-xs text-gray-700">
                          {p.triggerConditions.slice(0, 5).map((t, i) => (
                            <li key={`tr-${p.pathType}-${i}`} className="flex gap-2">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" aria-hidden />
                              <span className="leading-snug">{t}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Watch-outs</p>
                        <ul className="mt-1 space-y-1 text-xs text-gray-700">
                          {p.watchSignals.slice(0, 5).map((t, i) => (
                            <li key={`w-${p.pathType}-${i}`} className="flex gap-2">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400/90" aria-hidden />
                              <span className="leading-snug">{t}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/90 bg-white px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">If this path</p>
                      <p className="mt-0.5 text-sm font-medium leading-snug text-gray-900">{p.recommendedAction}</p>
                    </div>
                    {p.basedOn.length > 0 ? (
                      <EvidenceChips
                        refs={p.basedOn}
                        className="mt-0"
                        interactive
                        onChipClick={(r) => setDetailRef(r)}
                      />
                    ) : null}
                  </div>
                </details>
              </article>
            </li>
          );
        })}
      </ol>

      {detailRef && detailContent ? (
        <EvidenceDetailPopover reference={detailRef} content={detailContent} onClose={() => setDetailRef(null)} />
      ) : null}
    </section>
  );
}
