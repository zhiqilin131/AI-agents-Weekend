const UNSAFE_CHARS = /[<>"'`\\]/g;

/** Short, calendar-friendly action title (no clinical claims). */
export function calendarSafeTitle(raw: string, maxLen = 72): string {
  const cleaned = raw
    .replace(UNSAFE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Gentle wellbeing step';
  const capped = cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
  return capped;
}
