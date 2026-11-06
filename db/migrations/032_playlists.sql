BEGIN;

ALTER TABLE scenes
  ADD COLUMN playlist jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(playlist) = 'array' AND jsonb_array_length(playlist) <= 50);

ALTER TABLE campaign_audio
  ADD COLUMN queue jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(queue) = 'array' AND jsonb_array_length(queue) <= 50);

INSERT INTO schema_migrations(version) VALUES (32);

COMMIT;
