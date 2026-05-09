import { AlertTriangle } from 'lucide-react';

export function CalendarConflictCard({
  message,
  severity,
}: {
  message: string;
  severity?: string;
}) {
  const tone =
    severity === 'high'
      ? 'border-red-200 bg-red-50/90 text-red-950'
      : severity === 'medium'
        ? 'border-amber-200 bg-amber-50/90 text-amber-950'
        : 'border-slate-200 bg-slate-50/90 text-slate-900';
  return (
    <div className={`flex gap-2 rounded-xl border px-3 py-2 text-xs ${tone}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
      <p className="leading-relaxed">{message}</p>
    </div>
  );
}
