BEGIN;

CREATE TABLE scene_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  note_id uuid NOT NULL,
  x double precision NOT NULL CHECK (abs(x) <= 1000),
  z double precision NOT NULL CHECK (abs(z) <= 1000),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id),
  FOREIGN KEY (campaign_id, note_id) REFERENCES campaign_notes(campaign_id, id)
);

CREATE INDEX scene_pins_scene ON scene_pins(campaign_id, scene_id);
CREATE INDEX scene_pins_note ON scene_pins(campaign_id, note_id);

GRANT SELECT, INSERT, DELETE
  ON scene_pins
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (27);

COMMIT;
