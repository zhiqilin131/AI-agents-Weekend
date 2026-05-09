import { X } from 'lucide-react';
import type { EvidenceReference } from '../../model';
import type { EvidenceDetailContent } from '../../../utils/evidenceDetailFromTrace';
import { cn } from '../ui/utils';

export function EvidenceDetailPopover({
  reference,
  content,
  onClose,
}: {
  reference: EvidenceReference;
  content: EvidenceDetailContent;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-detail-title"
      onClick={onClose}
    >
      <div
        className={cn(
          'relative w-full max-w-md max-h-[min(85vh,520px)] overflow-y-auto rounded-2xl border border-violet-200/90',
          'bg-white shadow-2xl shadow-violet-900/10',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="border-b border-violet-100 bg-gradient-to-br from-violet-50/90 to-white px-4 pb-3 pt-4 pr-12">
          <p id="evidence-detail-title" className="text-sm font-bold text-gray-900">
            {content.title}
          </p>
          {content.subtitle ? <p className="mt-1 text-[11px] text-violet-800/90">{content.subtitle}</p> : null}
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            {reference.type.replace(/_/g, ' ')}
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          {content.sections.map((s, i) => (
            <div key={`${s.label}-${i}`} className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{s.label}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
