import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';

export type FollowupToastPayload = {
  id: string;
  decision_id: string;
  thread_id?: string;
  decision_title: string;
  decision_prompt: string;
  title: string;
  body: string;
  relative_phrase?: string;
};

type Props = {
  payload: FollowupToastPayload;
  onDismiss: () => void;
  onSwipeDismiss?: () => void;
  onSoftClose: () => void;
  onRecordOutcome: () => void;
  onStillPending: () => void;
  onSnooze: (preset: 'tomorrow' | '3_days' | 'next_week') => void;
  buddyLine?: string;
};

export function DecisionFollowupToast({
  payload,
  onDismiss,
  onSwipeDismiss,
  onSoftClose,
  onRecordOutcome,
  onStillPending,
  onSnooze,
  buddyLine,
}: Props) {
  const [dragX, setDragX] = useState(0);
  const startX = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    startX.current = e.clientX;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current == null) return;
    const dx = e.clientX - startX.current;
    setDragX(dx < 0 ? dx : 0);
  };

  const endDrag = useCallback(() => {
    if (dragX < -80) {
      (onSwipeDismiss ?? onDismiss)();
    }
    setDragX(0);
    startX.current = null;
  }, [dragX, onDismiss, onSwipeDismiss]);

  return (
    <div
      role="status"
      className="pointer-events-auto w-[min(22rem,calc(100vw-2rem))] select-none rounded-2xl border border-white/50 bg-white/45 px-4 py-3 pr-10 shadow-[0_8px_32px_rgba(31,38,135,0.12)] backdrop-blur-xl"
      style={{
        transform: `translateX(${dragX}px)`,
        transition: startX.current == null ? 'transform 0.2s ease-out' : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <button
        type="button"
        className="absolute right-2 top-2 rounded-full p-1 text-slate-500/80 hover:bg-white/50 hover:text-slate-800"
        aria-label="Close for now"
        onClick={(e) => {
          e.stopPropagation();
          onSoftClose();
        }}
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-2.5">
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-200/90 to-fuchsia-200/80 text-lg"
          aria-hidden
        >
          ✨
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600/90">{payload.title}</p>
          <p className="mt-1 text-[13px] leading-snug text-slate-800">{payload.body}</p>
          {payload.decision_prompt ? (
            <p className="mt-1.5 line-clamp-2 text-[12px] text-slate-600/95">&ldquo;{payload.decision_prompt}&rdquo;</p>
          ) : null}
          {buddyLine ? <p className="mt-2 text-[11px] text-violet-700/90">{buddyLine}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          className="rounded-full bg-violet-600/95 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-violet-700"
          onClick={(e) => {
            e.stopPropagation();
            onRecordOutcome();
          }}
        >
          Record outcome
        </button>
        <button
          type="button"
          className="rounded-full border border-slate-200/80 bg-white/50 px-3 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-white/80"
          onClick={(e) => {
            e.stopPropagation();
            onStillPending();
          }}
        >
          Still pending
        </button>
        <button
          type="button"
          className="rounded-full border border-slate-200/80 bg-white/50 px-3 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-white/80"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          Dismiss
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 border-t border-white/40 pt-2">
        <span className="w-full text-[10px] font-medium uppercase tracking-wide text-slate-500">Snooze</span>
        {(
          [
            ['tomorrow', 'Tomorrow'],
            ['3_days', '3 days'],
            ['next_week', 'Next week'],
          ] as const
        ).map(([preset, label]) => (
          <button
            key={preset}
            type="button"
            className="rounded-full border border-slate-200/60 px-2.5 py-1 text-[10px] text-slate-700 hover:bg-white/60"
            onClick={(e) => {
              e.stopPropagation();
              onSnooze(preset);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[9px] text-slate-400">Swipe left to dismiss</p>
    </div>
  );
}
