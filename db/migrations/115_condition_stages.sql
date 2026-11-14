BEGIN;

ALTER TABLE campaign_conditions ADD COLUMN stages jsonb
  CHECK (stages IS NULL OR (jsonb_typeof(stages) = 'array' AND jsonb_array_length(stages) <= 6));

ALTER TABLE campaign_conditions DROP CONSTRAINT campaign_conditions_code_check;
ALTER TABLE campaign_conditions ADD CONSTRAINT campaign_conditions_code_check CHECK (code ~ '^(custom_[a-z0-9]{6,40}|blinded|charmed|deafened|frightened|grappled|incapacitated|invisible|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious|cackle_fever|sewer_plague|sight_rot|assassins_blood|burnt_othur_fumes|crawler_mucus|drow_poison|essence_of_ether|malice|oil_of_taggit|pale_tincture|torpor|truth_serum)$');

INSERT INTO schema_migrations(version) VALUES (115);

COMMIT;
