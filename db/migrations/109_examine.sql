BEGIN;

CREATE TABLE character_examine (
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  skill text NOT NULL CHECK (length(skill) BETWEEN 1 AND 40),
  dc integer NOT NULL CHECK (dc BETWEEN 1 AND 40),
  dcs jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(dcs) = 'object'),
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, character_id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id) ON DELETE CASCADE
);

CREATE TABLE character_examinations (
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  examiner_id uuid NOT NULL,
  total integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, character_id, examiner_id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id, examiner_id) REFERENCES characters(campaign_id, id) ON DELETE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON character_examine TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON character_examinations TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (109);

COMMIT;
