import type { ExecutionTask } from '../../utils/scheduler';

export type AgilityPreviewData = {
  selected_option_id?: string;
  headline?: string;
  summary?: string;
  likely_consequences?: string[];
  workload_impact?: string;
  risk_windows?: string[];
  reversibility?: string;
  hidden_assumptions?: string[];
  first_steps?: ExecutionTask[];
  review_checkpoint?: string;
};

/** Sidebar variant only shows headline, summary, and first risk line — skip empty shell cards. */
export function agilityPreviewSidebarHasContent(preview: AgilityPreviewData | null | undefined): boolean {
  if (!preview) return false;
  const h = (preview.headline ?? '').trim();
  const s = (preview.summary ?? '').trim();
  const r = (preview.risk_windows?.[0] ?? '').trim();
  return Boolean(h || s || r);
}

export function AgilityPreview({ preview, variant = 'default' }: { preview: AgilityPreviewData | null; variant?: 'default' | 'sidebar' }) {
  if (!preview) return null;
  const sidebar = variant === 'sidebar';
  if (sidebar) {
    if (!agilityPreviewSidebarHasContent(preview)) return null;
    const risk = preview.risk_windows?.[0];
    return (
      <section className="w-full px-3 py-3">
        {preview.headline ? (
          <p className="text-xs font-semibold leading-snug text-gray-900 line-clamp-2">{preview.headline}</p>
        ) : null}
        {preview.summary ? (
          <p className="mt-1 text-[11px] leading-snug text-gray-600 line-clamp-3">{preview.summary}</p>
        ) : null}
        {risk ? (
          <p className="mt-2 truncate text-[11px] text-rose-600" title={risk}>
            {risk}
          </p>
        ) : null}
      </section>
    );
  }
  return (
    <section className="max-w-[1500px] mx-auto rounded-2xl border border-[#dbe4ff] bg-gradient-to-br from-[#f8faff] to-[#f5f3ff] p-5 shadow-[0_8px_28px_rgba(46,74,138,0.08)] space-y-2">
      <div className="flex flex-col gap-1">
        <h2 className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-indigo-600">Agility preview</h2>
        {preview.headline ? <p className="font-semibold text-slate-900 leading-snug text-lg">{preview.headline}</p> : null}
      </div>
      {preview.summary ? <p className="text-slate-600 leading-relaxed text-sm">{preview.summary}</p> : null}
      {(preview.workload_impact || preview.reversibility) && (
        <div className="grid gap-x-4 gap-y-2 text-xs text-slate-600 sm:grid-cols-2">
          {!!preview.workload_impact && (
            <p>
              <span className="font-medium text-slate-800">Workload</span>
              <span className="text-slate-400"> · </span>
              {preview.workload_impact}
            </p>
          )}
          {!!preview.reversibility && (
            <p>
              <span className="font-medium text-slate-800">Reversibility</span>
              <span className="text-slate-400"> · </span>
              {preview.reversibility}
            </p>
          )}
        </div>
      )}
      {!!preview.review_checkpoint && (
        <p className="text-slate-600 text-sm">
          <span className="font-medium text-slate-800">Review</span>
          <span className="text-slate-400"> · </span>
          {preview.review_checkpoint}
        </p>
      )}
      {!!preview.likely_consequences?.length && (
        <ul className="list-disc ml-4 text-slate-600 space-y-0.5 text-sm">
          {preview.likely_consequences.slice(0, 3).map((x, i) => (
            <li key={`c-${i}`}>{x}</li>
          ))}
        </ul>
      )}
      {!!preview.risk_windows?.length && (
        <ul className="list-disc ml-4 space-y-0.5 text-rose-700 text-sm">
          {preview.risk_windows.slice(0, 3).map((x, i) => (
            <li key={`r-${i}`}>{x}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

