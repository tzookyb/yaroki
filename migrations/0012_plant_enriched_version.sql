-- Which version of the AI data a plant has. Raising ENRICH_VERSION in shared/api.ts makes
-- the worker fill in the new data for older plants by itself.
ALTER TABLE plants ADD COLUMN enriched_version INTEGER NOT NULL DEFAULT 0;

UPDATE plants SET enriched_version = 1 WHERE description IS NOT NULL;
