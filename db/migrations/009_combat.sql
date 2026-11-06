BEGIN;

ALTER TABLE scenes
  ADD COLUMN combat_round integer NOT NULL DEFAULT 1
    CHECK (combat_round > 0);

CREATE TABLE roll_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  user_id uuid NOT NULL,
  character_id uuid,
  label text CHECK (label IS NULL OR length(label) BETWEEN 1 AND 100),
  formula text NOT NULL CHECK (length(formula) BETWEEN 1 AND 20),
  dice_results jsonb NOT NULL CHECK (jsonb_typeof(dice_results) = 'array'),
  modifier integer NOT NULL,
  total integer NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, user_id) REFERENCES campaign_members(campaign_id, user_id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id)
);

CREATE INDEX roll_log_campaign ON roll_log(campaign_id, created_at DESC);

CREATE TABLE initiative_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  character_id uuid,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  score numeric NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id),
  FOREIGN KEY (campaign_id, created_by) REFERENCES campaign_members(campaign_id, user_id)
);

CREATE INDEX initiative_entries_scene ON initiative_entries(campaign_id, scene_id);

GRANT SELECT, INSERT
  ON roll_log
  TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON initiative_entries
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (9);

COMMIT;
