// Flash-Lite, because gemini-3.8-flash took over 25 s on a plant photo in production.
const MODEL = 'gemini-3.5-flash-lite'
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
const TIMEOUT_MS = 45_000
const MAX_ERROR_CHARS = 500

const CATEGORIES = [
  'foliage',
  'flowering',
  'succulent',
  'cactus',
  'herb',
  'fern',
  'palm',
  'vine',
  'tree',
  'other',
]
const LIGHT_NEEDS = ['low', 'medium', 'bright_indirect', 'direct']
const MIN_WATER_EVERY_DAYS = 1
const MAX_WATER_EVERY_DAYS = 60

const PROMPT = `Identify the house plant in this photo.
Give species as the Latin botanical name, common_name as the name used in Hebrew, written in Hebrew letters, and english_name as the common name in English.
water_every_days is how often to water it indoors, in days, for a typical home in Israel.
If the photo does not show a plant, set is_plant to false.`

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_plant: { type: 'BOOLEAN' },
    species: { type: 'STRING' },
    common_name: { type: 'STRING' },
    english_name: { type: 'STRING' },
    category: { type: 'STRING', enum: CATEGORIES },
    light_needs: { type: 'STRING', enum: LIGHT_NEEDS },
    water_every_days: {
      type: 'INTEGER',
      minimum: MIN_WATER_EVERY_DAYS,
      maximum: MAX_WATER_EVERY_DAYS,
    },
  },
  required: [
    'is_plant',
    'species',
    'common_name',
    'english_name',
    'category',
    'light_needs',
    'water_every_days',
  ],
}

export type Identification = {
  species: string
  common_name: string
  english_name: string | null
  category: string
  light_needs: string
  water_every_days: number
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}

// Returns null when the photo shows no plant. Throws when Gemini fails or its answer is unusable.
export async function identifyPlant(
  photo: ArrayBuffer,
  apiKey: string,
): Promise<Identification | null> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: PROMPT },
            {
              inlineData: {
                mimeType: 'image/webp',
                // Native, because a loop in JS would use up the 10 ms CPU limit on large photos.
                data: new Uint8Array(photo).toBase64(),
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  })
  if (!response.ok) {
    const details = (await response.text()).slice(0, MAX_ERROR_CHARS)
    throw new Error(`Gemini HTTP ${response.status}: ${details}`)
  }

  const data = await response.json<GeminiResponse>()
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
  if (!text) {
    throw new Error('Gemini returned no text')
  }

  const answer = JSON.parse(text)
  if (answer.is_plant === false) {
    return null
  }

  const species = cleanText(answer.species)
  const commonName = cleanText(answer.common_name)
  if (!species || !commonName) {
    throw new Error('Gemini returned no name')
  }
  return {
    species,
    common_name: commonName,
    english_name: cleanText(answer.english_name) || null,
    category: oneOf(CATEGORIES, answer.category) ?? 'other',
    light_needs: oneOf(LIGHT_NEEDS, answer.light_needs) ?? 'medium',
    water_every_days: cleanWaterEveryDays(answer.water_every_days),
  }
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function oneOf(allowed: string[], value: unknown) {
  return allowed.find((item) => item === value)
}

function cleanWaterEveryDays(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Gemini returned no watering interval')
  }
  return Math.min(
    MAX_WATER_EVERY_DAYS,
    Math.max(MIN_WATER_EVERY_DAYS, Math.round(value)),
  )
}
