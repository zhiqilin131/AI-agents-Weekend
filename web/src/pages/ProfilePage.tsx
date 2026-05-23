import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Crown,
  Database,
  Heart,
  ListChecks,
  Pencil,
  Save,
  User,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { MainNavButtons } from '../app/components/MainNavButtons';
import { apiFetch } from '../utils/apiFetch';
import { SlimeCreditIcon } from '../app/components/credits/SlimeCreditIcon';
import { useSlimeCredits } from '../app/components/credits/SlimeCreditsContext';
import { ModelSelector } from '../features/models/ModelSelector';
import { patchDefaultModelOption } from '../features/models/slimeModelsApi';
import {
  readSlimeLegendaryMode,
  setSlimeLegendaryMode,
  SLIME_LEGENDARY_MODEL_ID,
} from '../features/models/legendaryMode';
import { useSlimeModelCatalog } from '../features/models/useSlimeModelCatalog';
import { Button } from '../app/components/ui/button';
import { Input } from '../app/components/ui/input';
import { cn } from '../app/components/ui/utils';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseEnvConfigured } from '../auth/RequireAuthLayout';
import { formatProfileMemoryToastAt } from '../app/components/shadow/ProfileMemoryToastStack';

function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function listToLines(items: string[]): string {
  return items.join('\n');
}

type ProfileLineRow = {
  id?: string;
  text: string;
  origin: 'user' | 'system';
  channel?: string;
  created_at?: string;
};

type MemoryFactRow = {
  id?: string;
  category: string;
  text: string;
  source?: string;
  created_at?: string;
  subject_ref?: string;
  predicate?: string;
  object_value?: string;
  evidence?: string;
  status?: string;
  qualifiers?: Record<string, unknown>;
};

function isSlimeCompanionMemoryFact(f: MemoryFactRow): boolean {
  const q = f.qualifiers?.memory_owner ?? f.qualifiers?.memoryOwner;
  if (typeof q === 'string' && ['slime_companion', 'slime', 'buddy'].includes(q.toLowerCase())) return true;
  const sr = (f.subject_ref || '').trim().toLowerCase();
  return ['slime_companion', 'buddy', 'companion', 'slime_buddy', 'companion_agent'].includes(sr);
}

function isWellbeingMemoryFact(f: MemoryFactRow): boolean {
  if ((f.category || '').toLowerCase() === 'wellbeing') return true;
  const domain = f.qualifiers?.memory_domain;
  if (typeof domain === 'string' && domain.toLowerCase() === 'wellbeing') return true;
  if ((f.text || '').toLowerCase().startsWith('[rimumu check-in]')) return true;
  return false;
}

function wellbeingRecordLabel(f: MemoryFactRow): string {
  const rt = f.qualifiers?.record_type;
  if (rt === 'checkin') return 'Check-in';
  if (rt === 'session_insight') return 'Session insight';
  return 'Wellbeing';
}

const CHANNEL_LABEL: Record<string, string> = {
  profile: 'Profile',
  clarification: 'Clarification',
  shadow: 'Shadow',
  personalize: 'Personalize',
  legacy: 'Recorded',
};

const MEMORY_CAT_LABEL: Record<string, string> = {
  identity: 'Identity',
  views: 'Views, opinions & interests',
  behavior: 'Behavior & habits',
  goals: 'Goals',
  constraints: 'Constraints',
  clarification: 'Decision clarifications',
  other: 'Other',
};

export default function ProfilePage() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const { credits: slimeCredits, loading: slimeCreditsLoading, refresh: refreshSlimeCredits } = useSlimeCredits();
  const slimeModels = useSlimeModelCatalog();
  const legendaryEggBusyRef = useRef(false);
  const [legendarySplash, setLegendarySplash] = useState(false);
  const [defaultModelOptionId, setDefaultModelOptionId] = useState('');
  const [userPriorities, setUserPriorities] = useState('');
  const [clarificationRows, setClarificationRows] = useState<ProfileLineRow[]>([]);
  const [systemRows, setSystemRows] = useState<ProfileLineRow[]>([]);
  const [memoryFacts, setMemoryFacts] = useState<MemoryFactRow[]>([]);
  const [preferredName, setPreferredName] = useState('');
  const [aboutMe, setAboutMe] = useState('');
  const [constraints, setConstraints] = useState('');
  const [values, setValues] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [memoryEditMode, setMemoryEditMode] = useState(false);
  const [selectedMemoryCat, setSelectedMemoryCat] = useState<string>('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    credits: true,
    priorities: false,
    memory: false,
    wellbeing: false,
    legacy: false,
    context: false,
  });

  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [creditRedeemMsg, setCreditRedeemMsg] = useState<string | null>(null);
  const [creditRedeemErr, setCreditRedeemErr] = useState<string | null>(null);
  const [creditTxBusy, setCreditTxBusy] = useState(false);
  const [recentCreditTx, setRecentCreditTx] = useState<
    Array<{
      id?: string;
      type?: string;
      amount?: number;
      reason?: string;
      feature?: string;
      created_at?: string;
    }>
  >([]);

  const loadCreditTx = useCallback(async () => {
    setCreditTxBusy(true);
    try {
      const res = await apiFetch('/api/usage/transactions?limit=8');
      if (!res.ok) return;
      const data = (await res.json()) as { transactions?: typeof recentCreditTx };
      setRecentCreditTx(Array.isArray(data.transactions) ? data.transactions : []);
    } finally {
      setCreditTxBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadCreditTx();
  }, [loadCreditTx, slimeCredits?.balance, slimeCredits?.display_balance]);

  const redeemProfileCode = async () => {
    setCreditRedeemErr(null);
    setCreditRedeemMsg(null);
    const code = redeemCodeInput.trim();
    if (!code) {
      setCreditRedeemErr('Enter a code first.');
      return;
    }
    try {
      const resV = await apiFetch('/api/usage/redeem-voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const jV = (await resV.json()) as { ok?: boolean; message?: string; error?: string };
      if (jV.ok) {
        setCreditRedeemMsg(typeof jV.message === 'string' ? jV.message : 'Redeemed.');
        setRedeemCodeInput('');
        await refreshSlimeCredits();
        await loadCreditTx();
        return;
      }
      if (jV.error === 'already_redeemed') {
        setCreditRedeemErr(typeof jV.message === 'string' ? jV.message : 'You already used this code.');
        return;
      }
      const resT = await apiFetch('/api/usage/redeem-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const jT = (await resT.json()) as { ok?: boolean; message?: string };
      if (!jT.ok) {
        setCreditRedeemErr(typeof jT.message === 'string' ? jT.message : 'That code is not valid.');
        return;
      }
      setCreditRedeemMsg(typeof jT.message === 'string' ? jT.message : 'Redeemed.');
      setRedeemCodeInput('');
      await refreshSlimeCredits();
      await loadCreditTx();
    } catch {
      setCreditRedeemErr('Network error — try again.');
    }
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch('/api/profile');
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        user_priorities?: string[];
        priorities?: string[];
        inferred_priorities?: string[];
        priority_lines?: ProfileLineRow[];
        memory_facts?: MemoryFactRow[];
        preferred_name?: string;
        about_me: string;
        constraints: string[];
        values: string[];
        timezone?: string;
        default_model_option_id?: string;
      };
      const pl = data.priority_lines;
      if (Array.isArray(pl) && pl.length > 0) {
        const profileOnly = pl.filter((x) => x.origin === 'user' && x.channel === 'profile').map((x) => x.text);
        setUserPriorities(listToLines(profileOnly));
        setClarificationRows(pl.filter((x) => x.origin === 'user' && x.channel === 'clarification'));
        setSystemRows(pl.filter((x) => x.origin === 'system'));
      } else {
        const stated = data.user_priorities?.length ? data.user_priorities : (data.priorities ?? []);
        setUserPriorities(listToLines(stated));
        setClarificationRows([]);
        setSystemRows(
          (data.inferred_priorities ?? []).map((text) => ({
            text,
            origin: 'system' as const,
            channel: 'legacy',
          })),
        );
      }
      setMemoryFacts(Array.isArray(data.memory_facts) ? data.memory_facts : []);
      setPreferredName((data.preferred_name ?? '').trim());
      setAboutMe(data.about_me ?? '');
      setConstraints(listToLines(data.constraints ?? []));
      setValues(listToLines(data.values ?? []));
      setTimezone((data.timezone || 'UTC').trim() || 'UTC');
      setDefaultModelOptionId((data.default_model_option_id || '').trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setMessage(null);
    setError(null);
    try {
      const body = {
        user_priorities: linesToList(userPriorities),
        priorities: linesToList(userPriorities),
        preferred_name: preferredName.trim(),
        about_me: aboutMe.trim(),
        constraints: linesToList(constraints),
        values: linesToList(values),
        timezone: timezone.trim() || 'UTC',
        ...(defaultModelOptionId ? { default_model_option_id: defaultModelOptionId } : {}),
      };
      const res = await apiFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { ok?: boolean; path?: string };
      setMessage(data.path ? `Saved to ${data.path}` : 'Saved.');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const deletePriorityLine = async (id: string) => {
    if (!id) {
      setError('This row has no id yet — save the profile once to assign ids, then delete.');
      return;
    }
    setDeletingId(id);
    setError(null);
    try {
      const res = await apiFetch(`/api/profile/priority-line/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setMessage('Removed.');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const deleteMemoryFact = async (id: string) => {
    if (!id) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await apiFetch(`/api/profile/memory-fact/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setMessage('Memory fact removed.');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const deleteStructuredRow = async (f: MemoryFactRow) => {
    if (!f.id) return;
    const fromClarification =
      f.source === 'clarification' || Boolean(f.qualifiers && (f.qualifiers as { from_priority_line?: boolean }).from_priority_line);
    if (fromClarification) await deletePriorityLine(f.id);
    else await deleteMemoryFact(f.id);
  };

  const wellbeingMemoryFacts = useMemo(
    () =>
      memoryFacts
        .filter((f) => isWellbeingMemoryFact(f))
        .sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || '')),
    [memoryFacts],
  );
  const userMemoryFacts = useMemo(
    () => memoryFacts.filter((f) => !isSlimeCompanionMemoryFact(f) && !isWellbeingMemoryFact(f)),
    [memoryFacts],
  );
  const slimeMemoryFacts = useMemo(() => memoryFacts.filter((f) => isSlimeCompanionMemoryFact(f)), [memoryFacts]);

  /** Priority lines from decision-run clarification — shown inside Structured memory, not a separate section. */
  const clarificationAsMemoryFacts = useMemo((): MemoryFactRow[] => {
    return clarificationRows.map((row) => ({
      id: row.id,
      category: 'clarification',
      text: row.text,
      source: 'clarification',
      qualifiers: { from_priority_line: true as const },
    }));
  }, [clarificationRows]);

  const mergedUserProfileFacts = useMemo(
    () => [...userMemoryFacts, ...clarificationAsMemoryFacts],
    [userMemoryFacts, clarificationAsMemoryFacts],
  );

  const factsByCat = useMemo(
    () =>
      mergedUserProfileFacts.reduce<Record<string, MemoryFactRow[]>>((acc, f) => {
        const k = f.category || 'other';
        if (!acc[k]) acc[k] = [];
        acc[k].push(f);
        return acc;
      }, {}),
    [mergedUserProfileFacts],
  );

  const slimeFactsByCat = useMemo(
    () =>
      slimeMemoryFacts.reduce<Record<string, MemoryFactRow[]>>((acc, f) => {
        const k = f.category || 'other';
        if (!acc[k]) acc[k] = [];
        acc[k].push(f);
        return acc;
      }, {}),
    [slimeMemoryFacts],
  );

  const memoryCatOrder = useMemo(() => {
    const preferred = ['identity', 'views', 'behavior', 'goals', 'constraints', 'clarification', 'other'];
    const existing = Object.keys(factsByCat);
    const inOrder = preferred.filter((k) => existing.includes(k));
    const rest = existing.filter((k) => !preferred.includes(k)).sort();
    return [...inOrder, ...rest];
  }, [factsByCat]);

  const slimeMemoryCatOrder = useMemo(() => {
    const preferred = ['identity', 'views', 'behavior', 'goals', 'constraints', 'other'];
    const existing = Object.keys(slimeFactsByCat);
    const inOrder = preferred.filter((k) => existing.includes(k));
    const rest = existing.filter((k) => !preferred.includes(k)).sort();
    return [...inOrder, ...rest];
  }, [slimeFactsByCat]);

  useEffect(() => {
    if (!memoryCatOrder.length) {
      setSelectedMemoryCat('');
      return;
    }
    if (!selectedMemoryCat || !memoryCatOrder.includes(selectedMemoryCat)) {
      setSelectedMemoryCat(memoryCatOrder[0] ?? '');
    }
  }, [memoryCatOrder, selectedMemoryCat]);

  /** If the profile default is the hidden tier but legendary mode is off, realign to a visible tier. */
  useEffect(() => {
    if (!slimeModels.ready || slimeModels.loading) return;
    const has55 = slimeModels.models.some((m) => m.id === SLIME_LEGENDARY_MODEL_ID);
    if (!has55 && defaultModelOptionId === SLIME_LEGENDARY_MODEL_ID) {
      const fb = slimeModels.defaultModel || 'little';
      setDefaultModelOptionId(fb);
      void patchDefaultModelOption(fb).catch(() => {});
    }
  }, [
    slimeModels.ready,
    slimeModels.loading,
    slimeModels.models,
    slimeModels.defaultModel,
    defaultModelOptionId,
  ]);

  const onLegendaryEggClick = async () => {
    if (legendaryEggBusyRef.current) return;
    legendaryEggBusyRef.current = true;
    setError(null);
    try {
      const turnOn = !readSlimeLegendaryMode();
      if (turnOn) {
        setSlimeLegendaryMode(true);
        setLegendarySplash(true);
        await patchDefaultModelOption(SLIME_LEGENDARY_MODEL_ID);
        setDefaultModelOptionId(SLIME_LEGENDARY_MODEL_ID);
        await slimeModels.refresh();
      } else {
        setLegendarySplash(false);
        setSlimeLegendaryMode(false);
        await patchDefaultModelOption('little');
        setDefaultModelOptionId('little');
        setMessage('Legendary mode deactivated.');
        await slimeModels.refresh();
      }
    } catch (e) {
      setSlimeLegendaryMode(false);
      setLegendarySplash(false);
      setError(e instanceof Error ? e.message : 'Could not toggle legendary mode');
    } finally {
      legendaryEggBusyRef.current = false;
    }
  };

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-3 py-4 pb-24 md:px-6 md:py-6 md:pb-28">
      <div className="mx-auto max-w-[1300px]">
        <MainNavButtons layout="topbar" className="!mb-3" />
        <div className="mt-1 mb-3 md:flex md:items-end md:justify-between md:gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl text-gray-900 md:text-3xl" style={{ fontWeight: 700 }}>
              Profile
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/onboarding?mode=resume')}
                className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/90 bg-gradient-to-r from-white via-indigo-50 to-violet-50 px-4 py-2 text-xs font-semibold text-indigo-900 shadow-[0_8px_20px_rgba(99,102,241,0.16)] transition hover:border-indigo-300 hover:from-indigo-50 hover:to-violet-100 hover:shadow-[0_10px_24px_rgba(99,102,241,0.2)] md:text-sm"
              >
                <Compass size={14} aria-hidden />
                Continue onboarding
              </button>
              <button
                type="button"
                onClick={() => void save()}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-200/90 bg-gradient-to-r from-white via-violet-50 to-fuchsia-50 px-4 py-2 text-xs font-semibold text-violet-700 shadow-[0_8px_20px_rgba(99,102,241,0.16)] transition hover:border-violet-300 hover:from-violet-50 hover:to-fuchsia-100 hover:shadow-[0_10px_24px_rgba(99,102,241,0.2)] md:text-sm"
              >
                <Save size={14} aria-hidden />
                Save profile
              </button>
            </div>
          </div>
          {isSupabaseEnvConfigured() && session ? (
            <div className="mt-3 flex shrink-0 flex-col items-stretch gap-2 sm:items-end md:mt-0">
              {session.user?.email ? (
                <p className="text-right text-[11px] text-gray-500 md:text-xs">
                  <span className="text-gray-600">Signed in as</span> {session.user.email}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {error && <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{error}</div>}
        {message && (
          <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-900">{message}</div>
        )}
        {creditRedeemMsg ? (
          <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-900">
            {creditRedeemMsg}
          </div>
        ) : null}
        {creditRedeemErr ? (
          <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-sm text-rose-800">{creditRedeemErr}</div>
        ) : null}

        <div className="space-y-2">
          <main className="space-y-2">
            <section
              id="profile-slime-credits"
              className="rounded-xl border border-emerald-100/90 bg-gradient-to-br from-white/90 via-emerald-50/40 to-violet-50/50 p-3 shadow-[0_8px_24px_rgba(16,185,129,0.08)] backdrop-blur-md md:rounded-2xl md:p-3.5"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <label className="inline-flex items-center gap-1.5 text-sm text-gray-900" style={{ fontWeight: 700 }}>
                    Slime Credits
                  </label>
                  <button
                    type="button"
                    onClick={() => void onLegendaryEggClick()}
                    className="rounded-full p-0.5 text-left transition hover:opacity-90 active:scale-95"
                    aria-label="Slime credits mark"
                  >
                    <SlimeCreditIcon className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSection('credits')}
                  className="shrink-0 rounded-full border border-gray-200 p-1.5 text-gray-700 md:p-2"
                  aria-expanded={openSections.credits}
                  aria-label={openSections.credits ? 'Collapse section' : 'Expand section'}
                >
                  {openSections.credits ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              {openSections.credits ? (
                <>
                  {slimeCredits?.is_unlimited ? (
                    <div className="space-y-1 text-sm text-gray-700">
                      <p className="font-semibold text-violet-900">Unlimited Admin Access</p>
                      <p className="text-xs leading-relaxed text-gray-600">
                        You are not limited by Slime Credits. Buddy can run AI actions without counting credits.
                      </p>
                      <p className="text-[11px] text-gray-500">
                        You can still pick a model tier below — usage is logged; credits are not deducted.
                      </p>
                      <div className="mt-3 rounded-lg border border-violet-100/90 bg-white/60 p-2.5">
                        <ModelSelector
                          feature="shadow_chat"
                          selectedModelId={
                            defaultModelOptionId || slimeModels.defaultModel || slimeModels.models[0]?.id || ''
                          }
                          onChange={async (id) => {
                            setDefaultModelOptionId(id);
                            try {
                              await patchDefaultModelOption(id);
                              setMessage('Default model saved.');
                              setError(null);
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'Could not save model preference');
                            }
                          }}
                          models={slimeModels.models}
                          selectorEnabled={slimeModels.selectorEnabled}
                          showWhenSingle
                          showCostPreview
                          variant="cards"
                          label="Default Slime model"
                          hint=""
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-2xl font-bold tracking-tight text-emerald-900" style={{ fontWeight: 800 }}>
                          {slimeCreditsLoading
                            ? '…'
                            : slimeCredits
                              ? String(slimeCredits.display_balance ?? slimeCredits.balance ?? 0)
                              : '—'}
                        </span>
                        <span className="text-xs font-medium text-gray-500">credits available</span>
                      </div>
                      {!slimeCreditsLoading && !slimeCredits ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-amber-900">
                          Could not load credits from the API. On Vercel, set{' '}
                          <span className="font-mono text-[10px]">VITE_API_ORIGIN</span> to your Railway API base URL
                          (no trailing slash), redeploy the frontend, and ensure you are signed in.{' '}
                          <button
                            type="button"
                            className="font-semibold text-violet-700 underline"
                            onClick={() => void refreshSlimeCredits()}
                          >
                            Retry
                          </button>
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                        Powers Buddy&apos;s AI actions. Costs scale by feature and by model tier (see default model
                        below).
                      </p>
                      <div className="mt-3 rounded-lg border border-violet-100/90 bg-white/60 p-2.5">
                        <ModelSelector
                          feature="shadow_chat"
                          selectedModelId={
                            defaultModelOptionId || slimeModels.defaultModel || slimeModels.models[0]?.id || ''
                          }
                          onChange={async (id) => {
                            setDefaultModelOptionId(id);
                            try {
                              await patchDefaultModelOption(id);
                              setMessage('Default model saved.');
                              setError(null);
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'Could not save model preference');
                            }
                          }}
                          models={slimeModels.models}
                          selectorEnabled={slimeModels.selectorEnabled}
                          showWhenSingle
                          showCostPreview
                          variant="cards"
                          label="Default Slime model"
                          hint=""
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Input
                          value={redeemCodeInput}
                          onChange={(e) => setRedeemCodeInput(e.target.value)}
                          placeholder="Voucher or testing code"
                          className="h-9 min-w-[200px] flex-1 bg-white/90 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void redeemProfileCode();
                          }}
                        />
                        <Button type="button" size="sm" className="shrink-0" onClick={() => void redeemProfileCode()}>
                          Redeem
                        </Button>
                      </div>
                      <div className="mt-4 border-t border-emerald-100/80 pt-3">
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-gray-700">Recent usage</p>
                          <button
                            type="button"
                            className="text-[10px] text-violet-700 underline disabled:opacity-40"
                            disabled={creditTxBusy}
                            onClick={() => void loadCreditTx()}
                          >
                            Refresh
                          </button>
                        </div>
                        {recentCreditTx.length === 0 ? (
                          <p className="text-[11px] text-gray-500">No transactions yet.</p>
                        ) : (
                          <ul className="space-y-1 text-[11px] text-gray-700">
                            {recentCreditTx.slice(0, 5).map((tx, index) => {
                              const amt = typeof tx.amount === 'number' ? tx.amount : 0;
                              const sign = amt > 0 ? '+' : '';
                              const label = (tx.reason || tx.feature || tx.type || 'Activity').slice(0, 48);
                              const rowKey =
                                tx.id?.trim() ||
                                `${tx.created_at ?? 'unknown'}-${label}-${amt}-${index}`;
                              return (
                                <li key={rowKey} className="flex justify-between gap-2 border-b border-gray-100/80 pb-1 last:border-0">
                                  <span className="min-w-0 truncate">{label}</span>
                                  <span className={cn('shrink-0 font-semibold', amt < 0 ? 'text-rose-700' : 'text-emerald-700')}>
                                    {sign}
                                    {amt}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : null}
            </section>

            <section
              id="profile-priorities"
              className="rounded-xl border border-white/90 bg-white/70 p-3 shadow-[0_8px_24px_rgba(99,102,241,0.05)] backdrop-blur-md md:rounded-2xl md:p-3.5"
            >
            <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700" style={{ fontWeight: 600 }}>
              Your priorities
              <ListChecks size={14} className="text-indigo-500" aria-hidden />
            </label>
            <button
              type="button"
              onClick={() => toggleSection('priorities')}
              className="shrink-0 rounded-full border border-gray-200 p-1.5 text-gray-700 md:p-2"
              aria-expanded={openSections.priorities}
              aria-label={openSections.priorities ? 'Collapse section' : 'Expand section'}
            >
              {openSections.priorities ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            </div>
            {openSections.priorities ? (
              <>
            <p className="mb-1.5 text-[11px] leading-snug text-gray-500">
              Your lines only — decision clarifications and structured facts appear under Structured memory; legacy system lines stay below.
            </p>
            <textarea
              value={userPriorities}
              onChange={(e) => setUserPriorities(e.target.value)}
              className="w-full min-h-[72px] rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2 text-sm md:min-h-[88px] md:rounded-2xl md:px-4 md:py-2.5"
              placeholder={'Family first\nCareer growth in AI'}
            />
              </>
            ) : null}
            </section>

            <section
              id="profile-memory"
              className="rounded-xl border border-white/90 bg-white/70 p-3 shadow-[0_8px_24px_rgba(99,102,241,0.05)] backdrop-blur-md md:rounded-2xl md:p-3.5"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-1.5 text-sm text-gray-700" style={{ fontWeight: 600 }}>
                  Structured memory (Shadow, clarifications &amp; imports)
                  <Database size={14} className="text-indigo-500" aria-hidden />
                </label>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleSection('memory')}
                    className="rounded-full border border-gray-200 p-1.5 text-gray-700 md:p-2"
                    aria-expanded={openSections.memory}
                    aria-label={openSections.memory ? 'Collapse section' : 'Expand section'}
                  >
                    {openSections.memory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMemoryEditMode((v) => !v)}
                    className={`rounded-full p-1.5 md:p-2 ${memoryEditMode ? 'bg-indigo-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}
                    aria-pressed={memoryEditMode}
                    aria-label={memoryEditMode ? 'Finish editing memory' : 'Edit memory'}
                  >
                    {memoryEditMode ? <Check size={14} /> : <Pencil size={14} />}
                  </button>
                </div>
              </div>
              {openSections.memory ? (
                <>
              <p className="mb-2 text-[11px] leading-snug text-gray-500">
                User-profile facts (about you), including decision-run clarification answers under{' '}
                <span className="font-medium text-gray-700">Decision clarifications</span>. Buddy-only notes are grouped
                separately when you clearly addressed your Slime. Delete only in Edit mode.
              </p>
              {mergedUserProfileFacts.length === 0 && slimeMemoryFacts.length === 0 ? (
                <div className="rounded-lg border border-violet-100 bg-violet-50/40 px-2.5 py-1.5 text-xs text-gray-500">
                  No structured facts yet — they appear when chat or decision runs store details you stated.
                </div>
              ) : (
                <>
                  {userMemoryFacts.length === 0 && clarificationRows.length === 0 ? (
                    <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5 text-xs text-gray-600">
                      No user-profile structured facts yet (Buddy-only rows may appear below).
                    </div>
                  ) : null}
                  {mergedUserProfileFacts.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[200px_1fr]">
                      <div className="rounded-lg border border-gray-200 bg-white/80 p-1.5">
                        {memoryCatOrder.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setSelectedMemoryCat(cat)}
                            className={`mb-0.5 w-full rounded-md px-2 py-1.5 text-left text-xs md:text-sm ${
                              selectedMemoryCat === cat ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {MEMORY_CAT_LABEL[cat] || cat}
                          </button>
                        ))}
                      </div>

                      <div className="space-y-2">
                        {memoryCatOrder.filter((c) => c === selectedMemoryCat).map((cat) => (
                          <div key={cat}>
                            <p
                              className="mb-1 text-[10px] uppercase tracking-wide text-indigo-700"
                              style={{ fontWeight: 700 }}
                            >
                              {MEMORY_CAT_LABEL[cat] || cat}
                            </p>
                            <div className="space-y-1.5">
                              {(factsByCat[cat] || []).map((f) => {
                                const isClarification =
                                  f.source === 'clarification' ||
                                  Boolean(
                                    f.qualifiers && (f.qualifiers as { from_priority_line?: boolean }).from_priority_line,
                                  );
                                return (
                                <div
                                  key={f.id || `${cat}-${f.text}`}
                                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-800"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
                                      {isClarification ? (
                                        <span className="shrink-0 rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                                          {CHANNEL_LABEL.clarification}
                                        </span>
                                      ) : null}
                                      <span className="min-w-0 leading-snug">{f.text}</span>
                                    </div>
                                    {memoryEditMode ? (
                                      <button
                                        type="button"
                                        disabled={deletingId === f.id}
                                        onClick={() => void deleteStructuredRow(f)}
                                        className="shrink-0 text-xs text-red-700 hover:underline disabled:opacity-40"
                                      >
                                        {deletingId === f.id ? '…' : 'Delete'}
                                      </button>
                                    ) : null}
                                  </div>
                                  {f.predicate && f.object_value ? (
                                    <p className="mt-1 text-[10px] font-mono leading-tight text-gray-500">
                                      {(f.subject_ref || 'user').trim()} · {f.predicate} · {f.object_value}
                                    </p>
                                  ) : null}
                                  {f.evidence ? (
                                    <p className="mt-1 text-[10px] italic text-violet-700/90">Evidence: {f.evidence}</p>
                                  ) : null}
                                  {f.created_at ? (
                                    <p className="mt-1.5 text-[10px] font-medium text-gray-500">
                                      Recorded {formatProfileMemoryToastAt(f.created_at)}
                                    </p>
                                  ) : null}
                                </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {slimeMemoryFacts.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-cyan-100/90 bg-gradient-to-br from-cyan-50/90 to-white px-3 py-2.5">
                      <p className="text-xs font-semibold text-cyan-950">Slime companion memory</p>
                      <p className="mt-1 text-[11px] leading-snug text-cyan-900/85">
                        Facts about your Buddy — saved only when you explicitly addressed the Slime (name, “your name…”, “Slime Buddy…”, etc.).
                      </p>
                      <div className="mt-2 space-y-3">
                        {slimeMemoryCatOrder.map((cat) => (
                          <div key={cat}>
                            <p
                              className="mb-1 text-[10px] uppercase tracking-wide text-cyan-800"
                              style={{ fontWeight: 700 }}
                            >
                              {MEMORY_CAT_LABEL[cat] || cat}
                            </p>
                            <div className="space-y-1.5">
                              {(slimeFactsByCat[cat] || []).map((f) => (
                                <div
                                  key={f.id || f.text}
                                  className="rounded-lg border border-cyan-100 bg-white px-2.5 py-2 text-sm text-gray-800"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="min-w-0 leading-snug">{f.text}</span>
                                    {memoryEditMode ? (
                                      <button
                                        type="button"
                                        disabled={deletingId === f.id}
                                        onClick={() => f.id && void deleteMemoryFact(f.id)}
                                        className="shrink-0 text-xs text-red-700 hover:underline disabled:opacity-40"
                                      >
                                        {deletingId === f.id ? '…' : 'Delete'}
                                      </button>
                                    ) : null}
                                  </div>
                                  {f.predicate && f.object_value ? (
                                    <p className="mt-1 text-[10px] font-mono leading-tight text-gray-500">
                                      {(f.subject_ref || 'slime_companion').trim()} · {f.predicate} · {f.object_value}
                                    </p>
                                  ) : null}
                                  {f.evidence ? (
                                    <p className="mt-1 text-[10px] italic text-cyan-800/90">Evidence: {f.evidence}</p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
                </>
              ) : null}
            </section>

            <section
              id="profile-wellbeing-memory"
              className="rounded-xl border border-rose-100/90 bg-gradient-to-br from-rose-50/50 via-white/80 to-white/70 p-3 shadow-[0_8px_24px_rgba(244,114,182,0.08)] backdrop-blur-md md:rounded-2xl md:p-3.5"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-1.5 text-sm text-rose-950" style={{ fontWeight: 600 }}>
                  Wellbeing (Rimumu)
                  <Heart size={14} className="text-rose-500" aria-hidden />
                </label>
                <button
                  type="button"
                  onClick={() => toggleSection('wellbeing')}
                  className="shrink-0 rounded-full border border-rose-200 p-1.5 text-rose-900 md:p-2"
                  aria-expanded={openSections.wellbeing}
                  aria-label={openSections.wellbeing ? 'Collapse section' : 'Expand section'}
                >
                  {openSections.wellbeing ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              {openSections.wellbeing ? (
                <>
                  <p className="mb-2 text-[11px] leading-snug text-rose-900/75">
                    Check-ins and key themes from therapy sessions with Rimumu — separate from general profile memory.
                    Every entry is timestamped when saved.
                  </p>
                  {wellbeingMemoryFacts.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-rose-200 bg-white/60 px-2.5 py-2 text-xs text-rose-800/70">
                      No wellbeing memories yet. Complete a check-in or talk with Rimumu in session to record them here.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {wellbeingMemoryFacts.map((f) => (
                        <div
                          key={f.id || `wb-${f.text}`}
                          className="rounded-lg border border-rose-100 bg-white/90 px-2.5 py-2 text-sm text-rose-950"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-900">
                                {wellbeingRecordLabel(f)}
                              </span>
                              <p className="mt-1 leading-snug">{f.text}</p>
                            </div>
                            {memoryEditMode && f.id ? (
                              <button
                                type="button"
                                disabled={deletingId === f.id}
                                onClick={() => void deleteMemoryFact(f.id!)}
                                className="shrink-0 text-xs text-red-700 hover:underline disabled:opacity-40"
                              >
                                {deletingId === f.id ? '…' : 'Delete'}
                              </button>
                            ) : null}
                          </div>
                          {f.predicate && f.object_value ? (
                            <p className="mt-1 text-[10px] font-mono text-rose-800/70">
                              {(f.subject_ref || 'user').trim()} · {f.predicate} · {f.object_value}
                            </p>
                          ) : null}
                          {f.evidence ? (
                            <p className="mt-1 text-[10px] italic text-rose-800/80">Evidence: {f.evidence}</p>
                          ) : null}
                          <p className="mt-1.5 text-[10px] font-medium text-rose-900/65">
                            {f.created_at
                              ? `Recorded ${formatProfileMemoryToastAt(f.created_at)}`
                              : 'Timestamp pending — reload profile to backfill'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </section>

            <section id="profile-legacy" className="rounded-xl border border-white/90 bg-white/70 p-3 shadow-[0_8px_24px_rgba(99,102,241,0.05)] backdrop-blur-md md:rounded-2xl">
            <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700" style={{ fontWeight: 600 }}>
              Legacy system lines
              <Archive size={14} className="text-indigo-500" aria-hidden />
            </label>
            <button
              type="button"
              onClick={() => toggleSection('legacy')}
              className="shrink-0 rounded-full border border-gray-200 p-1.5 text-gray-700 md:p-2"
              aria-expanded={openSections.legacy}
              aria-label={openSections.legacy ? 'Collapse section' : 'Expand section'}
            >
              {openSections.legacy ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            </div>
            {openSections.legacy ? (
              <>
            <p className="mb-1.5 text-[11px] leading-snug text-gray-500">
              Older inferred one-liners. Prefer structured memory; delete rows you do not want.
            </p>
            <div className="min-h-[56px] w-full space-y-1.5 rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-sm text-gray-800">
              {systemRows.length === 0 ? (
                <span className="text-gray-400">None.</span>
              ) : (
                systemRows.map((row, idx) => (
                  <div key={row.id || `${row.channel}-${idx}`} className="flex flex-wrap items-start gap-2 justify-between">
                    <div className="flex flex-wrap items-start gap-2 min-w-0">
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-200/80 text-indigo-900">
                        {CHANNEL_LABEL[row.channel || 'legacy'] || row.channel || 'Recorded'}
                      </span>
                      <span className="min-w-0 flex-1 leading-snug">{row.text}</span>
                    </div>
                    <button
                      type="button"
                      disabled={deletingId === row.id}
                      onClick={() => row.id && void deletePriorityLine(row.id)}
                      className="shrink-0 text-xs text-red-700 hover:underline disabled:opacity-40"
                    >
                      {deletingId === row.id ? '…' : 'Delete'}
                    </button>
                  </div>
                ))
              )}
            </div>
            </>
            ) : null}
          </section>

          <section id="profile-context" className="space-y-2 rounded-xl border border-white/90 bg-white/70 p-3 shadow-[0_8px_24px_rgba(99,102,241,0.05)] backdrop-blur-md md:rounded-2xl">
            <div className="flex items-center justify-between gap-2">
              <p className="inline-flex items-center gap-1.5 text-sm text-gray-700" style={{ fontWeight: 600 }}>
                Personal context
                <User size={14} className="text-indigo-500" aria-hidden />
              </p>
              <button
                type="button"
                onClick={() => toggleSection('context')}
                className="shrink-0 rounded-full border border-gray-200 p-1.5 text-gray-700 md:p-2"
                aria-expanded={openSections.context}
                aria-label={openSections.context ? 'Collapse section' : 'Expand section'}
              >
                {openSections.context ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
            {openSections.context ? (
              <>
            <div>
            <label className="mb-1 block text-xs text-gray-700 md:text-sm" style={{ fontWeight: 500 }}>
              Your name
            </label>
            <input
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              className="w-full rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2 text-sm md:rounded-2xl md:px-4"
              placeholder="How should Mochi and Rimumu call you?"
              maxLength={48}
            />
            <p className="mt-1 text-[10px] text-gray-500">
              Slime companions greet you with this name when it is saved here.
            </p>
            </div>
            <div>
            <label className="mb-1 block text-xs text-gray-700 md:text-sm" style={{ fontWeight: 500 }}>
              Timezone (IANA)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="min-w-[12rem] flex-1 rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2 text-sm"
                placeholder="America/Los_Angeles"
                maxLength={80}
              />
              <button
                type="button"
                className="rounded-full border border-indigo-200 px-3 py-1.5 text-xs text-indigo-900 hover:bg-indigo-50"
                onClick={() => {
                  try {
                    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
                  } catch {
                    setTimezone('UTC');
                  }
                }}
              >
                Use this device
              </button>
            </div>
            <p className="mt-1 text-[10px] text-gray-500">
              Used for decision follow-up quiet hours when the app does not pass a timezone query.
            </p>
            </div>
            <div>
            <label className="mb-1 block text-xs text-gray-700 md:text-sm" style={{ fontWeight: 500 }}>
              About me
            </label>
            <textarea
              value={aboutMe}
              onChange={(e) => setAboutMe(e.target.value)}
              className="w-full min-h-[88px] rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2 text-sm md:min-h-[100px] md:rounded-2xl md:px-4"
              placeholder="Short narrative: values, risk tolerance, context…"
            />
            </div>
            <div>
            <label className="mb-1 block text-xs text-gray-700 md:text-sm" style={{ fontWeight: 500 }}>
              Constraints (one per line)
            </label>
            <textarea
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              className="w-full min-h-[64px] rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2 text-sm md:min-h-[72px] md:rounded-2xl md:px-4"
              placeholder="Cannot relocate before 2027&#10;Max 50h weeks"
            />
            </div>
            <div>
            <label className="mb-1 block text-xs text-gray-700 md:text-sm" style={{ fontWeight: 500 }}>
              Values (one per line)
            </label>
            <textarea
              value={values}
              onChange={(e) => setValues(e.target.value)}
              className="w-full min-h-[64px] rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2 text-sm md:min-h-[72px] md:rounded-2xl md:px-4"
              placeholder="Honesty&#10;Autonomy"
            />
            </div>
            </>
            ) : null}
          </section>
          </main>
        </div>
      </div>

      {legendarySplash ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="legendary-splash-title"
          onClick={() => setLegendarySplash(false)}
        >
          <div
            className="max-w-lg rounded-[2rem] border-4 border-amber-400 bg-gradient-to-b from-amber-200 via-yellow-300 to-amber-300 p-10 shadow-2xl sm:p-14"
            onClick={(e) => e.stopPropagation()}
          >
            <Crown className="mx-auto h-16 w-16 text-amber-800 drop-shadow-md sm:h-24 sm:w-24" strokeWidth={1.25} aria-hidden />
            <p
              id="legendary-splash-title"
              className="mt-6 text-center text-2xl font-black leading-tight tracking-tight text-amber-950 sm:text-3xl"
            >
              Welcome Bob and Andrew, Lengendary Mode Activated
            </p>
            <button
              type="button"
              className="mt-10 w-full rounded-2xl bg-amber-950 py-3 text-sm font-bold text-amber-100 shadow-lg transition hover:bg-black"
              onClick={() => setLegendarySplash(false)}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {isSupabaseEnvConfigured() && session ? (
        <button
          type="button"
          onClick={() => void signOut().then(() => navigate('/login', { replace: true }))}
          className={cn(
            'fixed bottom-5 right-4 z-[60] rounded-full border border-rose-300/55 bg-rose-500/[0.16] px-5 py-2.5',
            'text-sm font-semibold text-rose-950 shadow-[0_10px_36px_rgba(225,29,72,0.18)] backdrop-blur-md',
            'transition-colors hover:border-rose-400/65 hover:bg-rose-500/[0.26]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
            'sm:bottom-6 sm:right-6',
          )}
        >
          Sign out
        </button>
      ) : null}
    </div>
  );
}
