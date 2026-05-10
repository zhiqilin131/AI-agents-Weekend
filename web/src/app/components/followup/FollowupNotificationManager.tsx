import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { apiFetch } from '../../../utils/apiFetch';
import { DecisionFollowupToast, type FollowupToastPayload } from './DecisionFollowupToast';
import { OutcomeReviewCard } from './OutcomeReviewCard';

function clientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const POLL_MS = 15 * 60 * 1000;
const SOFT_HIDE_MS = 60 * 60 * 1000;

export function FollowupNotificationManager() {
  const loc = useLocation();
  const profileTzRef = useRef<string | null>(null);
  const [queue, setQueue] = useState<FollowupToastPayload[]>([]);
  const [active, setActive] = useState<FollowupToastPayload | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<{ payload: FollowupToastPayload; followupId: string } | null>(null);
  const [buddyLine, setBuddyLine] = useState<string | undefined>();
  const softHideUntil = useRef<number>(0);
  const resumeToastRef = useRef<FollowupToastPayload | null>(null);
  const markedShownRef = useRef<Set<string>>(new Set());

  const fetchDue = useCallback(async () => {
    if (Date.now() < softHideUntil.current) return;
    const critical = document.querySelector('[data-modal="critical"]');
    if (critical) return;

    const tz = profileTzRef.current || clientTimezone();
    try {
      const res = await apiFetch(`/api/followups/due?timezone=${encodeURIComponent(tz)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { followups?: FollowupToastPayload[] };
      const next = data.followups ?? [];
      setQueue((q) => {
        const ids = new Set(next.map((f) => f.id));
        const merged = [...q.filter((x) => ids.has(x.id))];
        for (const f of next) {
          if (!merged.some((m) => m.id === f.id)) merged.push(f);
        }
        return merged;
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch('/api/profile');
        if (res.ok) {
          const p = (await res.json()) as { timezone?: string };
          const t = (p.timezone || '').trim();
          if (t) profileTzRef.current = t;
        }
      } catch {
        /* ignore */
      }
      await fetchDue();
    })();
  }, [fetchDue, loc.pathname]);

  useEffect(() => {
    const t = window.setInterval(() => void fetchDue(), POLL_MS);
    return () => window.clearInterval(t);
  }, [fetchDue]);

  useEffect(() => {
    if (active || outcomeFor) return;
    const next = queue[0];
    if (!next) return;
    setActive(next);
  }, [queue, active, outcomeFor]);

  useEffect(() => {
    if (!active || outcomeFor) return;
    if (markedShownRef.current.has(active.id)) return;
    markedShownRef.current.add(active.id);
    const tz = profileTzRef.current || clientTimezone();
    void apiFetch(`/api/followups/${encodeURIComponent(active.id)}/shown?timezone=${encodeURIComponent(tz)}`, {
      method: 'POST',
    });
  }, [active, outcomeFor]);

  const dequeue = (id: string) => {
    markedShownRef.current.delete(id);
    setQueue((q) => q.filter((x) => x.id !== id));
    setActive((a) => (a?.id === id ? null : a));
  };

  const onDismissApi = async (id: string, reason: 'dismissed' | 'swiped' | 'closed' = 'dismissed') => {
    try {
      await apiFetch(`/api/followups/${encodeURIComponent(id)}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
    } catch {
      /* ignore */
    }
    dequeue(id);
    resumeToastRef.current = null;
  };

  const onStillPending = async (id: string) => {
    try {
      await apiFetch(`/api/followups/${encodeURIComponent(id)}/still-pending`, { method: 'POST' });
      setBuddyLine("Got it — I'll check back later.");
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      setBuddyLine(undefined);
      dequeue(id);
      resumeToastRef.current = null;
    }, 2200);
  };

  const onSnooze = async (id: string, preset: 'tomorrow' | '3_days' | 'next_week') => {
    try {
      await apiFetch(`/api/followups/${encodeURIComponent(id)}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      });
    } catch {
      /* ignore */
    }
    dequeue(id);
    resumeToastRef.current = null;
  };

  const openOutcome = (payload: FollowupToastPayload) => {
    resumeToastRef.current = payload;
    setOutcomeFor({ payload, followupId: payload.id });
    setActive(null);
  };

  const closeOutcomeOnly = () => {
    setOutcomeFor(null);
    const r = resumeToastRef.current;
    resumeToastRef.current = null;
    if (r) setActive(r);
  };

  if (!active && !outcomeFor) return null;

  return (
    <>
      {active && !outcomeFor ? (
        <div
          className="pointer-events-none fixed left-4 top-4 z-[120] flex flex-col gap-2"
          aria-live="polite"
        >
          <DecisionFollowupToast
            payload={active}
            buddyLine={buddyLine}
            onSoftClose={() => {
              softHideUntil.current = Date.now() + SOFT_HIDE_MS;
              dequeue(active.id);
              resumeToastRef.current = null;
            }}
            onDismiss={() => void onDismissApi(active.id, 'dismissed')}
            onSwipeDismiss={() => void onDismissApi(active.id, 'swiped')}
            onRecordOutcome={() => openOutcome(active)}
            onStillPending={() => void onStillPending(active.id)}
            onSnooze={(preset) => void onSnooze(active.id, preset)}
          />
        </div>
      ) : null}
      {outcomeFor ? (
        <OutcomeReviewCard
          payload={outcomeFor.payload}
          followupId={outcomeFor.followupId}
          decisionId={outcomeFor.payload.decision_id}
          onClose={closeOutcomeOnly}
          onSaved={() => {
            setOutcomeFor(null);
            resumeToastRef.current = null;
            if (outcomeFor.followupId) dequeue(outcomeFor.followupId);
          }}
        />
      ) : null}
    </>
  );
}
