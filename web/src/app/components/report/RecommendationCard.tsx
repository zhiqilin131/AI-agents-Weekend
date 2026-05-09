import { useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router';
import { CheckCircle2 } from 'lucide-react';
import type { DecisionReport, ResourceDrop } from '../../model';
import { RESOURCE_DROP_CALENDAR_ID } from '../../model';
import { TypewriterText } from '../TypewriterText';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';
import {
  bubbleTextFromReasoning,
  conciseReasoningPreview,
  isLongReasoning,
  speechTextFromRecommendation,
} from '../../../utils/recommendationNarration';
import { SlimeAdvisor, type SlimeAdvisorState } from './SlimeAdvisor';
import { SpeechBubble } from './SpeechBubble';
import { MiniReadAloudControl } from './MiniReadAloudControl';
import { ResourceDrops } from './ResourceDrops';
import { useSlimeProfile } from '../../../hooks/useSlimeProfile';
import { slimeBubbleLabel } from '../../../utils/slimeBubbleLabel';

export function RecommendationCard({
  report,
  isStreaming,
  executionCalendar,
  resourceDrops,
  resourceDropsLoading,
}: {
  report: DecisionReport;
  isStreaming?: boolean;
  executionCalendar?: {
    decisionId: string;
    navigate: NavigateFunction;
    onExecutionCalendarNavigate?: (decisionId: string) => void;
  };
  resourceDrops?: ResourceDrop[];
  resourceDropsLoading?: boolean;
}) {
  const chosenOptionId = report.recommendation.chosenOption?.trim() ?? '';
  const optionTitleById = new Map(report.options.map((o) => [o.id, o.name]));
  const title =
    report.recommendation.chosenOptionName ||
    optionTitleById.get(chosenOptionId) ||
    report.recommendation.chosenOption ||
    '…';
  const reasoning = report.recommendation.reasoning?.trim() ?? '';
  const hasRec = Boolean(reasoning || chosenOptionId);
  const firstAction = report.actions[0]?.text;

  const bubbleText = useMemo(() => bubbleTextFromReasoning(reasoning, title), [reasoning, title]);
  const speechText = useMemo(
    () => speechTextFromRecommendation(title, bubbleText, firstAction),
    [title, bubbleText, firstAction],
  );

  const longBody = isLongReasoning(reasoning);
  const [showFullReasoning, setShowFullReasoning] = useState(false);
  const preview = useMemo(() => conciseReasoningPreview(reasoning), [reasoning]);

  const { supported, isSpeaking, isPaused, speak, pause, resume, cancel } = useSpeechSynthesis();
  const { slimeProfile, refreshSlimeProfile } = useSlimeProfile();
  /** After a streaming phase, fire one auto read-aloud when the card settles (same gesture chain as “generate report” if primed). */
  const autoSpokenAfterIdleRef = useRef(false);

  useEffect(() => () => cancel(), [cancel]);

  /** Report view often mounts while streaming; refetch slime when the card settles so colors/voice match Profile. */
  useEffect(() => {
    if (isStreaming) return;
    void refreshSlimeProfile();
  }, [isStreaming, refreshSlimeProfile]);

  const ttsOpts = useMemo(
    () => ({
      rate: slimeProfile.voice?.rate,
      pitch: slimeProfile.voice?.pitch,
      preferredVoiceName: slimeProfile.voice?.preferredVoiceName,
      onMayHaveBlocked: () => cancel(),
    }),
    [slimeProfile.voice?.rate, slimeProfile.voice?.pitch, slimeProfile.voice?.preferredVoiceName, cancel],
  );

  useEffect(() => {
    if (isStreaming) {
      autoSpokenAfterIdleRef.current = false;
      return;
    }
    if (!supported || !speechText.trim()) return;
    if (autoSpokenAfterIdleRef.current) return;
    autoSpokenAfterIdleRef.current = true;
    speak(speechText, ttsOpts);
  }, [isStreaming, speechText, supported, speak, ttsOpts]);

  const dropsLoading = Boolean(resourceDropsLoading);
  const dropsList = resourceDrops ?? [];

  const baseMood: SlimeAdvisorState =
    (report.insights.biasRisks?.length ?? 0) > 0 ? 'cautious' : 'idle';
  const effectiveSlimeState: SlimeAdvisorState =
    isSpeaking && !isPaused
      ? 'speaking'
      : isStreaming
        ? 'thinking'
        : dropsLoading
          ? 'thinking'
          : baseMood;

  const mouthSpeaking = isSpeaking && !isPaused;

  const handleReadAloud = () => {
    if (!supported) return;
    if (!isSpeaking) {
      speak(speechText, ttsOpts);
      return;
    }
    if (isPaused) {
      resume();
      return;
    }
    pause();
  };

  const showCollapsedReasoning = longBody && !showFullReasoning && !isStreaming;

  const goCalendar = () => {
    if (!executionCalendar) return;
    executionCalendar.onExecutionCalendarNavigate
      ? executionCalendar.onExecutionCalendarNavigate(executionCalendar.decisionId)
      : executionCalendar.navigate(`/execution/${encodeURIComponent(executionCalendar.decisionId)}`);
  };

  /** Avoid duplicate CTAs: slim chip replaces the big button once drops have loaded. */
  const hideBigCalendarButton =
    Boolean(executionCalendar) &&
    !dropsLoading &&
    dropsList.some((d) => d.id === RESOURCE_DROP_CALENDAR_ID);

  return (
    <section className="rounded-[24px] border border-white/90 bg-gradient-to-br from-white/85 to-purple-50/45 p-6 shadow-[0_8px_40px_rgba(0,0,0,0.06)] backdrop-blur-md">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-row items-end gap-2 sm:flex-col sm:items-center">
          {/* Report slime is decorative — disable hit targets so pulsing SVG/Motion layers cannot sit above the play control */}
          <SlimeAdvisor
            className="pointer-events-none"
            state={effectiveSlimeState}
            size="md"
            profile={slimeProfile}
          />
          <div className="relative z-20">
            <MiniReadAloudControl
              supported={supported}
              isPlaying={isSpeaking}
              isPaused={isPaused}
              disabled={Boolean(isStreaming) || !speechText.trim()}
              onPress={handleReadAloud}
            />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-purple-700">Recommendation</p>
            <p className="text-lg font-bold leading-snug text-gray-900">{title}</p>
            <p className="mt-1 text-[11px] text-gray-500">
              Best current path — no probability scores, just the tradeoffs behind the choice.
            </p>
          </div>
          <SpeechBubble speaking={mouthSpeaking} tailToward="start">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-purple-700/90">
              {slimeBubbleLabel(slimeProfile)}
            </p>
            <p className="text-sm font-medium leading-relaxed text-gray-800">{bubbleText}</p>
          </SpeechBubble>
          {executionCalendar ? (
            <ResourceDrops drops={dropsList} loading={dropsLoading} onInternalCalendar={goCalendar} />
          ) : null}
        </div>
      </div>

      {hasRec &&
        (isStreaming ? (
          <p className="whitespace-pre-wrap text-sm font-normal leading-relaxed text-gray-700">{reasoning}</p>
        ) : showCollapsedReasoning ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{preview}</p>
        ) : (
          <TypewriterText
            text={reasoning}
            as="p"
            className="text-sm leading-relaxed text-gray-700 whitespace-pre-wrap"
            enabled={Boolean(reasoning)}
          />
        ))}

      {longBody && !isStreaming ? (
        <button
          type="button"
          className="mt-3 text-xs font-semibold text-indigo-700 underline-offset-2 hover:underline"
          onClick={() => setShowFullReasoning((v) => !v)}
        >
          {showFullReasoning ? 'Show less' : 'Show full reasoning'}
        </button>
      ) : null}

      {executionCalendar && report.actions.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {report.actions.slice(0, 3).map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>
                {a.text}
                {a.deadline && <span className="ml-1 text-xs text-gray-500">({a.deadline})</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {executionCalendar && !hideBigCalendarButton ? (
        <div className="mt-4">
          <button
            type="button"
            data-testid="create-execution-calendar"
            onClick={goCalendar}
            className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-700"
          >
            Create execution calendar
          </button>
        </div>
      ) : null}
    </section>
  );
}
