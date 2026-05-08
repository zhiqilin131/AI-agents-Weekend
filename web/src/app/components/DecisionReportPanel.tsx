import { ReportCompact } from './ReportCompact';
import { mapTraceToReport } from '../../utils/mapTrace';

export function DecisionReportPanel({
  trace,
  open,
  onClose,
}: {
  trace: Record<string, unknown> | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || !trace) return null;
  const report = mapTraceToReport(trace);
  return (
    <div className="fixed inset-0 z-40 bg-black/35 p-4">
      <div className="mx-auto mt-4 max-h-[92vh] w-[min(1200px,96vw)] overflow-auto rounded-2xl border border-white/80 bg-white p-4">
        <div className="mb-3 flex justify-end">
          <button type="button" className="rounded-full border border-gray-300 px-4 py-2 text-sm" onClick={onClose}>
            Close report
          </button>
        </div>
        <ReportCompact report={report} fullTrace={trace} />
      </div>
    </div>
  );
}

