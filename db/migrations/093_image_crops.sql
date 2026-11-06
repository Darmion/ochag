BEGIN;

ALTER TABLE campaigns
  ADD COLUMN avatar_crop jsonb,
  ADD COLUMN banner_crop jsonb;

ALTER TABLE characters
  ADD COLUMN image_crop jsonb;

INSERT INTO schema_migrations(version) VALUES (93);

COMMIT;
