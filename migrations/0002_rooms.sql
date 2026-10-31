CREATE TABLE rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO rooms (name)
SELECT DISTINCT location FROM plants WHERE location IS NOT NULL;

ALTER TABLE plants ADD COLUMN room_id INTEGER REFERENCES rooms (id) ON DELETE SET NULL;

UPDATE plants SET room_id = (SELECT id FROM rooms WHERE rooms.name = plants.location);

ALTER TABLE plants DROP COLUMN location;

CREATE INDEX idx_plants_room_id ON plants (room_id);

-- Make name optional, since a plant now starts as just a photo. Swapping the column
-- instead of rebuilding the table, because DROP TABLE would cascade and delete events.
ALTER TABLE plants RENAME COLUMN name TO required_name;
ALTER TABLE plants ADD COLUMN name TEXT;
UPDATE plants SET name = required_name;
ALTER TABLE plants DROP COLUMN required_name;
