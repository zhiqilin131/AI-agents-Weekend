import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, MessageSquare, Plus } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { apiFetch } from '../../utils/apiFetch';
import { getSlimeIdentity, normalizeSlimeType } from './slimeIdentity';
import { BuddyTooltip } from './BuddyTooltip';
import { sortThreadsByRecent } from './buddyThreadSort';

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
    const v = localStorage.getItem(k);
    if (v === null) return false;
    return v === '1';
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

export type ChatThreadSummary = {
  thread_id: string;
  title?: string;
  updated_at?: string;
  message_count?: number;
  slime_type?: string;
};

export type BuddyRecentChatPanelProps = {
  activeThreadId: string | null;
  storageUserId?: string | null;
  refreshKey?: number;
  onSelectThread: (threadId: string) => void;
  onStartNewChat: () => void;
  onOpenFullChat: () => void;
  /** When true, panel fills a parent fixed left rail instead of positioning itself. */
  embedded?: boolean;
  className?: string;
};

function formatUpdatedAt(iso?: string): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function BuddyRecentChatPanel({
  activeThreadId,
  storageUserId = null,
  refreshKey = 0,
  onSelectThread,
  onStartNewChat,
  onOpenFullChat,
  embedded = false,
  className,
}: BuddyRecentChatPanelProps) {
  const ident = getSlimeIdentity('generalized');
  const [collapsed, setCollapsed] = useState(() => readCollapsedPreference(storageUserId));
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCollapsed(readCollapsedPreference(storageUserId));
  }, [storageUserId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/shadow-chat/threads');
      if (!res.ok) {
        setThreads([]);
        return;
      }
      const data = (await res.json()) as { threads?: ChatThreadSummary[] };
      const list = sortThreadsByRecent(
        (data.threads ?? []).filter(
          (t) => (normalizeSlimeType(t.slime_type) ?? 'generalized') === 'generalized',
        ),
      );
      setThreads(list.slice(0, 12));
    } catch {
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, activeThreadId, refreshKey]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsedPreference(storageUserId, next);
      return next;
    });
  };

  const chatCount = threads.length;
  const petName = ident.displayName;

  return (
    <aside
      data-slime-avoid
      data-testid="buddy-recent-chat-panel"
      className={cn(
        'pointer-events-auto flex flex-col transition-[width] duration-300 ease-out',
        embedded
          ? 'relative z-auto min-h-0 w-full flex-1 max-h-full'
          : 'fixed z-[72] left-3 top-[max(6.25rem,calc(env(safe-area-inset-top,0px)+5.5rem))] max-h-[calc(100dvh-max(6.25rem,calc(env(safe-area-inset-top,0px)+5.5rem))-env(safe-area-inset-bottom,0px))] sm:left-4',
        !embedded && (collapsed ? 'w-11' : 'w-[min(17.5rem,calc(100vw-2rem))] sm:w-72'),
        embedded && (collapsed ? 'w-11 self-start' : 'w-full'),
        className,
      )}
    >
      <motion.div
        layout
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/72 shadow-[0_14px_48px_rgba(79,70,229,0.12)] backdrop-blur-xl',
          collapsed && 'items-center rounded-full border-violet-200/70 py-2',
        )}
      >
        {collapsed ? (
          <motion.div layout className="flex flex-col items-center gap-2 px-1 py-1">
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
            {chatCount > 0 ? (
              <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                {chatCount}
              </span>
            ) : null}
          </motion.div>
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
                  {activeThreadId ? `Chats with ${petName}` : 'Pick a conversation'}
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

            <motion.div layout className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2">
              <BuddyTooltip content="Start a fresh chat with Mochi on the buddy page.">
                <button
                  type="button"
                  onClick={onStartNewChat}
                  className="mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-105"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  New chat
                </button>
              </BuddyTooltip>

              {loading && threads.length === 0 ? (
                <ul className="space-y-2" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <li
                      key={i}
                      className="h-12 animate-pulse rounded-xl border border-white/60 bg-white/50"
                    />
                  ))}
                </ul>
              ) : threads.length === 0 ? (
                <div className="rounded-xl border border-dashed border-violet-200/90 bg-violet-50/40 px-3 py-4 text-center">
                  <MessageSquare className="mx-auto h-5 w-5 text-violet-400" aria-hidden />
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
                    No chats yet. Tap New chat, or hold the mic and say hello.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {threads.map((t, i) => {
                      const active = t.thread_id === activeThreadId;
                      const when = formatUpdatedAt(t.updated_at);
                      const count = t.message_count ?? 0;
                      const subtitle =
                        count > 0 ? `${count} message${count === 1 ? '' : 's'}` : 'No messages yet';
                      return (
                        <motion.li
                          key={t.thread_id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                        >
                          <BuddyTooltip content="Continue this conversation on the buddy page">
                            <button
                              type="button"
                              onClick={() => onSelectThread(t.thread_id)}
                              className={cn(
                                'w-full rounded-xl border px-2.5 py-2 text-left text-[11px] transition',
                                active
                                  ? 'border-violet-300 bg-violet-100/90 shadow-sm'
                                  : 'border-violet-100/90 bg-white/85 hover:border-violet-200',
                              )}
                            >
                              <motion.div layout className="flex items-center justify-between gap-1">
                                <span className="truncate font-medium text-slate-800">
                                  {t.title || 'Chat'}
                                </span>
                                {when ? (
                                  <span className="shrink-0 text-[9px] text-violet-600/80">{when}</span>
                                ) : null}
                              </motion.div>
                              <p className="mt-0.5 truncate text-[10px] text-slate-500">{subtitle}</p>
                            </button>
                          </BuddyTooltip>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </motion.div>

            <motion.div
              layout
              className="shrink-0 border-t border-violet-100/80 bg-white/50 p-2.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <BuddyTooltip content="Open the full Chat workspace for the selected thread">
                <button
                  type="button"
                  onClick={onOpenFullChat}
                  disabled={!activeThreadId}
                  className={cn(
                    'inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition',
                    activeThreadId
                      ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md hover:brightness-105'
                      : 'cursor-not-allowed border border-violet-100 bg-violet-50/60 text-violet-400',
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {activeThreadId ? 'Continue in Chat' : 'Chat (pick a conversation)'}
                </button>
              </BuddyTooltip>
            </motion.div>
          </>
        )}
      </motion.div>
    </aside>
  );
}
