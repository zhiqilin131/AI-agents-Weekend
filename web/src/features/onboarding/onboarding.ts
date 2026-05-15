import type { UserProfile } from './types';

export const ONBOARDING_DRAFT_STORAGE_KEY = 'fx_onboarding_draft_v1';

export type PriorityDomain = 'work' | 'relationships' | 'health' | 'finance' | 'custom';
export type PrioritySourceChoice = 'A' | 'B' | 'C' | 'custom';
export type PriorityChoiceOrSkip = PrioritySourceChoice | 'skipped';
export type PvqScore = 'very_like' | 'somewhat_like' | 'not_much' | 'not_at_all' | 'skipped';
export type OnboardingTrigger = 'force_initial' | 'gentle_reminder' | 'none';

export type PriorityOption = {
  id: PrioritySourceChoice;
  label: string;
  description: string;
  draft: string;
};

export type PriorityDomainQuestion = {
  id: PriorityDomain;
  title: string;
  question: string;
  options: PriorityOption[];
};

export type Portrait = {
  portraitId: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  portraitKey:
    | 'achievement'
    | 'security'
    | 'autonomy'
    | 'depth_relationship'
    | 'tradition'
    | 'exploration'
    | 'altruism'
    | 'hedonism';
  text: string;
  keyword: string;
};

export type PersonalPriority = {
  id: string;
  domain: PriorityDomain;
  text: string;
  sourceChoice?: PrioritySourceChoice;
  createdAt: string;
  updatedAt: string;
};

export type PvqResponse = {
  portraitId: Portrait['portraitId'];
  portraitKey: Portrait['portraitKey'];
  score: PvqScore;
};

export type ValuesProfile = {
  pvqResponses: PvqResponse[];
  narrative: string;
  generatedAt: string;
  editedByUser: boolean;
};

export type OnboardingStatus = {
  completed: boolean;
  completedAt?: string;
  skippedQuestions: string[];
  lastPromptedAt?: string;
  promptCount: number;
};

export type PersonalProfile = {
  priorities: PersonalPriority[];
  valuesProfile: ValuesProfile;
  onboardingStatus: OnboardingStatus;
};

export type OnboardingDraft = {
  step: number;
  priorityCursor: number;
  stepOneSummary: boolean;
  pvqCursor: number;
  priorities: PersonalPriority[];
  prioritySelections: Partial<Record<PriorityDomain, PriorityChoiceOrSkip>>;
  pvqResponses: PvqResponse[];
  valuesNarrative: string;
  valuesEditedByUser: boolean;
  skippedQuestions: string[];
};

export const PRIORITY_QUESTIONS: PriorityDomainQuestion[] = [
  {
    id: 'work',
    title: 'Work & Career',
    question: 'When it comes to work, which feels most like you right now?',
    options: [
      {
        id: 'A',
        label: 'Challenge-driven',
        description: 'I want challenge and growth at work, and I am willing to invest more time and energy for that.',
        draft: 'At work, I currently prioritize challenge and growth, and I am willing to invest more time for that.',
      },
      {
        id: 'B',
        label: 'Balance-protecting',
        description: 'I want work to be stable and manageable, without taking over my life rhythm.',
        draft: 'At work, I currently prioritize stability and control, and I do not want work to overtake my life rhythm.',
      },
      {
        id: 'C',
        label: 'Freedom-first',
        description: 'I value autonomy and flexibility most; I can trade off salary or stability for that.',
        draft: 'At work, I currently value autonomy and flexibility most, and I can trade off salary or stability for that.',
      },
    ],
  },
  {
    id: 'relationships',
    title: 'Family & Relationships',
    question: 'When it comes to important people in your life, which sounds most like you?',
    options: [
      {
        id: 'A',
        label: 'Deep-presence',
        description: 'I am willing to adjust my plans and rhythm for people who matter to me.',
        draft: 'In relationships, I am willing to adjust my plans and rhythm for people who matter to me.',
      },
      {
        id: 'B',
        label: 'Mutual-independence',
        description: 'I value relationships, while believing everyone should keep their own space.',
        draft: 'In relationships, I value connection while also protecting each person’s personal space.',
      },
      {
        id: 'C',
        label: 'Still-building',
        description: 'I am currently in a phase of meeting people and building meaningful relationships.',
        draft: 'In relationships, I am currently in a building phase and want to leave room for connection and exploration.',
      },
    ],
  },
  {
    id: 'health',
    title: 'Health & Lifestyle',
    question: 'How would you describe your current stance on health and lifestyle?',
    options: [
      {
        id: 'A',
        label: 'Non-negotiable',
        description: 'I treat health, exercise, and sleep as non-negotiable baselines.',
        draft: 'For health, I treat exercise, sleep, and physical condition as non-negotiable baselines.',
      },
      {
        id: 'B',
        label: 'Intentionally maintained',
        description: 'I care about my health, but I do not let it dominate every decision.',
        draft: 'For health, I intentionally maintain it, but I do not let it dominate all of my decisions.',
      },
      {
        id: 'C',
        label: 'Not prioritized yet',
        description: 'I know it matters, but I do not currently have enough energy to do it systematically.',
        draft: 'For health, I know it matters, but I do not currently have enough bandwidth to manage it systematically.',
      },
    ],
  },
  {
    id: 'finance',
    title: 'Finance',
    question: 'When it comes to money and finances, which is closest to you right now?',
    options: [
      {
        id: 'A',
        label: 'Security-first',
        description: 'I prioritize savings and stable income, and I tend to avoid high-risk choices.',
        draft: 'Financially, I prioritize security through savings and stable income, and I tend to avoid high-risk choices.',
      },
      {
        id: 'B',
        label: 'Growth-first',
        description: 'I am willing to take reasonable risk for larger long-term returns.',
        draft: 'Financially, I am willing to take reasonable risk in exchange for stronger long-term upside.',
      },
      {
        id: 'C',
        label: 'Freedom-first',
        description: 'As long as money is enough, I care more about time and optionality.',
        draft: 'Financially, I care more about time and optionality, and “enough” is good enough.',
      },
    ],
  },
];

export const PVQ_PORTRAITS: Portrait[] = [
  {
    portraitId: 1,
    portraitKey: 'achievement',
    text: 'For this person, doing difficult things and being recognized for their capability is one of the most meaningful parts of life.',
    keyword: 'achievement and being recognized',
  },
  {
    portraitId: 2,
    portraitKey: 'security',
    text: 'For this person, a life with order and predictability matters more than excitement.',
    keyword: 'stability and predictability',
  },
  {
    portraitId: 3,
    portraitKey: 'autonomy',
    text: 'What this person cannot tolerate most is being controlled or boxed in by rules—having the final say over their own life is important.',
    keyword: 'autonomy and self-direction',
  },
  {
    portraitId: 4,
    portraitKey: 'depth_relationship',
    text: 'For this person, a few people who truly understand them are worth more than additional success.',
    keyword: 'deep relationships and being understood',
  },
  {
    portraitId: 5,
    portraitKey: 'tradition',
    text: 'This person values roots, family, and community tradition, and does not want to drift too far from them.',
    keyword: 'tradition, belonging, and roots',
  },
  {
    portraitId: 6,
    portraitKey: 'exploration',
    text: 'This person keeps wanting to try what they have not done before, and feels stuck when life gets too familiar.',
    keyword: 'novelty and exploration',
  },
  {
    portraitId: 7,
    portraitKey: 'altruism',
    text: 'When making decisions, this person naturally considers whether it is fair for others and for the wider group.',
    keyword: 'altruism and fairness',
  },
  {
    portraitId: 8,
    portraitKey: 'hedonism',
    text: 'This person feels life should not miss present-moment joy—food, beauty, laughter, and love.',
    keyword: 'present-moment enjoyment',
  },
];

export const PVQ_SCORE_OPTIONS: Array<{ value: PvqScore; label: string }> = [
  { value: 'very_like', label: 'Very much like me' },
  { value: 'somewhat_like', label: 'Somewhat like me' },
  { value: 'not_much', label: 'Not much like me' },
  { value: 'not_at_all', label: 'Not like me at all' },
];

export function nowIso(): string {
  return new Date().toISOString();
}

export function buildDefaultPvqResponses(): PvqResponse[] {
  return PVQ_PORTRAITS.map((portrait) => ({
    portraitId: portrait.portraitId,
    portraitKey: portrait.portraitKey,
    score: 'skipped' as const,
  }));
}

export function createEmptyOnboardingDraft(): OnboardingDraft {
  return {
    step: 0,
    priorityCursor: 0,
    stepOneSummary: false,
    pvqCursor: 0,
    priorities: [],
    prioritySelections: {},
    pvqResponses: buildDefaultPvqResponses(),
    valuesNarrative: '',
    valuesEditedByUser: false,
    skippedQuestions: [],
  };
}

export function loadDraftFromStorage(): OnboardingDraft | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingDraft> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ...createEmptyOnboardingDraft(),
      ...parsed,
      pvqResponses: Array.isArray(parsed.pvqResponses) && parsed.pvqResponses.length === 8
        ? (parsed.pvqResponses as PvqResponse[])
        : buildDefaultPvqResponses(),
      priorities: Array.isArray(parsed.priorities) ? (parsed.priorities as PersonalPriority[]) : [],
      skippedQuestions: Array.isArray(parsed.skippedQuestions) ? parsed.skippedQuestions : [],
      prioritySelections:
        parsed.prioritySelections && typeof parsed.prioritySelections === 'object'
          ? parsed.prioritySelections
          : {},
    };
  } catch {
    return null;
  }
}

export function saveDraftToStorage(draft: OnboardingDraft): void {
  try {
    localStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // best effort only
  }
}

export function clearDraftFromStorage(): void {
  try {
    localStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
  } catch {
    // best effort only
  }
}

export function withQuestionMarked(skippedQuestions: string[], questionId: string, skipped: boolean): string[] {
  const next = new Set(skippedQuestions);
  if (skipped) next.add(questionId);
  else next.delete(questionId);
  return Array.from(next);
}

export function generateValuesNarrative(responses: PvqResponse[]): string {
  const selected = responses
    .filter((item) => item.score === 'very_like' || item.score === 'somewhat_like')
    .map((item) => PVQ_PORTRAITS.find((x) => x.portraitId === item.portraitId)?.keyword)
    .filter((item): item is string => Boolean(item));
  if (selected.length === 0) {
    return 'You are still exploring what matters most to you, and that is completely normal. Start with one small decision that feels important right now, and I will adapt as we go.';
  }
  const top = selected.slice(0, 3);
  if (top.length === 1) {
    return `You seem to care deeply about ${top[0]}. This is likely to be a key signal in how you decide what fits you.`;
  }
  if (top.length === 2) {
    return `You seem to value both ${top[0]} and ${top[1]}. When weighing options, you likely prefer choices that respect both rather than maximizing only one side.`;
  }
  return `You seem to value ${top[0]}, ${top[1]}, and ${top[2]}. Together, these priorities shape how you judge what feels both worthwhile and sustainable.`;
}

export function shouldShowOnboarding(profile: UserProfile): OnboardingTrigger {
  const status = profile.personal_profile?.onboardingStatus;
  if (status?.completed) {
    return 'none';
  }
  if (!status?.completed && !status?.lastPromptedAt) {
    return 'force_initial';
  }
  const skippedCount = status?.skippedQuestions?.length ?? 0;
  const promptCount = status?.promptCount ?? 0;
  const tooManySkips = skippedCount >= 4;
  const longTimeSinceLastPrompt = daysSince(status?.lastPromptedAt) > 7;
  if (tooManySkips && longTimeSinceLastPrompt && promptCount < 3) {
    return 'gentle_reminder';
  }
  return 'none';
}

function daysSince(iso?: string): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}
