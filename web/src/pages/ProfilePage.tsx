import { useCallback, useEffect, useState } from 'react';
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

export default function ProfilePage() {
  const [userPriorities, setUserPriorities] = useState('');
  const [inferredPriorities, setInferredPriorities] = useState('');
  const [aboutMe, setAboutMe] = useState('');
  const [constraints, setConstraints] = useState('');
  const [values, setValues] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/profile'));
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        user_priorities?: string[];
        priorities?: string[];
        inferred_priorities?: string[];
        about_me: string;
        constraints: string[];
        values: string[];
      };
      const stated = data.user_priorities?.length ? data.user_priorities : (data.priorities ?? []);
      setUserPriorities(listToLines(stated));
      setInferredPriorities(listToLines(data.inferred_priorities ?? []));
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-8 py-16">
      <div className="max-w-2xl mx-auto">
        <PageBackButton />
        <h1 className="text-3xl text-gray-900 mb-2" style={{ fontWeight: 700 }}>
          Profile (shadow self)
        </h1>
        <p className="text-gray-600 mb-8 text-sm">
          Stored per <code className="text-xs bg-white/80 px-1 rounded">FORESIGHT_USER_ID</code> under{' '}
          <code className="text-xs bg-white/80 px-1 rounded">data/profile/</code>. Used in every run for retrieval and
          prompts. <strong>Your priorities</strong> are only changed here (or via clarification choices).{' '}
          <strong>Inferred priorities</strong> come from the system (e.g. Shadow chat) and may be updated by newer
          inference.
        </p>

        {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">{error}</div>}
        {message && <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm">{message}</div>}

        <div className="space-y-6">
          <div>
            <label className="block text-sm text-gray-700 mb-2" style={{ fontWeight: 600 }}>
              Your priorities (one per line)
            </label>
            <p className="text-xs text-gray-500 mb-2 leading-relaxed">
              Authoritative: only you edit these here. They are not overwritten by Shadow chat.
            </p>
            <textarea
              value={userPriorities}
              onChange={(e) => setUserPriorities(e.target.value)}
              className="w-full min-h-[100px] px-4 py-3 rounded-2xl border border-gray-200/80 bg-white/70 text-sm"
              placeholder={'Family first\nCareer growth in AI'}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-2" style={{ fontWeight: 600 }}>
              Inferred priorities (read-only)
            </label>
            <p className="text-xs text-gray-500 mb-2 leading-relaxed">
              System-generated hints from Shadow space and similar signals. These can be revised or replaced by newer
              inference; they are weighted lower than your own priorities in the pipeline.
            </p>
            <textarea
              value={inferredPriorities}
              readOnly
              className="w-full min-h-[100px] px-4 py-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 text-sm text-gray-800 cursor-default"
              placeholder="Nothing inferred yet — chat in Shadow space to accumulate notes here."
            />
          </div>

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
          <button
            type="button"
            onClick={() => void save()}
            className="px-8 py-3 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-semibold shadow-lg"
          >
            Save profile
          </button>
        </div>
      </div>
    </div>
  );
}
