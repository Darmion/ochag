BEGIN;

ALTER TABLE accounts ADD COLUMN can_create_campaigns boolean NOT NULL DEFAULT false;

UPDATE accounts SET can_create_campaigns = true
WHERE user_id IN (SELECT owner_user_id FROM campaigns);

GRANT UPDATE (can_create_campaigns) ON accounts TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (18);

COMMIT;
