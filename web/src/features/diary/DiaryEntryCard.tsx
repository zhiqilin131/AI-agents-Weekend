import { useState } from 'react';
import type { DiaryEntryDto } from './types';
import { apiFetchErrorMessage, apiUrl } from '../../utils/apiOrigin';

type DiaryEntryCardProps = {
  entry: DiaryEntryDto | null;
  loading: boolean;
  apiError: string | null;
  onSavedInsight?: () => void;
  onGenerateFromDay?: () => void;
  generateBusy?: boolean;
  onRegenerateCleaner?: () => void | Promise<void>;
  regenerateBusy?: boolean;
};

function formatDiaryDate(iso: string): string {
  const [y, mo, d] = iso.split('-').map(Number);
  if (!y || !mo || !d) return iso;
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function DiaryEntryCard({
  entry,
  loading,
  apiError,
  onSavedInsight,
  onGenerateFromDay,
  generateBusy,
  onRegenerateCleaner,
  regenerateBusy,
}: DiaryEntryCardProps) {
  const [insight, setInsight] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  async function saveInsight() {
    if (!entry?.id) return;
    setLocalErr(null);
    if (!confirm) {
      setLocalErr('Confirm to save this line into profile memory.');
      return;
    }
    const text = insight.trim();
    if (!text) {
      setLocalErr('Write an insight to save.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(apiUrl(`/api/diary/entries/${encodeURIComponent(entry.id)}/save-insight`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insight_text: text, confirmed: true }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { detail?: string }).detail || r.statusText);
      }
      setInsight('');
      setConfirm(false);
      onSavedInsight?.();
    } catch (e) {
      setLocalErr(apiFetchErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-white/80 bg-white/75 p-6 shadow-lg backdrop-blur-md">
        <p className="text-sm text-slate-500">Loading diary…</p>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="rounded-3xl border border-dashed border-violet-200/90 bg-white/60 p-6 shadow-inner backdrop-blur-md">
        <p className="text-sm text-slate-700">No diary yet.</p>
        {(apiError || localErr) && <p className="mt-2 text-sm text-rose-600">{apiError || localErr}</p>}
        {onGenerateFromDay ? (
          <button
            type="button"
            disabled={generateBusy}
            onClick={() => onGenerateFromDay()}
            className="mt-4 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-violet-700 disabled:opacity-50"
          >
            {generateBusy ? 'Generating…' : 'Generate from this day'}
          </button>
        ) : null}
      </div>
    );
  }

  const sc = entry.source_counts;

  return (
    <div className="rounded-3xl border border-violet-100/90 bg-gradient-to-br from-white/95 via-white/90 to-violet-50/50 p-6 shadow-xl shadow-violet-200/30 backdrop-blur-md">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">{entry.title || 'Diary'}</h2>
        {entry.tone ? (
          <span className="rounded-full bg-violet-100/90 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-violet-800">
            {entry.tone}
          </span>
        ) : null}
      </div>
      <p className="mb-3 text-sm text-slate-500">{formatDiaryDate(entry.date)}</p>

      <div className="text-sm leading-relaxed text-slate-700 whitespace-pre-line">{entry.summary}</div>

      {entry.highlights?.length ? (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Highlights</p>
          <div className="flex flex-wrap gap-2">
            {entry.highlights.map((h) => (
              <span
                key={h}
                className="rounded-full border border-violet-200/90 bg-white/90 px-3 py-1 text-xs font-medium text-violet-900 shadow-sm"
              >
                {h}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {entry.themes?.length ? (
        <p className="mt-3 text-xs text-slate-500">
          <span className="font-semibold text-slate-600">Themes: </span>
          {entry.themes.join(' · ')}
        </p>
      ) : null}

      <details className="mt-5 rounded-xl border border-slate-200/80 bg-white/50 px-3 py-2 text-sm text-slate-700">
        <summary className="cursor-pointer select-none font-medium text-slate-600">Sources</summary>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          <li>{sc.chat_messages} chat messages</li>
          <li>{sc.voice_turns} voice turns</li>
          <li>{sc.reports} decision reports</li>
          <li>{sc.calendar_items} calendar items</li>
          <li>{sc.memory_refs} memory references</li>
          <li>{sc.imported_items} imported notes</li>
        </ul>
      </details>

      {onRegenerateCleaner ? (
        <div className="mt-4">
          <button
            type="button"
            disabled={regenerateBusy || generateBusy}
            data-testid="diary-regenerate-cleaner"
            onClick={() => void onRegenerateCleaner()}
            className="rounded-full border border-violet-300 bg-white px-4 py-2 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-50 disabled:opacity-50"
          >
            {regenerateBusy ? 'Regenerating…' : 'Regenerate in cleaner style'}
          </button>
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
        <p className="text-xs font-semibold text-slate-600">Save insight as memory</p>
        <p className="mt-1 text-[11px] text-slate-500">Uses your normal profile memory pipeline after you confirm.</p>
        <textarea
          value={insight}
          onChange={(e) => setInsight(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="One durable line you want the advisor to remember…"
          className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-violet-300/40 focus:ring-2"
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I confirm saving this as profile memory
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveInsight()}
          className="mt-3 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-violet-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save insight'}
        </button>
        {localErr ? <p className="mt-2 text-xs text-rose-600">{localErr}</p> : null}
        {entry.memory_status === 'saved_selected_insights' ? (
          <p className="mt-2 text-[11px] font-medium text-emerald-700">You’ve saved insight(s) from this entry.</p>
        ) : null}
      </div>
    </div>
  );
}
