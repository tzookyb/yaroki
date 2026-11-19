import type { HistoryEntry, SkipReason } from '../shared/api'
import { jerusalemDate } from './tasks'

const EVENT_TASK_TYPES: Record<string, string> = {
  watered: 'water',
  misted: 'mist',
}

const MAX_ENTRIES = 100

// Past care of one plant, newest first. Waterings and mistings come from `events`, skips from
// `task_skip_log` and automatic interval changes from `water_interval_changes`.
export async function getHistory(
  db: D1Database,
  plantId: number,
): Promise<HistoryEntry[]> {
  const [events, skips, changes] = await db.batch([
    db
      .prepare(
        `SELECT id, type, created_at FROM events
         WHERE plant_id = ? AND type IN ('watered', 'misted')
         ORDER BY id DESC LIMIT ?`,
      )
      .bind(plantId, MAX_ENTRIES),
    db
      .prepare(
        `SELECT type, reason, skipped_on FROM task_skip_log
         WHERE plant_id = ? ORDER BY skipped_on DESC LIMIT ?`,
      )
      .bind(plantId, MAX_ENTRIES),
    db
      .prepare(
        `SELECT id, changed_on, from_days, to_days, cause FROM water_interval_changes
         WHERE plant_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .bind(plantId, MAX_ENTRIES),
  ])

  // `order` keeps entries of one day in a stable order: later row ids first within a source.
  const entries: { order: number; entry: HistoryEntry }[] = []
  for (const row of events.results as {
    id: number
    type: string
    created_at: string
  }[]) {
    entries.push({
      order: row.id,
      entry: {
        kind: 'task_done',
        type: EVENT_TASK_TYPES[row.type],
        date: jerusalemDate(row.created_at),
      },
    })
  }
  for (const row of skips.results as {
    type: string
    reason: SkipReason
    skipped_on: string
  }[]) {
    entries.push({
      order: 0,
      entry: {
        kind: 'task_skipped',
        type: row.type,
        date: row.skipped_on,
        reason: row.reason,
      },
    })
  }
  for (const row of changes.results as {
    id: number
    changed_on: string
    from_days: number
    to_days: number
    cause: string
  }[]) {
    entries.push({
      order: row.id,
      entry: {
        kind: 'interval_changed',
        date: row.changed_on,
        from_days: row.from_days,
        to_days: row.to_days,
        cause: row.cause,
      },
    })
  }
  return entries
    .sort(
      (a, b) => b.entry.date.localeCompare(a.entry.date) || b.order - a.order,
    )
    .slice(0, MAX_ENTRIES)
    .map(({ entry }) => entry)
}
