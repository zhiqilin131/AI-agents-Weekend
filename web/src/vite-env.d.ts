/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
  /** Same role as VITE_API_ORIGIN (FORESIGHT_X_LAUNCH.md naming). */
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Enable React Three Fiber slime (`1` or `true`). */
  readonly VITE_SLIME_3D?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
