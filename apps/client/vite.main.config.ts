import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => ({
  define: { __CONCORD_SERVER_URL__: JSON.stringify(loadEnv(mode, process.cwd(), 'VITE_').VITE_SERVER_URL ?? 'http://localhost:3001') },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: { entryFileNames: 'main.js' },
    },
  },
}))
