import { useState } from 'react';
import { VoiceInputButton } from './VoiceInputButton';

export function ChatInput({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState('');
  const appendVoice = (t: string) => {
    setValue((s) => (s.trim() ? `${s.trim()} ${t}` : t));
  };

  return (
    <div className="rounded-3xl border border-white/90 bg-white/90 p-3 shadow-[0_8px_28px_rgba(79,70,229,0.12)] backdrop-blur-sm">
      <textarea
        className="w-full min-h-[92px] resize-none rounded-2xl border border-gray-200/90 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        placeholder="Send a message..."
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = value.trim();
            if (!text) return;
            onSend(text);
            setValue('');
          }
        }}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <VoiceInputButton onTranscript={appendVoice} disabled={disabled} compact />
        <button
          type="button"
          className="rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm text-white shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-40"
          disabled={disabled || !value.trim()}
          onClick={() => {
            const text = value.trim();
            if (!text) return;
            onSend(text);
            setValue('');
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

