import { TherapyBuddyGuidanceStrip } from './TherapyBuddyGuidanceStrip';
import { TherapySessionDock } from './TherapySessionDock';
import type { ShadowThread } from '../../app/components/shadow/types';
import type { TherapyReport } from './therapySession';
import { canUseWellbeingBuddyVoice } from './therapySession';
import { getSlimeIdentity } from './slimeIdentity';

type Props = {
  gateHint: string | null;
  threadId: string | null;
  thread: ShadowThread | null;
  disabled?: boolean;
  onRequestNewSession: () => void;
  onThreadUpdated: (thread: ShadowThread) => void;
  onOpenReport: (report: TherapyReport) => void;
  onOpenCheckIn: () => void;
  onTherapyEnded?: (report: TherapyReport) => void;
};

/** Top-right therapy controls: guidance strip + session command card. */
export function TherapyBuddyTopRail({
  gateHint,
  threadId,
  thread,
  disabled,
  onRequestNewSession,
  onThreadUpdated,
  onOpenReport,
  onOpenCheckIn,
  onTherapyEnded,
}: Props) {
  const ident = getSlimeIdentity('wellbeing');
  const inSession = canUseWellbeingBuddyVoice(thread);
  /** Amber strip only nudges picking/creating a session; dock + intake handle the rest. */
  const showGuidanceStrip = Boolean(gateHint) && !threadId;

  return (
    <div
      data-testid="therapy-buddy-top-rail"
      data-slime-avoid
      className="pointer-events-auto flex w-full max-w-full flex-col gap-2.5"
    >
      {showGuidanceStrip ? <TherapyBuddyGuidanceStrip message={gateHint!} /> : null}

      {!gateHint && inSession ? (
        <div
          className="flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-3 py-1.5 text-[11px] font-semibold text-emerald-900 shadow-sm backdrop-blur-md"
          style={{ boxShadow: `0 2px 12px ${ident.theme.glow}` }}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live session — mic open
        </div>
      ) : null}

      <TherapySessionDock
        threadId={threadId}
        thread={thread}
        disabled={disabled}
        layout="command"
        onRequestNewSession={onRequestNewSession}
        onThreadUpdated={onThreadUpdated}
        onOpenReport={onOpenReport}
        onOpenCheckIn={onOpenCheckIn}
        onTherapyEnded={onTherapyEnded}
      />
    </div>
  );
}
