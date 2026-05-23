import { useEffect, useState } from 'react';
import { ChevronDown, FileText, HeartHandshake, Play, Square } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { BuddyTooltip } from './BuddyTooltip';
import { SLIME_CTA_BTN_CLASS, slimeCtaButtonStyle } from './slimeCtaButton';
import { getSlimeIdentity } from './slimeIdentity';
import { postTherapyEnd, postTherapyStart } from './therapySessionApi';
import {
  therapyReportFromThread,
  therapyStatusFromThread,
  type TherapyReport,
  type TherapyStatus,
} from './therapySession';
import type { ShadowThread } from '../../app/components/shadow/types';
import {
  readTherapySessionDockExpanded,
  writeTherapySessionDockExpanded,
} from './therapySessionDockExpanded';
import { THERAPY_AUDIO_MAX_GAIN, useTherapyAudio } from '../therapyLab/useTherapyAudio';

type Props = {
  threadId: string | null;
  thread: ShadowThread | null;
  disabled?: boolean;
  /** `command` = frosted card for top-right rail; `default` = legacy inline dock. */
  layout?: 'default' | 'command';
  onThreadUpdated: (thread: ShadowThread) => void;
  onOpenReport: (report: TherapyReport) => void;
  onOpenCheckIn: () => void;
  onRequestNewSession?: () => void;
  onTherapyEnded?: (report: TherapyReport) => void;
  className?: string;
};

function sessionStatusLine(
  status: TherapyStatus,
  intakeComplete: boolean,
  hasThread: boolean,
  layout: 'default' | 'command',
): string {
  if (!hasThread) {
    return layout === 'command' ? 'Select or create a session to continue.' : 'Pick a session from the left, or create a new one.';
  }
  if (status === 'ended') return 'View your report or start a new session.';
  if (!intakeComplete) return 'Complete check-in, then start therapy.';
  if (status === 'active') return 'Use the mic when you are ready. End to get your report.';
  return 'Start therapy to unlock voice.';
}

function statusBadge(
  status: TherapyStatus,
  intakeComplete: boolean,
  hasThread: boolean,
): { label: string; className: string } {
  if (!hasThread) {
    return { label: 'No session', className: 'bg-slate-100 text-slate-600 ring-slate-200/80' };
  }
  if (status === 'active') {
    return { label: 'In session', className: 'bg-rose-100 text-rose-900 ring-rose-200/90' };
  }
  if (status === 'ended') {
    return { label: 'Ended', className: 'bg-violet-100/90 text-violet-900 ring-violet-200/80' };
  }
  if (!intakeComplete) {
    return { label: 'Check-in', className: 'bg-amber-100/90 text-amber-900 ring-amber-200/80' };
  }
  return { label: 'Ready', className: 'bg-white/90 text-rose-800 ring-rose-200/80' };
}

export function TherapySessionDock({
  threadId,
  thread,
  disabled = false,
  layout = 'default',
  onThreadUpdated,
  onOpenReport,
  onOpenCheckIn,
  onRequestNewSession,
  onTherapyEnded,
  className,
}: Props) {
  const ident = getSlimeIdentity('wellbeing');
  const {
    volume,
    setVolume,
    startBreathBed,
    updateBreathPhase,
    stopAll,
    resumeContext,
  } = useTherapyAudio();
  const [busy, setBusy] = useState<'start' | 'end' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(() => readTherapySessionDockExpanded());
  const isCommand = layout === 'command';

  useEffect(() => {
    if (isCommand) setExpanded(readTherapySessionDockExpanded());
  }, [isCommand]);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      writeTherapySessionDockExpanded(next);
      return next;
    });
  };

  const status: TherapyStatus = therapyStatusFromThread(thread);
  const intakeComplete = Boolean(
    thread?.therapy_session?.intake_complete ?? thread?.wellbeing_session?.intake_complete,
  );
  const report = therapyReportFromThread(thread);
  const hasThread = Boolean(threadId);
  const sessionActive = hasThread && status === 'active';
  const badge = statusBadge(status, intakeComplete, hasThread);
  const btnBase =
    'inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
  const btnPrimary = SLIME_CTA_BTN_CLASS;
  const btnSecondary =
    'border border-rose-200/90 bg-white/90 text-rose-950 shadow-sm hover:bg-rose-50/95';

  const startTherapy = async () => {
    if (!threadId) {
      onRequestNewSession?.();
      return;
    }
    if (!intakeComplete) {
      onOpenCheckIn();
      return;
    }
    setBusy('start');
    setError(null);
    try {
      const result = await postTherapyStart(threadId);
      if (!result.ok) {
        if (result.needsIntake) {
          onOpenCheckIn();
          return;
        }
        throw new Error(result.error);
      }
      onThreadUpdated(result.thread);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start therapy');
    } finally {
      setBusy(null);
    }
  };

  const endTherapy = async () => {
    if (!threadId) return;
    setBusy('end');
    setError(null);
    try {
      const result = await postTherapyEnd(threadId);
      if (!result.ok) throw new Error(result.error);
      onThreadUpdated(result.thread);
      const rep = result.therapy_report;
      if (rep) {
        onOpenReport(rep);
        onTherapyEnded?.(rep);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end therapy');
    } finally {
      setBusy(null);
    }
  };

  const viewReport = () => {
    const r = therapyReportFromThread(thread);
    if (r) onOpenReport(r);
  };

  useEffect(() => {
    if (!sessionActive) {
      stopAll();
      return;
    }
    void resumeContext();
    startBreathBed();
    // Gentle baseline envelope while the session is active in the dock.
    updateBreathPhase('inhale', 6);
  }, [resumeContext, sessionActive, startBreathBed, stopAll, updateBreathPhase]);

  useEffect(() => () => stopAll(), [stopAll]);

  return (
    <div
      data-testid="therapy-session-dock"
      className={cn(
        isCommand
          ? 'overflow-hidden rounded-[1.35rem] border border-white/60 bg-white/55 shadow-[0_12px_40px_rgba(232,160,176,0.22),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-2xl'
          : 'rounded-2xl border px-3 py-3',
        className,
      )}
      style={
        isCommand
          ? undefined
          : {
              borderColor: ident.theme.border,
              background: `linear-gradient(135deg, ${ident.theme.surface}ee, rgba(255,255,255,0.85))`,
            }
      }
    >
      {isCommand ? (
        <div
          className="border-b border-white/50 px-3.5 py-2"
          style={{
            background: `linear-gradient(135deg, ${ident.theme.surface}cc 0%, rgba(255,255,255,0.75) 100%)`,
          }}
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            aria-controls="therapy-session-dock-body"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white shadow-md"
                style={slimeCtaButtonStyle(ident.theme)}
              >
                <HeartHandshake className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-900/70">
                  Session control
                </p>
                <p className="truncate text-[12px] font-semibold text-rose-950">
                  {hasThread ? thread?.title || 'Therapy session' : 'No thread selected'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1',
                  badge.className,
                )}
              >
                {badge.label}
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-rose-700/80 transition-transform',
                  expanded && 'rotate-180',
                )}
                aria-hidden
              />
            </div>
          </button>
        </div>
      ) : (
        <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-900/80">
          Therapy session
        </p>
      )}

      <div
        id="therapy-session-dock-body"
        className={cn(isCommand ? 'px-3.5 py-3' : '', isCommand && !expanded && 'hidden')}
      >
        {!isCommand ? (
          <p className="mt-1 text-[11px] leading-relaxed text-rose-900/75">
            {sessionStatusLine(status, intakeComplete, hasThread, layout)}
          </p>
        ) : (
          <p className="mb-2.5 text-[11px] leading-relaxed text-rose-900/72">
            {sessionStatusLine(status, intakeComplete, hasThread, layout)}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {hasThread && status !== 'ended' ? (
            <BuddyTooltip
              content={
                intakeComplete
                  ? 'Begin the focused support portion — unlocks voice conversation.'
                  : 'Complete a quick check-in first.'
              }
            >
              <button
                type="button"
                disabled={disabled || busy !== null || status === 'active'}
                className={cn(btnBase, btnPrimary)}
                style={slimeCtaButtonStyle(ident.theme, { muted: status === 'active' })}
                onClick={() => void startTherapy()}
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                {busy === 'start' ? 'Starting…' : status === 'active' ? 'In session' : 'Start therapy'}
              </button>
            </BuddyTooltip>
          ) : null}

          {!hasThread && onRequestNewSession ? (
            <button
              type="button"
              className={cn(btnBase, btnPrimary)}
              style={slimeCtaButtonStyle(ident.theme)}
              onClick={onRequestNewSession}
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              New session
            </button>
          ) : null}

          {hasThread && status === 'active' ? (
            <BuddyTooltip content="End this therapy session and generate your session report.">
              <button
                type="button"
                disabled={disabled || busy !== null}
                className={cn(btnBase, btnSecondary)}
                onClick={() => void endTherapy()}
              >
                <Square className="h-3.5 w-3.5" aria-hidden />
                {busy === 'end' ? 'Ending…' : 'End therapy'}
              </button>
            </BuddyTooltip>
          ) : null}

          {hasThread && (status === 'ended' || report) ? (
            <BuddyTooltip content="Open your therapy session report.">
              <button type="button" className={cn(btnBase, btnSecondary)} onClick={viewReport}>
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Report
              </button>
            </BuddyTooltip>
          ) : null}

          {hasThread && !intakeComplete && status !== 'ended' ? (
            <button type="button" className={cn(btnBase, btnSecondary)} onClick={onOpenCheckIn}>
              Check-in
            </button>
          ) : null}
        </div>
        <div className="mt-2.5 rounded-xl border border-rose-200/70 bg-white/85 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-rose-900">Ambient sound</p>
            <span className="rounded-full border border-rose-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-rose-900">
              Always on
            </span>
          </div>
          <label className="mt-1.5 block text-[10px] text-rose-800/80">
            Volume
            <input
              type="range"
              min={0}
              max={THERAPY_AUDIO_MAX_GAIN}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="mt-1 w-full accent-rose-400"
            />
          </label>
        </div>
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}
