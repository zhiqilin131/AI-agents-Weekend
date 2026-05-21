export type TherapyExerciseType =
  | 'breathing_guide'
  | 'emotion_check_in'
  | 'grounding_54321'
  | 'cbt_thought_reframe'
  | 'micro_action_plan';

export type TherapyExerciseStatus = 'idle' | 'in_progress' | 'completed' | 'skipped' | 'safety_stopped';

export type TherapyExerciseSource = 'therapy_lab';

export type TherapyNextAction = {
  id: string;
  label: string;
  calendarTitle?: string;
  durationMinutes?: number;
};

export type TherapyExerciseResult = {
  exerciseType: TherapyExerciseType;
  source: TherapyExerciseSource;
  startedAt: string;
  endedAt: string;
  status: TherapyExerciseStatus;
  beforeIntensity?: number;
  afterIntensity?: number;
  resultSummary: string;
  memoryCandidate: string;
  nextActions: TherapyNextAction[];
  payload?: Record<string, unknown>;
};

export type TherapyExerciseCallbacks = {
  onStart?: () => void;
  onComplete: (result: TherapyExerciseResult) => void;
  onSkip?: () => void;
  onAddToCalendar?: (action: TherapyNextAction) => void | Promise<void>;
};

export type TherapyLabSessionState = {
  selectedExercise: TherapyExerciseType | null;
  currentStep: string;
  beforeIntensity?: number;
  afterIntensity?: number;
  lastResult: TherapyExerciseResult | null;
  safetyActive: boolean;
};

export const THERAPY_EXERCISE_LABELS: Record<TherapyExerciseType, { title: string; blurb: string }> = {
  breathing_guide: {
    title: 'Breathing guide',
    blurb: 'Slow paced breathing with a gentle visual rhythm.',
  },
  emotion_check_in: {
    title: 'Emotion check-in',
    blurb: 'Name how you feel and what kind of support you want.',
  },
  grounding_54321: {
    title: '5-4-3-2-1 grounding',
    blurb: 'Reconnect with your senses, one step at a time.',
  },
  cbt_thought_reframe: {
    title: 'Thought reframe',
    blurb: 'Gently examine a thought — not a diagnosis.',
  },
  micro_action_plan: {
    title: 'Micro action plan',
    blurb: 'Pick one tiny step that fits your energy.',
  },
};
