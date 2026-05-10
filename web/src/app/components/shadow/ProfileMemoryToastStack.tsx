import { X } from 'lucide-react';

export type ProfileMemoryToast = { id: string; items: string[]; at: string };

/** Stable key for thread ``memory_events`` rows — used to dedupe toasts across reloads. */
export function profileMemoryEventDedupeKey(ev: { at: string; items: string[] }): string {
  return `${String(ev.at).trim()}::${ev.items.map((s) => String(s).trim()).join('\u0001')}`;
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
}: {
  toasts: ProfileMemoryToast[];
  onDismiss: (id: string) => void;
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
          className="pointer-events-auto relative rounded-2xl border border-emerald-200/90 bg-emerald-50/98 px-4 py-3 pr-9 text-sm shadow-lg backdrop-blur-sm transition-opacity duration-300"
        >
          <button
            type="button"
            className="absolute right-2 top-2 rounded-full p-1 text-emerald-700/70 hover:bg-emerald-100/90 hover:text-emerald-900"
            aria-label="Dismiss"
            onClick={() => onDismiss(toast.id)}
          >
            <X className="h-4 w-4" />
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Saved to profile memory</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] leading-snug text-emerald-950">
            {toast.items.slice(0, 8).map((line, i) => (
              <li key={`${toast.id}-${i}`}>{line}</li>
            ))}
          </ul>
          {toast.at ? (
            <p className="mt-1.5 text-[10px] text-emerald-800/75">{formatProfileMemoryToastAt(toast.at)}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
