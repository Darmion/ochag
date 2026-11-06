BEGIN;

CREATE TABLE campaign_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  kind text NOT NULL CHECK (kind IN ('flag','number','formula','text')),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  value jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, key),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (campaign_id, updated_by) REFERENCES campaign_members(campaign_id, user_id)
);

CREATE INDEX campaign_rules_campaign ON campaign_rules(campaign_id);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON campaign_rules
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (21);

COMMIT;
