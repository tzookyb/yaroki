-- One row: where the home is, for the weather of outdoor rooms. Kept in the database
-- instead of secrets so it can be changed from the app.
CREATE TABLE home_location (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  label TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL
);
