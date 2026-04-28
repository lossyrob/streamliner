/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import serveGraph from './vite-plugin-serve-graph'

export default defineConfig({
  plugins: [react(), serveGraph()],
  test: {
    environment: 'node',
    exclude: ['prototype/**', 'node_modules/**', 'tests/e2e/**'],
  },
})
