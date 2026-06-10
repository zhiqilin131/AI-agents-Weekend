import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { FeatureAudit } from '../../../utils/featureAudit';
import { tagQualityNotices } from '../../../utils/featureAudit';

interface ScoringAuditPanelProps {
  audit: FeatureAudit | null;
}

const STATUS_STYLES: Record<string, string> = {
  known: 'bg-emerald-50/90 text-emerald-700 ring-emerald-200/60',
  candidate: 'bg-amber-50/80 text-amber-800/90 ring-amber-200/50',
  unknown: 'bg-slate-50 text-slate-500 ring-slate-200/60',
};

function statusBadge(status: string) {
  const cls = STATUS_STYLES[status] ?? STATUS_STYLES.unknown;
  return (
    <span
      className={`inline-block rounded-md px-1.5 py-px text-[9px] uppercase tracking-wider ring-1 ring-inset ${cls}`}
    >
      {status}
    </span>
  );
}

function TagQualityHints({ audit }: { audit: FeatureAudit }) {
  const notices = tagQualityNotices(audit);
  const [open, setOpen] = useState(false);
  if (!notices.length) return null;

  const conflictCount = notices.reduce((n, x) => n + x.conflicts.length, 0);
  const optionCount = notices.length;
  const summary =
    conflictCount > 0
      ? `${conflictCount} label ${conflictCount === 1 ? 'mismatch' : 'mismatches'} across ${optionCount} ${optionCount === 1 ? 'option' : 'options'}`
      : `${optionCount} ${optionCount === 1 ? 'option needs' : 'options need'} stronger tag grounding`;

  return (
    <div className="border-t border-slate-200/50 pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-slate-50/80"
        aria-expanded={open}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80" aria-hidden />
        <span className="min-w-0 flex-1 text-[11px] leading-snug text-slate-600">{summary}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open ? (
        <ul className="mt-1 space-y-2 pl-3.5">
          {notices.map((notice) => (
            <li key={notice.optionId} className="text-[11px] leading-relaxed text-slate-500">
              <span className="font-medium text-slate-600">{notice.optionId}</span>
              {notice.conflicts.length > 0 ? (
                <ul className="mt-0.5 space-y-0.5">
                  {notice.conflicts.map((line) => (
                    <li key={`${notice.optionId}-${line}`} className="pl-2 before:mr-1.5 before:text-slate-300 before:content-['·']">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 pl-2 text-slate-500">Tags not yet grounded enough to score as known.</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ScoringAuditPanel({ audit }: ScoringAuditPanelProps) {
  if (!audit?.feature_vectors?.length) return null;

  const coverage = audit.grounded_feature_coverage;
  const vectors = audit.feature_vectors;

  return (
    <section
      className="rounded-2xl border border-slate-200/60 bg-gradient-to-b from-white/95 to-slate-50/40 p-4 shadow-sm"
      data-testid="scoring-audit-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] tracking-tight text-slate-800" style={{ fontWeight: 600 }}>
            Scoring audit
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            Tradeoff features driving rank — deterministic, not LLM impressions.
          </p>
        </div>
        {typeof coverage === 'number' ? (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${
              coverage >= 0.75
                ? 'bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-200/50'
                : coverage >= 0.55
                  ? 'bg-amber-50/90 text-amber-800/90 ring-1 ring-amber-200/40'
                  : 'bg-rose-50/80 text-rose-700/90 ring-1 ring-rose-200/40'
            }`}
          >
            {Math.round(coverage * 100)}% grounded
          </span>
        ) : null}
        {typeof audit.cross_option_discrimination === 'number' ? (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200/60 ring-inset">
            {Math.round(audit.cross_option_discrimination * 100)}% spread
          </span>
        ) : null}
      </div>

      <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
        {vectors.map((fv) => {
          const oid = String(fv.option_id ?? '');
          const fieldStatus = (fv.field_status ?? {}) as Record<string, string>;
          const keys = Object.keys(fieldStatus).slice(0, 12);
          return (
            <div
              key={oid}
              className="rounded-xl border border-slate-100/90 bg-white/70 px-2.5 py-2 backdrop-blur-[1px]"
            >
              <p className="mb-1 text-[11px] font-medium text-slate-700">{oid}</p>
              <div className="flex flex-wrap gap-1">
                {keys.map((k) => (
                  <span
                    key={`${oid}-${k}`}
                    className="inline-flex items-center gap-1 text-[10px] text-slate-500"
                  >
                    <span className="max-w-[100px] truncate">{k.replace(/_level$/, '')}</span>
                    {statusBadge(fieldStatus[k] ?? 'unknown')}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {audit.candidates?.length ? (
        <p className="mt-2 text-[10px] text-slate-400">
          {audit.candidates.length} future-derived candidate{audit.candidates.length === 1 ? '' : 's'} pending
          confirmation.
        </p>
      ) : null}

      <TagQualityHints audit={audit} />
    </section>
  );
}
