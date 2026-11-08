import {
  HUMIDITY_LEVELS,
  ROOM_TEMP_MAX,
  ROOM_TEMP_MIN,
  type RoomProfile,
} from '../shared/api'

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
If the photo does not show a plant, set is_plant to false.
humidity_needs is the air humidity the plant is happy with indoors, and temp_min and temp_max are the air temperatures in °C it is comfortable in indoors.
description is two or three short sentences in Hebrew about the plant and what it needs: light, watering, humidity and temperature.
care_notes is one or two short sentences in Hebrew with the most useful care tip for this plant.`

const MAX_CARE_NOTES_CHARS = 300
const MAX_DESCRIPTION_CHARS = 600

const WINDOW_TEXT = {
  north: 'a window facing north (little direct sun)',
  east: 'a window facing east (morning sun)',
  south: 'a window facing south (the most sun)',
  west: 'a window facing west (strong afternoon sun)',
  none: 'no window',
}
const LIGHT_TEXT = {
  direct: 'direct sun',
  bright_indirect: 'bright indirect light',
  low: 'low light',
}
const HUMIDITY_TEXT = { dry: 'dry', normal: 'normal', humid: 'humid' }

export function describeRoom(room: RoomProfile) {
  const facts = [
    room.window_direction && `Windows: ${WINDOW_TEXT[room.window_direction]}.`,
    room.light_level && `Light: ${LIGHT_TEXT[room.light_level]}.`,
    room.humidity && `Humidity: ${HUMIDITY_TEXT[room.humidity]}.`,
    (room.temp_min !== null || room.temp_max !== null) &&
      `Temperature: ${room.temp_min ?? '?'} to ${room.temp_max ?? '?'} °C.`,
    room.near_draft && 'Plants here are in a draft.',
    room.near_ac && 'An air conditioner blows or sits near the plants.',
    room.near_heater && 'A heater is near the plants.',
  ].filter(Boolean)
  if (facts.length === 0) {
    return ''
  }
  return `\nThe plant lives in a room with these conditions:\n${facts.join('\n')}
Set water_every_days for these conditions. If the plant needs more or less light, humidity or warmth than the room gives, or the draft, air conditioner or heater would hurt it, start care_notes with that warning.`
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_plant: { type: 'BOOLEAN' },
    species: { type: 'STRING' },
    common_name: { type: 'STRING' },
    english_name: { type: 'STRING' },
    category: { type: 'STRING', enum: CATEGORIES },
    light_needs: { type: 'STRING', enum: LIGHT_NEEDS },
    humidity_needs: { type: 'STRING', enum: HUMIDITY_LEVELS },
    temp_min: {
      type: 'INTEGER',
      minimum: ROOM_TEMP_MIN,
      maximum: ROOM_TEMP_MAX,
    },
    temp_max: {
      type: 'INTEGER',
      minimum: ROOM_TEMP_MIN,
      maximum: ROOM_TEMP_MAX,
    },
    description: { type: 'STRING' },
    care_notes: { type: 'STRING' },
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
    'humidity_needs',
    'temp_min',
    'temp_max',
    'description',
    'care_notes',
  ],
}

export type Identification = {
  species: string
  common_name: string
  english_name: string | null
  category: string
  light_needs: string
  water_every_days: number
  humidity_needs: string | null
  temp_min: number | null
  temp_max: number | null
  description: string | null
  care_notes: string | null
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}

// Returns null when the photo shows no plant. Throws when Gemini fails or its answer is unusable.
export async function identifyPlant(
  photo: ArrayBuffer,
  apiKey: string,
  room?: RoomProfile,
): Promise<Identification | null> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: PROMPT + (room ? describeRoom(room) : '') },
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
    humidity_needs: oneOf(HUMIDITY_LEVELS, answer.humidity_needs) ?? null,
    ...cleanTemperatures(answer.temp_min, answer.temp_max),
    description:
      cleanText(answer.description).slice(0, MAX_DESCRIPTION_CHARS) || null,
    care_notes:
      cleanText(answer.care_notes).slice(0, MAX_CARE_NOTES_CHARS) || null,
  }
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown) {
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

// Both or neither, because a half range is not enough to compare against a room.
function cleanTemperatures(min: unknown, max: unknown) {
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max)
  ) {
    return { temp_min: null, temp_max: null }
  }
  const low = clampTemperature(Math.min(min, max))
  const high = clampTemperature(Math.max(min, max))
  return { temp_min: low, temp_max: high }
}

function clampTemperature(value: number) {
  return Math.min(ROOM_TEMP_MAX, Math.max(ROOM_TEMP_MIN, Math.round(value)))
}
