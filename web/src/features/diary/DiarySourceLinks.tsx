import { useNavigate } from 'react-router';
import type { DiaryEntryDto } from './types';

type DiarySourceLinksProps = {
  entry: DiaryEntryDto;
};

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-violet-200/90 bg-white/90 px-3 py-1 text-xs font-medium text-violet-800 shadow-sm transition hover:border-violet-400 hover:bg-violet-50"
    >
      {label}
    </button>
  );
}

export function DiarySourceLinks({ entry }: DiarySourceLinksProps) {
  const navigate = useNavigate();
  const c = entry.source_counts;

  const chips: { label: string; onClick: () => void }[] = [];

  if (c.chat_messages > 0) {
    chips.push({
      label: `${c.chat_messages} chat${c.chat_messages === 1 ? '' : 's'}`,
      onClick: () => navigate('/chat'),
    });
  }
  if (c.voice_turns > 0) {
    chips.push({
      label: `${c.voice_turns} voice`,
      onClick: () => navigate('/buddy'),
    });
  }
  if (c.reports > 0) {
    const first = entry.linked_decision_ids[0];
    chips.push({
      label: `${c.reports} decision report${c.reports === 1 ? '' : 's'}`,
      onClick: () => (first ? navigate(`/trace/${encodeURIComponent(first)}`) : navigate('/history')),
    });
  }
  if (c.calendar_items > 0) {
    chips.push({
      label: `${c.calendar_items} calendar`,
      onClick: () => navigate('/execution'),
    });
  }
  if ((c.memory_refs ?? 0) > 0) {
    chips.push({
      label: `${c.memory_refs} memory ref${c.memory_refs === 1 ? '' : 's'}`,
      onClick: () => navigate('/profile'),
    });
  }
  if ((c.imported_items ?? 0) > 0) {
    chips.push({
      label: `${c.imported_items} imported`,
      onClick: () => navigate('/chat'),
    });
  }

  if (!chips.length) return null;

  return (
    <div data-testid="diary-source-links" className="flex flex-wrap gap-2">
      <span className="w-full text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sources from this day</span>
      {chips.map((ch) => (
        <Chip key={ch.label} label={ch.label} onClick={ch.onClick} />
      ))}
    </div>
  );
}
