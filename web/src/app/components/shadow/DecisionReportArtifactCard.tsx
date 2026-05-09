import { Calendar, FileText, MessageSquareText, Sparkles } from 'lucide-react';
import { SlimeAdvisor } from '../report/SlimeAdvisor';
import { useSlimeProfile } from '../../../hooks/useSlimeProfile';

export type ArtifactStatus = 'complete' | 'generating' | 'error';

export function DecisionReportArtifactCard({
  decisionId,
  title,
  summary,
  status,
  createdAt,
  onOpenReport,
  onReviseChat,
  onOpenExecutionCalendar,
}: {
  decisionId: string;
  title: string;
  summary: string;
  status: ArtifactStatus;
  createdAt?: string;
  onOpenReport: () => void;
  onReviseChat: () => void;
  onOpenExecutionCalendar: () => void;
}) {
  const { slimeProfile } = useSlimeProfile();
  const pill =
    status === 'complete' ? (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Complete</span>
    ) : status === 'generating' ? (
      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800">Generating</span>
    ) : (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">Error</span>
    );

  return (
    <div className="max-w-[90%] rounded-2xl border border-violet-200/80 bg-gradient-to-br from-white/95 to-violet-50/50 p-4 shadow-[0_8px_28px_rgba(99,102,241,0.12)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-md">
          <FileText className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            {pill}
          </div>
          <p className="mt-1 text-xs text-gray-600 leading-relaxed">{summary || 'Generated from this conversation.'}</p>
          {createdAt ? <p className="mt-1 text-[10px] text-gray-400">{createdAt}</p> : null}
          <div className="mt-1.5">
            <SlimeAdvisor size="sm" profile={slimeProfile} state={status === 'generating' ? 'thinking' : 'idle'} className="scale-[0.7] origin-left" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenReport}
          className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Open report
        </button>
        <button
          type="button"
          onClick={onReviseChat}
          className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-900 hover:bg-violet-50"
        >
          <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
          Revise with chat
        </button>
        <button
          type="button"
          onClick={onOpenExecutionCalendar}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
        >
          <Calendar className="h-3.5 w-3.5" aria-hidden />
          Execution calendar
        </button>
      </div>
      <p className="mt-2 text-[10px] text-gray-400 truncate" title={decisionId}>
        ID: {decisionId.slice(0, 8)}…
      </p>
    </div>
  );
}
