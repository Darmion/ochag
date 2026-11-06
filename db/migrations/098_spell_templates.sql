BEGIN;

ALTER TABLE campaign_spells ADD COLUMN template jsonb
  CHECK (template IS NULL OR jsonb_typeof(template) = 'object');
ALTER TABLE campaign_spells ADD COLUMN template_version integer NOT NULL DEFAULT 1
  CHECK (template_version >= 1);
ALTER TABLE campaign_spells ADD COLUMN suggestions jsonb
  CHECK (suggestions IS NULL OR jsonb_typeof(suggestions) = 'object');
ALTER TABLE campaign_spells ADD COLUMN special_notify boolean NOT NULL DEFAULT true;
ALTER TABLE campaign_spells ADD COLUMN review_note text
  CHECK (review_note IS NULL OR length(review_note) <= 2000);
ALTER TABLE campaign_spells ADD COLUMN origin_spell_id uuid;

ALTER TABLE campaign_spells DROP CONSTRAINT campaign_spells_status_check;
ALTER TABLE campaign_spells ADD CONSTRAINT campaign_spells_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'rework'));

CREATE TABLE campaign_spell_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  spell_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  template jsonb NOT NULL CHECK (jsonb_typeof(template) = 'object'),
  status text NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'rework', 'applied')),
  submitted_by uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  FOREIGN KEY (campaign_id, spell_id) REFERENCES campaign_spells(campaign_id, id) ON DELETE CASCADE
);
CREATE INDEX campaign_spell_revisions_spell ON campaign_spell_revisions(campaign_id, spell_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_spell_revisions TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (98);

COMMIT;
