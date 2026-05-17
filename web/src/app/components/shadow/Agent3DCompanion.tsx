import type { CSSProperties } from 'react';
import { SlimeAdvisor, type SlimeAdvisorState } from '../report/SlimeAdvisor';
import { useSlimeProfile } from '../../../hooks/useSlimeProfile';
import { slimeThemePalette } from '../../../features/slime/slimeThemePalette';
import { getSlimeIdentity, studioBackgroundStyle, type SlimeType } from '../../../features/slime/slimeIdentity';
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

type StudioMood = {
  label: string;
  accent: string;
  glow: string;
  desk: string;
  aura: 'soft' | 'scan' | 'questions' | 'rings' | 'spark' | 'error';
  advisorState: SlimeAdvisorState;
};

const MOODS: Record<AgentMode, StudioMood> = {
  idle: {
    label: 'Ready at the desk',
    accent: '#6d6af6',
    glow: 'rgba(99, 102, 241, 0.32)',
    desk: '#d9ddff',
    aura: 'soft',
    advisorState: 'idle',
  },
  reading_memory: {
    label: 'Reading notes',
    accent: '#0ea5e9',
    glow: 'rgba(14, 165, 233, 0.30)',
    desk: '#cdeeff',
    aura: 'scan',
    advisorState: 'thinking',
  },
  thinking: {
    label: 'Puzzling through it',
    accent: '#d946ef',
    glow: 'rgba(217, 70, 239, 0.28)',
    desk: '#ead8ff',
    aura: 'questions',
    advisorState: 'thinking',
  },
  responding: {
    label: 'Writing back',
    accent: '#3b82f6',
    glow: 'rgba(59, 130, 246, 0.28)',
    desk: '#dbeafe',
    aura: 'spark',
    advisorState: 'speaking',
  },
  updating_profile: {
    label: 'Saving useful context',
    accent: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.30)',
    desk: '#e9d5ff',
    aura: 'scan',
    advisorState: 'thinking',
  },
  decision_detected: {
    label: 'Decision moment spotted',
    accent: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.32)',
    desk: '#fde68a',
    aura: 'rings',
    advisorState: 'celebrating',
  },
  report_generating: {
    label: 'Building the report',
    accent: '#7c3aed',
    glow: 'rgba(124, 58, 237, 0.34)',
    desk: '#ddd6fe',
    aura: 'rings',
    advisorState: 'thinking',
  },
  report_complete: {
    label: 'Report ready',
    accent: '#6366f1',
    glow: 'rgba(99, 102, 241, 0.24)',
    desk: '#dbeafe',
    aura: 'soft',
    advisorState: 'celebrating',
  },
  report_open: {
    label: 'Reviewing the report',
    accent: '#6366f1',
    glow: 'rgba(99, 102, 241, 0.22)',
    desk: '#dbeafe',
    aura: 'soft',
    advisorState: 'idle',
  },
  scheduling: {
    label: 'Arranging the calendar',
    accent: '#0284c7',
    glow: 'rgba(2, 132, 199, 0.28)',
    desk: '#bae6fd',
    aura: 'scan',
    advisorState: 'thinking',
  },
  error: {
    label: 'Paused for a retry',
    accent: '#ea580c',
    glow: 'rgba(234, 88, 12, 0.30)',
    desk: '#fed7aa',
    aura: 'error',
    advisorState: 'cautious',
  },
};

function QuestionMarks({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="slime-studio-questions" aria-hidden="true">
      <span>?</span>
      <span className="delay-1">?</span>
      <span className="delay-2">?</span>
    </div>
  );
}

function StudioScene({ mood, slimeType }: { mood: StudioMood; slimeType: SlimeType }) {
  const { slimeProfile } = useSlimeProfile();
  const t = slimeThemePalette(slimeProfile, slimeType);
  const ident = getSlimeIdentity(slimeType);
  const cssVars = {
    '--slime-studio-accent': ident.theme.accent,
    '--slime-studio-glow': t.glow,
    '--slime-studio-desk': mood.desk,
    '--slime-studio-profile-a': t.a,
    '--slime-studio-profile-b': t.b,
    '--slime-studio-profile-c': t.c,
    '--slime-studio-deep': t.deep,
  } as CSSProperties;

  return (
    <div className="slime-studio-frame" data-slime-type={slimeType} style={cssVars}>
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          background:
            slimeType === 'wellbeing'
              ? 'transparent'
              : studioBackgroundStyle(slimeType),
        }}
      />
      <div
        className="absolute left-6 top-6 h-12 w-12 rounded-full"
        style={{ backgroundColor: ident.theme.highlight }}
        aria-hidden="true"
      />
      <div
        className="absolute right-10 top-8 h-5 w-5 rounded-full blur-[1px]"
        style={{ backgroundColor: ident.theme.secondary }}
        aria-hidden="true"
      />
      <div
        className="absolute right-16 top-12 h-2.5 w-2.5 rounded-full opacity-70"
        style={{ backgroundColor: ident.theme.accent }}
        aria-hidden="true"
      />
      <div className={`slime-studio-aura slime-studio-aura-${mood.aura}`} aria-hidden="true" />
      <QuestionMarks show={mood.aura === 'questions'} />
      {mood.aura === 'rings' ? (
        <>
          <span className="slime-studio-ring" aria-hidden="true" />
          <span className="slime-studio-ring slime-studio-ring-late" aria-hidden="true" />
        </>
      ) : null}
      {mood.aura === 'scan' ? <span className="slime-studio-scan" aria-hidden="true" /> : null}
      {mood.aura === 'error' ? <span className="slime-studio-error-streak" aria-hidden="true" /> : null}

      <div className="slime-studio-advisor-wrap" aria-label={mood.label}>
        <SlimeAdvisor
          state={mood.advisorState}
          size="lg"
          profile={slimeProfile}
          slimeType={slimeType}
          companionMode
          studioScene
        />
      </div>

      <div className="slime-studio-desk" aria-hidden="true">
        <span className="slime-studio-paper slime-studio-paper-left" />
        <span className="slime-studio-paper slime-studio-paper-right" />
        <span className="slime-studio-note" />
      </div>

      {mood.aura === 'spark' ? (
        <div className="slime-studio-typing" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : null}
    </div>
  );
}

export function Agent3DCompanion({
  mode,
  slimeType = 'generalized',
  onToggleTooltip,
  disableSceneClick = false,
}: {
  mode: AgentStatus;
  slimeType?: SlimeType;
  onToggleTooltip?: () => void;
  forceFallback?: boolean;
  /** When true, scene is not a button (rail handles tooltip). */
  disableSceneClick?: boolean;
}) {
  const mappedMode = (mode === 'report_open' ? 'report_open' : mode) as AgentMode;
  const baseMood = MOODS[mappedMode] ?? MOODS.idle;
  const ident = getSlimeIdentity(slimeType);
  const mood: StudioMood = {
    ...baseMood,
    accent: ident.theme.accent,
    glow: ident.theme.glow,
    desk: ident.theme.surface,
  };

  const scene = <StudioScene mood={mood} slimeType={slimeType} />;

  if (disableSceneClick) {
    return (
      <div
        className="h-[220px] w-full overflow-hidden rounded-2xl border shadow-sm"
        style={{
          borderColor: ident.theme.border,
          background: studioBackgroundStyle(slimeType),
        }}
        aria-label={`${ident.shortName} companion`}
      >
        {scene}
      </div>
    );
  }

  return (
    <div
      className="h-[220px] w-full overflow-hidden rounded-2xl border shadow-sm"
      style={{
        borderColor: ident.theme.border,
        background: studioBackgroundStyle(slimeType),
      }}
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
