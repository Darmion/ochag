BEGIN;

ALTER TABLE initiative_entries ADD COLUMN colossus_used boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations(version) VALUES (80);

COMMIT;
