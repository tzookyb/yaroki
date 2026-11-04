import type { TaskList } from './api'

// Open tasks due today or earlier, overdue included.
export function dueTaskCount({ today, tasks }: TaskList) {
  return tasks.filter((task) => !task.done_today && task.due_date <= today)
    .length
}
