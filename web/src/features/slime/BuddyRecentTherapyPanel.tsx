import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, ClipboardList, FileText, Plus } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { apiFetch } from '../../utils/apiFetch';
import { getSlimeIdentity } from './slimeIdentity';
import { BuddyTooltip } from './BuddyTooltip';
import { sortThreadsByRecent } from './buddyThreadSort';
import { SLIME_CTA_BTN_CLASS, slimeCtaButtonStyle } from './slimeCtaButton';

const COLLAPSED_STORAGE_PREFIX = 'slimeBuddyRecentTherapyCollapsed';

function collapsedStorageKey(userId: string | null | undefined): string | null {
  const u = userId?.trim();
  if (!u) return null;
  return `${COLLAPSED_STORAGE_PREFIX}:${u}`;
}

function readCollapsedPreference(userId: string | null | undefined): boolean {
  const k = collapsedStorageKey(userId);
  if (!k) return true;
  try {
    const v = localStorage.getItem(k);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
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

export type TherapyThreadSummary = {
  thread_id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  therapy_started_at?: string;
  therapy_status?: string;
  has_therapy_report?: boolean;
  mood_score?: number;
  primary_concern?: string;
  slime_type?: string;
};

export type BuddyRecentTherapyPanelProps = {
  activeThreadId: string | null;
  storageUserId?: string | null;
  refreshKey?: number;
  onSelectThread: (threadId: string) => void;
  onStartNewTherapy: () => void;
  onOpenFullChat: () => void;
  /** When true, panel fills a parent fixed left rail instead of positioning itself. */
  embedded?: boolean;
  className?: string;
};

function formatSessionTime(iso?: string): string | null {
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

export function BuddyRecentTherapyPanel({
  activeThreadId,
  storageUserId = null,
  refreshKey = 0,
  onSelectThread,
  onStartNewTherapy,
  onOpenFullChat,
  embedded = false,
  className,
}: BuddyRecentTherapyPanelProps) {
  const ident = getSlimeIdentity('wellbeing');
  const [collapsed, setCollapsed] = useState(() => readCollapsedPreference(storageUserId));
  const [threads, setThreads] = useState<TherapyThreadSummary[]>([]);
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
      const data = (await res.json()) as { threads?: TherapyThreadSummary[] };
      const list = sortThreadsByRecent(
        (data.threads ?? []).filter((t) => t.slime_type === 'wellbeing'),
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

  const statusLabel = (t: TherapyThreadSummary) => {
    if (t.has_therapy_report || t.therapy_status === 'ended') return 'Ended';
    if (t.therapy_status === 'active') return 'In session';
    return 'Ready';
  };

  const sessionCount = threads.length;

  return (
    <aside
      data-slime-avoid
      data-testid="buddy-recent-therapy-panel"
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
      <div
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border shadow-[0_14px_48px_rgba(244,114,182,0.14)] backdrop-blur-xl',
          collapsed && 'items-center rounded-full py-2',
        )}
        style={{
          borderColor: ident.theme.border,
          background: collapsed
            ? `linear-gradient(145deg, ${ident.theme.surface}, white)`
            : `linear-gradient(180deg, ${ident.theme.surface}f0, rgba(255,255,255,0.88))`,
        }}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 px-1 py-1">
            <BuddyTooltip side="right" content="Expand recent therapy sessions">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={false}
                aria-label="Expand recent therapy"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition hover:brightness-105"
                style={{
                  borderColor: ident.theme.border,
                  background: ident.theme.surface,
                  color: ident.theme.primary,
                }}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </BuddyTooltip>
            <BuddyTooltip side="right" content="Your Rimumu therapy sessions">
              <span className="inline-flex">
                <ClipboardList className="h-4 w-4" style={{ color: ident.theme.primary }} aria-hidden />
              </span>
            </BuddyTooltip>
            {sessionCount > 0 ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                style={{ background: ident.theme.primary }}
              >
                {sessionCount}
              </span>
            ) : null}
          </div>
        ) : (
          <>
            <div
              className="flex shrink-0 items-start justify-between gap-2 border-b px-3 py-2.5"
              style={{ borderColor: ident.theme.border }}
            >
              <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="min-w-0">
                <p
                  className="text-[10px] font-semibold uppercase tracking-[0.22em]"
                  style={{ color: ident.theme.primary }}
                >
                  Recent therapy
                </p>
                <p className="mt-0.5 truncate text-xs font-medium text-rose-950/90">
                  {activeThreadId ? 'Rimumu sessions' : 'No session selected'}
                </p>
              </motion.div>
              <BuddyTooltip content="Collapse panel">
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  aria-expanded
                  aria-label="Collapse recent therapy"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-white/90 shadow-sm transition hover:bg-rose-50"
                  style={{ borderColor: ident.theme.border, color: ident.theme.primary }}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
              </BuddyTooltip>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2">
              <BuddyTooltip content="Create a new therapy thread — then complete check-in and tap Start therapy below.">
                <button
                  type="button"
                  onClick={onStartNewTherapy}
                  className={cn(
                    'mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs',
                    SLIME_CTA_BTN_CLASS,
                  )}
                  style={slimeCtaButtonStyle(ident.theme)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  New session
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
                <div
                  className="rounded-xl border border-dashed px-3 py-4 text-center"
                  style={{ borderColor: ident.theme.border, background: `${ident.theme.surface}88` }}
                >
                  <ClipboardList
                    className="mx-auto h-5 w-5 opacity-60"
                    style={{ color: ident.theme.primary }}
                    aria-hidden
                  />
                  <p className="mt-2 text-[11px] leading-relaxed text-rose-900/70">
                    No therapy sessions yet. Tap New session, then Start therapy below.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {threads.map((t, i) => {
                      const active = t.thread_id === activeThreadId;
                      const when = formatSessionTime(t.therapy_started_at || t.updated_at || t.created_at);
                      return (
                        <motion.li
                          key={t.thread_id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                        >
                          <BuddyTooltip
                            content={`Open this session${t.has_therapy_report ? ' (report available)' : ''}`}
                          >
                            <button
                              type="button"
                              onClick={() => onSelectThread(t.thread_id)}
                              className={cn(
                                'w-full rounded-xl border px-2.5 py-2 text-left text-[11px] transition',
                                active
                                  ? 'border-rose-300 bg-rose-100/90 shadow-sm'
                                  : 'border-rose-100/90 bg-white/85 hover:border-rose-200',
                              )}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="truncate font-medium text-rose-950">
                                  {t.title || 'Therapy session'}
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {when ? <span className="text-[9px] font-semibold text-rose-600/80">{when}</span> : null}
                                  {t.has_therapy_report ? (
                                    <FileText className="h-3 w-3 text-rose-600" aria-hidden />
                                  ) : null}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-[10px] text-rose-900/65">
                                {t.primary_concern || statusLabel(t)}
                                {t.mood_score != null ? ` · mood ${t.mood_score}/10` : ''}
                              </p>
                              <span className="mt-1 inline-block rounded-full bg-rose-100/90 px-1.5 py-0.5 text-[9px] font-medium text-rose-800">
                                {statusLabel(t)}
                              </span>
                            </button>
                          </BuddyTooltip>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </div>

            <motion.div
              className="shrink-0 border-t p-2.5"
              style={{ borderColor: ident.theme.border }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <BuddyTooltip content="Open the full Chat workspace for the selected therapy thread.">
                <button
                  type="button"
                  onClick={onOpenFullChat}
                  disabled={!activeThreadId}
                  className={cn(
                    'inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs',
                    activeThreadId
                      ? SLIME_CTA_BTN_CLASS
                      : 'cursor-not-allowed border bg-rose-50/60 font-semibold text-rose-400',
                  )}
                  style={
                    activeThreadId ? slimeCtaButtonStyle(ident.theme) : { borderColor: ident.theme.border }
                  }
                >
                  <ClipboardList className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {activeThreadId ? 'Continue in Chat' : 'Chat (pick a session)'}
                </button>
              </BuddyTooltip>
            </motion.div>
          </>
        )}
      </div>
    </aside>
  );
}
