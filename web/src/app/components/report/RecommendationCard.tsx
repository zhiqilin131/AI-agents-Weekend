import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router';
import { CheckCircle2 } from 'lucide-react';
import type { DecisionReport, ResourceDrop } from '../../model';
import { RESOURCE_DROP_CALENDAR_ID } from '../../model';
import { MarkdownContent } from '../MarkdownContent';
import { TypewriterText } from '../TypewriterText';
import { conciseReasoningPreview, isLongReasoning } from '../../../utils/recommendationNarration';
import { SlimeAdvisor, type SlimeAdvisorState } from './SlimeAdvisor';
import { SpeechBubble } from './SpeechBubble';
import { MiniReadAloudControl } from './MiniReadAloudControl';
import { ResourceDrops } from './ResourceDrops';
import { useSlimeProfile } from '../../../hooks/useSlimeProfile';
import { slimeBubbleLabel } from '../../../utils/slimeBubbleLabel';
import { playMp3BlobWithWebAudio, unlockSlimeAudioContext } from '../../../utils/slimeAudioContext';
import {
  fetchSlimeTtsBlob,
  slimeTtsHintForFetchError,
} from '../../../utils/slimeTtsFetch';

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
    /** Optional: server-side Calendar Agent draft before navigation */
    preNavigate?: () => Promise<void>;
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
  const { slimeProfile, refreshSlimeProfile } = useSlimeProfile();
  const [cloudSpeaking, setCloudSpeaking] = useState(false);
  const [cloudPaused, setCloudPaused] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [readAloudHint, setReadAloudHint] = useState('');
  const cloudAudioRef = useRef<HTMLAudioElement | null>(null);
  const cloudAudioUrlRef = useRef<string | null>(null);
  const cloudPendingBlobRef = useRef<Blob | null>(null);
  const cloudWebAudioStopRef = useRef<(() => void) | null>(null);
  const cloudTtsGenRef = useRef(0);

  const speechText = useMemo(() => {
    const t = title.trim();
    const r = reasoning.trim();
    if (t && r) return `${t}. ${r}`;
    return r || t;
  }, [title, reasoning]);

  const longBody = isLongReasoning(reasoning);
  const [showFullReasoning, setShowFullReasoning] = useState(false);
  /** After first typewriter pass for this reasoning/stream phase, toggles show instantly (no re-animation). */
  const [reasoningTypewriterDone, setReasoningTypewriterDone] = useState(false);
  const preview = useMemo(() => conciseReasoningPreview(reasoning), [reasoning]);

  useEffect(() => {
    setReasoningTypewriterDone(false);
  }, [reasoning, isStreaming]);
  /** After a streaming phase, fire one auto read-aloud when the card settles (same gesture chain as “generate report” if primed). */
  const autoSpokenAfterIdleRef = useRef(false);

  /** Report view often mounts while streaming; refetch slime when the card settles so colors/voice match Profile. */
  useEffect(() => {
    if (isStreaming) return;
    void refreshSlimeProfile();
  }, [isStreaming, refreshSlimeProfile]);

  const cleanupCloudAudio = useCallback(() => {
    cloudWebAudioStopRef.current?.();
    cloudWebAudioStopRef.current = null;
    const audio = cloudAudioRef.current;
    cloudAudioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
    }
    const url = cloudAudioUrlRef.current;
    cloudAudioUrlRef.current = null;
    if (url) URL.revokeObjectURL(url);
    cloudPendingBlobRef.current = null;
    setCloudSpeaking(false);
    setCloudPaused(false);
    setCloudLoading(false);
  }, []);

  const playCloudBlob = useCallback(
    async (blob: Blob, gen: number): Promise<'played' | 'blocked' | 'failed'> => {
      const finish = () => {
        if (gen === cloudTtsGenRef.current) cleanupCloudAudio();
      };
      const webOk = await playMp3BlobWithWebAudio(blob, {
        onStart: () => {
          if (gen !== cloudTtsGenRef.current) return;
          setCloudLoading(false);
          setCloudSpeaking(true);
          setCloudPaused(false);
        },
        onEnded: finish,
        trackSource: (node) => {
          cloudWebAudioStopRef.current = node
            ? () => {
                try {
                  node.stop();
                } catch {
                  /* already stopped */
                }
              }
            : null;
        },
      });
      if (gen !== cloudTtsGenRef.current) return 'failed';
      if (webOk) return 'played';

      const url = URL.createObjectURL(blob);
      cloudAudioUrlRef.current = url;
      const audio = new Audio(url);
      cloudAudioRef.current = audio;
      audio.setAttribute('playsinline', 'true');
      audio.onended = finish;
      audio.onerror = () => {
        if (gen !== cloudTtsGenRef.current) return;
        cleanupCloudAudio();
        setReadAloudHint('TTS audio could not play. Tap play again.');
      };
      try {
        await audio.play();
        if (gen !== cloudTtsGenRef.current) return 'failed';
        setCloudLoading(false);
        setCloudSpeaking(true);
        setCloudPaused(false);
        return 'played';
      } catch {
        if (gen !== cloudTtsGenRef.current) return 'failed';
        setCloudLoading(false);
        setCloudSpeaking(false);
        setCloudPaused(false);
        return 'blocked';
      }
    },
    [cleanupCloudAudio],
  );

  const startCloudReadAloud = useCallback(
    (opts?: { reuseBlob?: boolean }) => {
      const text = speechText.trim();
      if (!text) return;
      setReadAloudHint('');
      cloudTtsGenRef.current += 1;
      const gen = cloudTtsGenRef.current;
      const cached = opts?.reuseBlob ? cloudPendingBlobRef.current : null;
      if (!cached) cleanupCloudAudio();
      setCloudLoading(true);

      void (async () => {
        let blob = cached;
        if (!blob) {
          const fetched = await fetchSlimeTtsBlob(text, 'report-tts', {
            preferredVoiceName: slimeProfile.voice?.preferredVoiceName,
            rate: slimeProfile.voice?.rate,
          });
          if (gen !== cloudTtsGenRef.current) return;
          if (!fetched.ok) {
            cleanupCloudAudio();
            setReadAloudHint(slimeTtsHintForFetchError(fetched.kind, fetched.message));
            return;
          }
          blob = fetched.blob;
          cloudPendingBlobRef.current = blob;
        }
        if (gen !== cloudTtsGenRef.current) return;
        const outcome = await playCloudBlob(blob, gen);
        if (gen !== cloudTtsGenRef.current) return;
        if (outcome === 'blocked') {
          setReadAloudHint('Tap the play button to hear this — your browser blocked autoplay.');
        }
      })();
    },
    [cleanupCloudAudio, playCloudBlob, slimeProfile.voice, speechText],
  );

  useEffect(() => {
    if (isStreaming) {
      autoSpokenAfterIdleRef.current = false;
      return;
    }
    if (slimeProfile.voice?.enabled === false || !speechText.trim()) return;
    if (autoSpokenAfterIdleRef.current) return;
    autoSpokenAfterIdleRef.current = true;
    startCloudReadAloud();
  }, [isStreaming, speechText, slimeProfile.voice?.enabled, startCloudReadAloud]);

  useEffect(
    () => () => {
      cloudTtsGenRef.current += 1;
      cleanupCloudAudio();
    },
    [cleanupCloudAudio],
  );

  const dropsLoading = Boolean(resourceDropsLoading);
  const dropsList = resourceDrops ?? [];

  const baseMood: SlimeAdvisorState =
    (report.insights.biasRisks?.length ?? 0) > 0 ? 'cautious' : 'idle';
  const effectiveSlimeState: SlimeAdvisorState =
    (cloudSpeaking || cloudLoading) && !cloudPaused
      ? 'speaking'
      : isStreaming
        ? 'thinking'
        : dropsLoading
          ? 'thinking'
          : baseMood;

  const mouthSpeaking = (cloudSpeaking || cloudLoading) && !cloudPaused;

  const handleReadAloud = () => {
    if (!speechText.trim()) return;
    unlockSlimeAudioContext();
    setReadAloudHint('');
    if (cloudLoading) {
      cloudTtsGenRef.current += 1;
      cleanupCloudAudio();
      return;
    }
    if (cloudSpeaking && cloudAudioRef.current) {
      if (cloudPaused) {
        void cloudAudioRef.current.play();
        setCloudPaused(false);
        return;
      }
      cloudAudioRef.current.pause();
      setCloudPaused(true);
      return;
    }
    if (cloudPendingBlobRef.current && !cloudSpeaking && !cloudLoading) {
      cloudTtsGenRef.current += 1;
      const gen = cloudTtsGenRef.current;
      setCloudLoading(true);
      void playCloudBlob(cloudPendingBlobRef.current, gen).then((outcome) => {
        if (gen !== cloudTtsGenRef.current) return;
        if (outcome === 'blocked') {
          setReadAloudHint('Tap the play button again after interacting with the page.');
        } else if (outcome === 'failed') {
          cloudPendingBlobRef.current = null;
          startCloudReadAloud();
        }
      });
      return;
    }
    startCloudReadAloud();
  };

  const showCollapsedReasoning = longBody && !showFullReasoning && !isStreaming;

  const goCalendar = () => {
    void (async () => {
      if (!executionCalendar) return;
      try {
        if (executionCalendar.preNavigate) {
          await executionCalendar.preNavigate();
        }
      } catch {
        /* still navigate — planner can build locally */
      }
      executionCalendar.onExecutionCalendarNavigate
        ? executionCalendar.onExecutionCalendarNavigate(executionCalendar.decisionId)
        : executionCalendar.navigate(`/execution/${encodeURIComponent(executionCalendar.decisionId)}`);
    })();
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
              supported={typeof Audio !== 'undefined'}
              isPlaying={cloudLoading || cloudSpeaking}
              isPaused={cloudPaused}
              disabled={Boolean(isStreaming) || slimeProfile.voice?.enabled === false || !speechText.trim()}
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
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-purple-700/90">
              {slimeBubbleLabel(slimeProfile)}
            </p>
            {hasRec ? (
              isStreaming ? (
                <MarkdownContent
                  content={reasoning}
                  className="text-sm font-normal leading-relaxed text-gray-800 [&_p]:text-sm [&_p]:text-gray-800"
                />
              ) : showCollapsedReasoning ? (
                <TypewriterText
                  text={preview}
                  as="p"
                  className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800"
                  enabled={Boolean(preview) && !reasoningTypewriterDone}
                  onComplete={() => setReasoningTypewriterDone(true)}
                />
              ) : longBody ? (
                <MarkdownContent
                  content={reasoning}
                  className="text-sm leading-relaxed text-gray-800 [&_p]:text-sm [&_p]:text-gray-800"
                />
              ) : (
                <TypewriterText
                  text={reasoning}
                  as="p"
                  className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800"
                  enabled={Boolean(reasoning) && !reasoningTypewriterDone}
                  onComplete={() => setReasoningTypewriterDone(true)}
                />
              )
            ) : (
              <p className="text-sm leading-relaxed text-gray-600">Your recommendation is loading…</p>
            )}
            {longBody && !isStreaming ? (
              <button
                type="button"
                className="mt-3 text-xs font-semibold text-indigo-700 underline-offset-2 hover:underline"
                onClick={() => {
                  setShowFullReasoning((prev) => {
                    if (!prev) setReasoningTypewriterDone(true);
                    return !prev;
                  });
                }}
              >
                {showFullReasoning ? 'Show less' : 'Show full reasoning'}
              </button>
            ) : null}
          </SpeechBubble>
          {readAloudHint ? <p className="text-[11px] text-amber-800">{readAloudHint}</p> : null}
          {executionCalendar ? (
            <ResourceDrops drops={dropsList} loading={dropsLoading} onInternalCalendar={goCalendar} />
          ) : null}
        </div>
      </div>

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
