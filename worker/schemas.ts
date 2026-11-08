import { z } from 'zod'
import {
  HUMIDITY_LEVELS,
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
