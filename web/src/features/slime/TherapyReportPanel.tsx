import { useEffect, useState } from 'react';
import { CalendarPlus, Check, ExternalLink, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { getSlimeIdentity } from './slimeIdentity';
import type { TherapyReport, TherapyActionSuggestion } from './therapySession';
import { scheduleTextOnExecutionCalendar } from '../../utils/calendarAgentApi';
import { useExecutionStorageUserKey } from '../../hooks/useExecutionStorageUserKey';
import { SLIME_VOICE_CALENDAR_RESOLVED_KEY } from '../../utils/executionStorageKeys';
import { BuddyTooltip } from './BuddyTooltip';

type AddedCalendarEntry = {
  eventTitle: string;
  startIso?: string;
  endIso?: string;
};

function readEventTiming(ev: Record<string, unknown>): { startIso?: string; endIso?: string } {
  const start = ev.start ?? ev.start_iso;
  const end = ev.end ?? ev.end_iso;
  return {
    startIso: typeof start === 'string' ? start : undefined,
    endIso: typeof end === 'string' ? end : undefined,
  };
}

type Props = {
  open: boolean;
  report: TherapyReport | null;
  onClose: () => void;
};

function schedulePhrase(action: TherapyActionSuggestion): string {
  const hint = (action.calendar_hint || '').trim();
  if (hint) return hint;
  const title = action.title.trim();
  const rationale = (action.rationale || '').trim();
  return `Schedule time for: ${title}${rationale ? `. ${rationale}` : ''}. Prefer a 30-minute block within the next few days.`;
}

export function TherapyReportPanel({ open, report, onClose }: Props) {
  const ident = getSlimeIdentity('wellbeing');
  const navigate = useNavigate();
  const { storageUserKey, ready: storageReady } = useExecutionStorageUserKey();
  const [schedulingKey, setSchedulingKey] = useState<string | null>(null);
  const [addedByTitle, setAddedByTitle] = useState<Record<string, AddedCalendarEntry>>({});
  const [errorsByTitle, setErrorsByTitle] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !report) return;
    setAddedByTitle({});
    setErrorsByTitle({});
    setSchedulingKey(null);
  }, [open, report?.id]);

  const addToCalendar = async (action: TherapyActionSuggestion) => {
    if (!storageReady || !storageUserKey) {
      setErrorsByTitle((prev) => ({
        ...prev,
        [action.title]: 'Sign in to use the execution calendar.',
      }));
      return;
    }
    const key = action.title;
    setSchedulingKey(key);
    setErrorsByTitle((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const events = await scheduleTextOnExecutionCalendar(schedulePhrase(action), storageUserKey);
      if (!events.length) {
        setErrorsByTitle((prev) => ({
          ...prev,
          [key]: 'Could not place a block — try opening Execution planner to adjust.',
        }));
        return;
      }
      const ev = events[0] ?? {};
      const title = String(ev.title || action.title);
      const timing = readEventTiming(ev);
      setAddedByTitle((prev) => ({
        ...prev,
        [key]: { eventTitle: title, ...timing },
      }));
    } catch (e) {
      setErrorsByTitle((prev) => ({
        ...prev,
        [key]: e instanceof Error ? e.message : 'Could not add to calendar',
      }));
    } finally {
      setSchedulingKey(null);
    }
  };

  const openInExecutionCalendar = (entry: AddedCalendarEntry) => {
    if (entry.startIso && entry.endIso) {
      try {
        sessionStorage.setItem(
          SLIME_VOICE_CALENDAR_RESOLVED_KEY,
          JSON.stringify({
            title: entry.eventTitle,
            start_iso: entry.startIso,
            end_iso: entry.endIso,
            display_summary: entry.eventTitle,
          }),
        );
      } catch {
        /* ignore */
      }
    }
    onClose();
    navigate('/execution');
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && report ? (
        <motion.div
          className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-labelledby="therapy-report-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border bg-white p-6 shadow-2xl"
            style={{ borderColor: ident.theme.border }}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="therapy-report-title" className="text-xl font-bold text-rose-950">
                  Therapy Report
                </h2>
                <p className="mt-1 text-xs text-rose-800/70">
                  Session summary — support-oriented, not a clinical diagnosis.
                </p>
              </div>
              <BuddyTooltip content="Close this report">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-rose-100 p-2 text-rose-900 hover:bg-rose-50"
                  aria-label="Close report"
                >
                  <X className="h-4 w-4" />
                </button>
              </BuddyTooltip>
            </div>

            <section className="mt-5 rounded-2xl border border-rose-100 bg-rose-50/50 p-4">
              <h3 className="text-sm font-semibold text-rose-950">Summary</h3>
              <p className="mt-2 text-sm leading-relaxed text-rose-950/90">{report.executive_summary}</p>
            </section>

            <section className="mt-4">
              <h3 className="text-sm font-semibold text-gray-900">What we explored</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">{report.session_summary}</p>
            </section>

            {report.themes_observed?.length ? (
              <section className="mt-4">
                <h3 className="text-sm font-semibold text-gray-900">Themes</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {report.themes_observed.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {report.strengths_noticed?.length ? (
              <section className="mt-4">
                <h3 className="text-sm font-semibold text-gray-900">Strengths noticed</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {report.strengths_noticed.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {report.suggested_actions?.length ? (
              <section className="mt-4">
                <h3 className="text-sm font-semibold text-gray-900">Suggested next steps</h3>
                <ul className="mt-3 space-y-3">
                  {report.suggested_actions.map((a) => {
                    const added = addedByTitle[a.title];
                    const rowErr = errorsByTitle[a.title];
                    const isAdding = schedulingKey === a.title;
                    return (
                    <li
                      key={a.title}
                      className="rounded-xl border border-rose-100 bg-white px-3 py-3 text-sm"
                    >
                      <p className="font-medium text-rose-950">{a.title}</p>
                      <p className="mt-1 text-gray-600">{a.rationale}</p>
                      <motion.div
                        layout
                        className="mt-2 flex flex-wrap items-center gap-2"
                        initial={false}
                      >
                        {added ? (
                          <>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
                              <Check className="h-3.5 w-3.5" aria-hidden />
                              Added
                            </span>
                            <BuddyTooltip content="Open the execution planner to view or adjust this block.">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-900 shadow-sm hover:bg-rose-50"
                                onClick={() => openInExecutionCalendar(added)}
                              >
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                                View in execution calendar
                              </button>
                            </BuddyTooltip>
                          </>
                        ) : (
                          <BuddyTooltip content="Parse this step and add a block to your execution calendar (planner).">
                            <button
                              type="button"
                              disabled={isAdding}
                              className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-900 hover:bg-rose-50 disabled:opacity-50"
                              onClick={() => void addToCalendar(a)}
                            >
                              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                              {isAdding ? 'Adding…' : 'Add to execution calendar'}
                            </button>
                          </BuddyTooltip>
                        )}
                      </motion.div>
                      {rowErr ? (
                        <p className="mt-2 text-xs text-red-700">{rowErr}</p>
                      ) : null}
                    </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {report.reflective_prompts?.length ? (
              <section className="mt-4">
                <h3 className="text-sm font-semibold text-gray-900">Reflection prompts</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
                  {report.reflective_prompts.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="mt-6 text-[11px] leading-relaxed text-gray-500">
              {report.disclaimer ||
                'This report is emotional support, not medical advice. Contact a qualified professional or crisis service if you need clinical care.'}
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
