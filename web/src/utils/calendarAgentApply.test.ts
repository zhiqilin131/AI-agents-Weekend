import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import {
  applyCalendarDraftToPlanner,
  draftHasSchedulableTimes,
  loadCalendarDraftForPlanner,
  mapAgentEventsToPlanner,
  parseCalendarSessionDraft,
} from './calendarAgentApply';
import { CALENDAR_AGENT_SESSION_DRAFT_KEY } from './executionStorageKeys';

vi.mock('./calendarAgentApi', () => ({
  confirmCalendarDraft: vi.fn(),
  fetchCalendarDraftFromReport: vi.fn(),
}));

import { confirmCalendarDraft, fetchCalendarDraftFromReport } from './calendarAgentApi';

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

beforeAll(() => {
  mockSessionStorage();
});

const draft = {
  draft_id: 'd-1',
  intent: {},
  proposed_events: [{ id: 'p1', title: 'Deep work', start: '2026-05-18T09:00:00.000Z', end: '2026-05-18T10:00:00.000Z' }],
  conflicts: [],
  alternatives: [],
  explanation: 'Placed in morning focus window.',
};

describe('parseCalendarSessionDraft', () => {
  it('reads nested draft from report handoff', () => {
    expect(parseCalendarSessionDraft(JSON.stringify({ draft }))).toEqual(draft);
  });

  it('reads flat draft from slime voice handoff', () => {
    expect(parseCalendarSessionDraft(JSON.stringify(draft))).toEqual(draft);
  });
});

describe('draftHasSchedulableTimes', () => {
  it('requires start and end on at least one proposed event', () => {
    expect(draftHasSchedulableTimes(draft)).toBe(true);
    expect(
      draftHasSchedulableTimes({
        ...draft,
        proposed_events: [{ title: 'No times' }],
      }),
    ).toBe(false);
  });
});

describe('mapAgentEventsToPlanner', () => {
  it('maps confirmed server events to ai planner blocks', () => {
    const mapped = mapAgentEventsToPlanner([
      {
        id: 'evt-abc',
        title: 'Ship MVP',
        start: '2026-05-18T14:00:00.000Z',
        end: '2026-05-18T15:00:00.000Z',
        source: 'confirmed',
      },
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.source).toBe('ai');
    expect(mapped[0]?.title).toBe('Ship MVP');
  });
});

describe('loadCalendarDraftForPlanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(fetchCalendarDraftFromReport).mockReset();
  });

  it('prefers session draft and clears the key', async () => {
    sessionStorage.setItem(CALENDAR_AGENT_SESSION_DRAFT_KEY, JSON.stringify({ draft }));
    const loaded = await loadCalendarDraftForPlanner('dec-1', 'thread-1');
    expect(loaded).toEqual(draft);
    expect(sessionStorage.getItem(CALENDAR_AGENT_SESSION_DRAFT_KEY)).toBeNull();
    expect(fetchCalendarDraftFromReport).not.toHaveBeenCalled();
  });

  it('fetches from report when session is empty', async () => {
    vi.mocked(fetchCalendarDraftFromReport).mockResolvedValue(draft);
    const loaded = await loadCalendarDraftForPlanner('dec-1', null);
    expect(loaded).toEqual(draft);
    expect(fetchCalendarDraftFromReport).toHaveBeenCalledWith('dec-1', null);
  });
});

describe('applyCalendarDraftToPlanner', () => {
  beforeEach(() => {
    vi.mocked(confirmCalendarDraft).mockReset();
  });

  it('confirms draft and returns planner events', async () => {
    vi.mocked(confirmCalendarDraft).mockResolvedValue([
      {
        id: 'evt-1',
        title: 'Deep work',
        start: '2026-05-18T09:00:00.000Z',
        end: '2026-05-18T10:00:00.000Z',
        source: 'confirmed',
      },
    ]);
    const result = await applyCalendarDraftToPlanner(draft);
    expect(confirmCalendarDraft).toHaveBeenCalledWith('d-1');
    expect(result.events).toHaveLength(1);
    expect(result.message).toContain('Added 1 block');
    expect(result.message).toContain('morning focus');
  });

  it('skips confirm when draft has no times', async () => {
    const result = await applyCalendarDraftToPlanner({
      ...draft,
      proposed_events: [],
    });
    expect(confirmCalendarDraft).not.toHaveBeenCalled();
    expect(result.events).toHaveLength(0);
  });
});
