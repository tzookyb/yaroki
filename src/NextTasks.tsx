import { useEffect, useState } from 'react'
import {
  completeTask,
  getUpcomingTasks,
  photoUrl,
  type Task,
  type UpcomingTasks,
} from './api'
import { ROOMS_CHANGED } from './ManageRooms'

const DAY_MS = 24 * 60 * 60 * 1000

// Add a label here for each task type in worker/tasks.ts.
const TASK_LABELS: Record<string, { action: string; done: string }> = {
  water: { action: 'להשקות', done: 'השקיתי ✓' },
}

function dueLabel(dueDate: string, today: string) {
  const days = (Date.parse(dueDate) - Date.parse(today)) / DAY_MS
  if (days === 0) return 'היום'
  if (days === 1) return 'מחר'
  if (days === -1) return 'באיחור של יום'
  return `באיחור של ${-days} ימים`
}

function taskKey(task: Task) {
  return `${task.type}-${task.plant_id}`
}

function NextTasks() {
  const [upcoming, setUpcoming] = useState<UpcomingTasks | null>(null)
  const [completing, setCompleting] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function load() {
      getUpcomingTasks()
        .then(setUpcoming)
        .catch(() => setError('לא הצלחנו לטעון את המשימות.'))
    }
    load()
    window.addEventListener(ROOMS_CHANGED, load)
    return () => window.removeEventListener(ROOMS_CHANGED, load)
  }, [])

  async function handleDone(task: Task) {
    const key = taskKey(task)
    setCompleting((current) => [...current, key])
    setError(null)
    try {
      await completeTask(task)
      setUpcoming(
        (current) =>
          current && {
            ...current,
            tasks: current.tasks.filter((other) => taskKey(other) !== key),
          },
      )
    } catch {
      setError('לא הצלחנו לסמן את המשימה.')
    } finally {
      setCompleting((current) => current.filter((other) => other !== key))
    }
  }

  if (!upcoming && !error) return null

  return (
    <section className="next-tasks">
      <h2>המשימות הבאות</h2>
      {error && <p role="alert">{error}</p>}
      {upcoming?.tasks.length === 0 && (
        <p className="muted">אין משימות להיום ולמחר.</p>
      )}
      <ul>
        {upcoming?.tasks.map((task) => {
          const key = taskKey(task)
          const labels = TASK_LABELS[task.type]
          const overdue = task.due_date < upcoming.today
          return (
            <li key={key}>
              {task.photo_key && (
                <img src={photoUrl(task.photo_key)} alt="" loading="lazy" />
              )}
              <a
                className="task-info"
                href={task.room_id ? `#/rooms/${task.room_id}` : undefined}
              >
                <strong>
                  {labels?.action ?? task.type} את {task.plant_name ?? 'הצמח'}
                </strong>
                <span className={overdue ? 'overdue' : 'muted'}>
                  {dueLabel(task.due_date, upcoming.today)}
                  {task.room_name && ` · ${task.room_name}`}
                </span>
              </a>
              <button
                type="button"
                disabled={completing.includes(key)}
                onClick={() => handleDone(task)}
              >
                {labels?.done ?? 'בוצע ✓'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default NextTasks
