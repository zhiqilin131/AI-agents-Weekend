/** Heuristic: user is giving actionable feedback about their execution calendar / schedule. */
export function detectCalendarFeedbackIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 12) return false;
  const keys = [
    'calendar',
    'schedule',
    'scheduling',
    'reschedule',
    'time slot',
    'time block',
    'timeblock',
    'too busy',
    'too tight',
    'not enough time',
    'move my',
    'shift my',
    'morning only',
    'evening only',
    '9 to 5',
    'nine to five',
    'buffer',
    'gap between',
    'overlap',
    'conflict',
    '排期',
    '日程',
    '日历',
    '会议太',
    '改一下时间',
  ];
  return keys.some((k) => t.includes(k));
}
