import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getTasks,
  photoUrl,
  setTaskDone,
  type Task,
  type TaskList,
} from './api'
import { ROOMS_CHANGED } from './ManageRooms'

const DAY_MS = 24 * 60 * 60 * 1000

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
  if (task.done_today) {
    return 'done'
  }
  const days = daysUntil(task.due_date, today)
  if (days < 0) {
    return 'overdue'
  }
  if (days === 0) {
    return 'today'
  }
  if (days === 1) {
    return 'tomorrow'
  }
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

const DRAWER_MS = 200

type TaskGroupsProps = {
  list: TaskList
  busy: string[]
  onDone: (task: Task, done: boolean) => void
}

function TaskGroups({ list, busy, onDone }: TaskGroupsProps) {
  const groups = new Map<Group, Task[]>()
  for (const task of list.tasks) {
    const group = groupOf(task, list.today)
    groups.set(group, [...(groups.get(group) ?? []), task])
  }

  return (Object.keys(GROUP_LABELS) as Group[])
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
                  <img src={photoUrl(task.photo_key)} alt="" loading="lazy" />
                )}
                <a
                  className="task-info"
                  href={task.room_id ? `#/rooms/${task.room_id}` : undefined}
                >
                  <strong>
                    {labels?.action ?? task.type} את {task.plant_name ?? 'הצמח'}
                  </strong>
                  <span className={group === 'overdue' ? 'overdue' : 'muted'}>
                    {[label, task.room_name].filter(Boolean).join(' · ')}
                  </span>
                </a>
                {task.done_today ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy.includes(key)}
                    onClick={() => onDone(task, false)}
                  >
                    ביטול
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy.includes(key)}
                    onClick={() => onDone(task, true)}
                  >
                    {labels?.done ?? 'בוצע ✓'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    ))
}

function NextTasks() {
  const drawer = useRef<HTMLDivElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [list, setList] = useState<TaskList | null>(null)
  const [allList, setAllList] = useState<TaskList | null>(null)
  const [busy, setBusy] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      Promise.all([
        getTasks(false).then(setList),
        drawerOpen && getTasks(true).then(setAllList),
      ]).catch(() => setError('לא הצלחנו לטעון את המשימות.')),
    [drawerOpen],
  )

  useEffect(() => {
    load()
    window.addEventListener(ROOMS_CHANGED, load)
    return () => window.removeEventListener(ROOMS_CHANGED, load)
  }, [load])

  // Same as the settings drawer: slide out while still open, then hide.
  function closeDrawer() {
    setClosing(true)
    setTimeout(() => drawer.current?.hidePopover(), DRAWER_MS)
  }

  async function handleDone(task: Task, done: boolean) {
    const key = taskKey(task)
    setBusy((current) => [...current, key])
    setError(null)
    try {
      await setTaskDone(task, done)
    } catch {
      setError(done ? 'לא הצלחנו לסמן את המשימה.' : 'לא הצלחנו לבטל את הביצוע.')
    } finally {
      // Also after a failure, since another device may have changed the task.
      await load()
      setBusy((current) => current.filter((other) => other !== key))
    }
  }

  if (!list && !error) {
    return null
  }

  return (
    <>
      <section className="next-tasks">
        <div className="next-tasks-header">
          <h2>המשימות הבאות</h2>
          <button
            type="button"
            className="link-button"
            popoverTarget="all-tasks"
          >
            כל המשימות העתידיות
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {list?.tasks.length === 0 && (
          <p className="muted">אין משימות להיום ולמחר.</p>
        )}
        {list && <TaskGroups list={list} busy={busy} onDone={handleDone} />}
      </section>
      <div
        id="all-tasks"
        ref={drawer}
        className={closing ? 'settings-menu closing' : 'settings-menu'}
        popover="auto"
        onToggle={(event) => {
          setDrawerOpen(event.newState === 'open')
          if (event.newState === 'closed') {
            setClosing(false)
            setAllList(null)
          }
        }}
      >
        <div className="settings-body">
          <div className="settings-header">
            <h2>כל המשימות העתידיות</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="סגירה"
              onClick={closeDrawer}
            >
              ✕&#xFE0E;
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          {allList?.tasks.length === 0 && <p className="muted">אין משימות.</p>}
          {allList && (
            <div className="next-tasks">
              <TaskGroups list={allList} busy={busy} onDone={handleDone} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default NextTasks
