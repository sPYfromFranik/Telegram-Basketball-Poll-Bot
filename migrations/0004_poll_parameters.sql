ALTER TABLE poll_schedule ADD COLUMN location TEXT;
ALTER TABLE poll_schedule ADD COLUMN game_date_local TEXT;
ALTER TABLE poll_schedule ADD COLUMN game_time TEXT;
ALTER TABLE poll_schedule ADD COLUMN max_players INTEGER;
ALTER TABLE poll_schedule ADD COLUMN min_players INTEGER;

ALTER TABLE poll_instances ADD COLUMN max_players INTEGER NOT NULL DEFAULT 18;
ALTER TABLE poll_instances ADD COLUMN min_players INTEGER NOT NULL DEFAULT 10;
