import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ONBOARDING_DRAFT_STORAGE_KEY,
  clearAllOnboardingClientState,
  createEmptyOnboardingDraft,
  loadDraftFromStorage,
  onboardingDraftStorageKey,
  resolveOnboardingStep,
  saveDraftToStorage,
} from './onboarding';

function mockWebStorage() {
  const mem: Record<string, string> = {};
  const store = {
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
  } as Storage;
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', { ...store });
}

beforeAll(() => {
  mockWebStorage();
});

describe('onboarding per-user storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('scopes draft keys by user id', () => {
    const draft = { ...createEmptyOnboardingDraft(), step: 2 };
    saveDraftToStorage(draft, 'user-a');
    saveDraftToStorage({ ...createEmptyOnboardingDraft(), step: 4 }, 'user-b');

    expect(loadDraftFromStorage('user-a')?.step).toBe(2);
    expect(loadDraftFromStorage('user-b')?.step).toBe(4);
    expect(localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('does not apply completion step from another user local draft', () => {
    saveDraftToStorage({ ...createEmptyOnboardingDraft(), step: 4 }, 'old-user');
    const step = resolveOnboardingStep({
      serverCompleted: false,
      localStep: 4,
      draftFromProfile: createEmptyOnboardingDraft(),
    });
    expect(step).toBe(0);
  });

  it('clears legacy and user keys on sign-out helper', () => {
    localStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, '{}');
    localStorage.setItem(onboardingDraftStorageKey('user-a'), '{}');
    clearAllOnboardingClientState('user-a');
    expect(localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(onboardingDraftStorageKey('user-a'))).toBeNull();
  });
});
