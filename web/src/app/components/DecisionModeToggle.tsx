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
}: {
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
  testId?: string;
  slimeType?: SlimeType;
}) {
  const theme = getSlimeIdentity(slimeType).theme;

  return (
    <BuddyTooltip content="Turn on before you speak or send — your message becomes a decision question; confirm with Yes to generate the report.">
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        onClick={onToggle}
        aria-pressed={active}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all',
          active
            ? 'decision-mode-glow border-sky-400/90 bg-sky-50 text-sky-900'
            : 'border-gray-200 bg-white text-gray-700 hover:border-sky-200 hover:bg-sky-50/60',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
        style={
          active
            ? {
                borderColor: theme.border,
                background: `linear-gradient(135deg, ${theme.background}, ${theme.surface})`,
                color: theme.heading,
                boxShadow: `0 10px 24px ${theme.glow}`,
              }
            : {
                borderColor: `${theme.border}99`,
                color: theme.heading,
              }
        }
      >
        <Scale className="h-3.5 w-3.5" style={{ color: theme.primary }} aria-hidden />
        <span className="hidden sm:inline">{active ? 'Decision on' : 'Decision'}</span>
        {active ? (
          <span
            className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ backgroundColor: theme.primary }}
            aria-hidden
          />
        ) : null}
      </button>
    </BuddyTooltip>
  );
}
