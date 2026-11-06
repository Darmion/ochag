BEGIN;

CREATE TABLE roll_applications (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  roll_id uuid NOT NULL REFERENCES roll_log(id),
  character_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (roll_id, character_id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id)
);

GRANT SELECT, INSERT, DELETE ON roll_applications TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (66);

COMMIT;
