import { Pencil, Trash2, X } from 'lucide-react';
import { cn } from '../ui/utils';

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
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ProfileMemoryToastStack({
  toasts,
  onDismiss,
  onDelete,
  onEdit,
  headerTitle = 'Profile memory updated',
  tone = 'emerald',
}: {
  toasts: ProfileMemoryToast[];
  onDismiss: (id: string) => void;
  onDelete?: (factId: string, toastId: string) => void;
  onEdit?: (factId?: string) => void;
  headerTitle?: string;
  tone?: 'emerald' | 'rose';
}) {
  const toneCls =
    tone === 'rose'
      ? {
          border: 'border-rose-200/90',
          shadow: 'shadow-[0_18px_50px_rgba(244,114,182,0.16)]',
          header: 'text-rose-800',
          dismiss: 'text-rose-700/70 hover:bg-rose-100/90 hover:text-rose-900',
          card: 'border-rose-100 bg-rose-50/70',
          pill: 'bg-rose-600',
          pillText: 'text-white',
          catBorder: 'border-rose-200',
          catText: 'text-rose-800',
          body: 'text-rose-950',
          time: 'text-rose-800/75',
        }
      : {
          border: 'border-emerald-200/90',
          shadow: 'shadow-[0_18px_50px_rgba(16,185,129,0.16)]',
          header: 'text-emerald-800',
          dismiss: 'text-emerald-700/70 hover:bg-emerald-100/90 hover:text-emerald-900',
          card: 'border-emerald-100 bg-emerald-50/70',
          pill: 'bg-emerald-600',
          pillText: 'text-white',
          catBorder: 'border-emerald-200',
          catText: 'text-emerald-800',
          body: 'text-emerald-950',
          time: 'text-emerald-800/75',
        };
  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-[100] flex max-w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto relative rounded-2xl border bg-white/95 px-4 py-3 pr-9 text-sm backdrop-blur-md transition-opacity duration-300',
            toneCls.border,
            toneCls.shadow,
          )}
        >
          <button
            type="button"
            className={cn('absolute right-2 top-2 rounded-full p-1', toneCls.dismiss)}
            aria-label="Dismiss"
            onClick={() => onDismiss(toast.id)}
          >
            <X className="h-4 w-4" />
          </button>
          <p className={cn('text-[11px] font-semibold uppercase tracking-wide', toneCls.header)}>{headerTitle}</p>
          <div className="mt-1.5 space-y-2">
            {(toast.details?.length ? toast.details : toast.items.map((text) => ({ text }))).slice(0, 4).map((detail, i) => {
              const factId = typeof detail.id === 'string' ? detail.id : '';
              const action = String(detail.action || 'new');
              const category = String(detail.category || 'memory');
              const label = action === 'merged' ? 'reinforced' : action;
              return (
                <div key={`${toast.id}-${factId || i}`} className={cn('rounded-xl border px-2.5 py-2', toneCls.card)}>
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        toneCls.pill,
                        toneCls.pillText,
                      )}
                    >
                      {label}
                    </span>
                    <span
                      className={cn(
                        'rounded-full border bg-white px-2 py-0.5 text-[10px] font-medium',
                        toneCls.catBorder,
                        toneCls.catText,
                      )}
                    >
                      {category}
                    </span>
                  </div>
                  <p className={cn('text-[13px] leading-snug', toneCls.body)}>
                    {String(detail.text || toast.items[i] || '')}
                  </p>
                  {factId ? (
                    <div className="mt-1.5 flex gap-2">
                      <button
                        type="button"
                        className={cn('inline-flex items-center gap-1 text-[11px] font-semibold hover:opacity-90', toneCls.catText)}
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
            <p className={cn('mt-1.5 text-[10px]', toneCls.time)}>{formatProfileMemoryToastAt(toast.at)}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
