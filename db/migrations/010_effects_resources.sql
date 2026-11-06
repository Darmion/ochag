BEGIN;

GRANT INSERT, UPDATE, DELETE
  ON character_effects
  TO ttrpg_app;

CREATE TABLE character_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  current integer NOT NULL CHECK (current >= 0),
  max integer NOT NULL CHECK (max >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id)
);

CREATE INDEX character_resources_character ON character_resources(campaign_id, character_id);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON character_resources
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (10);

COMMIT;
