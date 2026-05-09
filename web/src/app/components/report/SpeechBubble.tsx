import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../ui/utils';

export function SpeechBubble({
  children,
  className,
  speaking,
  tailToward = 'start',
}: {
  children: ReactNode;
  className?: string;
  /** When read-aloud is active, bubble gently pulses */
  speaking?: boolean;
  /** Tail points toward the slime (start = left in LTR, toward advisor column) */
  tailToward?: 'start' | 'end';
}) {
  const tailLeft = tailToward === 'start';
  return (
    <motion.div
      animate={speaking ? { boxShadow: ['0 0 0 0 rgba(99,102,241,0.12)', '0 0 0 6px rgba(99,102,241,0.06)', '0 0 0 0 rgba(99,102,241,0.12)'] } : false}
      transition={speaking ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
      className={cn(
        'relative rounded-2xl border border-white/90 bg-white/88 px-4 py-3 shadow-[0_4px_24px_rgba(79,70,229,0.08)] backdrop-blur-sm',
        className,
      )}
    >
      {/* Tail toward slime */}
      <span
        className={cn(
          'pointer-events-none absolute bottom-3 h-3 w-3 rotate-45 border border-white/90 bg-white/88',
          tailLeft ? '-left-1.5 border-r-0 border-t-0' : '-right-1.5 border-b-0 border-l-0',
        )}
        aria-hidden
      />
      <div className="relative z-[1] text-left">{children}</div>
    </motion.div>
  );
}
