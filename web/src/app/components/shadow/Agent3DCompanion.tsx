import { SlimeAdvisor, type SlimeAdvisorState } from '../report/SlimeAdvisor';
import { useSlimeProfile } from '../../../hooks/useSlimeProfile';
import { getSlimeIdentity, type SlimeType } from '../../../features/slime/slimeIdentity';
import type { AgentStatus } from './types';

export type AgentMode =
  | 'idle'
  | 'reading_memory'
  | 'thinking'
  | 'responding'
  | 'updating_profile'
  | 'decision_detected'
  | 'report_generating'
  | 'report_complete'
  | 'scheduling'
  | 'error'
  | 'report_open';

type BuddyMood = {
  label: string;
  advisorState: SlimeAdvisorState;
};

const MOODS: Record<AgentMode, BuddyMood> = {
  idle: { label: 'Ready', advisorState: 'idle' },
  reading_memory: { label: 'Reading notes', advisorState: 'thinking' },
  thinking: { label: 'Thinking', advisorState: 'thinking' },
  responding: { label: 'Replying', advisorState: 'speaking' },
  updating_profile: { label: 'Saving context', advisorState: 'thinking' },
  decision_detected: { label: 'Decision moment', advisorState: 'celebrating' },
  report_generating: { label: 'Building report', advisorState: 'thinking' },
  report_complete: { label: 'Report ready', advisorState: 'celebrating' },
  report_open: { label: 'Reviewing report', advisorState: 'idle' },
  scheduling: { label: 'Scheduling', advisorState: 'thinking' },
  error: { label: 'Paused', advisorState: 'cautious' },
};

function BuddyStyleSlimeScene({
  mood,
  slimeType,
  forceFallback,
}: {
  mood: BuddyMood;
  slimeType: SlimeType;
  forceFallback: boolean;
}) {
  const { slimeProfile } = useSlimeProfile();
  const ident = getSlimeIdentity(slimeType);

  return (
    <div
      className="relative flex h-full min-h-[200px] w-full items-center justify-center overflow-hidden"
      data-slime-type={slimeType}
      aria-label={mood.label}
      style={{
        background: '#ffffff',
      }}
    >
      <SlimeAdvisor
        state={mood.advisorState}
        size="lg"
        profile={slimeProfile}
        slimeType={slimeType}
        companionMode
        force2D={forceFallback}
      />
    </div>
  );
}

export function Agent3DCompanion({
  mode,
  slimeType = 'generalized',
  onToggleTooltip,
  disableSceneClick = false,
  forceFallback = false,
}: {
  mode: AgentStatus;
  slimeType?: SlimeType;
  onToggleTooltip?: () => void;
  forceFallback?: boolean;
  /** When true, scene is not a button (rail handles tooltip). */
  disableSceneClick?: boolean;
}) {
  const mappedMode = (mode === 'report_open' ? 'report_open' : mode) as AgentMode;
  const mood = MOODS[mappedMode] ?? MOODS.idle;
  const ident = getSlimeIdentity(slimeType);

  const scene = <BuddyStyleSlimeScene mood={mood} slimeType={slimeType} forceFallback={forceFallback} />;

  const frameStyle = {
    borderColor: ident.theme.border,
    background: '#ffffff',
  };

  if (disableSceneClick) {
    return (
      <div
        className="h-[240px] w-full overflow-hidden rounded-2xl border shadow-sm"
        style={frameStyle}
        aria-label={`${ident.shortName} companion`}
      >
        {scene}
      </div>
    );
  }

  return (
    <div
      className="h-[240px] w-full overflow-hidden rounded-2xl border shadow-sm"
      style={frameStyle}
      onClick={onToggleTooltip}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onToggleTooltip?.();
      }}
      aria-label={`${ident.shortName} companion`}
    >
      {scene}
    </div>
  );
}
