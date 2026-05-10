import type { SVGProps } from 'react';
import { cn } from '../ui/utils';

/**
 * Custom “slime droplet + sparkle” mark for Slime Credits (not a generic coin).
 */
export function SlimeCreditIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden
      {...props}
    >
      <defs>
        <linearGradient id="slimeCreditGrad" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34d399" />
          <stop offset="0.45" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
      </defs>
      <path
        d="M12 3.2c2.2 1.1 3.8 2.8 4.6 4.9.5 1.3.8 2.7.8 4.1 0 3.9-2.7 7.1-6.2 7.8-.5.1-1 .1-1.5 0-3.5-.7-6.2-3.9-6.2-7.8 0-1.4.3-2.8.8-4.1.8-2.1 2.4-3.8 4.6-4.9.6-.3 1.3-.3 1.9 0Z"
        fill="url(#slimeCreditGrad)"
        opacity="0.92"
      />
      <path
        d="M9.2 9.4c.35-.75 1.25-1.05 1.95-.55.45.35.65.9.55 1.45-.15.85-1.1 1.35-1.9 1-.75-.35-1.1-1.2-.6-1.9Z"
        fill="white"
        opacity="0.35"
      />
      <path d="M16.2 6.1l.9 1.55 1.75.35-1.25 1.2.3 1.8-1.55-.85-1.55.85.3-1.8-1.25-1.2 1.75-.35.9-1.55Z" fill="#fef9c3" opacity="0.95" />
      <path d="M6.5 14.2l.55.95 1.1.2-.8.75.2 1.1-.95-.55-.95.55.2-1.1-.8-.75 1.1-.2.55-.95Z" fill="#e0e7ff" opacity="0.9" />
    </svg>
  );
}
