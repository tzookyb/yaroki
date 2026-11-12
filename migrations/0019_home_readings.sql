-- Readings of every Sensibo device in the house, linked to a room or not, so rooms without a sensor
-- can show the home average. Starts with the readings already collected for linked rooms.
CREATE TABLE home_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  temperature REAL NOT NULL,
  humidity REAL,
  UNIQUE (source_id, measured_at)
);

CREATE INDEX idx_home_readings_time ON home_readings (measured_at);

INSERT OR IGNORE INTO home_readings (source_id, measured_at, temperature, humidity)
SELECT source_id, measured_at, temperature, humidity FROM room_readings WHERE source_id != 'weather';
