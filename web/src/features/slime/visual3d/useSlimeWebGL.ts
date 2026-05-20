import { useEffect, useState } from 'react';
import { SLIME_3D_ENABLED } from './slime3dConfig';

function detectWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => setReduced(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return reduced;
}

export type UseSlimeWebGLResult = {
  use3D: boolean;
  reducedMotion: boolean;
};

/** Decide whether to render R3F slime or SVG fallback. */
export function useSlimeWebGL(force2D = false): UseSlimeWebGLResult {
  const reducedMotion = usePrefersReducedMotion();
  const [webglOk, setWebglOk] = useState(() => (typeof window === 'undefined' ? false : detectWebGL()));

  useEffect(() => {
    setWebglOk(detectWebGL());
  }, []);

  const use3D = SLIME_3D_ENABLED && !force2D && webglOk && !reducedMotion;
  return { use3D, reducedMotion };
}
