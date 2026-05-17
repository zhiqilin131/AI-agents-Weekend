import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Agent3DCompanion } from './Agent3DCompanion';
import type { AgentStatus, ShadowSuggestion } from './types';
import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';

/** Short line under companion — plain language */
const statusRibbon: Record<AgentStatus, string> = {
  idle: 'Ready when you are.',
  reading_memory: 'Gathering context…',
  thinking: 'Thinking it through…',
  responding: 'Writing a reply…',
  updating_profile: 'Saving what matters for later…',
  decision_detected: 'This feels like a decision moment.',
  report_generating: 'Building your report…',
  report_complete: 'Report is ready.',
  report_open: 'Report open alongside chat.',
  scheduling: 'Working with your calendar…',
  error: 'Something paused — you can try again.',
};

const statusHint: Record<AgentStatus, string> = {
  idle: 'Standing by for your next request.',
  reading_memory: "I'm reading relevant memory before responding.",
  thinking: "I'm weighing options and trade-offs.",
  responding: "I'm composing the response now.",
  updating_profile: "I'm updating long-term profile signals.",
  decision_detected: "I've detected a decision moment in your thread.",
  report_generating: "I'm assembling the decision report trace.",
  report_complete: 'The report is complete and ready to inspect.',
  report_open: 'The report panel is open for review.',
  scheduling: "I'm aligning available time blocks for execution.",
  error: 'A recoverable issue happened. Retry when ready.',
};

export type ActivityStep = { label: string; state: 'done' | 'active' | 'pending' };

/** @deprecated Kept for tests / tooling — UI uses fade feed instead */
export function buildActivitySteps(status: AgentStatus): ActivityStep[] {
  if (status === 'scheduling') {
    return [
      { label: 'Message received', state: 'done' },
      { label: 'Reading memory', state: 'done' },
      { label: 'Thinking', state: 'done' },
      { label: 'Scheduling', state: 'active' },
    ];
  }

  const rank: Record<AgentStatus, number> = {
    idle: 0,
    reading_memory: 1,
    thinking: 2,
    responding: 3,
    updating_profile: 4,
    decision_detected: 5,
    report_generating: 6,
    report_complete: 7,
    report_open: 7,
    scheduling: 4,
    error: 0,
  };
  const current = rank[status];
  const labels = ['Message received', 'Reading memory', 'Thinking', 'Responding'];
  return labels.map((label, idx) => {
    const stepRank = idx;
    if (status === 'error') return { label, state: idx === 0 ? 'active' : 'pending' };
    if (current > stepRank) return { label, state: 'done' };
    if (current === stepRank) return { label, state: 'active' };
    return { label, state: 'pending' };
  });
}

type FeedLine = { id: string; text: string; visible: boolean; createdAt: number };

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Map timeline crumbs to human lines; skip timings and noise */
function timelineToFeedLine(entry: string): string | null {
  const t = entry.trim();
  if (!t) return null;
  if (/\b\d+\s*ms\b/i.test(t)) return null;
  if (/response\s+\d/i.test(t)) return null;
  const lower = t.toLowerCase();
  if (lower === 'ready') return null;
  if (lower === 'reading memory') return null;
  if (lower === 'generating report') return 'Putting your decision report together.';
  if (lower === 'report complete') return 'All set — your report is ready to open.';
  if (lower.includes('execution calendar updated')) return 'Your calendar picked up those changes.';
  if (lower.includes('connection lost') || lower.includes('stream interrupted'))
    return 'Connection stuttered — send again whenever you like.';
  if (lower.includes('stream ended')) return 'That pass finished a little early.';
  if (/^[a-z0-9_\s-]+$/.test(lower) && lower.length < 40 && lower.includes('_')) return null;
  if (t.length > 100) return null;
  return null;
}

function statusPrimaryFeedLine(status: AgentStatus): string | null {
  switch (status) {
    case 'reading_memory':
      return 'Taking a quiet look at what you’ve shared before.';
    case 'thinking':
      return 'Connecting this to what matters for you.';
    case 'responding':
      return 'Turning it into something you can read.';
    case 'scheduling':
      return 'Sketching how this could land on your calendar.';
    case 'report_generating':
      return 'Laying out paths and consequences.';
    case 'decision_detected':
      return 'Feels like a choice worth slowing down for.';
    case 'updating_profile':
      return 'Keeping the useful bits for next time.';
    case 'report_complete':
      return 'Report’s ready when you are.';
    case 'report_open':
      return 'Report’s open — tweak as you like.';
    case 'error':
      return 'Hit a snag — nothing lost; try again.';
    default:
      return null;
  }
}

export function AgentPresence3DPanel({
  status,
  timeline,
  suggestion,
  onGenerateReport,
  generateReportDisabled = false,
  forceFallback = false,
  reportOverlaySession = null,
}: {
  status: AgentStatus;
  timeline: string[];
  suggestion?: ShadowSuggestion | null;
  onGenerateReport?: () => void;
  /** True while clarification gate runs or card is open — avoids duplicate clicks with no feedback */
  generateReportDisabled?: boolean;
  forceFallback?: boolean;
  /** Decision-report overlay is open — keep a persistent session card until the user closes it */
  reportOverlaySession?: { streaming: boolean; progressStep: string } | null;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [feedLines, setFeedLines] = useState<FeedLine[]>([]);
  const timeoutsRef = useRef<number[]>([]);
  const readingBurstRef = useRef(0);
  const prevTimelineLen = useRef(timeline.length);

  const appendFeedLine = useCallback((text: string) => {
    const now = Date.now();
    const id = `${now}-${Math.random().toString(36).slice(2, 9)}`;
    setFeedLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.text === text && now - last.createdAt < 1200) return prev;
      return [...prev.slice(-12), { id, text, visible: true, createdAt: now }];
    });
    const fadeAt = window.setTimeout(() => {
      setFeedLines((p) => p.map((l) => (l.id === id ? { ...l, visible: false } : l)));
    }, 3200);
    const removeAt = window.setTimeout(() => {
      setFeedLines((p) => p.filter((l) => l.id !== id));
    }, 4200);
    timeoutsRef.current.push(fadeAt, removeAt);
  }, []);

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((x) => window.clearTimeout(x));
      timeoutsRef.current = [];
    };
  }, []);

  /** Status transitions → primary natural line */
  const prevStatus = useRef<AgentStatus | null>(null);
  useEffect(() => {
    if (prevStatus.current === null) {
      prevStatus.current = status;
      const line = statusPrimaryFeedLine(status);
      if (line) appendFeedLine(line);
      return;
    }
    if (prevStatus.current === status) return;
    prevStatus.current = status;
    const line = statusPrimaryFeedLine(status);
    if (line) appendFeedLine(line);
  }, [status, appendFeedLine]);

  /** Extra beats while still “reading” — feels alive */
  useEffect(() => {
    if (status !== 'reading_memory') return;
    readingBurstRef.current += 1;
    const burst = readingBurstRef.current;
    const patterns = [2, 3, 4][Math.floor(Math.random() * 3)]!;
    const t1 = window.setTimeout(() => {
      if (burst !== readingBurstRef.current) return;
      appendFeedLine(`Found ${patterns} earlier threads that still feel relevant.`);
    }, 650);
    const t2 = window.setTimeout(() => {
      if (burst !== readingBurstRef.current) return;
      appendFeedLine(pick(['Setting the scene before answering.', 'Pulling anything that rhymes with this moment.']));
    }, 1500);
    timeoutsRef.current.push(t1, t2);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [status, appendFeedLine]);

  useEffect(() => {
    if (status !== 'thinking') return;
    const t = window.setTimeout(() => appendFeedLine('Weighing a few sensible next steps.'), 550);
    timeoutsRef.current.push(t);
    return () => window.clearTimeout(t);
  }, [status, appendFeedLine]);

  /** Timeline — only curated friendly lines */
  useEffect(() => {
    if (timeline.length <= prevTimelineLen.current) {
      prevTimelineLen.current = timeline.length;
      return;
    }
    const last = timeline[timeline.length - 1];
    prevTimelineLen.current = timeline.length;
    const natural = timelineToFeedLine(last);
    if (natural) appendFeedLine(natural);
  }, [timeline, appendFeedLine]);

  const ribbon = useMemo(() => statusRibbon[status], [status]);

  /** Hide duplicate generate CTAs while the report overlay is open or already finished. */
  const showDecisionReportCta =
    suggestion?.type === 'decision_report' &&
    !reportOverlaySession &&
    !['report_generating', 'report_complete'].includes(status);
  const companionMode =
    status === 'idle' && suggestion?.type === 'decision_report' ? 'decision_detected' : status;

  return (
    <aside
      data-agent-status={status}
      className="rounded-3xl border border-white/90 bg-white/65 p-4 shadow-[0_10px_28px_rgba(99,102,241,0.10)] backdrop-blur-md"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Shadow Chat</p>
        </div>
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500/90 shadow-[0_0_12px_rgba(99,102,241,0.9)]" />
      </div>

      <div className="mt-3">
        <Agent3DCompanion
          mode={companionMode}
          onToggleTooltip={() => setTooltipOpen((s) => !s)}
          forceFallback={forceFallback}
        />
      </div>

      <div
        className="mt-3 min-h-[4.5rem] space-y-2"
        aria-live="polite"
        aria-label="What the assistant is doing"
      >
        {feedLines.map((line) => (
          <p
            key={line.id}
            className={`text-[11px] leading-snug text-gray-600 transition-opacity duration-[650ms] ease-out ${
              line.visible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {line.text}
          </p>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-indigo-100/60 pt-3">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === 'idle' ? 'bg-gray-300' : 'animate-pulse bg-indigo-400'}`}
          aria-hidden
        />
        <p className="text-xs text-gray-500">{ribbon}</p>
      </div>

      {tooltipOpen ? (
        <div className="mt-2 rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2 text-xs text-violet-900">
          {statusHint[status]}
        </div>
      ) : null}

      {reportOverlaySession ? (
        <div className="mt-4 rounded-xl border border-violet-200/90 bg-gradient-to-br from-violet-50/95 to-indigo-50/80 p-3 shadow-[0_8px_24px_rgba(99,102,241,0.12)]">
          <div className="flex items-center gap-2 text-violet-950">
            <Sparkles size={14} className="shrink-0 text-violet-600" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-wide">
              {reportOverlaySession.streaming ? 'Report generating' : 'Report session'}
            </p>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-violet-900/95">
            {reportOverlaySession.streaming
              ? reportOverlaySession.progressStep
              : 'Full report is in the overlay. Close it when you are done reviewing.'}
          </p>
        </div>
      ) : null}

      {showDecisionReportCta ? (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/70 p-3">
          <div className="flex items-center gap-2 text-amber-900">
            <Sparkles size={14} />
            <p className="text-xs font-semibold uppercase tracking-wide">Decision detected</p>
          </div>
          <p className="mt-1 text-xs text-amber-900/90">{suggestion.message || 'A high-value decision moment was detected.'}</p>
          <BuddyTooltip content="Run the decision report flow from the last user message in this thread.">
            <button
              type="button"
              disabled={generateReportDisabled}
              className="mt-2 w-full rounded-lg bg-amber-500/90 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onGenerateReport}
            >
              Generate report
            </button>
          </BuddyTooltip>
        </div>
      ) : null}
    </aside>
  );
}
