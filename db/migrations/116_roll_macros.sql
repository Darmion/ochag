BEGIN;

CREATE TABLE roll_macros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  user_id uuid NOT NULL REFERENCES users(id),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 40),
  formula text NOT NULL CHECK (length(formula) BETWEEN 1 AND 100),
  character_id uuid,
  hidden boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id) ON DELETE SET NULL (character_id)
);

CREATE INDEX roll_macros_owner ON roll_macros(campaign_id, user_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON roll_macros TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (116);

COMMIT;
