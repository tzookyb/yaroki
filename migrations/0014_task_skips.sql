-- A task the owner chose to skip for now, with the reason. At most one row per plant and task type:
-- a new skip replaces the old one, and the task comes back by itself on `until`.
CREATE TABLE task_skips (
  plant_id INTEGER NOT NULL REFERENCES plants (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  skipped_on TEXT NOT NULL,
  until TEXT NOT NULL,
  PRIMARY KEY (plant_id, type)
);
