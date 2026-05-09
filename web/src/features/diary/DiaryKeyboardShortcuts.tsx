import { useEffect } from 'react';

export type DiaryKeyboardShortcutsProps = {
  enabled: boolean;
  selectedDate: string | null;
  onStepCalendarDay: (delta: -1 | 1) => void;
  onNextDiaryEntry: () => void;
  onPrevDiaryEntry: () => void;
  onHome?: () => void;
  onEscape?: () => void;
};

/**
 * Global keyboard navigation: arrows move by calendar day; Space/Backspace jump among diary entries.
 */
export function useDiaryKeyboardShortcuts({
  enabled,
  selectedDate,
  onStepCalendarDay,
  onNextDiaryEntry,
  onPrevDiaryEntry,
  onHome,
  onEscape,
}: DiaryKeyboardShortcutsProps): void {
  useEffect(() => {
    if (!enabled || !selectedDate) return;

    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        onStepCalendarDay(-1);
        return;
      }
      if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        onStepCalendarDay(1);
        return;
      }
      if (ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        onNextDiaryEntry();
        return;
      }
      if (ev.key === 'Backspace') {
        ev.preventDefault();
        onPrevDiaryEntry();
        return;
      }
      if (ev.key === 'Home') {
        ev.preventDefault();
        onHome?.();
        return;
      }
      if (ev.key === 'Escape') {
        onEscape?.();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, selectedDate, onStepCalendarDay, onNextDiaryEntry, onPrevDiaryEntry, onHome, onEscape]);
}

export function DiaryKeyboardShortcuts(props: DiaryKeyboardShortcutsProps) {
  useDiaryKeyboardShortcuts(props);
  return null;
}
