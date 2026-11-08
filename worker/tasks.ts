import type { SkipReason, Task, TaskList } from '../shared/api'

// Care tasks are computed from plant fields, not stored. A new task type adds an entry to TASK_TYPES.
// Each plant has at most one task of each type.

const TIME_ZONE = 'Asia/Jerusalem'
const DAY_MS = 24 * 60 * 60 * 1000

type TaskPlant = {
  id: number
  name: string | null
  photo_key: string | null
  room_id: number | null
  room_name: string | null
  water_every_days: number | null
  last_watered: string | null
}

type TaskType = {
  // The due date, or null when the plant has no such task.
  dueDate(plant: TaskPlant, today: string): string | null
  doneToday(plant: TaskPlant, today: string): boolean
  complete(db: D1Database, plantId: number, today: string): Promise<unknown>
  undo(db: D1Database, plantId: number, today: string): Promise<unknown>
}

const TASK_TYPES: Record<string, TaskType> = {
  water: {
    dueDate(plant, today) {
      if (!plant.water_every_days) {
        return null
      }
      // A plant never marked as watered is due today, and its schedule starts once it is.
      if (!plant.last_watered) {
        return today
      }
      return addDays(plant.last_watered, plant.water_every_days)
    },
    doneToday(plant, today) {
      return plant.last_watered === today
    },
    complete(db, plantId, today) {
      return db.batch([
        db
          .prepare('UPDATE plants SET last_watered = ? WHERE id = ?')
          .bind(today, plantId),
        db
          .prepare("INSERT INTO events (plant_id, type) VALUES (?, 'watered')")
          .bind(plantId),
      ])
    },
    // Removes today's waterings, and goes back to the latest one before today, if any.
    async undo(db, plantId, today) {
      const { results } = await db
        .prepare(
          `SELECT id, created_at FROM events
           WHERE plant_id = ? AND type = 'watered'
           ORDER BY id DESC LIMIT 10`,
        )
        .bind(plantId)
        .all<{ id: number; created_at: string }>()
      const todays = results.filter(
        (event) => jerusalemDate(event.created_at) === today,
      )
      const previous = results.find(
        (event) => jerusalemDate(event.created_at) !== today,
      )
      return db.batch([
        db
          .prepare('UPDATE plants SET last_watered = ? WHERE id = ?')
          .bind(previous ? jerusalemDate(previous.created_at) : null, plantId),
        ...todays.map((event) =>
          db.prepare('DELETE FROM events WHERE id = ?').bind(event.id),
        ),
      ])
    },
  },
}

// Days a skip postpones the task. Wet soil needs time to dry, a resting plant needs much longer,
// and the others only move the task to tomorrow.
const SKIP_DAYS: Record<SkipReason, number> = {
  wet_soil: 3,
  dormant: 7,
  away: 1,
  other: 1,
}

type Skip = {
  plant_id: number
  type: string
  reason: SkipReason
  skipped_on: string
  until: string
}

// en-CA formats as YYYY-MM-DD.
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE })

export function todayInJerusalem() {
  return dateFormat.format(new Date())
}

// D1's datetime('now') is UTC, as YYYY-MM-DD HH:MM:SS.
function jerusalemDate(utcDateTime: string) {
  return dateFormat.format(new Date(`${utcDateTime.replace(' ', 'T')}Z`))
}

function addDays(date: string, days: number) {
  const time = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS
  return new Date(time).toISOString().slice(0, 10)
}

// Open tasks most urgent first, then tasks done today. Without `all`, only open tasks due by tomorrow.
export async function getTasks(
  db: D1Database,
  all: boolean,
): Promise<TaskList> {
  const today = todayInJerusalem()
  const tomorrow = addDays(today, 1)
  const { results: plants } = await db
    .prepare(
      `SELECT plants.id, plants.name, plants.photo_key, plants.room_id,
              rooms.name AS room_name, plants.water_every_days, plants.last_watered
       FROM plants
       LEFT JOIN rooms ON rooms.id = plants.room_id`,
    )
    .all<TaskPlant>()

  const { results: skipRows } = await db
    .prepare('SELECT plant_id, type, reason, skipped_on, until FROM task_skips')
    .all<Skip>()
  const skips = new Map(
    skipRows.map((skip) => [`${skip.plant_id}-${skip.type}`, skip]),
  )

  const tasks: Task[] = []
  for (const plant of plants) {
    for (const [type, taskType] of Object.entries(TASK_TYPES)) {
      let dueDate = taskType.dueDate(plant, today)
      if (!dueDate) {
        continue
      }
      // A skip only counts until the plant is cared for again, and only if it moves the date later.
      const skip = skips.get(`${plant.id}-${type}`)
      const skipped =
        skip !== undefined &&
        skip.until > dueDate &&
        (!plant.last_watered || skip.skipped_on > plant.last_watered)
      if (skipped) {
        dueDate = skip.until
      }
      const doneToday = taskType.doneToday(plant, today)
      if (!all && !doneToday && dueDate > tomorrow) {
        continue
      }
      tasks.push({
        type,
        plant_id: plant.id,
        plant_name: plant.name,
        photo_key: plant.photo_key,
        room_id: plant.room_id,
        room_name: plant.room_name,
        due_date: dueDate,
        done_today: doneToday,
        skip_reason: skipped ? skip.reason : null,
      })
    }
  }
  tasks.sort(
    (a, b) =>
      Number(a.done_today) - Number(b.done_today) ||
      a.due_date.localeCompare(b.due_date) ||
      (a.room_name ?? '').localeCompare(b.room_name ?? '') ||
      a.plant_id - b.plant_id,
  )
  return { today, tasks }
}

// Returns false when the task type or the plant does not exist, or an undo has nothing to undo.
export async function setTaskDone(
  db: D1Database,
  type: string,
  plantId: number,
  done: boolean,
) {
  const taskType = Object.hasOwn(TASK_TYPES, type) ? TASK_TYPES[type] : null
  if (!taskType) {
    return false
  }
  const plant = await db
    .prepare('SELECT * FROM plants WHERE id = ?')
    .bind(plantId)
    .first<TaskPlant>()
  if (!plant) {
    return false
  }
  const today = todayInJerusalem()
  if (done) {
    if (!taskType.doneToday(plant, today)) {
      await taskType.complete(db, plantId, today)
    }
  } else {
    // Only today's completion can be undone, so an old one is never lost by mistake.
    if (!taskType.doneToday(plant, today)) {
      return false
    }
    await taskType.undo(db, plantId, today)
  }
  return true
}

// Postpones a task for the reason's number of days, or brings it back when `reason` is null.
// Returns false when the task type or the plant does not exist, or the task is already done today.
export async function setTaskSkipped(
  db: D1Database,
  type: string,
  plantId: number,
  reason: SkipReason | null,
) {
  const taskType = Object.hasOwn(TASK_TYPES, type) ? TASK_TYPES[type] : null
  if (!taskType) {
    return false
  }
  const plant = await db
    .prepare('SELECT * FROM plants WHERE id = ?')
    .bind(plantId)
    .first<TaskPlant>()
  const today = todayInJerusalem()
  if (!plant || taskType.doneToday(plant, today)) {
    return false
  }
  const remove = db
    .prepare('DELETE FROM task_skips WHERE plant_id = ? AND type = ?')
    .bind(plantId, type)
  if (reason === null) {
    await remove.run()
  } else {
    await db.batch([
      remove,
      db
        .prepare(
          'INSERT INTO task_skips (plant_id, type, reason, skipped_on, until) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(plantId, type, reason, today, addDays(today, SKIP_DAYS[reason])),
    ])
  }
  return true
}
