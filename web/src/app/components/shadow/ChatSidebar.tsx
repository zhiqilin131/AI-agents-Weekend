import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../ui/utils';
import { BuddyTooltip } from '../../../features/slime/BuddyTooltip';
import { getSlimeIdentity, normalizeSlimeType, type SlimeType } from '../../../features/slime/slimeIdentity';
import { SLIME_CTA_BTN_CLASS, slimeCtaButtonStyle } from '../../../features/slime/slimeCtaButton';
import type { ShadowThread } from './types';

type Filter = 'all' | 'generalized' | 'wellbeing';

export function ChatSidebar({
  threads,
  activeThreadId,
  onNewChat,
  onSelectThread,
  onDeleteThread,
  slimeType = 'generalized',
}: {
  threads: ShadowThread[];
  activeThreadId: string | null;
  onNewChat: () => void;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  slimeType?: SlimeType;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const threadSlime = (t: ShadowThread): SlimeType =>
    normalizeSlimeType(t.slime_type) ?? 'generalized';

  const newChatSlimeType = useMemo((): SlimeType => {
    if (!activeThreadId) return slimeType;
    const active = threads.find((t) => t.thread_id === activeThreadId);
    return active ? threadSlime(active) : slimeType;
  }, [activeThreadId, threads, slimeType]);

  const theme = getSlimeIdentity(newChatSlimeType).theme;

  const filtered = useMemo(() => {
    if (filter === 'all') return threads;
    return threads.filter((t) => normalizeSlimeType(t.slime_type) === filter);
  }, [threads, filter]);

  return (
    <aside className="rounded-3xl border border-white/90 bg-white/60 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.06)] backdrop-blur-md">
      <BuddyTooltip content="Create a new chat — you will choose Mochi or Rimumu once.">
        <button
          type="button"
          onClick={onNewChat}
          className={cn(
            'mb-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm',
            SLIME_CTA_BTN_CLASS,
          )}
          style={slimeCtaButtonStyle(theme)}
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </BuddyTooltip>

      <div className="mb-2 flex gap-1 rounded-xl bg-white/80 p-0.5">
        {(
          [
            ['all', 'All'],
            ['generalized', 'Chat'],
            ['wellbeing', 'Therapy'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`flex-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition ${
              filter === id ? 'bg-violet-100 text-violet-950' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((t) => {
          const active = t.thread_id === activeThreadId;
          const st = threadSlime(t);
          const ident = getSlimeIdentity(st);
          const isTherapy = st === 'wellbeing';
          return (
            <div
              key={t.thread_id}
              className={`group flex items-center gap-2 rounded-xl border px-3 py-2 ${
                active ? '' : 'border-gray-200 bg-white/80'
              }`}
              style={
                active
                  ? {
                      borderColor: ident.theme.border,
                      background: `linear-gradient(135deg, ${ident.theme.background}cc, ${ident.theme.surface}aa)`,
                    }
                  : undefined
              }
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: ident.theme.primary }}
                title={ident.shortName}
                aria-hidden
              />
              <BuddyTooltip content={`Open: ${t.title || 'Untitled'} (${ident.shortName})`}>
                <button
                  type="button"
                  className="flex-1 truncate text-left text-sm text-gray-800"
                  onClick={() => onSelectThread(t.thread_id)}
                >
                  {t.title || (isTherapy ? 'Therapy session' : 'New chat')}
                  {isTherapy && t.has_therapy_report ? ' · Report' : ''}
                </button>
              </BuddyTooltip>
              <BuddyTooltip content="Delete this thread.">
                <button
                  type="button"
                  className="opacity-60 hover:opacity-100"
                  onClick={() => onDeleteThread(t.thread_id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-gray-500" />
                </button>
              </BuddyTooltip>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
