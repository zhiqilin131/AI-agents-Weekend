import { Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DecisionModeToggle } from '../DecisionModeToggle';
import { VoiceRecorderTranscribeButton } from '../VoiceRecorderTranscribeButton';
import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';
import { ModelSelector } from '../../../features/models/ModelSelector';
import type { SlimeModelRow } from '../../../features/models/types';
import { getSlimeIdentity, slimeSupportsDecisionMode, type SlimeType } from '../../../features/slime/slimeIdentity';
import { SLIME_CTA_BTN_CLASS, slimeCtaButtonStyle } from '../../../features/slime/slimeCtaButton';
import { cn } from '../ui/utils';

type Props = {
  disabled: boolean;
  decisionModeActive: boolean;
  onToggleDecisionMode: () => void;
  modelOptionId: string;
  onModelChange: (id: string) => void;
  models: SlimeModelRow[];
  selectorEnabled: boolean;
  defaultModelId: string;
  bootstrapText?: string | null;
  onBootstrapConsumed?: () => void;
  onSend: (text: string, opts?: { manualDecisionMode?: boolean }) => void;
  slimeType?: SlimeType;
};

export function ShadowChatComposerDock({
  disabled,
  decisionModeActive,
  onToggleDecisionMode,
  modelOptionId,
  onModelChange,
  models,
  selectorEnabled,
  defaultModelId,
  bootstrapText,
  onBootstrapConsumed,
  onSend,
  slimeType = 'generalized',
}: Props) {
  const [value, setValue] = useState('');
  const theme = getSlimeIdentity(slimeType).theme;
  const decisionModeEnabled = slimeSupportsDecisionMode(slimeType);

  useEffect(() => {
    const b = (bootstrapText || '').trim();
    if (!b) return;
    setValue((prev) => (prev.trim() ? prev : b));
    onBootstrapConsumed?.();
  }, [bootstrapText, onBootstrapConsumed]);

  const appendVoice = (t: string) => setValue((s) => (s.trim() ? `${s.trim()} ${t}` : t));

  const send = () => {
    const x = value.trim();
    if (!x || disabled) return;
    onSend(x, { manualDecisionMode: decisionModeEnabled && decisionModeActive });
    setValue('');
  };

  return (
    <div
      className={cn(
        'rounded-3xl border bg-white/95 p-3 shadow-[0_8px_28px_rgba(99,102,241,0.1)] backdrop-blur-sm transition-shadow duration-500',
        decisionModeEnabled && decisionModeActive ? 'decision-mode-glow border-sky-300/80' : 'border-white/90',
      )}
    >
      <div className="mb-2 flex items-center gap-2 border-b border-gray-100/90 pb-2">
        {decisionModeEnabled ? (
          <DecisionModeToggle
            active={decisionModeActive}
            disabled={disabled}
            onToggle={onToggleDecisionMode}
            testId="shadow-decision-mode-toggle"
            slimeType={slimeType}
          />
        ) : null}

        {selectorEnabled && models.length > 0 ? (
          <div className="ml-auto min-w-0 max-w-[min(100%,14rem)] flex-1 sm:max-w-[13rem]">
            <ModelSelector
              feature="shadow_chat"
              selectedModelId={modelOptionId || defaultModelId}
              onChange={onModelChange}
              models={models}
              selectorEnabled={selectorEnabled}
              showCostPreview={false}
              variant="compact"
              elevated={false}
              hideCompactHeader
              compactSelectAriaLabel="Slime model"
              disabled={disabled}
              className="w-full"
            />
          </div>
        ) : null}
      </div>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="Message Shadow Chat..."
        className="min-h-[72px] w-full resize-none rounded-2xl border-0 bg-transparent px-1 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />

      <div className="mt-1 flex items-center justify-between gap-2 border-t border-gray-100/90 pt-2">
        <VoiceRecorderTranscribeButton onTranscript={appendVoice} disabled={disabled} compact slimeType={slimeType} />
        <BuddyTooltip content="Send (Enter). Shift+Enter for a new line.">
          <button
            type="button"
            onClick={send}
            disabled={!value.trim() || disabled}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm',
              SLIME_CTA_BTN_CLASS,
            )}
            style={slimeCtaButtonStyle(theme)}
          >
            <Send className="h-3.5 w-3.5" aria-hidden />
            Send
          </button>
        </BuddyTooltip>
      </div>
    </div>
  );
}
