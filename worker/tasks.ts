import {
  DONE_TASK_VISIBLE_MS,
  MIST_DRY_BELOW,
  MIST_EVERY_DAYS,
  type SkipReason,
  type Task,
  type TaskList,
} from '../shared/api'

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
  // UTC time of the latest watering, as D1's datetime('now') writes it.
  last_watered_at: string | null
  humidity_needs: string | null
  room_location_type: string | null
  // Newest humidity reading of the room from the last 3 days.
  room_humidity: number | null
  last_misted_at: string | null
}

type TaskType = {
  // The due date, or null when the plant has no such task.
  dueDate(plant: TaskPlant, today: string): string | null
  // The due date of the occurrence after one done on `doneOn`.
  nextDueDate(plant: TaskPlant, doneOn: string): string
  doneToday(plant: TaskPlant, today: string): boolean
  // The date of the latest completion; a skip only counts until the plant is cared for after it.
  lastDoneOn(plant: TaskPlant): string | null
  // When the latest completion happened, as a UTC datetime.
  doneAt(plant: TaskPlant): string | null
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
    nextDueDate(plant, doneOn) {
      return addDays(doneOn, plant.water_every_days ?? 0)
    },
    doneToday(plant, today) {
      return plant.last_watered === today
    },
    lastDoneOn(plant) {
      return plant.last_watered
    },
    doneAt(plant) {
      return plant.last_watered_at
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
  // Only while the air in an indoor room is measured as dry and the plant likes humid air, so the task
  // appears and goes with the readings. A done misting counts for today even if the air has recovered.
  mist: {
    dueDate(plant, today) {
      const lastDone = plant.last_misted_at
        ? jerusalemDate(plant.last_misted_at)
        : null
      if (lastDone === today) {
        return addDays(today, MIST_EVERY_DAYS)
      }
      const dry =
        plant.humidity_needs === 'humid' &&
        plant.room_location_type === 'indoor' &&
        plant.room_humidity !== null &&
        plant.room_humidity < MIST_DRY_BELOW
      if (!dry) {
        return null
      }
      // Dryness is a condition, not a schedule, so a task past its interval is simply due now.
      const next = lastDone ? addDays(lastDone, MIST_EVERY_DAYS) : today
      return next > today ? next : today
    },
    nextDueDate(_plant, doneOn) {
      return addDays(doneOn, MIST_EVERY_DAYS)
    },
    doneToday(plant, today) {
      return plant.last_misted_at
        ? jerusalemDate(plant.last_misted_at) === today
        : false
    },
    lastDoneOn(plant) {
      return plant.last_misted_at ? jerusalemDate(plant.last_misted_at) : null
    },
    doneAt(plant) {
      return plant.last_misted_at
    },
    complete(db, plantId) {
      return db
        .prepare("INSERT INTO events (plant_id, type) VALUES (?, 'misted')")
        .bind(plantId)
        .run()
    },
    async undo(db, plantId, today) {
      const { results } = await db
        .prepare(
          `SELECT id, created_at FROM events
           WHERE plant_id = ? AND type = 'misted'
           ORDER BY id DESC LIMIT 10`,
        )
        .bind(plantId)
        .all<{ id: number; created_at: string }>()
      return db.batch(
        results
          .filter((event) => jerusalemDate(event.created_at) === today)
          .map((event) =>
            db.prepare('DELETE FROM events WHERE id = ?').bind(event.id),
          ),
      )
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
function utcTime(utcDateTime: string) {
  return Date.parse(`${utcDateTime.replace(' ', 'T')}Z`)
}

function jerusalemDate(utcDateTime: string) {
  return dateFormat.format(new Date(utcTime(utcDateTime)))
}

function addDays(date: string, days: number) {
  const time = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS
  return new Date(time).toISOString().slice(0, 10)
}

// The plants with everything the task types read. `plantId` limits it to one plant.
async function loadTaskPlants(db: D1Database, plantId?: number) {
  const { results } = await db
    .prepare(
      `SELECT plants.id, plants.name, plants.photo_key, plants.room_id,
              rooms.name AS room_name, plants.water_every_days, plants.last_watered,
              (SELECT MAX(created_at) FROM events
               WHERE events.plant_id = plants.id AND events.type = 'watered') AS last_watered_at,
              plants.humidity_needs, rooms.location_type AS room_location_type,
              (SELECT humidity FROM room_readings
               WHERE room_readings.room_id = plants.room_id AND measured_at >= date('now', '-3 days')
               ORDER BY measured_at DESC LIMIT 1) AS room_humidity,
              (SELECT MAX(created_at) FROM events
               WHERE events.plant_id = plants.id AND events.type = 'misted') AS last_misted_at
       FROM plants
       LEFT JOIN rooms ON rooms.id = plants.room_id
       WHERE ?1 IS NULL OR plants.id = ?1`,
    )
    .bind(plantId ?? null)
    .all<TaskPlant>()
  return results
}

// Open tasks most urgent first, then tasks done within the last hour. Without `all`, only open tasks due by tomorrow.
// `plantId` limits the list to one plant.
export async function getTasks(
  db: D1Database,
  all: boolean,
  plantId?: number,
): Promise<TaskList> {
  const now = Date.now()
  const today = todayInJerusalem()
  const tomorrow = addDays(today, 1)
  const plants = await loadTaskPlants(db, plantId)

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
        (!taskType.lastDoneOn(plant) ||
          skip.skipped_on > taskType.lastDoneOn(plant)!)
      if (skipped) {
        dueDate = skip.until
      }
      const doneAt = taskType.doneAt(plant)
      const doneTime = doneAt ? utcTime(doneAt) : null
      // The task list shows a completed task for an hour, so it can be undone or swiped away.
      // The plant's own page lists all of its tasks and keeps showing it all day.
      const doneToday =
        taskType.doneToday(plant, today) &&
        (plantId !== undefined ||
          (doneTime !== null && now - doneTime < DONE_TASK_VISIBLE_MS))
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
        done_at:
          doneToday && doneTime !== null
            ? new Date(doneTime).toISOString()
            : null,
        skip_reason: skipped ? skip.reason : null,
        next_due_date: taskType.nextDueDate(
          plant,
          // A late task done today moves the schedule from today, not from its old due date.
          doneToday || dueDate > today ? dueDate : today,
        ),
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
  const [plant] = await loadTaskPlants(db, plantId)
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
  const [plant] = await loadTaskPlants(db, plantId)
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
