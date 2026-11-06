BEGIN;

ALTER TABLE server_instance ADD COLUMN open_registration boolean NOT NULL DEFAULT false;
GRANT UPDATE (open_registration) ON server_instance TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (85);

COMMIT;
