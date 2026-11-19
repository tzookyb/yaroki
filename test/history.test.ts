import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { getHistory } from '../worker/history'
import { addPlant, addWatering } from './helpers'

describe('plant history', () => {
  it('merges waterings, mistings, skips and interval changes, newest first', async () => {
    const plant = await addPlant({ water_every_days: 7 })
    await addWatering(plant, '2026-11-01 08:00:00')
    await env.DB.prepare(
      "INSERT INTO events (plant_id, type, created_at) VALUES (?, 'misted', '2026-11-05 08:00:00')",
    )
      .bind(plant)
      .run()
    await env.DB.prepare(
      "INSERT INTO task_skip_log (plant_id, type, reason, skipped_on) VALUES (?, 'water', 'wet_soil', '2026-11-08')",
    )
      .bind(plant)
      .run()
    await env.DB.prepare(
      "INSERT INTO water_interval_changes (plant_id, changed_on, from_days, to_days, cause) VALUES (?, '2026-11-10', 7, 8, 'wet_soil_skips')",
    )
      .bind(plant)
      .run()

    const history = await getHistory(env.DB, plant)

    expect(history.map((entry) => `${entry.kind} ${entry.date}`)).toEqual([
      'interval_changed 2026-11-10',
      'task_skipped 2026-11-08',
      'task_done 2026-11-05',
      'task_done 2026-11-01',
    ])
    expect(history[2]).toMatchObject({ type: 'mist' })
    expect(history[3]).toMatchObject({ type: 'water' })
  })

  it('is empty for a plant with no past care', async () => {
    const plant = await addPlant({})
    expect(await getHistory(env.DB, plant)).toEqual([])
  })
})
