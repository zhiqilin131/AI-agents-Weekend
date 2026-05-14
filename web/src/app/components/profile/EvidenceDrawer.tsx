import { AlertTriangle, CheckCircle2, Clock3, Pencil, Trash2, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { MemoryEvidenceItem } from './memoryEvidenceTypes';
import { cn } from '../ui/utils';

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function evidenceMeta(item: MemoryEvidenceItem): {
  confidenceLabel: string;
  confidenceTone: string;
  stale: boolean;
  dateLabel: string;
} {
  const confidence = typeof item.confidence === 'number' ? item.confidence : null;
  const confidenceLabel =
    confidence == null
      ? 'confidence unknown'
      : confidence >= 0.68
        ? 'high confidence'
        : confidence >= 0.42
          ? 'medium confidence'
          : 'low confidence';
  const confidenceTone =
    confidence == null
      ? 'border-slate-200 bg-slate-50 text-slate-600'
      : confidence >= 0.68
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : confidence >= 0.42
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-red-200 bg-red-50 text-red-800';
  const date = parseDate(item.lastReinforcedAt) || parseDate(item.updatedAt) || parseDate(item.createdAt);
  const ageMs = date ? Date.now() - date.getTime() : 0;
  const stale = Boolean(date && ageMs > 1000 * 60 * 60 * 24 * 180);
  const dateLabel = date
    ? `${stale ? 'possibly stale' : 'recent enough'} · ${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'no timestamp';
  return { confidenceLabel, confidenceTone, stale, dateLabel };
}

export function EvidenceDrawer({
  open,
  onClose,
  items,
  onEdit,
  onFlagWrong,
  onDelete,
  flaggedIds = new Set<string>(),
  className,
}: {
  open: boolean;
  onClose: () => void;
  items: MemoryEvidenceItem[];
  onEdit?: (item: MemoryEvidenceItem) => void;
  onFlagWrong?: (item: MemoryEvidenceItem) => void;
  onDelete?: (item: MemoryEvidenceItem) => void;
  flaggedIds?: Set<string>;
  className?: string;
}) {
  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn('fixed inset-0 z-[80] flex items-end justify-center sm:items-center', className)}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/25 backdrop-blur-[2px]"
        aria-label="Close evidence"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: 24, opacity: 0.96 }}
        animate={{ y: 0, opacity: 1 }}
        className="relative z-10 m-4 max-h-[min(70vh,520px)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/80 bg-white/95 p-4 shadow-2xl backdrop-blur-xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-violet-950">Remembered evidence</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              See what influenced this answer, then correct or remove anything that feels wrong.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-500 transition hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="space-y-3">
          {items.map((it) => {
            const meta = evidenceMeta(it);
            const canEdit = Boolean(onEdit && it.sourceId && it.type === 'profile');
            const canDelete = Boolean(onDelete);
            const flagged = flaggedIds.has(it.id);
            return (
              <li
                key={it.id}
                className={cn(
                  'rounded-2xl border px-3 py-2 transition',
                  flagged ? 'border-amber-200 bg-amber-50/70' : 'border-violet-100/90 bg-violet-50/40',
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="mr-auto text-[10px] font-semibold uppercase tracking-wide text-violet-700">{it.label}</p>
                  <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold', meta.confidenceTone)}>
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {meta.confidenceLabel}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                      meta.stale ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white/80 text-slate-600',
                    )}
                  >
                    <Clock3 className="h-2.5 w-2.5" />
                    {meta.dateLabel}
                  </span>
                  {it.category ? (
                    <span className="rounded-full border border-violet-100 bg-white/80 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                      {it.category}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-800">
                  {(it.fullText || it.shortText).slice(0, 4000)}
                </p>
                {flagged ? (
                  <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800">
                    <AlertTriangle className="h-3 w-3" />
                    Marked questionable for this answer.
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="rounded-full border border-amber-200 bg-white/75 px-2 py-1 text-[10px] font-semibold text-amber-800 transition hover:bg-amber-50"
                    onClick={() => onFlagWrong?.(it)}
                  >
                    This is wrong
                  </button>
                  <button
                    type="button"
                    disabled={!canEdit}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white/75 px-2 py-1 text-[10px] font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => onEdit?.(it)}
                  >
                    <Pencil className="h-3 w-3" />
                    Update
                  </button>
                  <button
                    type="button"
                    disabled={!canDelete}
                    className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white/75 px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => onDelete?.(it)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Don't use
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </motion.div>
    </motion.div>
  );
}
