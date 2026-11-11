import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENRICH_VERSION } from '../shared/api'
import {
  backfillReferenceImages,
  enrichPendingPlants,
  enrichPlant,
} from '../worker/enrich'
import { api, signIn } from './helpers'

const NEEDS = {
  humidity_needs: 'humid',
  temp_min: 18,
  temp_max: 27,
  description: 'צמח טרופי.',
  care_notes: 'להרחיק ממזגן',
}

// Answers Gemini with `NEEDS` and Wikipedia with a photo. The real services are never called.
function mockServices(gemini: () => Response = () => geminiAnswer()) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).includes('wikipedia.org')
      ? Response.json({
          thumbnail: { source: 'https://upload.wikimedia.org/a.jpg' },
        })
      : gemini(),
  )
}

function geminiAnswer() {
  return Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(NEEDS) }] } }],
  })
}

async function addOldPlant(species: string | null = 'Monstera deliciosa') {
  const { results } = await env.DB.prepare(
    `INSERT INTO plants (name, species, enriched_version)
     VALUES ('מונסטרה', ?, 0) RETURNING id`,
  )
    .bind(species)
    .run<{ id: number }>()
  return results[0].id
}

function plantRow(id: number) {
  return env.DB.prepare('SELECT * FROM plants WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('enrichPlant', () => {
  it('fills in the new data and keeps the name', async () => {
    const id = await addOldPlant()
    mockServices()
    expect(await enrichPlant(env, id)).toBe(true)
    expect(await plantRow(id)).toMatchObject({
      name: 'מונסטרה',
      species: 'Monstera deliciosa',
      ...NEEDS,
      reference_image_url: 'https://upload.wikimedia.org/a.jpg',
      enriched_version: ENRICH_VERSION,
    })
  })

  it('does not call the AI again for a plant that is up to date', async () => {
    const id = await addOldPlant()
    const fetch = mockServices()
    await enrichPlant(env, id)
    fetch.mockClear()
    expect(await enrichPlant(env, id)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('skips a plant that was never identified', async () => {
    const id = await addOldPlant(null)
    const fetch = mockServices()
    expect(await enrichPlant(env, id)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('leaves the plant as it was when Gemini fails', async () => {
    const id = await addOldPlant()
    mockServices(() => new Response('quota', { status: 429 }))
    await expect(enrichPlant(env, id)).rejects.toThrow()
    expect(await plantRow(id)).toMatchObject({ enriched_version: 0 })
  })
})

describe('enrichPendingPlants', () => {
  it('does a few plants per run and carries on after a failure', async () => {
    const ids = [] as number[]
    for (let i = 0; i < 7; i++) {
      ids.push(await addOldPlant())
    }
    let calls = 0
    mockServices(() =>
      ++calls === 1 ? new Response('boom', { status: 500 }) : geminiAnswer(),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await enrichPendingPlants(env)
    const done = await Promise.all(ids.map(plantRow))
    expect(
      done.filter((p) => p?.enriched_version === ENRICH_VERSION),
    ).toHaveLength(4)
    expect(done.filter((p) => p?.enriched_version === 0)).toHaveLength(3)
  })
})

describe('POST /plants/:id/enrich', () => {
  let session = ''
  beforeEach(async () => {
    session = (await signIn()).token
  })

  it('returns the updated plant', async () => {
    const id = await addOldPlant()
    mockServices()
    const response = await api(
      `/plants/${id}/enrich`,
      { method: 'POST' },
      session,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id,
      description: NEEDS.description,
    })
  })

  it('answers 502 when Gemini fails', async () => {
    const id = await addOldPlant()
    mockServices(() => new Response('quota', { status: 429 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await api(
      `/plants/${id}/enrich`,
      { method: 'POST' },
      session,
    )
    expect(response.status).toBe(502)
  })

  it('answers 404 for a missing plant', async () => {
    mockServices()
    const response = await api(
      '/plants/999/enrich',
      { method: 'POST' },
      session,
    )
    expect(response.status).toBe(404)
  })
})

describe('backfillReferenceImages', () => {
  it('fills missing photos without touching the AI data, and retries misses only after a week', async () => {
    const withPhoto = await addOldPlant()
    await env.DB.prepare(
      `UPDATE plants SET reference_image_url = 'https://upload.wikimedia.org/keep.jpg' WHERE id = ?`,
    )
      .bind(withPhoto)
      .run()
    const missing = await addOldPlant()
    const fetch = mockServices()

    await backfillReferenceImages(env)
    expect(await plantRow(missing)).toMatchObject({
      reference_image_url: 'https://upload.wikimedia.org/a.jpg',
      name: 'מונסטרה',
      enriched_version: 0,
    })
    expect(await plantRow(withPhoto)).toMatchObject({
      reference_image_url: 'https://upload.wikimedia.org/keep.jpg',
    })
    expect(fetch).toHaveBeenCalledTimes(1)

    fetch.mockImplementation(async () => new Response('', { status: 404 }))
    const noPage = await addOldPlant('Nothing here')
    await backfillReferenceImages(env)
    await backfillReferenceImages(env)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(await plantRow(noPage)).toMatchObject({ reference_image_url: null })
  })
})
