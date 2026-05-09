import { useCallback, useEffect, useState } from 'react';

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

export function useSpeechSynthesis() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const supported = speechSynthesisSupported();

  const cancel = useCallback(() => {
    if (!speechSynthesisSupported()) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  const speak = useCallback(
    (text: string) => {
      if (!speechSynthesisSupported()) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(trimmed);
      u.onend = () => {
        setIsSpeaking(false);
        setIsPaused(false);
      };
      u.onerror = () => {
        setIsSpeaking(false);
        setIsPaused(false);
      };
      window.speechSynthesis.speak(u);
      setIsSpeaking(true);
      setIsPaused(false);
    },
    [],
  );

  const pause = useCallback(() => {
    if (!speechSynthesisSupported() || !isSpeaking) return;
    try {
      window.speechSynthesis.pause();
      setIsPaused(true);
    } catch {
      /* some engines noop */
    }
  }, [isSpeaking]);

  const resume = useCallback(() => {
    if (!speechSynthesisSupported()) return;
    try {
      window.speechSynthesis.resume();
      setIsPaused(false);
    } catch {
      /* some engines noop */
    }
  }, []);

  return { supported, isSpeaking, isPaused, speak, pause, resume, cancel };
}
