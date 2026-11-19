-- The AI's watering interval stays in ai_water_every_days; water_every_days is what the app uses and
-- may be moved from it by what the owner does. The adjustment is bounded relative to the AI value.
ALTER TABLE plants ADD COLUMN ai_water_every_days INTEGER;
UPDATE plants SET ai_water_every_days = water_every_days;

-- Every skip, kept for learning. task_skips holds only the latest skip per plant and task type.
CREATE TABLE task_skip_log (
  plant_id INTEGER NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  skipped_on TEXT NOT NULL,
  PRIMARY KEY (plant_id, type, skipped_on)
);
-- Skips made before the log existed: only the latest per plant survived.
INSERT INTO task_skip_log (plant_id, type, reason, skipped_on)
SELECT plant_id, type, reason, skipped_on FROM task_skips;

-- Each automatic change of a plant's interval and why; the newest row also paces the next change.
CREATE TABLE water_interval_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id INTEGER NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
  changed_on TEXT NOT NULL,
  from_days INTEGER NOT NULL,
  to_days INTEGER NOT NULL,
  cause TEXT NOT NULL CHECK (cause IN ('wet_soil_skips', 'early_waterings'))
);
CREATE INDEX idx_water_interval_changes_plant ON water_interval_changes (plant_id);
