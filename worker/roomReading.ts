import type { RoomReading } from '../shared/api'

// Old readings (a broken sensor, a room switched to outdoor) say nothing about now.
export function latestReading(db: D1Database, roomId: number) {
  return db
    .prepare(
      `SELECT temperature, humidity FROM room_readings
       WHERE room_id = ? AND measured_at >= date('now', '-3 days')
       ORDER BY measured_at DESC LIMIT 1`,
    )
    .bind(roomId)
    .first<RoomReading>()
}
