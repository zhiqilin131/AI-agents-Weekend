import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MemoryEvidenceChip } from './MemoryEvidenceChip';
import type { MemoryEvidenceItem } from './memoryEvidenceTypes';

const POSITIONS: Array<{ className: string; delay: number }> = [
  { className: 'absolute -left-2 top-0 -translate-x-full', delay: 0 },
  { className: 'absolute -right-2 top-2 translate-x-full', delay: 0.08 },
  { className: 'absolute left-1/2 -bottom-3 -translate-x-1/2 translate-y-full', delay: 0.16 },
  { className: 'absolute -left-1 bottom-8 -translate-x-3/4', delay: 0.1 },
  { className: 'absolute -right-1 bottom-10 translate-x-3/4', delay: 0.12 },
];

export type MemoryEvidenceParticlesProps = {
  items: MemoryEvidenceItem[];
  active: boolean;
  onDone?: () => void;
};

/** Brief chips around the slime — no raw dump in the main canvas. */
export function MemoryEvidenceParticles({ items, active, onDone }: MemoryEvidenceParticlesProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!active || items.length === 0) {
      setShow(false);
      return;
    }
    setShow(true);
    const t = window.setTimeout(() => {
      setShow(false);
      onDone?.();
    }, 2000);
    return () => window.clearTimeout(t);
  }, [active, items, onDone]);

  const slice = items.slice(0, 5);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      <AnimatePresence>
        {show
          ? slice.map((item, i) => {
              const pos = POSITIONS[i % POSITIONS.length];
              return (
                <motion.div
                  key={`${item.id}-${i}`}
                  className={pos.className}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <MemoryEvidenceChip item={item} delay={pos.delay} />
                </motion.div>
              );
            })
          : null}
      </AnimatePresence>
    </div>
  );
}
