import { useState } from 'react';
import {
  Brain,
  CalendarClock,
  CheckCircle2,
  FileText,
  Link2,
  MessageCircle,
  Mic,
  RotateCcw,
  Save,
  Sparkles,
} from 'lucide-react';
import type { DiaryEntryDto } from './types';
import { apiFetch } from '../../utils/apiFetch';
import { apiFetchErrorMessage } from '../../utils/apiOrigin';

type DiaryEntryCardProps = {
  entry: DiaryEntryDto | null;
  loading: boolean;
  apiError: string | null;
  onSavedInsight?: () => void;
  onGenerateFromDay?: () => void;
  generateBusy?: boolean;
  onRegenerateCleaner?: () => void | Promise<void>;
  regenerateBusy?: boolean;
  selectedDate?: string;
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

function sourceRows(entry: DiaryEntryDto) {
  const sc = entry.source_counts;
  return [
    { key: 'chat', label: 'chat messages', value: sc.chat_messages, Icon: MessageCircle },
    { key: 'voice', label: 'voice turns', value: sc.voice_turns, Icon: Mic },
    { key: 'reports', label: 'decision reports', value: sc.reports, Icon: FileText },
    { key: 'calendar', label: 'calendar items', value: sc.calendar_items, Icon: CalendarClock },
    { key: 'memory', label: 'memory references', value: sc.memory_refs, Icon: Brain },
    { key: 'imports', label: 'imported notes', value: sc.imported_items, Icon: Link2 },
  ];
}

function paragraphs(summary: string): string[] {
  return summary
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
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
  selectedDate,
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
      const r = await apiFetch(`/api/diary/entries/${encodeURIComponent(entry.id)}/save-insight`, {
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
      <div className="rounded-lg border border-white/80 bg-white/78 p-6 shadow-[0_18px_60px_rgba(79,70,229,0.10)] backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-violet-500" />
          <p className="text-sm font-medium text-slate-600">Loading diary...</p>
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="rounded-lg border border-dashed border-violet-200/90 bg-white/72 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_18px_60px_rgba(79,70,229,0.08)] backdrop-blur-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-500">Unwritten coordinate</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {selectedDate ? formatDiaryDate(selectedDate) : 'No diary yet'}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
              This day has not been distilled into a record yet.
            </p>
          </div>
          <Sparkles className="mt-1 h-5 w-5 shrink-0 text-violet-500" aria-hidden />
        </div>
        {(apiError || localErr) && <p className="mt-2 text-sm text-rose-600">{apiError || localErr}</p>}
        {onGenerateFromDay ? (
          <button
            type="button"
            disabled={generateBusy}
            onClick={() => onGenerateFromDay()}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-violet-500/20 hover:bg-violet-700 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {generateBusy ? 'Generating…' : 'Generate from this day'}
          </button>
        ) : null}
      </div>
    );
  }

  const sources = sourceRows(entry);
  const paras = paragraphs(entry.summary);

  return (
    <article className="overflow-hidden rounded-lg border border-white/85 bg-white/80 shadow-[0_24px_80px_rgba(79,70,229,0.12)] backdrop-blur-xl">
      <div className="border-b border-violet-100/80 bg-gradient-to-r from-white via-violet-50/60 to-cyan-50/55 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-500">Daily record</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{entry.title || 'Diary'}</h2>
            <p className="mt-1 text-sm text-slate-500">{formatDiaryDate(entry.date)}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {entry.tone ? (
              <span className="rounded-full border border-violet-200/85 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-violet-800">
                {entry.tone}
              </span>
            ) : null}
            {entry.memory_status === 'saved_selected_insights' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/90 bg-emerald-50/90 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                Memory saved
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div>
          <div className="space-y-4 text-[15px] leading-7 text-slate-700">
            {(paras.length ? paras : [entry.summary]).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          {entry.highlights?.length ? (
            <div className="mt-6">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Highlights</p>
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
            <div className="mt-5 flex flex-wrap gap-2">
              {entry.themes.map((theme) => (
                <span key={theme} className="rounded-full bg-slate-950 px-3 py-1 text-[11px] font-medium text-white">
                  {theme}
                </span>
              ))}
            </div>
          ) : null}

          {entry.action_items?.length ? (
            <div className="mt-6 rounded-lg border border-violet-100/90 bg-violet-50/45 p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">Actions</p>
              <div className="space-y-2">
                {entry.action_items.map((item, i) => (
                  <div key={`${item.title}-${i}`} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" aria-hidden />
                    <span>{item.title}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {onRegenerateCleaner ? (
            <div className="mt-6">
              <button
                type="button"
                disabled={regenerateBusy || generateBusy}
                data-testid="diary-regenerate-cleaner"
                onClick={() => void onRegenerateCleaner()}
                className="inline-flex items-center gap-2 rounded-full border border-violet-300 bg-white px-4 py-2 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-50 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {regenerateBusy ? 'Regenerating…' : 'Regenerate in cleaner style'}
              </button>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200/80 bg-white/70 p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Sources</p>
            <div className="space-y-2">
              {sources.map(({ key, label, value, Icon }) => (
                <div key={key} className="flex items-center justify-between gap-3 text-xs text-slate-600">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
                    <span className="truncate">
                      {value} {label}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-4">
            <p className="text-xs font-semibold text-slate-700">Save insight as memory</p>
            <textarea
              value={insight}
              onChange={(e) => setInsight(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="One durable line you want the advisor to remember…"
              className="mt-3 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-violet-300/40 focus:ring-2"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              I confirm saving this as profile memory
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveInsight()}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-violet-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" aria-hidden />
              {busy ? 'Saving…' : 'Save insight'}
            </button>
            {localErr ? <p className="mt-2 text-xs text-rose-600">{localErr}</p> : null}
          </section>
        </aside>
      </div>
    </article>
  );
}
