import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

/** Same proxy for `npm run dev` and `npm run preview` so `/api/*` always reaches FastAPI on 8765. */
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8765',
    changeOrigin: true,
    // Long-running LLM + SSE; avoid proxy socket timeouts (default can be 60s).
    timeout: 600_000,
    proxyTimeout: 600_000,
  },
} as const

export default defineConfig({
  server: {
    proxy: { ...apiProxy },
  },
  preview: {
    proxy: { ...apiProxy },
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
