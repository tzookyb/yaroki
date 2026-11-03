import { useCallback, useEffect, useState } from 'react'
import {
  getTasks,
  photoUrl,
  setTaskDone,
  type Task,
  type TaskList,
} from './api'
import { ROOMS_CHANGED } from './ManageRooms'

const DAY_MS = 24 * 60 * 60 * 1000

// Add a label here for each task type in worker/tasks.ts.
const TASK_LABELS: Record<string, { action: string; done: string }> = {
  water: { action: 'להשקות', done: 'השקיתי ✓' },
}

const GROUP_LABELS = {
  overdue: 'באיחור',
  today: 'היום',
  tomorrow: 'מחר',
  later: 'בהמשך',
  done: 'בוצע היום',
}

type Group = keyof typeof GROUP_LABELS

function daysUntil(date: string, today: string) {
  return Math.round((Date.parse(date) - Date.parse(today)) / DAY_MS)
}

function groupOf(task: Task, today: string): Group {
  if (task.done_today) return 'done'
  const days = daysUntil(task.due_date, today)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return 'later'
}

function inDays(days: number) {
  return days === 1 ? 'מחר' : `בעוד ${days} ימים`
}

function dueLabel(task: Task, group: Group, today: string) {
  const days = daysUntil(task.due_date, today)
  switch (group) {
    case 'overdue':
      return days === -1 ? 'באיחור של יום' : `באיחור של ${-days} ימים`
    case 'later':
      return inDays(days)
    case 'done':
      return `הבא ${inDays(days)}`
    default:
      return null
  }
}

function taskKey(task: Task) {
  return `${task.type}-${task.plant_id}`
}

function NextTasks() {
  const [showAll, setShowAll] = useState(false)
  const [list, setList] = useState<TaskList | null>(null)
  const [busy, setBusy] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      getTasks(showAll)
        .then(setList)
        .catch(() => setError('לא הצלחנו לטעון את המשימות.')),
    [showAll],
  )

  useEffect(() => {
    load()
    window.addEventListener(ROOMS_CHANGED, load)
    return () => window.removeEventListener(ROOMS_CHANGED, load)
  }, [load])

  async function handleDone(task: Task, done: boolean) {
    const key = taskKey(task)
    setBusy((current) => [...current, key])
    setError(null)
    try {
      await setTaskDone(task, done)
      await load()
    } catch {
      setError(
        done ? 'לא הצלחנו לסמן את המשימה.' : 'לא הצלחנו לבטל את הביצוע.',
      )
    } finally {
      setBusy((current) => current.filter((other) => other !== key))
    }
  }

  if (!list && !error) return null

  const groups = new Map<Group, Task[]>()
  for (const task of list?.tasks ?? []) {
    const group = groupOf(task, list!.today)
    groups.set(group, [...(groups.get(group) ?? []), task])
  }

  return (
    <section className="next-tasks">
      <h2>המשימות הבאות</h2>
      {error && <p role="alert">{error}</p>}
      {list?.tasks.length === 0 && (
        <p className="muted">
          {showAll ? 'אין משימות.' : 'אין משימות להיום ולמחר.'}
        </p>
      )}
      {list &&
        (Object.keys(GROUP_LABELS) as Group[])
          .filter((group) => groups.has(group))
          .map((group) => (
            <div key={group}>
              <h3 className="task-divider">{GROUP_LABELS[group]}</h3>
              <ul>
                {groups.get(group)!.map((task) => {
                  const key = taskKey(task)
                  const labels = TASK_LABELS[task.type]
                  const label = dueLabel(task, group, list.today)
                  return (
                    <li key={key} className={task.done_today ? 'done' : ''}>
                      {task.photo_key && (
                        <img
                          src={photoUrl(task.photo_key)}
                          alt=""
                          loading="lazy"
                        />
                      )}
                      <a
                        className="task-info"
                        href={
                          task.room_id ? `#/rooms/${task.room_id}` : undefined
                        }
                      >
                        <strong>
                          {labels?.action ?? task.type} את{' '}
                          {task.plant_name ?? 'הצמח'}
                        </strong>
                        <span
                          className={group === 'overdue' ? 'overdue' : 'muted'}
                        >
                          {[label, task.room_name].filter(Boolean).join(' · ')}
                        </span>
                      </a>
                      {task.done_today ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy.includes(key)}
                          onClick={() => handleDone(task, false)}
                        >
                          ביטול
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy.includes(key)}
                          onClick={() => handleDone(task, true)}
                        >
                          {labels?.done ?? 'בוצע ✓'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
      <button
        type="button"
        className="secondary show-all"
        onClick={() => setShowAll((current) => !current)}
      >
        {showAll ? 'רק היום ומחר' : 'כל המשימות העתידיות'}
      </button>
    </section>
  )
}

export default NextTasks
