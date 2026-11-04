import { execFile } from 'node:child_process'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The settings menu's "pull from production" button. `apply: 'serve'` keeps it out of the
// prod build, so the deployed Worker never has this route.
function pullProdButton(): Plugin {
  return {
    name: 'pull-prod-button',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/pull-prod', (req, res) => {
        // The custom header blocks plain cross-site form posts to the dev server.
        if (req.method !== 'POST' || req.headers['x-dev-action'] !== '1') {
          res.statusCode = 405
          res.end()
          return
        }
        execFile('node', ['scripts/pull-prod.mjs'], (error, stdout, stderr) => {
          server.config.logger.info(stdout + stderr)
          res.statusCode = error ? 500 : 200
          res.end()
        })
      })
    },
  }
}
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    pullProdButton(),
    cloudflare(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Yaroki',
        short_name: 'Yaroki',
        description: 'מעקב אחר הצמחים בבית',
        lang: 'he',
        dir: 'rtl',
        theme_color: '#2f6b3f',
        background_color: '#f6f7f2',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
