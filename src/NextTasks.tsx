import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getTasks,
  photoUrl,
  setTaskDone,
  skipTask,
  unskipTask,
  type SkipReason,
  type Task,
  type TaskList,
} from './api'
import { DONE_TASK_VISIBLE_MS, SKIP_REASONS } from '../shared/api'
import { dueTaskCount } from '../shared/taskBadge'
import { setAppBadge } from './appBadge'
import { ROOMS_CHANGED } from './ManageRooms'

const DAY_MS = 24 * 60 * 60 * 1000

const TASK_LABELS: Record<string, { action: string; done: string }> = {
  water: { action: 'להשקות', done: 'השקיתי ✓' },
}

const SKIP_LABELS: Record<SkipReason, string> = {
  wet_soil: 'האדמה עדיין רטובה',
  dormant: 'הצמח במנוחה',
  away: 'לא הייתי בבית',
  other: 'סיבה אחרת',
}

const GROUP_LABELS = {
  overdue: 'באיחור',
  today: 'היום',
  tomorrow: 'מחר',
  later: 'בהמשך',
  done: 'בוצע לאחרונה',
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

// `from=home` makes Back on the plant page return here instead of to the plant's room.
function plantHref(task: Task) {
  return `#/plants/${task.plant_id}?from=home`
}

const DRAWER_MS = 200
const SWIPE_HIDE_PX = 80
const SWIPE_MOVED_PX = 10
const HIDDEN_KEY = 'yaroki.hiddenDoneTasks'

// A done task swiped away stays hidden on this device. The key includes the completion time,
// so doing the task again later shows it again.
function doneId(task: Task) {
  return `${taskKey(task)}@${task.done_at}`
}

function readHidden(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function useHiddenDone() {
  const [hidden, setHidden] = useState(readHidden)
  const hide = (task: Task) => {
    const next = [...hidden, doneId(task)]
    setHidden(next)
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next.slice(-100)))
    } catch {
      // Hiding then lasts only until the page reloads.
    }
  }
  return {
    isHidden: (task: Task) => hidden.includes(doneId(task)),
    hide,
  }
}

type TaskGroupsProps = {
  list: TaskList
  busy: string[]
  onDone: (task: Task, done: boolean) => void
  onSkip: (task: Task, reason: SkipReason | null) => void
}

function TaskGroups({ list, busy, onDone, onSkip }: TaskGroupsProps) {
  const [choosing, setChoosing] = useState<string | null>(null)
  const [swipe, setSwipe] = useState<{ key: string; dx: number } | null>(null)
  const swipeStart = useRef<{ x: number; moved: boolean } | null>(null)
  const { isHidden, hide } = useHiddenDone()
  const groups = new Map<Group, Task[]>()
  for (const task of list.tasks) {
    if (task.done_today && isHidden(task)) {
      continue
    }
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
              <li
                key={key}
                className={task.done_today ? 'done' : ''}
                style={
                  swipe?.key === key
                    ? {
                        transform: `translateX(${swipe.dx}px)`,
                        opacity:
                          0.55 * (1 - Math.min(Math.abs(swipe.dx) / 200, 0.6)),
                        transition: 'none',
                      }
                    : undefined
                }
                onPointerDown={(event) => {
                  if (task.done_today) {
                    swipeStart.current = { x: event.clientX, moved: false }
                  }
                }}
                onPointerMove={(event) => {
                  const start = swipeStart.current
                  if (!start || !task.done_today) {
                    return
                  }
                  const dx = event.clientX - start.x
                  if (Math.abs(dx) > SWIPE_MOVED_PX) {
                    start.moved = true
                    event.currentTarget.setPointerCapture(event.pointerId)
                    setSwipe({ key, dx })
                  }
                }}
                onPointerUp={() => {
                  if (
                    swipe?.key === key &&
                    Math.abs(swipe.dx) >= SWIPE_HIDE_PX
                  ) {
                    hide(task)
                  }
                  setSwipe(null)
                  // Cleared after the click that follows a drag has been ignored.
                  setTimeout(() => (swipeStart.current = null))
                }}
                onPointerCancel={() => {
                  swipeStart.current = null
                  setSwipe(null)
                }}
                onClick={(event) => {
                  if (swipeStart.current?.moved) {
                    return
                  }
                  // The link inside covers keyboard use; the rest of the card is a bigger tap target.
                  if (!(event.target as Element).closest('button, a')) {
                    window.location.hash = plantHref(task)
                  }
                }}
              >
                {task.photo_key && (
                  <img src={photoUrl(task.photo_key)} alt="" loading="lazy" />
                )}
                <a className="task-info" href={plantHref(task)}>
                  <strong>
                    {labels?.action ?? task.type} את {task.plant_name ?? 'הצמח'}
                  </strong>
                  <span className={group === 'overdue' ? 'overdue' : 'muted'}>
                    {[
                      label,
                      task.skip_reason &&
                        `נדחה: ${SKIP_LABELS[task.skip_reason]}`,
                      task.room_name,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
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
                  <>
                    {task.skip_reason ? (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy.includes(key)}
                        onClick={() => onSkip(task, null)}
                      >
                        ביטול דחייה
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy.includes(key)}
                        aria-expanded={choosing === key}
                        onClick={() =>
                          setChoosing(choosing === key ? null : key)
                        }
                      >
                        דילוג
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy.includes(key)}
                      onClick={() => onDone(task, true)}
                    >
                      {labels?.done ?? 'בוצע ✓'}
                    </button>
                  </>
                )}
                {choosing === key && (
                  <div
                    className="skip-reasons"
                    role="group"
                    aria-label="סיבת הדילוג"
                  >
                    {SKIP_REASONS.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        className="secondary"
                        disabled={busy.includes(key)}
                        onClick={() => {
                          setChoosing(null)
                          onSkip(task, reason)
                        }}
                      >
                        {SKIP_LABELS[reason]}
                      </button>
                    ))}
                  </div>
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

  // A done task leaves the list an hour after it was done, even if the app stays open.
  useEffect(() => {
    const expiries = (list?.tasks ?? [])
      .filter((task) => task.done_at)
      .map((task) => Date.parse(task.done_at!) + DONE_TASK_VISIBLE_MS)
    if (expiries.length === 0) {
      return
    }
    const timer = setTimeout(
      load,
      Math.max(Math.min(...expiries) - Date.now(), 0) + 1000,
    )
    return () => clearTimeout(timer)
  }, [list, load])

  const badgeCount = list ? dueTaskCount(list) : undefined

  // Keep the app icon badge in step with the list.
  useEffect(() => {
    if (badgeCount !== undefined) {
      setAppBadge(badgeCount)
    }
  }, [badgeCount])

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

  async function handleSkip(task: Task, reason: SkipReason | null) {
    const key = taskKey(task)
    setBusy((current) => [...current, key])
    setError(null)
    try {
      await (reason ? skipTask(task, reason) : unskipTask(task))
    } catch {
      setError('לא הצלחנו לעדכן את המשימה.')
    } finally {
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
        {list && (
          <TaskGroups
            list={list}
            busy={busy}
            onDone={handleDone}
            onSkip={handleSkip}
          />
        )}
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
              <TaskGroups
                list={allList}
                busy={busy}
                onDone={handleDone}
                onSkip={handleSkip}
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default NextTasks
