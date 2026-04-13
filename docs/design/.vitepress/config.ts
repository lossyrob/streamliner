import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Streamliner Design',
  description: 'Streamliner project design documentation',
  srcDir: '.',
  outDir: '.vitepress/dist',

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
          { text: '001 — Heartbeat Session Tracking', link: '/decisions/001-heartbeat-based-session-tracking' },
          { text: '002 — File-Based Context Delivery', link: '/decisions/002-file-based-context-delivery' },
        ]
      }
    ],

    outline: {
      level: [2, 3]
    }
  }
})
