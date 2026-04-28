/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { createApiProxyConfig, STREAMLINER_VITE_HOST } from './src/server/vite-proxy-config'

const apiProxy = createApiProxyConfig()

export default defineConfig({
  plugins: [react()],
  server: {
    host: STREAMLINER_VITE_HOST,
    proxy: {
      '/api': apiProxy,
    },
  },
  preview: {
    host: STREAMLINER_VITE_HOST,
    proxy: {
      '/api': apiProxy,
    },
  },
  test: {
    environment: 'node',
    exclude: ['prototype/**', 'node_modules/**', 'tests/e2e/**'],
  },
})
