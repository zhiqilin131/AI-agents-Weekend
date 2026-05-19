import { forwardRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../app/components/ui/utils';
import type { SlimeThemeColors } from './slimeIdentity';

type Props = {
  icon: LucideIcon;
  label: string;
  theme: SlimeThemeColors;
  onClick: () => void;
  className?: string;
  'aria-label'?: string;
  'aria-expanded'?: boolean;
  'data-testid'?: string;
};

/** Full-width CTA for the fixed Slime Buddy left rail (About, How Rimumu works, etc.). */
export const BuddyRailButton = forwardRef<HTMLButtonElement, Props>(function BuddyRailButton(
  {
    icon: Icon,
    label,
    theme,
    onClick,
    className,
    'aria-label': ariaLabel,
    'aria-expanded': ariaExpanded,
    'data-testid': dataTestId,
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      data-testid={dataTestId}
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      aria-expanded={ariaExpanded}
      className={cn(
        'inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-semibold shadow-[0_8px_28px_rgba(0,0,0,0.06)] backdrop-blur-xl transition hover:brightness-[1.02]',
        className,
      )}
      style={{
        borderColor: theme.border,
        background: `linear-gradient(180deg, ${theme.surface}f0, rgba(255,255,255,0.9))`,
        color: theme.primary,
        boxShadow: `0 8px 28px ${theme.glow}`,
      }}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
});
