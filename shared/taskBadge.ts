import type { TaskList } from './api'

// Open tasks due today or earlier, overdue included. `type` limits the count to one kind of task.
export function dueTaskCount({ today, tasks }: TaskList, type?: string) {
  return tasks.filter(
    (task) =>
      !task.done_today &&
      task.due_date <= today &&
      (type === undefined || task.type === type),
  ).length
}
