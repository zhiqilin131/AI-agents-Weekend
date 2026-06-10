import type { AlignmentReport } from '../../../utils/featureAudit';

interface AlignmentWarningsProps {
  report: AlignmentReport | null | undefined;
}

export function AlignmentWarnings({ report }: AlignmentWarningsProps) {
  if (!report) return null;
  const violations = report.constraint_violations ?? [];
  const showNearDup = report.near_duplicate_options === true;
  const needsCompare = report.needs_comparative_elicitation === true;
  const reconcile = report.reconcile_required === true;
  if (!violations.length && !showNearDup && !needsCompare && !reconcile) return null;

  return (
    <section
      className="rounded-xl border border-amber-200/70 bg-amber-50/40 px-3 py-2.5"
      data-testid="alignment-warnings"
    >
      <p className="text-[11px] font-medium text-amber-900">Alignment notes</p>
      <ul className="mt-1 space-y-1">
        {needsCompare ? (
          <li className="text-[11px] leading-relaxed text-amber-800">
            Cross-option ranking will help separate options on key tradeoffs.
          </li>
        ) : null}
        {reconcile ? (
          <li className="text-[11px] leading-relaxed text-amber-800">
            Some answers may conflict — review ranking vs per-option levels below.
          </li>
        ) : null}
        {showNearDup ? (
          <li className="text-[11px] leading-relaxed text-amber-800">
            Options score similarly — use comparative ranking below to differentiate tradeoffs.
          </li>
        ) : null}
        {violations.map((v, i) => (
          <li key={`${v.option_id}-${v.feature_key}-${i}`} className="text-[11px] leading-relaxed text-amber-800">
            {v.message || `${v.feature_key} on ${v.option_id}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
