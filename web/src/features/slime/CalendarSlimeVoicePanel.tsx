import { useState } from 'react';
import type { SlimeProfile } from '../../app/model';
import { SlimeAdvisor, type SlimeAdvisorState } from '../../app/components/report/SlimeAdvisor';
import { SlimeVoiceAgent } from './SlimeVoiceAgent';
import { cn } from '../../app/components/ui/utils';

type CalendarSlimeVoicePanelProps = {
  slimeProfile: SlimeProfile;
  eventCount: number;
  threadId?: string;
  onThreadId?: (id: string) => void;
  className?: string;
};

const DEFAULT_STATUS =
  'Tap the mic to add, move, or delete events. I will show a confirm card before saving.';

export function CalendarSlimeVoicePanel({
  slimeProfile,
  eventCount,
  threadId,
  onThreadId,
  className,
}: CalendarSlimeVoicePanelProps) {
  const [advisorState, setAdvisorState] = useState<SlimeAdvisorState>('idle');
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const bubbleText = statusLine?.trim() || DEFAULT_STATUS;

  return (
    <section
      className={cn(
        'relative flex flex-col overflow-hidden rounded-[28px] border border-white/90 bg-white/65 p-4 shadow-[0_16px_42px_rgba(99,102,241,0.09)] backdrop-blur-md',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_16%,rgba(255,255,255,0.95),transparent_30%),radial-gradient(circle_at_50%_45%,rgba(139,92,246,0.16),transparent_55%)]" />

      <div className="relative z-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-violet-500/90">Calendar Slime</p>
        <p className="mt-1 text-sm font-semibold text-slate-950">
          {eventCount} event{eventCount === 1 ? '' : 's'} this week
        </p>
      </div>

      {/* Row: slime (left) / speech bubble (right) */}
      <div className="relative z-10 mt-4 flex min-h-[7.5rem] items-start gap-2">
        <div className="relative flex h-[7.25rem] w-[6.25rem] shrink-0 items-start justify-center pt-0.5">
          <SlimeAdvisor
            size="md"
            profile={slimeProfile}
            state={advisorState}
            companionMode
            className="scale-[0.94]"
          />
        </div>

        <div className="min-w-0 flex-1 self-center pl-0.5">
          <div className="slime-comic-bubble slime-comic-bubble-calendar pointer-events-auto relative z-20">
            <p className="break-words text-[12px] font-medium leading-snug text-slate-800">{bubbleText}</p>
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-3 min-h-[5.5rem]">
        <SlimeVoiceAgent
          variant="calendar"
          slimeProfile={slimeProfile}
          currentRoute="/execution"
          threadId={threadId}
          onThreadId={onThreadId}
          onAdvisorStateChange={setAdvisorState}
          onCalendarStatusLine={setStatusLine}
          hideModelSelector
          className="!static !relative !bottom-0 !left-0 !right-0 !w-full !translate-x-0"
        />
      </div>
    </section>
  );
}
