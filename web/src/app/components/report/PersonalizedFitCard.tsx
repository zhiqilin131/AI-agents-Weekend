import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Anchor, Brain, HeartHandshake, History, Lock, MessageCircle, Sparkles } from 'lucide-react';
import type { EvidenceReference, EvidenceRefType, ReportSurface } from '../../model';
import {
  resolveEvidenceDetail,
  type TraceMemoryBlockLite,
  type TraceUserStateLite,
} from '../../../utils/evidenceDetailFromTrace';
import { EvidenceChips } from './EvidenceChips';
import { EvidenceDetailPopover } from './EvidenceDetailPopover';
import { cn } from '../ui/utils';

const TYPE_ICONS: Partial<Record<EvidenceRefType, LucideIcon>> = {
  profile: Sparkles,
  past_decision: History,
  memory: Brain,
  current_constraint: Lock,
  user_statement: MessageCircle,
};

const TYPE_LABELS: Partial<Record<EvidenceRefType, string>> = {
  profile: 'Profile',
  past_decision: 'Past decisions',
  memory: 'Memory',
  current_constraint: 'Constraints',
  user_statement: 'Your words',
};

function countByType(refs: EvidenceReference[]): Map<EvidenceRefType, number> {
  const m = new Map<EvidenceRefType, number>();
  for (const r of refs) {
    m.set(r.type, (m.get(r.type) ?? 0) + 1);
  }
  return m;
}

const MAX_VISIBLE_REASONS = 3;

export function PersonalizedFitCard({
  surface,
  memoryTrace,
  userState,
}: {
  surface: ReportSurface;
  memoryTrace?: TraceMemoryBlockLite;
  userState?: TraceUserStateLite;
}) {
  const [detailRef, setDetailRef] = useState<EvidenceReference | null>(null);
  const [showAllReasons, setShowAllReasons] = useState(false);
  const allRefs = useMemo(
    () => surface.personalizedReasons.flatMap((r) => r.basedOn),
    [surface.personalizedReasons],
  );
  const typeCounts = useMemo(() => countByType(allRefs), [allRefs]);
  const detailContent = detailRef
    ? resolveEvidenceDetail(detailRef, { memoryTrace, userState })
    : null;

  const reasons = surface.personalizedReasons;
  const visibleReasons =
    showAllReasons || reasons.length <= MAX_VISIBLE_REASONS
      ? reasons
      : reasons.slice(0, MAX_VISIBLE_REASONS);
  const moreReasonCount = Math.max(0, reasons.length - MAX_VISIBLE_REASONS);

  const orderedTypes: EvidenceRefType[] = [
    'memory',
    'past_decision',
    'profile',
    'current_constraint',
    'user_statement',
  ];

  return (
    <section className="rounded-2xl border border-white/90 bg-gradient-to-b from-white/90 to-rose-50/25 backdrop-blur-md p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-100 to-white shadow-sm">
            <HeartHandshake className="h-5 w-5 text-rose-600" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold tracking-tight text-gray-900">Why this fits you</h3>
            <p className="mt-0.5 text-xs text-gray-500">Signals we leaned on — tap a chip to see the full memory or quote.</p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-rose-100/90 bg-white/80 px-4 py-3 shadow-inner">
        <div className="flex items-start gap-2">
          <Anchor className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden />
          <p className="text-sm font-medium leading-relaxed text-gray-800">{surface.groundingNote}</p>
        </div>
      </div>

      {typeCounts.size > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">At a glance</p>
          <div className="flex flex-wrap gap-2">
            {orderedTypes.map((t) => {
              const n = typeCounts.get(t);
              if (!n) return null;
              const Icon = TYPE_ICONS[t] ?? Sparkles;
              const label = TYPE_LABELS[t] ?? t;
              return (
                <div
                  key={t}
                  className={cn(
                    'flex min-w-[7.5rem] flex-1 items-center gap-2 rounded-xl border px-3 py-2 sm:flex-initial sm:min-w-0',
                    'border-violet-100 bg-gradient-to-br from-violet-50/90 to-white/90',
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600/10 text-violet-700">
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-bold leading-none text-gray-900">{n}</p>
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {visibleReasons.map((reason, i) => (
          <li
            key={`fit-${reason.text}-${i}`}
            className="group relative overflow-hidden rounded-2xl border border-gray-100/90 bg-white/85 p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-rose-400 to-violet-400 opacity-90" aria-hidden />
            <div className="pl-2">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Reason</span>
              </div>
              <p className="text-sm leading-relaxed text-gray-800">{reason.text}</p>
              <EvidenceChips
                refs={reason.basedOn}
                className="mt-3"
                interactive
                onChipClick={(r) => setDetailRef(r)}
              />
            </div>
          </li>
        ))}
      </ul>

      {reasons.length > MAX_VISIBLE_REASONS ? (
        <button
          type="button"
          className="mt-3 text-xs font-semibold text-rose-800 underline-offset-2 hover:underline"
          onClick={() => setShowAllReasons((v) => !v)}
        >
          {showAllReasons
            ? 'Show fewer reasons'
            : `Show ${moreReasonCount} more reason${moreReasonCount === 1 ? '' : 's'}`}
        </button>
      ) : null}

      {detailRef && detailContent ? (
        <EvidenceDetailPopover reference={detailRef} content={detailContent} onClose={() => setDetailRef(null)} />
      ) : null}
    </section>
  );
}
