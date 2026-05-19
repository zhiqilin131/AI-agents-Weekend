import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { getSlimeIdentity, type SlimeType } from './slimeIdentity';
import { BUDDY_THREAD_LONG_MESSAGE_THRESHOLD } from './buddyThreadLimits';

export type BuddyLongThreadBannerProps = {
  slimeType: SlimeType;
  messageCount: number;
  onStartFresh: () => void;
  onDismiss: () => void;
  className?: string;
};

export function BuddyLongThreadBanner({
  slimeType,
  messageCount,
  onStartFresh,
  onDismiss,
  className,
}: BuddyLongThreadBannerProps) {
  const ident = getSlimeIdentity(slimeType);
  const freshLabel = slimeType === 'wellbeing' ? 'New therapy session' : 'New chat';

  return (
    <motion.div
      role="status"
      data-testid="buddy-long-thread-banner"
      className={cn(
        'flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-left shadow-sm backdrop-blur-md sm:px-4',
        className,
      )}
      style={{
        borderColor: `${ident.theme.border}99`,
        background: `linear-gradient(135deg, ${ident.theme.surface}ee, ${ident.theme.background}f5)`,
        boxShadow: `0 8px 24px ${ident.theme.glow}`,
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-900 sm:text-sm">This conversation is getting long</p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-600 sm:text-xs">
          {messageCount} messages in this thread — more than {BUDDY_THREAD_LONG_MESSAGE_THRESHOLD}.
          Start {freshLabel} for a snappier session; older threads stay in the list on the right.
        </p>
        <button
          type="button"
          onClick={onStartFresh}
          className="mt-2.5 inline-flex items-center justify-center rounded-full px-3.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-105"
          style={{
            background: `linear-gradient(135deg, ${ident.theme.ctaFrom}, ${ident.theme.ctaTo})`,
            boxShadow: `0 4px 14px ${ident.theme.ctaGlow}`,
          }}
        >
          {freshLabel}
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss long conversation reminder"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/90 text-slate-500 transition hover:bg-white hover:text-slate-800"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </motion.div>
  );
}
