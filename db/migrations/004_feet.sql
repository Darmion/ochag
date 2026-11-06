BEGIN;

ALTER TABLE characters
  RENAME COLUMN speed_meters TO speed_feet;

UPDATE characters
SET speed_feet = round(speed_feet / 0.3048, 6);

ALTER TABLE character_vision_overrides
  RENAME COLUMN blindness_radius_meters TO blindness_radius_feet;

UPDATE character_vision_overrides
SET blindness_radius_feet =
  round(blindness_radius_feet / 0.3048, 6)
WHERE blindness_radius_feet IS NOT NULL;

ALTER TABLE scenes
  RENAME COLUMN meters_per_unit TO feet_per_unit;

UPDATE scenes
SET feet_per_unit = feet_per_unit / 0.3048;

ALTER TABLE scenes
  ALTER COLUMN feet_per_unit SET DEFAULT 5;

UPDATE characters
SET sheet_extra =
  (sheet_extra - 'darkvisionMeters'::text)
  || jsonb_build_object(
    'darkvisionFeet',
    CASE
      WHEN jsonb_typeof(sheet_extra->'darkvisionMeters') = 'number'
      THEN to_jsonb(
        round(
          (sheet_extra->>'darkvisionMeters')::numeric / 0.3048,
          6
        )
      )
      ELSE sheet_extra->'darkvisionMeters'
    END
  )
WHERE sheet_extra ? 'darkvisionMeters';

UPDATE campaigns
SET house_rules = house_rules
  || jsonb_build_object(
    'blindness'::text,
    jsonb_build_object(
      'radiusFeet'::text,
      round(
        (house_rules->'blindness'->>'radiusMeters')::numeric / 0.3048,
        6
      ),
      'blocksAlliedVision'::text,
      house_rules->'blindness'->'blocksAlliedVision'
    )
  )
WHERE jsonb_typeof(house_rules->'blindness'->'radiusMeters') = 'number';

ALTER TABLE campaigns
  ALTER COLUMN house_rules SET DEFAULT
  '{"blindness":{"radiusFeet":16.404199,"blocksAlliedVision":true}}'::jsonb;

UPDATE import_drafts
SET status = 'cancelled',
    draft_revision = draft_revision + 1
WHERE status = 'draft';

INSERT INTO schema_migrations(version) VALUES (4);

COMMIT;