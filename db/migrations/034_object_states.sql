BEGIN;

CREATE TABLE object_states (
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  openable boolean NOT NULL DEFAULT false,
  is_open boolean NOT NULL DEFAULT false,
  locked boolean NOT NULL DEFAULT false,
  lock_dc integer CHECK (lock_dc BETWEEN 1 AND 40),
  lock_known boolean NOT NULL DEFAULT false,
  break_dc integer CHECK (break_dc BETWEEN 1 AND 40),
  broken boolean NOT NULL DEFAULT false,
  trap_armed boolean NOT NULL DEFAULT false,
  trap_detect_dc integer CHECK (trap_detect_dc BETWEEN 1 AND 40),
  trap_disarm_dc integer CHECK (trap_disarm_dc BETWEEN 1 AND 40),
  trap_detected boolean NOT NULL DEFAULT false,
  trap_note text CHECK (trap_note IS NULL OR length(trap_note) <= 500),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, character_id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id),
  CHECK (openable OR NOT (is_open OR locked)),
  CHECK (NOT (locked AND is_open))
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON object_states
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (34);

COMMIT;
