import { z } from 'zod'
import {
  HUMIDITY_LEVELS,
  LOCATION_TYPES,
  ROOM_LIGHT_LEVELS,
  ROOM_NAME_MAX_LENGTH,
  ROOM_TEMP_MAX,
  ROOM_TEMP_MIN,
  WINDOW_DIRECTIONS,
} from '../shared/api'

export const idParam = z.object({ id: z.coerce.number().int().positive() })

export const roomBody = z.object({
  name: z.string().trim().min(1).max(ROOM_NAME_MAX_LENGTH),
})

const temperature = z.number().int().min(ROOM_TEMP_MIN).max(ROOM_TEMP_MAX)
const flag = z.union([z.literal(0), z.literal(1)])

export const roomProfileBody = z
  .object({
    window_direction: z.enum(WINDOW_DIRECTIONS).nullable(),
    light_level: z.enum(ROOM_LIGHT_LEVELS).nullable(),
    humidity: z.enum(HUMIDITY_LEVELS).nullable(),
    temp_min: temperature.nullable(),
    temp_max: temperature.nullable(),
    near_draft: flag,
    near_ac: flag,
    near_heater: flag,
  })
  .refine(
    ({ temp_min, temp_max }) =>
      temp_min === null || temp_max === null || temp_min <= temp_max,
    { message: 'temp_min is above temp_max', path: ['temp_min'] },
  )

export const loginBody = z.object({ password: z.string().min(1).max(200) })

export const locationBody = z.object({ location_type: z.enum(LOCATION_TYPES) })

export const sensorParam = z.object({
  sensiboId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
})

export const sensorBody = z.object({
  room_id: z.number().int().positive().nullable(),
})

export const placeQuery = z.object({ q: z.string().trim().min(3).max(100) })

export const homeLocationBody = z.object({
  label: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})
