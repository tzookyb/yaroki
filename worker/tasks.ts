// Care tasks are computed from plant fields, not stored. A new task type adds an entry to TASK_TYPES.

const TIME_ZONE = 'Asia/Jerusalem'
const DAY_MS = 24 * 60 * 60 * 1000

export type Task = {
  type: string
  plant_id: number
  plant_name: string | null
  photo_key: string | null
  room_id: number | null
  room_name: string | null
  // YYYY-MM-DD in Asia/Jerusalem.
  due_date: string
}

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
  complete(db: D1Database, plantId: number, today: string): D1PreparedStatement[]
}

const TASK_TYPES: Record<string, TaskType> = {
  water: {
    dueDate(plant, today) {
      if (!plant.water_every_days) return null
      // A plant never marked as watered is due today, and its schedule starts once it is.
      if (!plant.last_watered) return today
      return addDays(plant.last_watered, plant.water_every_days)
    },
    complete(db, plantId, today) {
      return [
        db
          .prepare('UPDATE plants SET last_watered = ? WHERE id = ?')
          .bind(today, plantId),
        db
          .prepare("INSERT INTO events (plant_id, type) VALUES (?, 'watered')")
          .bind(plantId),
      ]
    },
  },
}

export function todayInJerusalem() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(
    new Date(),
  )
}

function addDays(date: string, days: number) {
  const time = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS
  return new Date(time).toISOString().slice(0, 10)
}

// Tasks due by tomorrow, overdue ones included, most urgent first.
export async function getUpcomingTasks(db: D1Database) {
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

  const tasks: Task[] = []
  for (const plant of plants) {
    for (const [type, taskType] of Object.entries(TASK_TYPES)) {
      const dueDate = taskType.dueDate(plant, today)
      if (!dueDate || dueDate > tomorrow) continue
      tasks.push({
        type,
        plant_id: plant.id,
        plant_name: plant.name,
        photo_key: plant.photo_key,
        room_id: plant.room_id,
        room_name: plant.room_name,
        due_date: dueDate,
      })
    }
  }
  tasks.sort(
    (a, b) =>
      a.due_date.localeCompare(b.due_date) ||
      (a.room_name ?? '').localeCompare(b.room_name ?? '') ||
      a.plant_id - b.plant_id,
  )
  return { today, tasks }
}

// Returns false when the task type or the plant does not exist.
export async function completeTask(
  db: D1Database,
  type: string,
  plantId: number,
) {
  const taskType = Object.hasOwn(TASK_TYPES, type) ? TASK_TYPES[type] : null
  if (!taskType) return false
  const plant = await db
    .prepare('SELECT id FROM plants WHERE id = ?')
    .bind(plantId)
    .first()
  if (!plant) return false
  await db.batch(taskType.complete(db, plantId, todayInJerusalem()))
  return true
}
