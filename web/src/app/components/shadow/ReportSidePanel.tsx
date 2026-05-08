import { DecisionReportPanel } from '../DecisionReportPanel';

export function ReportSidePanel({
  open,
  trace,
  onClose,
}: {
  open: boolean;
  trace: Record<string, unknown> | null;
  onClose: () => void;
}) {
  return <DecisionReportPanel open={open} trace={trace} onClose={onClose} />;
}

