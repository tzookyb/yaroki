-- Misting is logged like watering, so the events type list gains 'misted'. SQLite can't change a CHECK in place,
-- and nothing references events, so the table is rebuilt.
CREATE TABLE events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id INTEGER NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('watered', 'fertilized', 'repotted', 'note', 'ai_check', 'misted')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO events_new (id, plant_id, type, notes, created_at)
SELECT id, plant_id, type, notes, created_at FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX idx_events_plant_id ON events (plant_id);

-- The due date of the misting task a push already announced, per plant. A new due date (after the task
-- was done) is announced again; the row goes when the air is no longer dry, so the next dry spell is too.
CREATE TABLE misting_alerts (
  plant_id INTEGER PRIMARY KEY REFERENCES plants (id) ON DELETE CASCADE,
  due_date TEXT NOT NULL
);
