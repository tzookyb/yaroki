ALTER TABLE rooms ADD COLUMN location_type TEXT NOT NULL DEFAULT 'indoor' CHECK (location_type IN ('indoor', 'outside_window', 'garden'));

-- Which Sensibo device measures which room. Moving a device to another room keeps its old readings with the old room.
CREATE TABLE room_sensors (
  sensibo_id TEXT PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms (id) ON DELETE CASCADE
);

CREATE INDEX idx_room_sensors_room_id ON room_sensors (room_id);

-- Measured values live apart from the room profile, which holds what the owner says about the room.
-- source_id is the Sensibo device id, or 'weather' for outdoor rooms.
CREATE TABLE room_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  temperature REAL NOT NULL,
  humidity REAL,
  UNIQUE (room_id, source_id, measured_at)
);

CREATE INDEX idx_room_readings_room_time ON room_readings (room_id, measured_at);
