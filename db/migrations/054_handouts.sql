BEGIN;

CREATE TABLE handouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  body text CHECK (body IS NULL OR length(body) <= 20000),
  asset_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  CHECK (body IS NOT NULL OR asset_id IS NOT NULL)
);

CREATE TABLE handout_recipients (
  campaign_id uuid NOT NULL,
  handout_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  shown_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (handout_id, user_id),
  FOREIGN KEY (campaign_id, handout_id) REFERENCES handouts(campaign_id, id) ON DELETE CASCADE
);

CREATE INDEX handout_recipients_user ON handout_recipients(campaign_id, user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON handouts, handout_recipients TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (54);

COMMIT;
