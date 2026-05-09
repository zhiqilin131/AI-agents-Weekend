import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SLIME_VOICE_CALENDAR_DRAFT_KEY,
  SLIME_VOICE_CHAT_PREFILL_KEY,
  applySlimeVoiceFrontendAction,
  normalizeVoiceSlimePatch,
} from './slimeVoiceActions';
import { CALENDAR_AGENT_SESSION_DRAFT_KEY } from './executionStorageKeys';

function mockSessionStorage() {
  const mem: Record<string, string> = {};
  vi.stubGlobal(
    'sessionStorage',
    {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = String(v);
      },
      removeItem: (k: string) => {
        delete mem[k];
      },
      clear: () => {
        for (const k of Object.keys(mem)) delete mem[k];
      },
      length: 0,
      key: () => null,
    } as Storage,
  );
}

describe('slimeVoiceActions', () => {
  beforeEach(() => {
    mockSessionStorage();
  });

  it('navigate stores calendar draft and chat prefill then navigates', () => {
    sessionStorage.clear();
    const navigate = vi.fn();
    applySlimeVoiceFrontendAction(navigate, {
      type: 'navigate',
      route: '/execution',
      payload: {
        calendar_draft: { title: 'x', duration_minutes: 20 },
        prefill_message: 'hello',
      },
    });
    expect(sessionStorage.getItem(SLIME_VOICE_CALENDAR_DRAFT_KEY)).toContain('x');
    expect(sessionStorage.getItem(SLIME_VOICE_CHAT_PREFILL_KEY)).toBe('hello');
    expect(navigate).toHaveBeenCalledWith('/execution');
  });

  it('rejects non-root paths', () => {
    const navigate = vi.fn();
    applySlimeVoiceFrontendAction(navigate, { type: 'navigate', route: '//evil' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('show_calendar_draft stores agent payload and navigates', () => {
    sessionStorage.clear();
    const navigate = vi.fn();
    applySlimeVoiceFrontendAction(navigate, {
      type: 'show_calendar_draft',
      route: '/execution/d1',
      payload: { draft_id: 'cd-1', draft: { draft_id: 'cd-1' } },
    });
    expect(sessionStorage.getItem(CALENDAR_AGENT_SESSION_DRAFT_KEY)).toContain('cd-1');
    expect(navigate).toHaveBeenCalledWith('/execution/d1');
  });

  it('normalizes snake_case slime patch', () => {
    expect(
      normalizeVoiceSlimePatch({
        color_theme: 'mint',
        custom_colors: { primary: '#112233', secondary: '#445566', glow: '#778899' },
      }),
    ).toMatchObject({
      colorTheme: 'mint',
      customColors: expect.any(Object),
    });
  });
});
