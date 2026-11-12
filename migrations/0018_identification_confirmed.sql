-- The owner confirms the AI's species after adding a plant. Plants that exist now count as confirmed.
ALTER TABLE plants ADD COLUMN identification_confirmed INTEGER NOT NULL DEFAULT 0;
UPDATE plants SET identification_confirmed = 1;
-- JSON array of reference photo URLs, so the owner can flip through them and check the species.
ALTER TABLE plants ADD COLUMN reference_images TEXT NOT NULL DEFAULT '[]';
