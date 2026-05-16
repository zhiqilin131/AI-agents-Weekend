import { AlertTriangle } from 'lucide-react';

export function DegradedModeBanner({
  messages,
  title = 'Degraded mode',
  className = '',
}: {
  messages: string[];
  title?: string;
  className?: string;
}) {
  if (messages.length === 0) return null;
  return (
    <div
      role="alert"
      className={`rounded-xl border-2 border-amber-400/90 bg-gradient-to-r from-amber-50 via-amber-50/95 to-orange-50 px-4 py-3 text-sm text-amber-950 shadow-[0_4px_20px_rgba(245,158,11,0.15)] ${className}`}
    >
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold tracking-tight">{title}</p>
          <p className="mt-0.5 text-xs text-amber-900/90">
            Some steps used fallback logic instead of the full LLM pipeline. Results may be generic — check your API
            key and restart the server if this was unexpected.
          </p>
          <ul className="mt-2 space-y-1 text-xs font-medium">
            {messages.map((w) => (
              <li key={w} className="leading-snug">
                {w}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
