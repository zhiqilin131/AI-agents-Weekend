import { X } from 'lucide-react';
import { motion } from 'motion/react';
import type { MemoryEvidenceItem } from './memoryEvidenceTypes';
import { cn } from '../ui/utils';

export function EvidenceDrawer({
  open,
  onClose,
  items,
  className,
}: {
  open: boolean;
  onClose: () => void;
  items: MemoryEvidenceItem[];
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-violet-950">Evidence</h2>
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
          {items.map((it) => (
            <li key={it.id} className="rounded-2xl border border-violet-100/90 bg-violet-50/40 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">{it.label}</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-800">
                {(it.fullText || it.shortText).slice(0, 4000)}
              </p>
            </li>
          ))}
        </ul>
      </motion.div>
    </motion.div>
  );
}
