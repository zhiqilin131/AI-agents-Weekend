import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageBackButton } from '../app/components/PageBackButton';
import { apiUrl } from '../utils/apiOrigin';

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
};

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
    memory: true,
    clarifications: true,
    legacy: true,
    context: true,
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/profile'));
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
      const res = await fetch(apiUrl('/api/profile'), {
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
      const res = await fetch(apiUrl(`/api/profile/priority-line/${encodeURIComponent(id)}`), { method: 'DELETE' });
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
      const res = await fetch(apiUrl(`/api/profile/memory-fact/${encodeURIComponent(id)}`), { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setMessage('Memory fact removed.');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const factsByCat = useMemo(
    () =>
      memoryFacts.reduce<Record<string, MemoryFactRow[]>>((acc, f) => {
        const k = f.category || 'other';
        if (!acc[k]) acc[k] = [];
        acc[k].push(f);
        return acc;
      }, {}),
    [memoryFacts],
  );

  const memoryCatOrder = useMemo(() => {
    const preferred = ['identity', 'views', 'behavior', 'goals', 'constraints', 'other'];
    const existing = Object.keys(factsByCat);
    const inOrder = preferred.filter((k) => existing.includes(k));
    const rest = existing.filter((k) => !preferred.includes(k)).sort();
    return [...inOrder, ...rest];
  }, [factsByCat]);

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
    <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-[1300px]">
        <PageBackButton />
        <div className="mt-2 mb-6">
          <h1 className="text-3xl text-gray-900" style={{ fontWeight: 700 }}>
            Profile
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            Stored per <code className="rounded bg-white/80 px-1 text-xs">FORESIGHT_USER_ID</code> under{' '}
            <code className="rounded bg-white/80 px-1 text-xs">data/profile/</code>. Keep your own priorities curated,
            and audit structured memory captured from Shadow chat.
          </p>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {message && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</div>}

        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => void save()}
              className="rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md"
            >
              Save profile
            </button>
          </div>

          <main className="space-y-4">
            <section id="profile-priorities" className="rounded-2xl border border-white/90 bg-white/70 p-4 shadow-[0_12px_34px_rgba(99,102,241,0.06)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between">
            <label className="block text-sm text-gray-700 mb-2" style={{ fontWeight: 600 }}>
              Your priorities (one per line)
            </label>
            <button type="button" onClick={() => toggleSection('priorities')} className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-700">
              {openSections.priorities ? 'Collapse' : 'Expand'}
            </button>
            </div>
            {openSections.priorities ? (
              <>
            <p className="text-xs text-gray-500 mb-2 leading-relaxed">
              Only rows you enter here. Clarification answers and system-inferred lines are kept separate so nothing
              automatic overwrites this list.
            </p>
            <textarea
              value={userPriorities}
              onChange={(e) => setUserPriorities(e.target.value)}
              className="w-full min-h-[100px] px-4 py-3 rounded-2xl border border-gray-200/80 bg-white/70 text-sm"
              placeholder={'Family first\nCareer growth in AI'}
            />
              </>
            ) : null}
            </section>

            <section id="profile-memory" className="rounded-2xl border border-white/90 bg-white/70 p-4 shadow-[0_12px_34px_rgba(99,102,241,0.06)] backdrop-blur-md">
              <div className="mb-3 flex items-center justify-between">
                <label className="block text-sm text-gray-700" style={{ fontWeight: 600 }}>
                  Structured memory (from Shadow &amp; imports)
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => toggleSection('memory')} className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-700">
                    {openSections.memory ? 'Collapse' : 'Expand'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMemoryEditMode((v) => !v)}
                    className={`rounded-full px-3 py-1 text-xs ${memoryEditMode ? 'bg-indigo-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}
                  >
                    {memoryEditMode ? 'Done' : 'Edit'}
                  </button>
                </div>
              </div>
              {openSections.memory ? (
                <>
              <p className="mb-3 text-xs leading-relaxed text-gray-500">
                Short, categorized facts — not therapist paraphrases. Delete only in Edit mode.
              </p>
              {memoryFacts.length === 0 ? (
                <div className="rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2 text-sm text-gray-500">
                  No structured facts yet — they appear when Shadow chat stores concrete details you stated.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
                  <div className="rounded-xl border border-gray-200 bg-white/80 p-2">
                    {memoryCatOrder.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedMemoryCat(cat)}
                        className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${
                          selectedMemoryCat === cat ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {MEMORY_CAT_LABEL[cat] || cat}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {memoryCatOrder.filter((c) => c === selectedMemoryCat).map((cat) => (
                      <div key={cat}>
                        <p className="mb-2 text-[11px] uppercase tracking-wide text-indigo-700" style={{ fontWeight: 700 }}>
                          {MEMORY_CAT_LABEL[cat] || cat}
                        </p>
                        <div className="space-y-2">
                          {(factsByCat[cat] || []).map((f) => (
                            <div key={f.id || f.text} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800">
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
                              {f.evidence ? <p className="mt-1 text-[10px] italic text-violet-700/90">Evidence: {f.evidence}</p> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
                </>
              ) : null}
            </section>

            {clarificationRows.length > 0 && (
              <section id="profile-clarifications" className="rounded-2xl border border-white/90 bg-white/70 p-4 shadow-[0_12px_34px_rgba(99,102,241,0.06)] backdrop-blur-md">
              <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm text-gray-700 mb-2" style={{ fontWeight: 600 }}>
                From clarification (saved with a decision run)
              </label>
              <button type="button" onClick={() => toggleSection('clarifications')} className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-700">
                {openSections.clarifications ? 'Collapse' : 'Expand'}
              </button>
              </div>
              {openSections.clarifications ? (
                <>
              <p className="text-xs text-gray-500 mb-2 leading-relaxed">
                These came from multiple-choice prompts — not the same as free-form priorities. You can remove any row.
              </p>
              <div className="w-full min-h-[60px] px-4 py-3 rounded-2xl border border-amber-100 bg-amber-50/50 text-sm text-gray-800 space-y-2">
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

          <section id="profile-legacy" className="rounded-2xl border border-white/90 bg-white/70 p-4 shadow-[0_12px_34px_rgba(99,102,241,0.06)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between">
            <label className="block text-sm text-gray-700 mb-2" style={{ fontWeight: 600 }}>
              Legacy system lines (one-line notes)
            </label>
            <button type="button" onClick={() => toggleSection('legacy')} className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-700">
              {openSections.legacy ? 'Collapse' : 'Expand'}
            </button>
            </div>
            {openSections.legacy ? (
              <>
            <p className="text-xs text-gray-500 mb-2 leading-relaxed">
              Older inferred lines (e.g. from Personalize). Prefer structured memory above for new data. You can delete
              rows here.
            </p>
            <div className="w-full min-h-[80px] px-4 py-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 text-sm text-gray-800 space-y-2">
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

          <section id="profile-context" className="rounded-2xl border border-white/90 bg-white/70 p-4 shadow-[0_12px_34px_rgba(99,102,241,0.06)] backdrop-blur-md space-y-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm text-gray-700" style={{ fontWeight: 600 }}>Personal context</p>
              <button type="button" onClick={() => toggleSection('context')} className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-700">
                {openSections.context ? 'Collapse' : 'Expand'}
              </button>
            </div>
            {openSections.context ? (
              <>
            <div>
            <label className="block text-sm text-gray-700 mb-2" style={{ fontWeight: 500 }}>
              About me
            </label>
            <textarea
              value={aboutMe}
              onChange={(e) => setAboutMe(e.target.value)}
              className="w-full min-h-[120px] px-4 py-3 rounded-2xl border border-gray-200/80 bg-white/70 text-sm"
              placeholder="Short narrative: values, risk tolerance, context…"
            />
            </div>
            <div>
            <label className="block text-sm text-gray-700 mb-2" style={{ fontWeight: 500 }}>
              Constraints (one per line)
            </label>
            <textarea
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              className="w-full min-h-[80px] px-4 py-3 rounded-2xl border border-gray-200/80 bg-white/70 text-sm"
              placeholder="Cannot relocate before 2027&#10;Max 50h weeks"
            />
            </div>
            <div>
            <label className="block text-sm text-gray-700 mb-2" style={{ fontWeight: 500 }}>
              Values (one per line)
            </label>
            <textarea
              value={values}
              onChange={(e) => setValues(e.target.value)}
              className="w-full min-h-[80px] px-4 py-3 rounded-2xl border border-gray-200/80 bg-white/70 text-sm"
              placeholder="Honesty&#10;Autonomy"
            />
            </div>
            </>
            ) : null}
          </section>
          </main>
        </div>
      </div>
    </div>
  );
}
