import { Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DecisionModeToggle } from '../DecisionModeToggle';
import { VoiceRecorderTranscribeButton } from '../VoiceRecorderTranscribeButton';
import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';
import { ModelSelector } from '../../../features/models/ModelSelector';
import type { SlimeModelRow } from '../../../features/models/types';
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
}: Props) {
  const [value, setValue] = useState('');

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
    onSend(x, { manualDecisionMode: decisionModeActive });
    setValue('');
  };

  return (
    <div
      className={cn(
        'rounded-3xl border bg-white/95 p-3 shadow-[0_8px_28px_rgba(99,102,241,0.1)] backdrop-blur-sm transition-shadow duration-500',
        decisionModeActive ? 'decision-mode-glow border-sky-300/80' : 'border-white/90',
      )}
    >
      <div className="mb-2 flex items-center gap-2 border-b border-gray-100/90 pb-2">
        <DecisionModeToggle
          active={decisionModeActive}
          disabled={disabled}
          onToggle={onToggleDecisionMode}
          testId="shadow-decision-mode-toggle"
        />

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
        <VoiceRecorderTranscribeButton onTranscript={appendVoice} disabled={disabled} compact />
        <BuddyTooltip content="Send (Enter). Shift+Enter for a new line.">
          <button
            type="button"
            onClick={send}
            disabled={!value.trim() || disabled}
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" aria-hidden />
            Send
          </button>
        </BuddyTooltip>
      </div>
    </div>
  );
}
