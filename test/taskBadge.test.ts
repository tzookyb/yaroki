import { describe, expect, it } from 'vitest'
import type { Task } from '../shared/api'
import { taskBadge } from '../shared/taskBadge'

function task(due_date: string, done_today = false): Task {
  return {
    type: 'water',
    plant_id: 1,
    plant_name: null,
    photo_key: null,
    room_id: null,
    room_name: null,
    due_date,
    done_today,
  }
}

const today = '2026-11-04'

describe('taskBadge', () => {
  it('is empty without tasks', () => {
    expect(taskBadge({ today, tasks: [] })).toEqual({
      count: 0,
      overdue: false,
    })
  })

  it('counts today and overdue, not tomorrow or done', () => {
    const tasks = [
      task('2026-11-04'),
      task('2026-11-02'),
      task('2026-11-05'),
      task('2026-11-03', true),
    ]
    expect(taskBadge({ today, tasks })).toEqual({ count: 2, overdue: true })
  })

  it('is not overdue when everything is due today', () => {
    expect(taskBadge({ today, tasks: [task(today)] })).toEqual({
      count: 1,
      overdue: false,
    })
  })
})
