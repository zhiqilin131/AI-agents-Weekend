import type { NavigateFunction } from 'react-router';

/** Session keys — read/written only around navigation from voice commands. */
export const SLIME_VOICE_CHAT_PREFILL_KEY = 'foresight_slime_voice_chat_prefill';
export const SLIME_VOICE_CALENDAR_DRAFT_KEY = 'foresight_slime_voice_calendar_draft';

export type SlimeVoiceFrontendAction = {
  type: string;
  route?: string;
  payload?: Record<string, unknown>;
};

/** Apply safe server-suggested navigation + stash payloads for destination pages. */
export function applySlimeVoiceFrontendAction(
  navigate: NavigateFunction,
  action: SlimeVoiceFrontendAction | undefined | null,
): void {
  if (!action?.type) return;
  const path = (action.route || '').trim();
  const payload = action.payload;

  if (action.type === 'navigate') {
    if (!path.startsWith('/') || path.startsWith('//')) return;
    try {
      const draft = payload?.calendar_draft;
      if (draft && typeof draft === 'object') {
        sessionStorage.setItem(SLIME_VOICE_CALENDAR_DRAFT_KEY, JSON.stringify(draft));
      }
    } catch {
      /* ignore quota */
    }
    try {
      const prefill = payload?.prefill_message;
      if (typeof prefill === 'string' && prefill.trim()) {
        sessionStorage.setItem(SLIME_VOICE_CHAT_PREFILL_KEY, prefill.trim());
      }
    } catch {
      /* ignore */
    }
    navigate(path);
  }
}

/** Normalize snake_case profile patches from the API into the web PATCH shape. */
export function normalizeVoiceSlimePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'color_theme') out.colorTheme = v;
    else if (k === 'custom_colors') out.customColors = v;
    else out[k] = v;
  }
  return out;
}
