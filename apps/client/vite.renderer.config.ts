import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  server: {
    watch: {
      // The web build shares this root and must not reload the desktop renderer.
      ignored: ['**/dist-web/**'],
    },
  },
  build: {
    // Keep sounds as files because the renderer CSP intentionally disallows data: media.
    assetsInlineLimit: 0,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
    },
  },
})
