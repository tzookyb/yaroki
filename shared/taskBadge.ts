import type { TaskList } from './api'

// Open tasks due today or earlier. `overdue` is true when any of them is late.
export function taskBadge({ today, tasks }: TaskList) {
  const open = tasks.filter(
    (task) => !task.done_today && task.due_date <= today,
  )
  return {
    count: open.length,
    overdue: open.some((task) => task.due_date < today),
  }
}
