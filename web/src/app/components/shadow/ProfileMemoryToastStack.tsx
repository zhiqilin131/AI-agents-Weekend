import { Pencil, Trash2, X } from 'lucide-react';

export type ProfileMemoryDetail = {
  action?: 'new' | 'updated' | 'merged' | string;
  id?: string;
  text?: string;
  category?: string;
  confidence?: number;
  importance?: number;
  previous_id?: string;
};

export type ProfileMemoryToast = { id: string; items: string[]; at: string; details?: ProfileMemoryDetail[] };

/** Stable key for thread ``memory_events`` rows — used to dedupe toasts across reloads. */
export function profileMemoryEventDedupeKey(ev: { at: string; items: string[]; details?: ProfileMemoryDetail[] }): string {
  const detailIds = (ev.details || []).map((d) => `${d.action || ''}:${d.id || ''}:${d.text || ''}`).join('\u0001');
  return `${String(ev.at).trim()}::${ev.items.map((s) => String(s).trim()).join('\u0001')}::${detailIds}`;
}

export function formatProfileMemoryToastAt(iso: string): string {
  const t = (iso || '').trim();
  if (!t) return '';
  const d = Date.parse(t);
  if (Number.isNaN(d)) return t.slice(0, 16);
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ProfileMemoryToastStack({
  toasts,
  onDismiss,
  onDelete,
  onEdit,
}: {
  toasts: ProfileMemoryToast[];
  onDismiss: (id: string) => void;
  onDelete?: (factId: string, toastId: string) => void;
  onEdit?: (factId?: string) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-[100] flex max-w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto relative rounded-2xl border border-emerald-200/90 bg-white/95 px-4 py-3 pr-9 text-sm shadow-[0_18px_50px_rgba(16,185,129,0.16)] backdrop-blur-md transition-opacity duration-300"
        >
          <button
            type="button"
            className="absolute right-2 top-2 rounded-full p-1 text-emerald-700/70 hover:bg-emerald-100/90 hover:text-emerald-900"
            aria-label="Dismiss"
            onClick={() => onDismiss(toast.id)}
          >
            <X className="h-4 w-4" />
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Profile memory updated</p>
          <div className="mt-1.5 space-y-2">
            {(toast.details?.length ? toast.details : toast.items.map((text) => ({ text }))).slice(0, 4).map((detail, i) => {
              const factId = typeof detail.id === 'string' ? detail.id : '';
              const action = String(detail.action || 'new');
              const category = String(detail.category || 'memory');
              const label = action === 'merged' ? 'reinforced' : action;
              return (
                <div key={`${toast.id}-${factId || i}`} className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-2.5 py-2">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      {label}
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                      {category}
                    </span>
                  </div>
                  <p className="text-[13px] leading-snug text-emerald-950">{String(detail.text || toast.items[i] || '')}</p>
                  {factId ? (
                    <div className="mt-1.5 flex gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 hover:text-emerald-950"
                        onClick={() => onEdit?.(factId)}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 hover:text-red-900"
                        onClick={() => onDelete?.(factId, toast.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {toast.at ? (
            <p className="mt-1.5 text-[10px] text-emerald-800/75">{formatProfileMemoryToastAt(toast.at)}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
