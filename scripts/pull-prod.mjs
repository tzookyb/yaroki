// Replaces the local D1 database with a copy of production, and copies the photos it needs.
// Production is only read: the only --remote commands are `d1 export` and `r2 object get`.
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { getPlatformProxy } from 'wrangler'

const DB = 'plants-tracker'
const BUCKET = 'plants-tracker-photos'
const DIR = '.wrangler/prod-pull'
const PARALLEL_DOWNLOADS = 4

const run = promisify(execFile)

async function wrangler(...args) {
  const { stdout } = await run('npx', ['wrangler', ...args], {
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

mkdirSync(DIR, { recursive: true })

// Schema and data are exported apart, because a full export inserts plants before it creates rooms.
console.log('Exporting the production database...')
for (const [flag, file] of [
  ['--no-data', 'schema.sql'],
  ['--no-schema', 'data.sql'],
]) {
  await wrangler('d1', 'export', DB, '--remote', flag, '--output', `${DIR}/${file}`)
}

// The export recreates every table, so the local ones are dropped first.
const [{ results: tables }] = JSON.parse(
  await wrangler(
    'd1',
    'execute',
    DB,
    '--local',
    '--json',
    '--command',
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ),
)
writeFileSync(
  `${DIR}/import.sql`,
  [
    'PRAGMA defer_foreign_keys = on;',
    ...tables.map(({ name }) => `DROP TABLE IF EXISTS "${name}";`),
    readFileSync(`${DIR}/schema.sql`, 'utf8'),
    readFileSync(`${DIR}/data.sql`, 'utf8'),
  ].join('\n'),
)
console.log('Importing into the local database...')
await wrangler('d1', 'execute', DB, '--local', '--file', `${DIR}/import.sql`)

const { env, dispose } = await getPlatformProxy({ remoteBindings: false })
try {
  const { results } = await env.DB.prepare(
    'SELECT photo_key FROM plants WHERE photo_key IS NOT NULL',
  ).all()
  // Photo keys are never reused, so a photo that is already local is up to date.
  const missing = []
  for (const { photo_key: key } of results) {
    if (!(await env.PHOTOS.head(key))) missing.push(key)
  }
  console.log(`Copying ${missing.length} of ${results.length} photos...`)

  for (let i = 0; i < missing.length; i += PARALLEL_DOWNLOADS) {
    await Promise.all(
      missing.slice(i, i + PARALLEL_DOWNLOADS).map(async (key, j) => {
        const file = `${DIR}/photo-${i + j}.webp`
        await wrangler(
          'r2',
          'object',
          'get',
          `${BUCKET}/${key}`,
          '--remote',
          '--file',
          file,
        )
        await env.PHOTOS.put(key, readFileSync(file), {
          httpMetadata: { contentType: 'image/webp' },
        })
      }),
    )
  }
} finally {
  await dispose()
}
console.log('Done.')
