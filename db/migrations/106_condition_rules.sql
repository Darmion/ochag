BEGIN;

CREATE TABLE campaign_conditions (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  code text NOT NULL CHECK (code ~ '^(custom_[a-z0-9]{6,40}|blinded|charmed|deafened|frightened|grappled|incapacitated|invisible|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious)$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  icon text NOT NULL DEFAULT 'alert' CHECK (length(icon) BETWEEN 1 AND 40),
  kind text NOT NULL DEFAULT 'condition' CHECK (kind IN ('condition', 'disease', 'poison', 'curse', 'effect')),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  clauses jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(clauses) = 'array' AND jsonb_array_length(clauses) <= 40),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_conditions TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (106);

COMMIT;
