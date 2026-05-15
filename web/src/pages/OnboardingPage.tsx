import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { apiFetch } from '../utils/apiFetch';
import { Button } from '../app/components/ui/button';
import { Progress } from '../app/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../app/components/ui/alert-dialog';
import {
  PRIORITY_QUESTIONS,
  PVQ_PORTRAITS,
  PVQ_SCORE_OPTIONS,
  buildDefaultPvqResponses,
  clearDraftFromStorage,
  createEmptyOnboardingDraft,
  generateValuesNarrative,
  loadDraftFromStorage,
  nowIso,
  saveDraftToStorage,
  type OnboardingDraft,
  type PriorityDomain,
  type PrioritySourceChoice,
  type PvqScore,
  withQuestionMarked,
} from '../features/onboarding/onboarding';
import type { UserProfile } from '../features/onboarding/types';

const DOMAIN_LABEL: Record<PriorityDomain, string> = {
  work: 'Work',
  relationships: 'Relationships',
  health: 'Health',
  finance: 'Finance',
  custom: 'Custom',
};

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampStep(v: number): number {
  if (v < 0) return 0;
  if (v > 4) return 4;
  return v;
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') || '';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [draft, setDraft] = useState<OnboardingDraft>(() => createEmptyOnboardingDraft());
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [step3SavingDone, setStep3SavingDone] = useState(false);

  const currentStep = clampStep(draft.step);
  const progressValue = ((currentStep + 1) / 5) * 100;

  const hydrateDraftFromProfile = useCallback((payload: UserProfile): OnboardingDraft => {
    const existing = payload.personal_profile;
    const draftFromProfile: OnboardingDraft = {
      ...createEmptyOnboardingDraft(),
      priorities: Array.isArray(existing?.priorities) ? existing.priorities : [],
      pvqResponses:
        Array.isArray(existing?.valuesProfile?.pvqResponses) && existing.valuesProfile.pvqResponses.length === 8
          ? existing.valuesProfile.pvqResponses
          : buildDefaultPvqResponses(),
      valuesNarrative: existing?.valuesProfile?.narrative || '',
      valuesEditedByUser: Boolean(existing?.valuesProfile?.editedByUser),
      skippedQuestions: existing?.onboardingStatus?.skippedQuestions ?? [],
    };
    for (const item of draftFromProfile.priorities) {
      if (item.domain !== 'custom') {
        draftFromProfile.prioritySelections[item.domain] = item.sourceChoice || 'custom';
      }
    }
    const local = loadDraftFromStorage();
    if (!local) {
      if (!draftFromProfile.valuesNarrative.trim()) {
        draftFromProfile.valuesNarrative = generateValuesNarrative(draftFromProfile.pvqResponses);
      }
      return draftFromProfile;
    }
    const merged: OnboardingDraft = {
      ...draftFromProfile,
      ...local,
      step: clampStep(local.step ?? draftFromProfile.step),
      priorities: Array.isArray(local.priorities) ? local.priorities : draftFromProfile.priorities,
      pvqResponses:
        Array.isArray(local.pvqResponses) && local.pvqResponses.length === 8
          ? local.pvqResponses
          : draftFromProfile.pvqResponses,
      skippedQuestions: Array.isArray(local.skippedQuestions) ? local.skippedQuestions : draftFromProfile.skippedQuestions,
    };
    if (!merged.valuesNarrative.trim()) merged.valuesNarrative = generateValuesNarrative(merged.pvqResponses);
    return merged;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch('/api/profile');
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as UserProfile;
        if (cancelled) return;
        setProfile(data);
        setDraft(hydrateDraftFromProfile(data));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateDraftFromProfile]);

  useEffect(() => {
    if (loading) return;
    saveDraftToStorage(draft);
  }, [draft, loading]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (step3SavingDone) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [step3SavingDone]);

  const updatePriorityByDomain = useCallback((domain: PriorityDomain, choice: PrioritySourceChoice) => {
    const option = PRIORITY_QUESTIONS.find((item) => item.id === domain)?.options.find((item) => item.id === choice);
    if (!option) return;
    setDraft((prev) => {
      const ts = nowIso();
      const nextPriorities = [...prev.priorities];
      const existingIdx = nextPriorities.findIndex((item) => item.domain === domain);
      const base = {
        id: existingIdx >= 0 ? nextPriorities[existingIdx]!.id : randomId(),
        domain,
        text: option.draft,
        sourceChoice: choice,
        createdAt: existingIdx >= 0 ? nextPriorities[existingIdx]!.createdAt : ts,
        updatedAt: ts,
      };
      if (existingIdx >= 0) nextPriorities[existingIdx] = base;
      else nextPriorities.push(base);
      return {
        ...prev,
        priorities: nextPriorities,
        prioritySelections: { ...prev.prioritySelections, [domain]: choice },
        skippedQuestions: withQuestionMarked(prev.skippedQuestions, `priority:${domain}`, false),
      };
    });
  }, []);

  const markPrioritySkipped = useCallback((domain: PriorityDomain) => {
    setDraft((prev) => ({
      ...prev,
      priorities: prev.priorities.filter((item) => item.domain !== domain),
      prioritySelections: { ...prev.prioritySelections, [domain]: 'skipped' },
      skippedQuestions: withQuestionMarked(prev.skippedQuestions, `priority:${domain}`, true),
    }));
  }, []);

  const persistProfile = useCallback(
    async (opts: { completed: boolean; incrementPrompt: boolean }) => {
      if (!profile) throw new Error('Profile is not ready');
      const ts = nowIso();
      const pvqResponses = draft.pvqResponses.length === 8 ? draft.pvqResponses : buildDefaultPvqResponses();
      const priorities = draft.priorities.filter((item) => item.text.trim()).map((item) => ({
        ...item,
        text: item.text.trim(),
        updatedAt: ts,
      }));
      const selectedValueKeywords = pvqResponses
        .filter((x) => x.score === 'very_like' || x.score === 'somewhat_like')
        .map((x) => PVQ_PORTRAITS.find((p) => p.portraitId === x.portraitId)?.keyword)
        .filter((x): x is string => Boolean(x));
      const statusPrev = profile.personal_profile?.onboardingStatus;
      const nextPromptCount = opts.incrementPrompt ? (statusPrev?.promptCount ?? 0) + 1 : statusPrev?.promptCount ?? 0;
      const personalProfile = {
        priorities,
        valuesProfile: {
          pvqResponses,
          narrative: draft.valuesNarrative.trim() || generateValuesNarrative(pvqResponses),
          generatedAt: ts,
          editedByUser: draft.valuesEditedByUser,
        },
        onboardingStatus: {
          completed: opts.completed,
          completedAt: opts.completed ? ts : statusPrev?.completedAt,
          skippedQuestions: draft.skippedQuestions,
          lastPromptedAt: opts.incrementPrompt ? ts : statusPrev?.lastPromptedAt,
          promptCount: nextPromptCount,
        },
      };
      const body: UserProfile = {
        ...profile,
        user_priorities: priorities.map((item) => item.text),
        priorities: priorities.map((item) => item.text),
        values: selectedValueKeywords,
        personal_profile: personalProfile,
      };
      const res = await apiFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setProfile((prev) => (prev ? { ...prev, ...body } : body));
    },
    [draft, profile],
  );

  const continueFromStep3 = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await persistProfile({ completed: true, incrementPrompt: false });
      setStep3SavingDone(true);
      clearDraftFromStorage();
      setDraft((prev) => ({ ...prev, step: 4 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save onboarding');
    } finally {
      setSaving(false);
    }
  }, [persistProfile]);

  const saveAndExit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await persistProfile({ completed: false, incrementPrompt: true });
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save onboarding draft');
    } finally {
      setSaving(false);
      setExitConfirmOpen(false);
    }
  }, [navigate, persistProfile]);

  const priorityCursorQuestion = PRIORITY_QUESTIONS[draft.priorityCursor] || PRIORITY_QUESTIONS[0];
  const selectedPriorityChoice = draft.prioritySelections[priorityCursorQuestion.id];
  const selectedPriorityRow = draft.priorities.find((item) => item.domain === priorityCursorQuestion.id);
  const currentPortrait = PVQ_PORTRAITS[draft.pvqCursor] || PVQ_PORTRAITS[0];
  const currentPortraitResponse = draft.pvqResponses.find((item) => item.portraitId === currentPortrait.portraitId);

  const orderedPriorityRows = useMemo(() => {
    const order: PriorityDomain[] = ['work', 'relationships', 'health', 'finance', 'custom'];
    return [...draft.priorities].sort((a, b) => order.indexOf(a.domain) - order.indexOf(b.domain));
  }, [draft.priorities]);

  if (loading) {
    return <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] p-6 text-sm text-gray-600">Loading onboarding…</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-4 md:px-8">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-white/90 bg-white/85 p-4 shadow-md md:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Step {currentStep + 1} of 5</p>
            <Progress value={progressValue} className="mt-2 h-2" />
          </div>
          <Button variant="ghost" className="text-xs text-gray-600" onClick={() => setExitConfirmOpen(true)} disabled={saving}>
            Save and exit
          </Button>
        </div>

        {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</div> : null}
        {mode === 'force_initial' ? (
          <p className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50/80 px-3 py-2 text-xs text-indigo-900">
            A quick setup helps me give you more tailored suggestions. You can choose "I am not sure yet" on any question.
          </p>
        ) : null}

        {currentStep === 0 ? (
          <section className="space-y-4">
            <h1 className="text-2xl text-gray-900" style={{ fontWeight: 700 }}>Before we begin, let me get to know you a little.</h1>
            <div className="space-y-2 text-sm leading-relaxed text-gray-700">
              <p>Foresight-X is most useful when it understands what matters to you.</p>
              <p>
                In the next 3-4 minutes, I will ask a few questions to build your Personal Profile. It guides how I support your future decisions.
              </p>
              <p>You can skip any question, and you can edit everything later.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                onClick={() => setDraft((prev) => ({ ...prev, step: 1 }))}
                className="rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-5 text-white"
              >
                Start →
              </Button>
              <button
                type="button"
                className="text-xs text-gray-500 underline underline-offset-4"
                onClick={() => setExitConfirmOpen(true)}
              >
                Skip for now
              </button>
            </div>
          </section>
        ) : null}

        {currentStep === 1 ? (
          <section className="space-y-4">
            <h2 className="text-xl text-gray-900" style={{ fontWeight: 700 }}>Priorities</h2>
            <p className="text-sm text-gray-700">This helps me understand your hard constraints—the things you want me to always remember.</p>
            {!draft.stepOneSummary ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={priorityCursorQuestion.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.24 }}
                  className="space-y-3 rounded-xl border border-gray-200/80 bg-white p-4"
                >
                  <p className="text-xs uppercase tracking-wide text-indigo-700">{priorityCursorQuestion.title}</p>
                  <p className="text-sm text-gray-900">{priorityCursorQuestion.question}</p>
                  <div className="space-y-2">
                    {priorityCursorQuestion.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${
                          selectedPriorityChoice === option.id
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                            : 'border-gray-200 bg-white text-gray-800 hover:border-indigo-200'
                        }`}
                        onClick={() => updatePriorityByDomain(priorityCursorQuestion.id, option.id)}
                      >
                        <p className="font-semibold">{option.id}. {option.label}</p>
                        <p className="mt-1 text-xs text-gray-600">{option.description}</p>
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                        selectedPriorityChoice === 'skipped'
                          ? 'border-gray-400 bg-gray-100 text-gray-700'
                          : 'border-dashed border-gray-300 bg-gray-50 text-gray-500'
                      }`}
                      onClick={() => markPrioritySkipped(priorityCursorQuestion.id)}
                    >
                      ⊘ I am not sure yet - things are in transition
                    </button>
                  </div>
                  {selectedPriorityRow ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                      <p>✓ Saved: {selectedPriorityRow.text}</p>
                      <textarea
                        className="mt-2 min-h-[72px] w-full rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-sm"
                        value={selectedPriorityRow.text}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            priorities: prev.priorities.map((item) =>
                              item.id === selectedPriorityRow.id
                                ? { ...item, text: e.target.value, updatedAt: nowIso() }
                                : item,
                            ),
                          }))
                        }
                      />
                    </div>
                  ) : null}
                  {selectedPriorityChoice === 'skipped' ? (
                    <p className="text-xs text-gray-500">Saved as "I am not sure yet." You can fill this in on the preview step later.</p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <Button
                      variant="outline"
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, priorityCursor: Math.max(0, prev.priorityCursor - 1) }))
                      }
                      disabled={draft.priorityCursor === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      onClick={() =>
                        setDraft((prev) => {
                          if (prev.priorityCursor >= PRIORITY_QUESTIONS.length - 1) {
                            return { ...prev, stepOneSummary: true };
                          }
                          return { ...prev, priorityCursor: prev.priorityCursor + 1 };
                        })
                      }
                      disabled={!selectedPriorityChoice}
                    >
                      {draft.priorityCursor >= PRIORITY_QUESTIONS.length - 1 ? 'Review this step' : '⏭ Next'}
                    </Button>
                  </div>
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-sm text-gray-700">Saved priorities ({orderedPriorityRows.length})</p>
                {orderedPriorityRows.length > 0 ? (
                  <ul className="space-y-2 text-sm text-gray-900">
                    {orderedPriorityRows.map((item) => (
                      <li key={item.id} className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                        {DOMAIN_LABEL[item.domain]}：{item.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">No priorities saved yet. You can complete this later.</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="outline" onClick={() => setDraft((prev) => ({ ...prev, stepOneSummary: false }))}>
                    Back to questions
                  </Button>
                  <Button onClick={() => setDraft((prev) => ({ ...prev, step: 2 }))}>✓ Looks good, continue →</Button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {currentStep === 2 ? (
          <section className="space-y-4">
            <h2 className="text-xl text-gray-900" style={{ fontWeight: 700 }}>Values</h2>
            <p className="text-sm text-gray-700">
              Next are 8 short prompts, each describing a person. Tell me how much this person is like you. There are no right or wrong answers.
            </p>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentPortrait.portraitId}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.24 }}
                className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
              >
                <p className="text-xs uppercase tracking-wide text-indigo-700">Question {draft.pvqCursor + 1} / 8</p>
                <p className="text-base leading-relaxed text-gray-900">{currentPortrait.text}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PVQ_SCORE_OPTIONS.map((score) => (
                    <button
                      key={score.value}
                      type="button"
                      className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm ${
                        currentPortraitResponse?.score === score.value
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                          : 'border-gray-200 bg-white text-gray-800 hover:border-indigo-200'
                      }`}
                      onClick={() => {
                        setDraft((prev) => {
                          const nextResponses = prev.pvqResponses.map((item) =>
                            item.portraitId === currentPortrait.portraitId ? { ...item, score: score.value } : item,
                          );
                          const nextSkipped = withQuestionMarked(prev.skippedQuestions, `pvq:${currentPortrait.portraitId}`, false);
                          const nextCursor =
                            prev.pvqCursor >= PVQ_PORTRAITS.length - 1 ? prev.pvqCursor : prev.pvqCursor + 1;
                          const nextNarrative = prev.valuesEditedByUser
                            ? prev.valuesNarrative
                            : generateValuesNarrative(nextResponses);
                          return {
                            ...prev,
                            pvqResponses: nextResponses,
                            skippedQuestions: nextSkipped,
                            pvqCursor: nextCursor,
                            valuesNarrative: nextNarrative,
                          };
                        });
                      }}
                    >
                      {score.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="text-xs text-gray-500 underline underline-offset-4"
                  onClick={() => {
                    setDraft((prev) => {
                      const nextResponses = prev.pvqResponses.map((item) =>
                        item.portraitId === currentPortrait.portraitId ? { ...item, score: 'skipped' as PvqScore } : item,
                      );
                      const nextCursor =
                        prev.pvqCursor >= PVQ_PORTRAITS.length - 1 ? prev.pvqCursor : prev.pvqCursor + 1;
                      const nextNarrative = prev.valuesEditedByUser
                        ? prev.valuesNarrative
                        : generateValuesNarrative(nextResponses);
                      return {
                        ...prev,
                        pvqResponses: nextResponses,
                        skippedQuestions: withQuestionMarked(prev.skippedQuestions, `pvq:${currentPortrait.portraitId}`, true),
                        pvqCursor: nextCursor,
                        valuesNarrative: nextNarrative,
                      };
                    });
                  }}
                >
                  ⊘ I am not sure yet
                </button>
              </motion.div>
            </AnimatePresence>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => setDraft((prev) => ({ ...prev, pvqCursor: Math.max(0, prev.pvqCursor - 1) }))}
                disabled={draft.pvqCursor === 0}
              >
                Previous
              </Button>
              <Button onClick={() => setDraft((prev) => ({ ...prev, step: 3 }))}>Continue to preview</Button>
            </div>
          </section>
        ) : null}

        {currentStep === 3 ? (
          <section className="space-y-5">
            <h2 className="text-xl text-gray-900" style={{ fontWeight: 700 }}>Here is my initial understanding of you</h2>
            <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Your priorities</p>
              {orderedPriorityRows.length > 0 ? (
                orderedPriorityRows.map((item) => (
                  <div key={item.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="mb-1 text-xs text-gray-600">{DOMAIN_LABEL[item.domain]}</p>
                    <div className="flex items-start gap-2">
                      <textarea
                        className="min-h-[60px] flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                        value={item.text}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            priorities: prev.priorities.map((row) =>
                              row.id === item.id ? { ...row, text: e.target.value, updatedAt: nowIso() } : row,
                            ),
                          }))
                        }
                      />
                      <Button
                        variant="ghost"
                        className="text-xs text-rose-700"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            priorities: prev.priorities.filter((row) => row.id !== item.id),
                          }))
                        }
                      >
                        ✕
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No priority saved yet. You can add one below.</p>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    priorities: [
                      ...prev.priorities,
                      {
                        id: randomId(),
                        domain: 'custom',
                        text: '',
                        sourceChoice: 'custom',
                        createdAt: nowIso(),
                        updatedAt: nowIso(),
                      },
                    ],
                  }))
                }
              >
                + Add a new priority
              </Button>
            </div>

            <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Your values narrative</p>
              <textarea
                className="min-h-[96px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                value={draft.valuesNarrative}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    valuesNarrative: e.target.value,
                    valuesEditedByUser: true,
                  }))
                }
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" onClick={() => setDraft((prev) => ({ ...prev, step: 2 }))}>
                Back
              </Button>
              <Button onClick={() => void continueFromStep3()} disabled={saving}>
                {saving ? 'Saving…' : '✓ Looks good, finish setup'}
              </Button>
            </div>
          </section>
        ) : null}

        {currentStep === 4 ? (
          <section className="space-y-4 text-center">
            <h2 className="text-2xl text-gray-900" style={{ fontWeight: 700 }}>✓ All set</h2>
            <div className="space-y-2 text-sm text-gray-700">
              <p>Your Personal Profile is now created.</p>
              <p>From now on, when you describe a choice in Decision Space, I will use this context.</p>
              <p>You can edit or add details anytime in your Profile.</p>
            </div>
            <div className="flex flex-col items-center gap-2 pt-2">
              <Button
                className="rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-5 text-white"
                onClick={() => navigate('/', { replace: true })}
              >
                Start my first Decision Session →
              </Button>
              <Button variant="ghost" onClick={() => navigate('/', { replace: true })}>
                Back to Home
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave for now?</AlertDialogTitle>
            <AlertDialogDescription>
              Your progress will be saved, and you can continue from this step next time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => void saveAndExit()} disabled={saving}>
              {saving ? 'Saving…' : 'Save and exit'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
