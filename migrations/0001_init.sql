CREATE TABLE plants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  species TEXT,
  common_name TEXT,
  category TEXT,
  photo_key TEXT,
  location TEXT,
  water_every_days INTEGER,
  last_watered TEXT,
  care_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id INTEGER NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('watered', 'fertilized', 'repotted', 'note', 'ai_check')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_plant_id ON events (plant_id);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  keys TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
