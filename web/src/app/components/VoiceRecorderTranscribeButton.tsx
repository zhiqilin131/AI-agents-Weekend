import { Loader2, Mic, Square, Upload } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { apiUrl } from '../../utils/apiOrigin';
import { unlockSlimeAudioContext } from '../../utils/slimeAudioContext';
import { cn } from './ui/utils';

type VoiceRecorderTranscribeButtonProps = {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  /** Smaller control for composer toolbars (Slime Buddy uses the large default on the buddy page). */
  compact?: boolean;
  /** Keep file upload → /api/transcribe for environments without a reliable mic pipeline. */
  showUploadFallback?: boolean;
  className?: string;
};

async function transcribeBlob(blob: Blob): Promise<string> {
  const fd = new FormData();
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('wav') ? 'wav' : 'webm';
  fd.append('file', blob, `voice.${ext}`);
  const res = await fetch(apiUrl('/api/transcribe'), { method: 'POST', body: fd });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const j = (await res.json()) as { text?: string };
  const text = (j.text || '').trim();
  if (!text) throw new Error('No speech recognized — try again or speak a bit longer.');
  return text;
}

/**
 * Push-to-talk voice capture (MediaRecorder) + server `/api/transcribe`, matching the Slime Buddy
 * mic pipeline. Replaces browser `SpeechRecognition` for Shadow Chat and similar composers.
 */
export function VoiceRecorderTranscribeButton({
  onTranscript,
  disabled = false,
  compact = false,
  showUploadFallback = false,
  className,
}: VoiceRecorderTranscribeButtonProps) {
  const { supported, recording, error: recorderError, setError, startRecording, stopRecording } = useVoiceRecorder();
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const uploadAudio = useCallback(
    async (file: File) => {
      if (disabled || busy) return;
      setInlineError(null);
      setError(null);
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append('file', file, file.name);
        const res = await fetch(apiUrl('/api/transcribe'), { method: 'POST', body: fd });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || res.statusText);
        }
        const j = (await res.json()) as { text?: string };
        const text = (j.text || '').trim();
        if (text) onTranscript(text);
        else setInlineError('No speech recognized in that file.');
      } catch (e) {
        setInlineError(e instanceof Error ? e.message : 'Transcription failed');
      } finally {
        setBusy(false);
      }
    },
    [disabled, busy, onTranscript, setError],
  );

  const onMicClick = useCallback(async () => {
    if (busy) return;
    setInlineError(null);

    if (recording) {
      unlockSlimeAudioContext();
      setBusy(true);
      try {
        const blob = await stopRecording();
        if (!blob) {
          setInlineError('No audio captured.');
          return;
        }
        const text = await transcribeBlob(blob);
        onTranscript(text);
      } catch (e) {
        setInlineError(e instanceof Error ? e.message : 'Transcription failed');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (disabled || !supported) return;
    setError(null);
    const ok = await startRecording();
    if (!ok && !recorderError) {
      setInlineError('Could not start recording.');
    }
  }, [
    busy,
    recording,
    disabled,
    supported,
    stopRecording,
    startRecording,
    onTranscript,
    setError,
    recorderError,
  ]);

  const showError = inlineError || recorderError;
  /** Allow finishing a take even if the composer becomes disabled while recording. */
  const buttonDisabled = busy || (!recording && (!supported || disabled));

  return (
    <div
      className={cn('flex', compact ? 'flex-row items-center gap-2' : 'flex-col items-end gap-1', className)}
    >
      <div className="flex items-center gap-2">
        {showUploadFallback ? (
          <label
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-gray-200 bg-white/80 px-3 py-2 text-xs hover:bg-white',
              disabled || busy ? 'pointer-events-none opacity-50' : '',
            )}
          >
            <Upload className="h-3.5 w-3.5 text-violet-600" aria-hidden />
            <span>Upload audio</span>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              disabled={disabled || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAudio(f);
                e.target.value = '';
              }}
            />
          </label>
        ) : null}
        <button
          type="button"
          disabled={buttonDisabled}
          onClick={() => void onMicClick()}
          title={recording ? 'Stop and transcribe' : busy ? 'Transcribing…' : 'Voice input'}
          aria-label={recording ? 'Stop recording' : 'Start voice input'}
          aria-pressed={recording}
          className={cn(
            'relative inline-flex items-center justify-center rounded-full border-2 border-white/90 bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md transition hover:scale-[1.03] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40',
            compact ? 'h-10 w-10' : 'h-14 w-14',
            recording && 'ring-4 ring-cyan-300/80',
          )}
        >
          {busy ? (
            <Loader2 className={cn('animate-spin', compact ? 'h-4 w-4' : 'h-6 w-6')} aria-hidden />
          ) : recording ? (
            <Square className={cn('fill-current', compact ? 'h-4 w-4' : 'h-6 w-6')} aria-hidden />
          ) : (
            <Mic className={cn(compact ? 'h-4 w-4' : 'h-6 w-6')} aria-hidden />
          )}
        </button>
      </div>
      {showError ? (
        <span className="max-w-[220px] text-right text-xs leading-snug text-amber-800">{showError}</span>
      ) : null}
    </div>
  );
}
