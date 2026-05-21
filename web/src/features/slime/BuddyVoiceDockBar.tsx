import { Mic, RotateCcw, Square } from 'lucide-react';
import { motion } from 'motion/react';
import { DecisionModeToggle } from '../../app/components/DecisionModeToggle';
import { ModelSelector } from '../models/ModelSelector';
import { slimeModelDockAbbrev } from '../models/slimeModelDockAbbrev';
import type { SlimeModelRow } from '../models/types';
import { BuddyTooltip } from './BuddyTooltip';
import { SLIME_CTA_BTN_CLASS, slimeCtaButtonStyle } from './slimeCtaButton';
import type { SlimeThemeColors, SlimeType } from './slimeIdentity';
import { cn } from '../../app/components/ui/utils';

const SIDE_SLOT =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition hover:brightness-[1.02] active:scale-[0.97]';

export type BuddyVoiceDockBarProps = {
  theme: SlimeThemeColors;
  slimeType: SlimeType;
  petName: string;
  supported: boolean;
  recording: boolean;
  voiceGateDisabled: boolean;
  voiceGateMessage?: string | null;
  onPushToTalk: () => void;
  showDecision: boolean;
  decisionModeActive: boolean;
  decisionModeToggleDisabled?: boolean;
  onToggleDecisionMode?: () => void;
  showVoiceCancel: boolean;
  onCancelVoice: () => void;
  showReplay: boolean;
  buddyAudioPlaying: boolean;
  onReplay: () => void;
  hideModelSelector?: boolean;
  voiceModelOptionId: string;
  defaultVoiceModelId: string;
  onVoiceModelChange: (id: string) => void;
  models: SlimeModelRow[];
  selectorEnabled: boolean;
  phaseLabel?: string | null;
};

function SidePlaceholder() {
  return <div className={cn(SIDE_SLOT, 'pointer-events-none opacity-0')} aria-hidden />;
}

export function BuddyVoiceDockBar({
  theme,
  slimeType,
  petName,
  supported,
  recording,
  voiceGateDisabled,
  voiceGateMessage,
  onPushToTalk,
  showDecision,
  decisionModeActive,
  decisionModeToggleDisabled,
  onToggleDecisionMode,
  showVoiceCancel,
  onCancelVoice,
  showReplay,
  buddyAudioPlaying,
  onReplay,
  hideModelSelector,
  voiceModelOptionId,
  defaultVoiceModelId,
  onVoiceModelChange,
  models,
  selectorEnabled,
  phaseLabel,
}: BuddyVoiceDockBarProps) {
  const leftSlot = showVoiceCancel ? (
    <BuddyTooltip content="Stop this request and return to idle.">
      <button
        type="button"
        data-testid="buddy-voice-stop"
        onClick={onCancelVoice}
        className={cn(
          SIDE_SLOT,
          'border-red-200/90 bg-gradient-to-b from-red-50 via-white to-white text-red-700 shadow-[0_2px_10px_rgba(239,68,68,0.14)] hover:border-red-300',
        )}
        aria-label="Stop current request"
      >
        <Square className="h-4 w-4 fill-current" aria-hidden />
      </button>
    </BuddyTooltip>
  ) : showReplay ? (
    <BuddyTooltip content="Play the assistant's last reply with the saved TTS voice.">
      <button
        type="button"
        data-testid="buddy-voice-replay"
        onClick={onReplay}
        className={cn(
          SIDE_SLOT,
          'bg-white/95 shadow-sm',
          buddyAudioPlaying
            ? 'border-fuchsia-200 bg-gradient-to-b from-fuchsia-50 to-white text-fuchsia-800 shadow-[0_2px_10px_rgba(217,70,239,0.12)]'
            : 'hover:border-sky-200/80',
        )}
        style={
          buddyAudioPlaying
            ? undefined
            : {
                borderColor: `${theme.border}99`,
                color: theme.heading,
                boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
              }
        }
        aria-label={buddyAudioPlaying ? 'Replaying last reply' : 'Replay last reply'}
      >
        <RotateCcw className={cn('h-4 w-4', buddyAudioPlaying && 'animate-spin')} aria-hidden />
      </button>
    </BuddyTooltip>
  ) : showDecision && onToggleDecisionMode ? (
    <DecisionModeToggle
      active={decisionModeActive}
      disabled={decisionModeToggleDisabled}
      onToggle={onToggleDecisionMode}
      testId="slime-decision-mode-toggle"
      slimeType={slimeType}
      iconOnly
      className="shadow-sm"
    />
  ) : (
    <SidePlaceholder />
  );

  const selectedModelId = voiceModelOptionId || defaultVoiceModelId;
  const selectedModel = models.find((m) => m.id === selectedModelId) ?? models[0];
  const modelAbbrev = slimeModelDockAbbrev(
    selectedModelId,
    selectedModel?.display_name,
  );
  const modelSlot = hideModelSelector ? (
    <SidePlaceholder />
  ) : (
    <BuddyTooltip
      content={`Slime speed: ${selectedModel?.display_name ?? 'Default'} (${modelAbbrev}). Tap to switch model tier.`}
    >
      <span className="inline-flex">
        <ModelSelector
          feature="slime_voice"
          selectedModelId={voiceModelOptionId || defaultVoiceModelId}
          onChange={onVoiceModelChange}
          models={models}
          selectorEnabled={selectorEnabled}
          showCostPreview={false}
          variant="dockIcon"
          dockIconTheme={theme}
          compactSelectAriaLabel={`Slime speed tier (${modelAbbrev}). Tap to change model.`}
          selectContentClassName="z-[300]"
          selectContentSide="top"
          selectContentAvoidCollisions={false}
          disabled={recording}
        />
      </span>
    </BuddyTooltip>
  );

  return (
    <div
      className={cn(
        'relative overflow-visible rounded-[28px] border px-3 py-2.5 backdrop-blur-xl',
        decisionModeActive && 'ring-1 ring-sky-200/70',
        recording && 'ring-1 ring-cyan-200/50',
      )}
      style={{
        borderColor: `${theme.border}55`,
        background: `linear-gradient(165deg, rgba(255,255,255,0.97) 0%, rgba(255,255,255,0.9) 38%, color-mix(in srgb, ${theme.highlight} 12%, white) 100%)`,
        boxShadow: `0 12px 40px rgba(15, 23, 42, 0.08), 0 2px 8px color-mix(in srgb, ${theme.primary} 8%, transparent), inset 0 1px 0 rgba(255,255,255,0.96)`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-4 top-0 h-px rounded-full opacity-80"
        style={{
          background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${theme.primary} 35%, white), transparent)`,
        }}
        aria-hidden
      />

      {phaseLabel ? (
        <p
          className="relative z-[1] mb-2 rounded-full border px-2.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600/90"
          style={{
            borderColor: `${theme.border}44`,
            background: `linear-gradient(180deg, white, color-mix(in srgb, ${theme.highlight} 28%, white))`,
          }}
        >
          {phaseLabel}
        </p>
      ) : null}

      <div className="relative z-[1] grid grid-cols-[2.75rem_1fr_3.5rem] items-center gap-2.5 sm:gap-3">
        <div className="flex justify-center">{leftSlot}</div>

        <div className="relative flex items-center justify-center">
          {recording ? (
            <motion.span
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ backgroundColor: `${theme.accent}35` }}
              animate={{ scale: [1, 1.4, 1], opacity: [0.45, 0.12, 0.45] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          ) : null}
          <BuddyTooltip
            side="top"
            content={
              voiceGateDisabled && voiceGateMessage
                ? voiceGateMessage
                : supported
                  ? `Tap to start or stop recording and send to ${petName}.`
                  : 'Voice input is not available in this browser.'
            }
          >
            <button
              type="button"
              disabled={!supported || (voiceGateDisabled && !recording)}
              onClick={onPushToTalk}
              aria-label={recording ? 'Stop recording' : `Talk to ${petName}`}
              className={cn(
                'relative mx-auto flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-full border-2',
                SLIME_CTA_BTN_CLASS,
                'shadow-[0_10px_28px_rgba(15,23,42,0.14)] transition hover:scale-[1.04] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55',
                recording && 'ring-4 ring-cyan-300/70',
              )}
              style={{
                ...slimeCtaButtonStyle(theme),
                boxShadow: recording
                  ? `0 0 0 6px color-mix(in srgb, ${theme.accent} 22%, transparent), 0 12px 32px ${theme.ctaGlow}`
                  : slimeCtaButtonStyle(theme).boxShadow,
              }}
            >
              {recording ? (
                <Square className="h-6 w-6 fill-current" aria-hidden />
              ) : (
                <Mic className="h-6 w-6" aria-hidden />
              )}
            </button>
          </BuddyTooltip>
        </div>

        <div className="flex justify-center">{modelSlot}</div>
      </div>
    </div>
  );
}
