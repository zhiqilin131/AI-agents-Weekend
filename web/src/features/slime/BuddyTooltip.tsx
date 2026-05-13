import type { ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../app/components/ui/tooltip';
import { cn } from '../../app/components/ui/utils';

/** Shared look for buddy / studio hover hints (high contrast on dark violet). Slightly more opaque than glass panels for readability. */
export const buddyTooltipContentClass = cn(
  'z-[240] max-w-[min(288px,calc(100vw-2rem))] rounded-md border border-violet-900/50 bg-violet-950 px-3 py-2 text-left text-[11px] leading-relaxed font-medium text-violet-50 shadow-xl',
);

type BuddyTooltipProps = {
  content: string;
  /** Trigger element (must be a single element that accepts a ref). */
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delayDuration?: number;
};

export function BuddyTooltip({ content, children, side = 'top', delayDuration = 280 }: BuddyTooltipProps) {
  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={10} className={buddyTooltipContentClass}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
