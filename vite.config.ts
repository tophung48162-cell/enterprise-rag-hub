import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@ant-design/icons/') || id.includes('/node_modules/antd/')) return 'ui-vendor'
          if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react-vendor'
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
