import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { PageBackButton } from '../app/components/PageBackButton';
import { apiFetch } from '../utils/apiFetch';
import { cn } from '../app/components/ui/utils';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseEnvConfigured } from '../auth/RequireAuthLayout';

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

const CHANNEL_LABEL: Record<string, string> = {
  profile: 'Profile',
  clarification: 'Clarification',
  shadow: 'Shadow',
  personalize: 'Personalize',
  legacy: 'Recorded',
};

const MEMORY_CAT_LABEL: Record<string, string> = {
  identity: 'Identity',
  views: 'Views & opinions',
  behavior: 'Behavior & habits',
  goals: 'Goals',
  constraints: 'Constraints',
  other: 'Other',
};

export default function ProfilePage() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const [userPriorities, setUserPriorities] = useState('');
  const [clarificationRows, setClarificationRows] = useState<ProfileLineRow[]>([]);
  const [systemRows, setSystemRows] = useState<ProfileLineRow[]>([]);
  const [memoryFacts, setMemoryFacts] = useState<MemoryFactRow[]>([]);
  const [aboutMe, setAboutMe] = useState('');
  const [constraints, setConstraints] = useState('');
  const [values, setValues] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [memoryEditMode, setMemoryEditMode] = useState(false);
  const [selectedMemoryCat, setSelectedMemoryCat] = useState<string>('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    priorities: true,
    memory: false,
    clarifications: false,
    legacy: false,
    context: false,
  });

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
        about_me: string;
        constraints: string[];
        values: string[];
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
      setAboutMe(data.about_me ?? '');
      setConstraints(listToLines(data.constraints ?? []));
      setValues(listToLines(data.values ?? []));
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
        about_me: aboutMe.trim(),
        constraints: linesToList(constraints),
        values: linesToList(values),
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

  const userMemoryFacts = useMemo(() => memoryFacts.filter((f) => !isSlimeCompanionMemoryFact(f)), [memoryFacts]);
  const slimeMemoryFacts = useMemo(() => memoryFacts.filter((f) => isSlimeCompanionMemoryFact(f)), [memoryFacts]);

  const factsByCat = useMemo(
    () =>
      userMemoryFacts.reduce<Record<string, MemoryFactRow[]>>((acc, f) => {
        const k = f.category || 'other';
        if (!acc[k]) acc[k] = [];
        acc[k].push(f);
        return acc;
      }, {}),
    [userMemoryFacts],
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
    const preferred = ['identity', 'views', 'behavior', 'goals', 'constraints', 'other'];
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

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-3 py-4 pb-24 md:px-6 md:py-6 md:pb-28">
      <div className="mx-auto max-w-[1300px]">
        <PageBackButton />
        <div className="mt-1 mb-3 md:flex md:items-end md:justify-between md:gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl text-gray-900 md:text-3xl" style={{ fontWeight: 700 }}>
              Profile
            </h1>
            <p className="mt-1 text-xs leading-snug text-gray-600 md:text-sm md:leading-relaxed">
              Edit priorities and structured memory below. Customize your Slime Advisor (look, motion, voice) on{' '}
              <button
                type="button"
                onClick={() => navigate('/buddy')}
                className="font-semibold text-violet-800 underline decoration-violet-300 underline-offset-2 hover:text-violet-950"
              >
                Buddy home
              </button>{' '}
              — same profile powers reports and Shadow. Scoped to{' '}
              <code className="rounded bg-white/80 px-1 text-[10px] md:text-xs">FORESIGHT_USER_ID</code> ·{' '}
              <code className="rounded bg-white/80 px-1 text-[10px] md:text-xs">data/profile/</code>.
            </p>
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

        <div className="space-y-2">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => void save()}
              className="rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md md:text-sm"
            >
              Save profile
            </button>
          </div>

          <main className="space-y-2">
            <section
              id="profile-priorities"
              className="rounded-xl border border-white/90 bg-white/70 p-3 shadow-[0_8px_24px_rgba(99,102,241,0.05)] backdrop-blur-md md:rounded-2xl md:p-3.5"
            >
            <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-sm text-gray-700" style={{ fontWeight: 600 }}>
              Your priorities (one per line)
            </label>
            <button type="button" onClick={() => toggleSection('priorities')} className="shrink-0 rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] text-gray-700 md:px-3 md:py-1 md:text-xs">
              {openSections.priorities ? 'Collapse' : 'Expand'}
            </button>
            </div>
            {openSections.priorities ? (
              <>
            <p className="mb-1.5 text-[11px] leading-snug text-gray-500">
              Your lines only — clarifications and system rows live in their own sections.
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
                <label className="text-sm text-gray-700" style={{ fontWeight: 600 }}>
                  Structured memory (Shadow &amp; imports)
                </label>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" onClick={() => toggleSection('memory')} className="rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] text-gray-700 md:px-3 md:py-1 md:text-xs">
                    {openSections.memory ? 'Collapse' : 'Expand'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMemoryEditMode((v) => !v)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] md:px-3 md:py-1 md:text-xs ${memoryEditMode ? 'bg-indigo-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}
                  >
                    {memoryEditMode ? 'Done' : 'Edit'}
                  </button>
                </div>
              </div>
              {openSections.memory ? (
                <>
              <p className="mb-2 text-[11px] leading-snug text-gray-500">
                User-profile facts (about you). Buddy-only notes are grouped separately when you clearly addressed your
                Slime. Delete only in Edit mode.
              </p>
              {memoryFacts.length === 0 ? (
                <div className="rounded-lg border border-violet-100 bg-violet-50/40 px-2.5 py-1.5 text-xs text-gray-500">
                  No structured facts yet — they appear when chat stores details you stated.
                </div>
              ) : (
                <>
                  {userMemoryFacts.length === 0 ? (
                    <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5 text-xs text-gray-600">
                      No user-profile structured facts yet (Buddy-only rows may appear below).
                    </div>
                  ) : (
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
                              {(factsByCat[cat] || []).map((f) => (
                                <div
                                  key={f.id || f.text}
                                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-800"
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
                                      {(f.subject_ref || 'user').trim()} · {f.predicate} · {f.object_value}
                                    </p>
                                  ) : null}
                                  {f.evidence ? (
                                    <p className="mt-1 text-[10px] italic text-violet-700/90">Evidence: {f.evidence}</p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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

            {clarificationRows.length > 0 && (
              <section id="profile-clarifications" className="rounded-xl border border-white/90 bg-white/70 p-3 shadow-[0_8px_24px_rgba(99,102,241,0.05)] backdrop-blur-md md:rounded-2xl">
              <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-sm text-gray-700" style={{ fontWeight: 600 }}>
                Clarification answers
              </label>
              <button type="button" onClick={() => toggleSection('clarifications')} className="shrink-0 rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] text-gray-700 md:px-3 md:py-1 md:text-xs">
                {openSections.clarifications ? 'Collapse' : 'Expand'}
              </button>
              </div>
              {openSections.clarifications ? (
                <>
              <p className="mb-1.5 text-[11px] leading-snug text-gray-500">
                From decision-run prompts — not the same as your priority list.
              </p>
              <div className="min-h-[48px] w-full space-y-1.5 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2 text-sm text-gray-800">
                {clarificationRows.map((row, idx) => (
                  <div key={row.id || `clar-${idx}`} className="flex flex-wrap items-start gap-2 justify-between">
                    <div className="flex flex-wrap items-start gap-2 min-w-0">
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-950">
                        {CHANNEL_LABEL[row.channel || 'clarification'] || 'Clarification'}
                      </span>
                      <span className="min-w-0 flex-1 leading-snug">{row.text}</span>
                    </div>
                    <button
                      type="button"
                      disabled={deletingId === row.id}
                      onClick={() => row.id && void deletePriorityLine(row.id)}
                      className="shrink-0 text-xs text-red-700 hover:underline disabled:opacity-40"
                    >
                      {deletingId === row.id ? '…' : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
              </>
              ) : null}
              </section>
          )}

          <section id="profile-legacy" className="rounded-xl border border-white/90 bg-white/70 p-3 shadow-[0_8px_24px_rgba(99,102,241,0.05)] backdrop-blur-md md:rounded-2xl">
            <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-sm text-gray-700" style={{ fontWeight: 600 }}>
              Legacy system lines
            </label>
            <button type="button" onClick={() => toggleSection('legacy')} className="shrink-0 rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] text-gray-700 md:px-3 md:py-1 md:text-xs">
              {openSections.legacy ? 'Collapse' : 'Expand'}
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
              <p className="text-sm text-gray-700" style={{ fontWeight: 600 }}>Personal context</p>
              <button type="button" onClick={() => toggleSection('context')} className="shrink-0 rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] text-gray-700 md:px-3 md:py-1 md:text-xs">
                {openSections.context ? 'Collapse' : 'Expand'}
              </button>
            </div>
            {openSections.context ? (
              <>
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
