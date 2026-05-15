/** Voice intent guards — keep calendar mutations from hijacking decision-mode utterances. */

export function normalizeVoiceText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isExplicitDecisionModeCommand(text: string): boolean {
  const t = normalizeVoiceText(text);
  if (!t) return false;
  const exact = new Set([
    'decision mode',
    'start decision mode',
    'activate decision mode',
    'decision report',
    'generate decision report',
  ]);
  if (exact.has(t)) return true;
  return /\b(?:start|enter|open|switch(?:\s+to)?|turn\s+on|begin|run|generate|make|create|launch|activate)\b.*\b(?:decision(?:\s+report|\s+mode)?|report(?:\s+mode)?)\b/.test(
    t,
  );
}

export function hasCalendarMutationContext(text: string): boolean {
  const t = normalizeVoiceText(text);
  return (
    /\b(?:calendar|event|meeting|appointment|schedule|reschedule|reminder|planner)\b/.test(t) ||
    /日历|日程|会议|约会|提醒|计划/.test(text)
  );
}

/** Life-choice phrasing that uses "move" but is not a calendar reschedule. */
export function isLifeChoiceMovePhrase(text: string): boolean {
  const t = normalizeVoiceText(text);
  return (
    /\bmove to\b/.test(t) &&
    /\b(?:apartment|house|home|city|job|school|company|offer|relocate|relocation)\b/.test(t) &&
    !hasCalendarMutationContext(text)
  );
}

export function isDecisionForkUtterance(text: string): boolean {
  const t = normalizeVoiceText(text);
  if (isExplicitDecisionModeCommand(text)) return true;
  if (isLifeChoiceMovePhrase(text)) return true;
  if (/\b(?:whether|should i|which one|help me (?:choose|decide|pick)|can't decide|cannot decide)\b/.test(t)) {
    return !hasCalendarMutationContext(text);
  }
  if (/\bor\b/.test(t) && t.length > 18 && !hasCalendarMutationContext(text)) {
    return true;
  }
  return false;
}

export function shouldBypassCalendarMutation(text: string): boolean {
  return isExplicitDecisionModeCommand(text) || isDecisionForkUtterance(text);
}

export type CalendarMutationKind = 'delete' | 'update';

export function calendarMutationKindFromTranscript(
  text: string,
  isProfileIntent: boolean,
): CalendarMutationKind | null {
  if (isProfileIntent || shouldBypassCalendarMutation(text)) return null;
  const t = normalizeVoiceText(text);
  const wantsDelete = /\b(delete|remove|cancel|drop|clear|get rid of)\b/.test(t) || /删除|取消|删掉|移除|去掉/.test(text);
  if (wantsDelete) return 'delete';
  const wantsUpdate =
    /\b(change|edit|modify|update|reschedule|rename|shift|postpone)\b/.test(t) ||
    /修改|更改|改成|改到|改为|挪到|换到|推迟|提前/.test(text);
  const wantsMove = /\bmove\b/.test(t) || /挪|移/.test(text);
  if (wantsUpdate || wantsMove) {
    if (!hasCalendarMutationContext(text) && !wantsDelete) {
      if (wantsMove && !wantsUpdate) return null;
      if (isLifeChoiceMovePhrase(text)) return null;
    }
    return 'update';
  }
  return null;
}
