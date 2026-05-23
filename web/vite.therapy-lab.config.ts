import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/** Dev server dedicated to Rimumu Therapy Exercise Lab (separate port from main app). */
export default mergeConfig(
  base,
  defineConfig({
    server: {
      port: 5174,
      strictPort: true,
      open: '/#/therapy-lab',
    },
  }),
);
