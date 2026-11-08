-- What the plant needs, from the AI, in the same terms as the room profile so the two can be compared.
ALTER TABLE plants ADD COLUMN humidity_needs TEXT CHECK (humidity_needs IN ('dry', 'normal', 'humid'));
ALTER TABLE plants ADD COLUMN temp_min INTEGER;
ALTER TABLE plants ADD COLUMN temp_max INTEGER;
ALTER TABLE plants ADD COLUMN description TEXT;
ALTER TABLE plants ADD COLUMN reference_image_url TEXT;
