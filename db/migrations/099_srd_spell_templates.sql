BEGIN;

CREATE TABLE campaign_srd_templates (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  srd_index text NOT NULL CHECK (srd_index ~ '^[a-z0-9-]{1,64}$'),
  template jsonb NOT NULL CHECK (jsonb_typeof(template) = 'object'),
  template_version integer NOT NULL DEFAULT 1 CHECK (template_version >= 1),
  special_notify boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, srd_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_srd_templates TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (99);

COMMIT;
