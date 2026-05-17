import { useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import { getSlimeIdentity, nextSlimeType, prevSlimeType, type SlimeType } from './slimeIdentity';
import { BuddyTooltip } from './BuddyTooltip';

const SWIPE_PX = 48;

/** Left / right arrows + swipe — cycle Mochi ↔ Rimumu. Chat 3D panel only; do NOT wrap Buddy voice slime. */
export function SlimeCompanionRail({
  slimeType,
  onSlimeTypeChange,
  disabled = false,
  children,
  className,
}: {
  slimeType: SlimeType;
  onSlimeTypeChange: (next: SlimeType) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const ident = getSlimeIdentity(slimeType);
  const dragRef = useRef<{ x: number; active: boolean }>({ x: 0, active: false });
  const prevName = getSlimeIdentity(prevSlimeType(slimeType)).shortName;
  const nextName = getSlimeIdentity(nextSlimeType(slimeType)).shortName;

  const goPrev = () => {
    if (disabled) return;
    onSlimeTypeChange(prevSlimeType(slimeType));
  };

  const goNext = () => {
    if (disabled) return;
    onSlimeTypeChange(nextSlimeType(slimeType));
  };

  const arrowBtnClass =
    'flex h-11 w-9 items-center justify-center rounded-full border border-white/90 bg-white/80 shadow-md backdrop-blur-md transition hover:bg-white disabled:opacity-50';

  return (
    <div className={cn('relative', className)}>
      <div
        className="absolute left-0 top-1/2 z-20 -translate-y-1/2"
        data-slime-avoid
      >
        <BuddyTooltip content={`Switch to ${prevName}`}>
          <button
            type="button"
            disabled={disabled}
            onClick={goPrev}
            className={arrowBtnClass}
            style={{ color: ident.theme.primary }}
            aria-label={`Switch to ${prevName}. Current: ${ident.shortName}`}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
        </BuddyTooltip>
      </div>

      <div
        className="absolute right-0 top-1/2 z-20 -translate-y-1/2"
        data-slime-avoid
      >
        <BuddyTooltip content={`Switch to ${nextName}`}>
          <button
            type="button"
            disabled={disabled}
            onClick={goNext}
            className={arrowBtnClass}
            style={{ color: ident.theme.primary }}
            aria-label={`Switch to ${nextName}. Current: ${ident.shortName}`}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </BuddyTooltip>
      </div>

      <div
        className="touch-pan-y"
        onPointerDown={(e) => {
          dragRef.current = { x: e.clientX, active: true };
        }}
        onPointerUp={(e) => {
          if (!dragRef.current.active) return;
          dragRef.current.active = false;
          const delta = e.clientX - dragRef.current.x;
          if (delta >= SWIPE_PX) goNext();
          else if (delta <= -SWIPE_PX) goPrev();
        }}
        onPointerCancel={() => {
          dragRef.current.active = false;
        }}
      >
        {children}
      </div>
    </div>
  );
}
