import { useEffect, useState } from 'react';
import { VoiceInputButton } from '../VoiceInputButton';

export function ShadowChatInput({
  disabled,
  onSend,
  bootstrapText,
  onBootstrapConsumed,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  /** When set, prefills an empty composer (e.g. suggestion chip). */
  bootstrapText?: string | null;
  onBootstrapConsumed?: () => void;
}) {
  const [value, setValue] = useState('');
  const appendVoice = (t: string) => setValue((s) => (s.trim() ? `${s.trim()} ${t}` : t));

  useEffect(() => {
    const b = (bootstrapText || '').trim();
    if (!b) return;
    setValue((prev) => (prev.trim() ? prev : b));
    onBootstrapConsumed?.();
  }, [bootstrapText, onBootstrapConsumed]);

  const send = () => {
    const x = value.trim();
    if (!x || disabled) return;
    onSend(x);
    setValue('');
  };

  return (
    <div className="rounded-3xl border border-white/90 bg-white/90 p-3 shadow-[0_8px_28px_rgba(99,102,241,0.12)]">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="Message Shadow Chat..."
        className="min-h-[84px] w-full resize-none rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <VoiceInputButton onTranscript={appendVoice} disabled={disabled} compact />
        <button type="button" onClick={send} disabled={!value.trim() || disabled} className="rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm text-white disabled:opacity-40">
          Send
        </button>
      </div>
    </div>
  );
}

