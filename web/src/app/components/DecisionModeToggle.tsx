import { Scale } from 'lucide-react';
import { BuddyTooltip } from '../../features/slime/BuddyTooltip';
import { getSlimeIdentity, type SlimeType } from '../../features/slime/slimeIdentity';
import { cn } from './ui/utils';

export function DecisionModeToggle({
  active,
  disabled = false,
  onToggle,
  className = '',
  testId = 'decision-mode-toggle',
  slimeType = 'generalized',
  iconOnly = false,
}: {
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
  testId?: string;
  slimeType?: SlimeType;
  /** Square icon button for buddy voice dock. */
  iconOnly?: boolean;
}) {
  const theme = getSlimeIdentity(slimeType).theme;

  return (
    <BuddyTooltip
      content={
        active
          ? 'Decision Mode on — your next message becomes a decision question.'
          : 'Turn on before you speak or send — your message becomes a decision question; confirm with Yes to generate the report.'
      }
    >
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        onClick={onToggle}
        aria-pressed={active}
        aria-label={active ? 'Decision mode on' : 'Turn on decision mode'}
        className={cn(
          'inline-flex shrink-0 items-center justify-center border font-semibold transition-all',
          iconOnly
            ? cn(
                'h-11 w-11 rounded-2xl',
                active
                  ? 'shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]'
                  : 'bg-white/95 hover:brightness-[1.02] active:scale-[0.97]',
              )
            : cn(
                'gap-1.5 rounded-xl px-3 py-1.5 text-xs',
                active
                  ? 'decision-mode-glow border-sky-400/90 bg-sky-50 text-sky-900'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-sky-200 hover:bg-sky-50/60',
              ),
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
        style={
          active
            ? {
                borderColor: theme.accent,
                background: iconOnly
                  ? `linear-gradient(145deg, ${theme.highlight}, ${theme.surface})`
                  : `linear-gradient(135deg, ${theme.background}, ${theme.surface})`,
                color: theme.heading,
                boxShadow: iconOnly
                  ? `0 4px 14px ${theme.ctaGlow}, inset 0 1px 0 rgba(255,255,255,0.85)`
                  : `0 10px 24px ${theme.glow}`,
              }
            : {
                borderColor: `${theme.border}88`,
                color: theme.heading,
                boxShadow: iconOnly ? '0 2px 8px rgba(15, 23, 42, 0.05)' : undefined,
              }
        }
      >
        <Scale
          className={cn(iconOnly ? 'h-[1.125rem] w-[1.125rem]' : 'h-3.5 w-3.5')}
          style={{ color: theme.primary }}
          aria-hidden
        />
        {!iconOnly ? (
          <>
            <span className="hidden sm:inline">{active ? 'Decision on' : 'Decision'}</span>
            {active ? (
              <span
                className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full"
                style={{ backgroundColor: theme.primary }}
                aria-hidden
              />
            ) : null}
          </>
        ) : null}
      </button>
    </BuddyTooltip>
  );
}
