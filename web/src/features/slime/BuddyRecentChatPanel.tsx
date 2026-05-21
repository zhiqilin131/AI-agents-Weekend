import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, MessageSquare, Plus } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { apiFetch } from '../../utils/apiFetch';
import { BUDDY_RAIL_CONTENT_X } from './buddyLayout';
import { mochiBuddyRecentPanelTheme } from './buddyRecentPanelTheme';
import { getSlimeIdentity, normalizeSlimeType } from './slimeIdentity';
import { BuddyTooltip } from './BuddyTooltip';
import { sortThreadsByRecent } from './buddyThreadSort';
import { SLIME_CTA_BTN_CLASS } from './slimeCtaButton';

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
  creatingNewChat?: boolean;
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
  creatingNewChat = false,
  onSelectThread,
  onStartNewChat,
  onOpenFullChat,
  embedded = false,
  className,
}: BuddyRecentChatPanelProps) {
  const ident = getSlimeIdentity('generalized');
  const theme = ident.theme;
  const panel = mochiBuddyRecentPanelTheme(theme);
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
  const panelShellStyle = {
    borderColor: panel.border,
    background: `linear-gradient(180deg, ${panel.surface}, rgba(255,255,255,0.94))`,
    boxShadow: `0 4px 14px ${panel.shadow}`,
  } as const;

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
          'flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border backdrop-blur-xl',
          collapsed && 'items-center rounded-full py-2',
        )}
        style={panelShellStyle}
      >
        {collapsed ? (
          <motion.div layout className={cn('flex flex-col items-center gap-2 py-1', BUDDY_RAIL_CONTENT_X)}>
            <BuddyTooltip side="right" content="Expand recent chat">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={false}
                aria-label="Expand recent chat"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition hover:brightness-105"
                style={{
                  borderColor: panel.border,
                  background: panel.highlight,
                  color: panel.label,
                }}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </BuddyTooltip>
            <MessageSquare className="h-4 w-4" style={{ color: panel.label }} aria-hidden />
            {chatCount > 0 ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                style={{ background: panel.label }}
              >
                {chatCount}
              </span>
            ) : null}
          </motion.div>
        ) : (
          <>
            <div
              className={cn(
                'flex shrink-0 items-start justify-between gap-2 border-b py-2.5',
                BUDDY_RAIL_CONTENT_X,
              )}
              style={{
                borderColor: panel.border,
                background: `linear-gradient(90deg, ${panel.highlight}, transparent)`,
              }}
            >
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="min-w-0"
              >
                <p
                  className="text-[10px] font-semibold uppercase tracking-[0.22em]"
                  style={{ color: panel.label }}
                >
                  Recent chat
                </p>
                <p className="mt-0.5 truncate text-xs font-medium" style={{ color: panel.subtitle }}>
                  {activeThreadId ? `Chats with ${petName}` : 'Pick a conversation'}
                </p>
              </motion.div>
              <BuddyTooltip content="Collapse panel">
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  aria-expanded
                  aria-label="Collapse recent chat"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-white/90 shadow-sm transition hover:brightness-105"
                  style={{ borderColor: panel.border, color: panel.label }}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
              </BuddyTooltip>
            </div>

            <motion.div
              layout
              className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain py-2', BUDDY_RAIL_CONTENT_X)}
            >
              <BuddyTooltip content="Start a fresh chat with Mochi on the buddy page.">
                <button
                  type="button"
                  onClick={onStartNewChat}
                  disabled={creatingNewChat}
                  className={cn(
                    'mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs',
                    SLIME_CTA_BTN_CLASS,
                  )}
                  style={panel.ctaStyle}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {creatingNewChat ? 'Creating…' : 'New chat'}
                </button>
              </BuddyTooltip>

              {loading && threads.length === 0 ? (
                <ul className="space-y-2" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <li
                      key={i}
                      className="h-12 animate-pulse rounded-xl border bg-white/50"
                      style={{ borderColor: panel.border }}
                    />
                  ))}
                </ul>
              ) : threads.length === 0 ? (
                <div
                  className="rounded-xl border border-dashed px-3 py-4 text-center"
                  style={{
                    borderColor: panel.border,
                    background: panel.highlight,
                  }}
                >
                  <MessageSquare className="mx-auto h-5 w-5" style={{ color: panel.label }} aria-hidden />
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
                              className="w-full rounded-xl border px-2.5 py-2 text-left text-[11px] transition"
                              style={active ? panel.activeItem : panel.idleItem}
                            >
                              <motion.div layout className="flex items-center justify-between gap-1">
                                <span className="truncate font-medium text-slate-800">
                                  {t.title || 'Chat'}
                                </span>
                                {when ? (
                                  <span
                                    className="shrink-0 text-[9px] font-medium"
                                    style={{ color: panel.label }}
                                  >
                                    {when}
                                  </span>
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
              className={cn('shrink-0 border-t py-2.5', BUDDY_RAIL_CONTENT_X)}
              style={{ borderColor: panel.border, background: `${panel.highlight}88` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <BuddyTooltip content="Open the full Chat workspace for the selected thread">
                <button
                  type="button"
                  onClick={onOpenFullChat}
                  disabled={!activeThreadId}
                  className={cn(
                    'inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs transition',
                    activeThreadId ? SLIME_CTA_BTN_CLASS : 'font-semibold',
                  )}
                  style={activeThreadId ? panel.ctaStyle : panel.ctaDisabled}
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
