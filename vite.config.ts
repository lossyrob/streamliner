/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

import { loadDotEnvFile } from './src/server/env'
import { createApiProxyConfig, STREAMLINER_VITE_HOST } from './src/server/vite-proxy-config'

loadDotEnvFile()

const apiProxy = createApiProxyConfig()

function reactRefreshPreambleFallback(): Plugin {
  let enabled = true
  let preamble = react.preambleCode.replace('__BASE__', '/')

  return {
    name: 'streamliner:react-refresh-preamble-fallback',
    apply: 'serve',
    configResolved(config) {
      enabled = config.server.hmr !== false
      preamble = react.preambleCode.replace('__BASE__', config.base)
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!enabled || html.includes('/@react-refresh')) {
          return
        }

        return [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: preamble,
            injectTo: 'head-prepend',
          },
        ]
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), reactRefreshPreambleFallback()],
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
