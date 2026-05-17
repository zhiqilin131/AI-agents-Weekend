import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Network, PlayCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../app/components/ui/utils';
import { shellCard } from './resilienceStyles';

const STEPS: {
  id: string;
  step: string;
  title: string;
  Icon: LucideIcon;
}[] = [
  { id: 'journey-hero', step: '1', title: 'Overview', Icon: LayoutDashboard },
  { id: 'resilience-explorer', step: '2', title: 'Architecture', Icon: Network },
  { id: 'resilience-live-test', step: '3', title: 'Live test', Icon: PlayCircle },
];

export function JudgeJourneyNav() {
  const [active, setActive] = useState<string>(STEPS[0].id);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    STEPS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) setActive(id);
          });
        },
        { rootMargin: '-20% 0px -50% 0px', threshold: 0.12 },
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <motion.nav
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.15, duration: 0.35 }}
      className="pointer-events-none fixed left-3 top-1/2 z-40 -translate-y-1/2 sm:left-4"
      aria-label="Judge tour steps"
    >
      <div className={cn(shellCard, 'pointer-events-auto flex flex-col gap-1.5 p-1.5')}>
        {STEPS.map(({ id, step, title, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              title={title}
              aria-label={`${step}. ${title}`}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => scrollTo(id)}
              className={cn(
                'flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-xl transition',
                isActive
                  ? 'bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-md'
                  : 'text-violet-700 hover:bg-violet-50/90',
              )}
            >
              <span className={cn('text-[10px] font-bold leading-none', isActive ? 'text-white/90' : 'text-violet-500')}>
                {step}
              </span>
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
            </button>
          );
        })}
      </div>
    </motion.nav>
  );
}
