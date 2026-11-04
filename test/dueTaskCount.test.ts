import { describe, expect, it } from 'vitest'
import type { Task } from '../shared/api'
import { dueTaskCount } from '../shared/taskBadge'

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

describe('dueTaskCount', () => {
  it('is 0 without tasks', () => {
    expect(dueTaskCount({ today, tasks: [] })).toBe(0)
  })

  it('counts today and overdue, not tomorrow or done', () => {
    const tasks = [
      task('2026-11-04'),
      task('2026-11-02'),
      task('2026-11-05'),
      task('2026-11-03', true),
    ]
    expect(dueTaskCount({ today, tasks })).toBe(2)
  })
})
