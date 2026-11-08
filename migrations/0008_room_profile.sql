-- What the room is like, as the owner describes it. Live sensor readings will be
-- stored separately and linked to rooms by room_id, so they never overwrite these.
ALTER TABLE rooms ADD COLUMN window_direction TEXT CHECK (window_direction IN ('north', 'east', 'south', 'west', 'none'));
ALTER TABLE rooms ADD COLUMN light_level TEXT CHECK (light_level IN ('direct', 'bright_indirect', 'low'));
ALTER TABLE rooms ADD COLUMN humidity TEXT CHECK (humidity IN ('dry', 'normal', 'humid'));
ALTER TABLE rooms ADD COLUMN temp_min INTEGER;
ALTER TABLE rooms ADD COLUMN temp_max INTEGER;
ALTER TABLE rooms ADD COLUMN near_draft INTEGER NOT NULL DEFAULT 0 CHECK (near_draft IN (0, 1));
ALTER TABLE rooms ADD COLUMN near_ac INTEGER NOT NULL DEFAULT 0 CHECK (near_ac IN (0, 1));
ALTER TABLE rooms ADD COLUMN near_heater INTEGER NOT NULL DEFAULT 0 CHECK (near_heater IN (0, 1));
