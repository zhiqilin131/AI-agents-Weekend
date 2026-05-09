import { format, parseISO } from 'date-fns';

function fmtRange(startIso: string, endIso: string) {
  try {
    const s = parseISO(startIso);
    const e = parseISO(endIso);
    return `${format(s, 'EEE MMM d')} · ${format(s, 'h:mm a')} – ${format(e, 'h:mm a')}`;
  } catch {
    return `${startIso} – ${endIso}`;
  }
}

export function CalendarDraftCard({
  title,
  start,
  end,
  explanation,
  confidenceLabel,
  onAdd,
  onEdit,
  onSuggest,
  onCancel,
  busy,
}: {
  title: string;
  start: string;
  end: string;
  explanation?: string;
  confidenceLabel?: string;
  onAdd: () => void;
  onEdit?: () => void;
  onSuggest?: () => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-white/95 to-indigo-50/50 px-4 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Proposed block</p>
      <p className="mt-1 font-semibold text-indigo-950">{title}</p>
      <p className="mt-0.5 text-sm text-slate-700">{fmtRange(start, end)}</p>
      {explanation ? <p className="mt-2 text-xs leading-relaxed text-slate-600">{explanation}</p> : null}
      {confidenceLabel ? <p className="mt-1 text-[10px] text-slate-500">{confidenceLabel}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onAdd}
          className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          Add to calendar
        </button>
        {onEdit ? (
          <button
            type="button"
            disabled={busy}
            onClick={onEdit}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Edit
          </button>
        ) : null}
        {onSuggest ? (
          <button
            type="button"
            disabled={busy}
            onClick={onSuggest}
            className="rounded-full border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-900 hover:bg-indigo-50/80 disabled:opacity-50"
          >
            Suggest another time
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-full px-3 py-2 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50">
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
