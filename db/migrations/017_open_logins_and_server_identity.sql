BEGIN;

ALTER TABLE accounts DROP CONSTRAINT accounts_username_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_username_check
  CHECK (length(username) BETWEEN 1 AND 64 AND username = btrim(username));

CREATE TABLE server_instance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO server_instance DEFAULT VALUES;

GRANT SELECT ON server_instance TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (17);

COMMIT;
