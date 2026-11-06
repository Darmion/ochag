BEGIN;

ALTER TABLE scenes
  ADD COLUMN mood_playlists jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(mood_playlists) = 'object');

ALTER TABLE campaign_audio
  ADD COLUMN mood text NOT NULL DEFAULT 'explore' CHECK (mood IN ('explore', 'combat', 'tension')),
  ADD COLUMN resume jsonb CHECK (resume IS NULL OR jsonb_typeof(resume) = 'object');

INSERT INTO schema_migrations(version) VALUES (59);

COMMIT;
