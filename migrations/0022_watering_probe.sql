-- While a probe runs (the interval was shortened on purpose to test it), the interval it came from.
ALTER TABLE plants ADD COLUMN water_probe_from INTEGER;

-- The change log gains the probe outcomes. SQLite can't change a CHECK in place and nothing references
-- this table, so it is rebuilt.
CREATE TABLE water_interval_changes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id INTEGER NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
  changed_on TEXT NOT NULL,
  from_days INTEGER NOT NULL,
  to_days INTEGER NOT NULL,
  cause TEXT NOT NULL CHECK (cause IN
    ('wet_soil_skips', 'early_waterings', 'probe', 'probe_accepted', 'probe_failed'))
);
INSERT INTO water_interval_changes_new (id, plant_id, changed_on, from_days, to_days, cause)
SELECT id, plant_id, changed_on, from_days, to_days, cause FROM water_interval_changes;
DROP TABLE water_interval_changes;
ALTER TABLE water_interval_changes_new RENAME TO water_interval_changes;
CREATE INDEX idx_water_interval_changes_plant ON water_interval_changes (plant_id);
