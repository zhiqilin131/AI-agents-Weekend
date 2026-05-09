import { Pause, Play } from 'lucide-react';
import { cn } from '../ui/utils';

export function MiniReadAloudControl({
  supported,
  isPlaying,
  isPaused,
  disabled,
  onPress,
  className,
}: {
  supported: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  disabled?: boolean;
  onPress: () => void;
  className?: string;
}) {
  if (!supported) return null;

  const label =
    !isPlaying || isPaused ? 'Read recommendation aloud' : 'Pause read-aloud';

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onPress();
      }}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-indigo-200/90 bg-gradient-to-br from-white/95 to-indigo-50/90 text-indigo-700 shadow-[0_2px_12px_rgba(79,70,229,0.15)] transition-transform hover:scale-[1.04] active:scale-[0.98]',
        disabled && 'cursor-not-allowed opacity-40 hover:scale-100',
        className,
      )}
    >
      {!isPlaying || isPaused ? (
        <Play className="h-4 w-4 translate-x-px" fill="currentColor" aria-hidden />
      ) : (
        <Pause className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
