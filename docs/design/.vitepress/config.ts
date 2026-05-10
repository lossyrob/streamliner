import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Streamliner Design',
  description: 'Streamliner project design documentation',
  srcDir: '.',
  outDir: '.vitepress/dist',
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }]
  ],

  rewrites: {
    'decisions/README.md': 'decisions/index.md'
  },

  themeConfig: {
    nav: [
      { text: 'Design', link: '/' }
    ],

    sidebar: [
      {
        text: 'Design Docs',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Product', link: '/product' },
          { text: 'Operating Model', link: '/operating-model' },
          { text: 'Design Layer', link: '/design-layer' },
          { text: 'Workstream Format', link: '/workstream-format' },
          { text: 'Session System', link: '/session-system' },
        ]
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Context Package', link: '/concepts/context-package' },
          { text: 'Waves', link: '/concepts/waves' },
        ]
      },
      {
        text: 'Decisions',
        items: [
          { text: 'Decision Records', link: '/decisions/' },
          { text: '001 — Observation-Based Session Tracking', link: '/decisions/001-observation-based-session-tracking' },
          { text: '002 — File-Based Context Delivery', link: '/decisions/002-file-based-context-delivery' },
          { text: '003 — PAW Control State Integration (superseded)', link: '/decisions/003-paw-control-state-integration' },
          { text: '004 — Session Registry as the Primary Session Surface', link: '/decisions/004-session-registry-primary-surface' },
          { text: '005 — Session Registry Storage and Identity Model', link: '/decisions/005-session-registry-storage-and-identity' },
          { text: '006 — Local Streamliner API Service', link: '/decisions/006-local-streamliner-api-service' },
          { text: '007 — Tracked Workstream Registry', link: '/decisions/007-tracked-workstream-registry' },
          { text: '008 — PAW Artifacts for Workflow Status', link: '/decisions/008-paw-artifacts-for-workflow-status' },
          { text: '009 — SDK-Managed Graph-Node Worker Runtime', link: '/decisions/009-sdk-managed-worker-runtime' },
          { text: '010 — Terminal Takeover and Managed Cleanup Actions', link: '/decisions/010-terminal-takeover-and-cleanup' },
        ]
      }
    ],

    outline: {
      level: [2, 3]
    }
  }
})
