import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Tests run inside the Workers runtime, with a local D1, R2 and rate limiter from wrangler.jsonc.
// Each test file starts from an empty database with all migrations applied (test/setup.ts).
export default defineConfig(async () => {
  const migrations = await readD1Migrations('migrations')
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            APP_PASSWORD: 'test-password-long-enough',
            GEMINI_API_KEY: 'test-gemini-key',
            SENTRY_DSN: '',
            SENSIBO_API_KEY: 'test-sensibo-key',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
    },
  }
})
