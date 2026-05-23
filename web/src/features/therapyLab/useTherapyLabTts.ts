import { useCallback, useRef, useState } from 'react';
import { ttsVoiceForSlimeType } from '../slime/slimeIdentity';
import { fetchSlimeTtsBlob } from '../../utils/slimeTtsFetch';
import { playMp3BlobWithWebAudio, unlockSlimeAudioContext } from '../../utils/slimeAudioContext';

export function useTherapyLabTts() {
  const [speaking, setSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stop = useCallback(() => {
    try {
      sourceRef.current?.stop();
    } catch {
      /* already stopped */
    }
    sourceRef.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      stop();
      unlockSlimeAudioContext();
      setTtsError(null);
      const res = await fetchSlimeTtsBlob(trimmed, 'therapy-lab-tts', {
        preferredVoiceName: ttsVoiceForSlimeType('wellbeing'),
        rate: 0.95,
      });
      if (!res.ok) {
        setTtsError(res.message);
        return;
      }
      setSpeaking(true);
      const played = await playMp3BlobWithWebAudio(res.blob, {
        trackSource: (node) => {
          sourceRef.current = node;
        },
        onEnded: () => setSpeaking(false),
      });
      if (!played) {
        setSpeaking(false);
        setTtsError('Could not play voice guidance in this browser.');
      }
    },
    [stop],
  );

  return { speak, stop, speaking, ttsError };
}
