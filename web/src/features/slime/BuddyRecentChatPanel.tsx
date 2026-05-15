import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, MessageSquare, Sparkles } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { apiFetch } from '../../utils/apiFetch';
import type { ShadowMessage } from '../../app/components/shadow/types';
import { recapLines } from './BuddyThreadRecap';
import { BuddyTooltip } from './BuddyTooltip';

const COLLAPSED_STORAGE_PREFIX = 'slimeBuddyRecentChatCollapsed';

function collapsedStorageKey(userId: string | null | undefined): string | null {
  const u = userId?.trim();
  if (!u) return null;
  return `${COLLAPSED_STORAGE_PREFIX}:${u}`;
}

function readCollapsedPreference(userId: string | null | undefined): boolean {
  const k = collapsedStorageKey(userId);
  if (!k) return false;
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPreference(userId: string | null | undefined, collapsed: boolean): void {
  const k = collapsedStorageKey(userId);
  if (!k) return;
  try {
    localStorage.setItem(k, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export type BuddyRecentChatPanelProps = {
  threadId: string | null;
  refreshToken?: number;
  slimeName?: string;
  storageUserId?: string | null;
  onOpenFullChat: () => void;
  className?: string;
};

export function BuddyRecentChatPanel({
  threadId,
  refreshToken = 0,
  slimeName = 'Slime',
  storageUserId = null,
  onOpenFullChat,
  className,
}: BuddyRecentChatPanelProps) {
  const [collapsed, setCollapsed] = useState(() => readCollapsedPreference(storageUserId));
  const [lines, setLines] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCollapsed(readCollapsedPreference(storageUserId));
  }, [storageUserId]);

  const load = useCallback(async () => {
    const tid = threadId?.trim();
    if (!tid) {
      setLines([]);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(`/api/shadow-chat/threads/${encodeURIComponent(tid)}`);
      if (!res.ok) {
        setLines([]);
        return;
      }
      const data = (await res.json()) as { thread?: { messages?: ShadowMessage[] } };
      setLines(recapLines(data.thread?.messages ?? [], 8));
    } catch {
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsedPreference(storageUserId, next);
      return next;
    });
  };

  const petName = slimeName?.trim() || 'Slime';
  const hasThread = Boolean(threadId?.trim());
  const messageCount = lines.length;

  return (
    <aside
      data-slime-avoid
      data-testid="buddy-recent-chat-panel"
      className={cn(
        'pointer-events-auto fixed z-[55] flex flex-col transition-[width] duration-300 ease-out',
        'left-3 top-[4.25rem] max-h-[calc(100dvh-5.5rem)] sm:left-4 sm:top-[4.5rem]',
        collapsed ? 'w-11' : 'w-[min(17.5rem,calc(100vw-2rem))] sm:w-72',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/72 shadow-[0_14px_48px_rgba(79,70,229,0.12)] backdrop-blur-xl',
          collapsed && 'items-center rounded-full border-violet-200/70 py-2',
        )}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 px-1 py-1">
            <BuddyTooltip side="right" content="Expand recent chat">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={false}
                aria-label="Expand recent chat"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-violet-200/80 bg-violet-50/90 text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </BuddyTooltip>
            <MessageSquare className="h-4 w-4 text-violet-500/80" aria-hidden />
            {messageCount > 0 ? (
              <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                {messageCount}
              </span>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-start justify-between gap-2 border-b border-violet-100/80 bg-gradient-to-r from-violet-50/90 to-fuchsia-50/50 px-3 py-2.5">
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="min-w-0"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-600/90">
                  Recent chat
                </p>
                <p className="mt-0.5 truncate text-xs font-medium text-slate-700">
                  {hasThread ? `Thread with ${petName}` : 'No thread yet'}
                </p>
              </motion.div>
              <BuddyTooltip content="Collapse panel">
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  aria-expanded
                  aria-label="Collapse recent chat"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/90 text-violet-700 shadow-sm transition hover:bg-violet-50"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
              </BuddyTooltip>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2">
              {!hasThread ? (
                <div className="rounded-xl border border-dashed border-violet-200/90 bg-violet-50/40 px-3 py-4 text-center">
                  <Sparkles className="mx-auto h-5 w-5 text-violet-400" aria-hidden />
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
                    Hold the mic and say hello — your conversation will show up here.
                  </p>
                </div>
              ) : loading && lines.length === 0 ? (
                <ul className="space-y-2" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <li
                      key={i}
                      className="h-12 animate-pulse rounded-xl border border-white/60 bg-white/50"
                    />
                  ))}
                </ul>
              ) : lines.length === 0 ? (
                <p className="px-1 py-2 text-center text-[11px] text-slate-500">No messages in this thread yet.</p>
              ) : (
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {lines.map((row, i) => (
                      <motion.li
                        key={`${row.role}:${i}:${row.text.slice(0, 20)}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className={cn(
                          'rounded-xl border px-2.5 py-2 text-[11px] leading-snug shadow-sm',
                          row.role === 'user'
                            ? 'ml-2 border-violet-200/70 bg-white/85 text-slate-800'
                            : 'mr-2 border-fuchsia-200/60 bg-gradient-to-br from-fuchsia-50/95 to-violet-50/80 text-slate-800',
                        )}
                      >
                        <div className="mb-1 flex items-center gap-1.5">
                          <span
                            className={cn(
                              'inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold uppercase',
                              row.role === 'user'
                                ? 'bg-violet-600 text-white'
                                : 'bg-fuchsia-500 text-white',
                            )}
                          >
                            {row.role === 'user' ? 'Y' : 'S'}
                          </span>
                          <span className="font-semibold text-violet-900/90">
                            {row.role === 'user' ? 'You' : petName}
                          </span>
                        </div>
                        <p className="text-slate-700">{row.text}</p>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>

            <motion.div
              className="shrink-0 border-t border-violet-100/80 bg-white/50 p-2.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <BuddyTooltip content="Open the full Chat workspace with this thread">
                <button
                  type="button"
                  onClick={onOpenFullChat}
                  disabled={!hasThread}
                  className={cn(
                    'inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition',
                    hasThread
                      ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md hover:brightness-105'
                      : 'cursor-not-allowed border border-violet-100 bg-violet-50/60 text-violet-400',
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {hasThread ? 'Continue in Chat' : 'Chat (after first message)'}
                </button>
              </BuddyTooltip>
            </motion.div>
          </>
        )}
      </div>
    </aside>
  );
}
