import * as Sentry from '@sentry/cloudflare'
import { suggestReminderHour } from './gemini'
import { sendDueReminders } from './push'
import { todayInJerusalem } from './tasks'

// The reminder hour is learned from past "watered" events. The AI refines it weekly, but
// whatever it answers stays inside these limits, so a bad answer can't wake the owner at night.
export const DEFAULT_HOUR = 8
export const MIN_HOUR = 7
export const MAX_HOUR = 21
// Fewer completions than this say little about a routine.
export const MIN_SAMPLES = 5
const SAMPLE_LIMIT = 60

const hourFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  hourCycle: 'h23',
})
const weekdayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Jerusalem',
  weekday: 'short',
})
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function jerusalemHour(date = new Date()) {
  return Number(hourFormat.format(date))
}

function clampHour(hour: number) {
  return Math.min(MAX_HOUR, Math.max(MIN_HOUR, hour))
}

export function medianHour(hours: number[]) {
  const sorted = [...hours].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function completions(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT created_at FROM events WHERE type = 'watered' ORDER BY id DESC LIMIT ?`,
    )
    .bind(SAMPLE_LIMIT)
    .all<{ created_at: string }>()
  // D1 stores UTC as YYYY-MM-DD HH:MM:SS.
  return results.map((row) => new Date(`${row.created_at.replace(' ', 'T')}Z`))
}

async function schedule(db: D1Database) {
  const row = await db
    .prepare('SELECT hour, source FROM reminder_schedule WHERE id = 1')
    .first<{ hour: number; source: 'default' | 'history' | 'ai' }>()
  return row ?? { hour: DEFAULT_HOUR, source: 'default' as const }
}

function saveHour(db: D1Database, hour: number, source: 'history' | 'ai') {
  return db
    .prepare(
      `INSERT INTO reminder_schedule (id, hour, source) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE
         SET hour = excluded.hour, source = excluded.source, updated_at = datetime('now')`,
    )
    .bind(hour, source)
    .run()
}

// Daily. Moves the hour to the median of recent completions, unless the AI has set it.
export async function learnHourFromHistory(db: D1Database) {
  if ((await schedule(db)).source === 'ai') {
    return
  }
  const dates = await completions(db)
  if (dates.length >= MIN_SAMPLES) {
    await saveHour(
      db,
      clampHour(medianHour(dates.map(jerusalemHour))),
      'history',
    )
  }
}

// Weekly. Gemini sees only counts of completions per hour and weekday, never plant data.
export async function learnHourWithAi(env: Env) {
  const dates = await completions(env.DB)
  if (dates.length < MIN_SAMPLES || !env.GEMINI_API_KEY) {
    return
  }
  const hoursByCount = Array<number>(24).fill(0)
  const weekdaysByCount = Array<number>(7).fill(0)
  for (const date of dates) {
    hoursByCount[jerusalemHour(date)]++
    weekdaysByCount[WEEKDAYS.indexOf(weekdayFormat.format(date))]++
  }
  const { hour: currentHour } = await schedule(env.DB)
  const suggested = await suggestReminderHour(
    { hoursByCount, weekdaysByCount, currentHour },
    env.GEMINI_API_KEY,
  )
  if (suggested !== null) {
    await saveHour(env.DB, clampHour(suggested), 'ai')
  }
}

// Hourly. Sends the day's reminder in the learned hour, or later the same day if that run was missed.
export async function sendReminderIfTime(env: Env, now = new Date()) {
  const { hour } = await schedule(env.DB)
  if (jerusalemHour(now) < hour) {
    return
  }
  // Claiming the day first means two overlapping runs can't both send.
  const claim = await env.DB.prepare(
    `INSERT INTO reminder_schedule (id, hour, source, last_sent) VALUES (1, ?, 'default', ?)
     ON CONFLICT (id) DO UPDATE SET last_sent = excluded.last_sent
       WHERE reminder_schedule.last_sent IS NOT excluded.last_sent`,
  )
    .bind(DEFAULT_HOUR, todayInJerusalem())
    .run()
  if (claim.meta.changes === 1) {
    try {
      await sendDueReminders(env)
    } catch (error) {
      console.error('Watering reminders failed', error)
      Sentry.captureException(error)
    }
  }
}
