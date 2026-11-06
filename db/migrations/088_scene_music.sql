BEGIN;

ALTER TABLE campaign_audio
  ADD COLUMN scene_id uuid REFERENCES scenes(id) ON DELETE SET NULL;

INSERT INTO schema_migrations(version) VALUES (88);

COMMIT;
