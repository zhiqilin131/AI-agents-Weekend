import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import type { MemoryEvidenceItem } from './memoryEvidenceTypes';
import { cn } from '../ui/utils';

export function MemoryEvidenceChip({
  item,
  className,
  style,
  delay = 0,
}: {
  item: MemoryEvidenceItem;
  className?: string;
  style?: CSSProperties;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.82, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -6 }}
      transition={{ delay, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      style={style}
      className={cn(
        'pointer-events-none max-w-[140px] rounded-2xl border border-violet-200/70 bg-white/90 px-2.5 py-1.5 shadow-md backdrop-blur-md',
        className,
      )}
    >
      <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-600/90">{item.label}</p>
      <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-gray-700">{item.shortText}</p>
    </motion.div>
  );
}
