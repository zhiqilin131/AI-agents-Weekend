import { useCallback, useState } from 'react';
import type { TherapyExerciseResult, TherapyExerciseType, TherapyLabSessionState, TherapyNextAction } from './types';
import { buildExerciseResult } from './buildExerciseResult';
import { addTherapyActionToCalendar } from './therapyLabCalendar';
import { BreathingGuideExercise } from './exercises/BreathingGuideExercise';
import { EmotionCheckInExercise } from './exercises/EmotionCheckInExercise';
import { Grounding54321Exercise } from './exercises/Grounding54321Exercise';
import { CbtReframeExercise } from './exercises/CbtReframeExercise';
import { MicroActionPlanExercise } from './exercises/MicroActionPlanExercise';
import { SafetyEscalationPanel } from './components/SafetyEscalationPanel';
import { stopTherapyAudioNow } from './useTherapyAudio';

type Props = {
  exercise: TherapyExerciseType;
  session: TherapyLabSessionState;
  onSessionUpdate: (patch: Partial<TherapyLabSessionState>) => void;
  storageUserKey: string | null;
  storageReady: boolean;
};

export function TherapyLabExerciseHost({
  exercise,
  session,
  onSessionUpdate,
  storageUserKey,
  storageReady,
}: Props) {
  const [safetyActive, setSafetyActive] = useState(session.safetyActive);

  const handleStep = useCallback(
    (step: string) => onSessionUpdate({ currentStep: step }),
    [onSessionUpdate],
  );

  const handleComplete = useCallback(
    (result: TherapyExerciseResult) => {
      onSessionUpdate({
        lastResult: result,
        beforeIntensity: result.beforeIntensity,
        afterIntensity: result.afterIntensity,
        currentStep: 'complete',
      });
    },
    [onSessionUpdate],
  );

  const handleSafety = useCallback(() => {
    stopTherapyAudioNow();
    setSafetyActive(true);
    onSessionUpdate({ safetyActive: true, currentStep: 'safety_escalation' });
    const startedAt = new Date().toISOString();
    handleComplete(
      buildExerciseResult({
        exerciseType: exercise,
        startedAt,
        status: 'safety_stopped',
        resultSummary: 'Exercise paused for safety escalation.',
      }),
    );
  }, [exercise, handleComplete, onSessionUpdate]);

  const handleAddToCalendar = useCallback(
    async (action: TherapyNextAction) => {
      if (!storageUserKey) return;
      await addTherapyActionToCalendar(action, storageUserKey);
    },
    [storageUserKey],
  );

  if (safetyActive) {
    return <SafetyEscalationPanel onAcknowledge={() => setSafetyActive(false)} />;
  }

  const shared = {
    onStepChange: handleStep,
    onComplete: handleComplete,
    onSkip: () => handleStep('skipped'),
    onSafetyTriggered: handleSafety,
    onAddToCalendar: handleAddToCalendar,
  };

  switch (exercise) {
    case 'breathing_guide':
      return <BreathingGuideExercise {...shared} />;
    case 'emotion_check_in':
      return <EmotionCheckInExercise {...shared} />;
    case 'grounding_54321':
      return <Grounding54321Exercise {...shared} />;
    case 'cbt_thought_reframe':
      return <CbtReframeExercise {...shared} />;
    case 'micro_action_plan':
      return (
        <MicroActionPlanExercise
          {...shared}
          storageUserKey={storageUserKey}
          storageReady={storageReady}
        />
      );
    default:
      return null;
  }
}
