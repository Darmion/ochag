BEGIN;

CREATE TABLE campaign_encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  members jsonb NOT NULL
    CHECK (jsonb_typeof(members) = 'array' AND jsonb_array_length(members) BETWEEN 1 AND 50),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id)
);

CREATE INDEX campaign_encounters_campaign ON campaign_encounters(campaign_id, created_at);

GRANT SELECT, INSERT, DELETE
  ON campaign_encounters
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (30);

COMMIT;
