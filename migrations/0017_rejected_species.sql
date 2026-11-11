-- JSON array of species the owner said were wrong, so a repeated re-identification never returns them again.
ALTER TABLE plants ADD COLUMN rejected_species TEXT NOT NULL DEFAULT '[]';
