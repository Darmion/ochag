BEGIN;

CREATE TABLE campaign_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  created_by uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, created_by) REFERENCES campaign_members(campaign_id, user_id)
);

CREATE INDEX campaign_notes_campaign ON campaign_notes(campaign_id);

CREATE TABLE campaign_note_grants (
  campaign_id uuid NOT NULL,
  note_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id),
  FOREIGN KEY (campaign_id, note_id) REFERENCES campaign_notes(campaign_id, id),
  FOREIGN KEY (campaign_id, user_id) REFERENCES campaign_members(campaign_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON campaign_notes, campaign_note_grants
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (11);

COMMIT;
