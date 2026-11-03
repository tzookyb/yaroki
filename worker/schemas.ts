import { z } from 'zod'
import { ROOM_NAME_MAX_LENGTH } from '../shared/api'

export const idParam = z.object({ id: z.coerce.number().int().positive() })

export const roomBody = z.object({
  name: z.string().trim().min(1).max(ROOM_NAME_MAX_LENGTH),
})

export const loginBody = z.object({ password: z.string().min(1).max(200) })
