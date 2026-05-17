import { FileText, Sparkles } from 'lucide-react';
import { cn } from '../ui/utils';
import { SlimeAdvisor } from '../report/SlimeAdvisor';
import { useSlimeProfile } from '../../../hooks/useSlimeProfile';
import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';
import { getSlimeIdentity } from '../../../features/slime/slimeIdentity';
import { SLIME_CTA_BTN_CLASS, slimeCtaButtonStyle } from '../../../features/slime/slimeCtaButton';
import type { ArtifactStatus } from './DecisionReportArtifactCard';

export function TherapyReportArtifactCard({
  title,
  summary,
  status,
  createdAt,
  onOpenReport,
}: {
  title: string;
  summary: string;
  status: ArtifactStatus;
  createdAt?: string;
  onOpenReport: () => void;
}) {
  const { slimeProfile } = useSlimeProfile();
  const theme = getSlimeIdentity('wellbeing').theme;
  const pill =
    status === 'complete' ? (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-900">
        Complete
      </span>
    ) : status === 'generating' ? (
      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
        Generating
      </span>
    ) : (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">Error</span>
    );

  return (
    <div
      className="max-w-[90%] rounded-2xl border p-4 shadow-[0_8px_28px_rgba(244,114,182,0.12)]"
      style={{
        borderColor: theme.border,
        background: `linear-gradient(135deg, rgba(255,255,255,0.97), ${theme.surface}cc)`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-md"
          style={slimeCtaButtonStyle(theme)}
        >
          <FileText className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold" style={{ color: theme.heading }}>
              {title}
            </p>
            {pill}
          </div>
          <p className="mt-1 text-xs text-gray-600 leading-relaxed">
            {summary || 'Generated from this therapy session.'}
          </p>
          {createdAt ? <p className="mt-1 text-[10px] text-gray-400">{createdAt}</p> : null}
          <div className="mt-1.5">
            <SlimeAdvisor
              size="sm"
              profile={slimeProfile}
              slimeType="wellbeing"
              state={status === 'generating' ? 'thinking' : 'idle'}
              className="scale-[0.7] origin-left"
            />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <BuddyTooltip content="Open the full therapy session report.">
          <button
            type="button"
            onClick={onOpenReport}
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs', SLIME_CTA_BTN_CLASS)}
            style={slimeCtaButtonStyle(theme)}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Open report
          </button>
        </BuddyTooltip>
      </div>
    </div>
  );
}
