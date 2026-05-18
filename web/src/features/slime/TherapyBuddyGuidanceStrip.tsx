import { ArrowLeft, Sparkles } from 'lucide-react';
import { getSlimeIdentity } from './slimeIdentity';

/** Soft nudge when voice is gated — distinct from the session control card below. */
export function TherapyBuddyGuidanceStrip({ message }: { message: string }) {
  const ident = getSlimeIdentity('wellbeing');
  return (
    <div
      data-testid="therapy-buddy-gate-banner"
      className="relative overflow-hidden rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50/95 via-white/90 to-rose-50/80 px-3.5 py-2.5 backdrop-blur-xl"
      style={{ boxShadow: `0 4px 24px ${ident.theme.glow}, inset 0 1px 0 rgba(255,255,255,0.9)` }}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-2xl"
        style={{ background: `linear-gradient(180deg, #fbbf24, ${ident.theme.primary})` }}
        aria-hidden
      />
      <div className="flex items-start gap-2.5 pl-1">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-amber-200/80 bg-white/90 text-amber-700 shadow-sm"
          aria-hidden
        >
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-900/75">
            Before you talk
          </p>
          <p className="mt-0.5 text-[12px] font-medium leading-snug text-amber-950/90">{message}</p>
          <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-rose-800/70">
            <ArrowLeft className="h-3 w-3 shrink-0" aria-hidden />
            Recent therapy · left
          </p>
        </div>
      </div>
    </div>
  );
}
