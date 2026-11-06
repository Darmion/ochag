BEGIN;
CREATE TABLE schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  rules_base text NOT NULL DEFAULT 'dnd5e-2014',
  rules_revision integer NOT NULL DEFAULT 1 CHECK (rules_revision > 0),
  house_rules jsonb NOT NULL DEFAULT '{"blindness":{"radiusMeters":5,"blocksAlliedVision":true}}',
  fog_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(house_rules) = 'object')
);
CREATE TABLE campaign_members (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  user_id uuid NOT NULL REFERENCES users(id),
  is_full_gm boolean NOT NULL DEFAULT false,
  may_choose_allied_vision boolean NOT NULL DEFAULT false,
  selected_vision text NOT NULL DEFAULT 'own' CHECK (selected_vision IN ('own','allies')),
  fog_disabled_by_gm boolean NOT NULL DEFAULT false,
  PRIMARY KEY (campaign_id,user_id)
);
ALTER TABLE campaigns ADD CONSTRAINT owner_is_member
  FOREIGN KEY (id,owner_user_id) REFERENCES campaign_members(campaign_id,user_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE permission_catalog (
  code text PRIMARY KEY
);
INSERT INTO permission_catalog VALUES
 ('scenes.manage'),('characters.manage'),('notes.manage'),
 ('vision.manage'),('rules.manage');
CREATE TABLE member_permissions (
  campaign_id uuid NOT NULL,
  user_id uuid NOT NULL,
  permission text NOT NULL REFERENCES permission_catalog(code),
  PRIMARY KEY (campaign_id,user_id,permission),
  FOREIGN KEY (campaign_id,user_id) REFERENCES campaign_members(campaign_id,user_id)
);
CREATE TABLE characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  owner_user_id uuid,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  sheet_version integer NOT NULL DEFAULT 1 CHECK (sheet_version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  strength integer NOT NULL DEFAULT 10 CHECK (strength >= 0),
  dexterity integer NOT NULL DEFAULT 10 CHECK (dexterity >= 0),
  constitution integer NOT NULL DEFAULT 10 CHECK (constitution >= 0),
  intelligence integer NOT NULL DEFAULT 10 CHECK (intelligence >= 0),
  wisdom integer NOT NULL DEFAULT 10 CHECK (wisdom >= 0),
  charisma integer NOT NULL DEFAULT 10 CHECK (charisma >= 0),
  hp_current integer NOT NULL DEFAULT 0 CHECK (hp_current >= 0),
  hp_max integer NOT NULL DEFAULT 0 CHECK (hp_max >= 0),
  hp_temp integer NOT NULL DEFAULT 0 CHECK (hp_temp >= 0),
  armor_class integer NOT NULL DEFAULT 10,
  speed_meters numeric NOT NULL DEFAULT 0 CHECK (speed_meters >= 0),
  sheet_extra jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(sheet_extra) = 'object'),
  UNIQUE (campaign_id,id),
  FOREIGN KEY (campaign_id,owner_user_id) REFERENCES campaign_members(campaign_id,user_id)
);
CREATE INDEX characters_owner ON characters(campaign_id,owner_user_id);
CREATE TABLE import_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  created_by uuid NOT NULL,
  target_character_id uuid,
  expected_character_revision integer CHECK (expected_character_revision > 0),
  source_format text NOT NULL DEFAULT 'long-story-short-v2',
  original_document jsonb NOT NULL CHECK (jsonb_typeof(original_document) = 'object'),
  proposed_document jsonb NOT NULL CHECK (jsonb_typeof(proposed_document) = 'object'),
  field_mapping jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(field_mapping) = 'array'),
  warnings jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(warnings) = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id,created_by) REFERENCES campaign_members(campaign_id,user_id),
  FOREIGN KEY (campaign_id,target_character_id) REFERENCES characters(campaign_id,id),
  CHECK ((target_character_id IS NULL) = (expected_character_revision IS NULL))
);
CREATE TABLE scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  name text NOT NULL,
  meters_per_unit numeric NOT NULL DEFAULT 1 CHECK (meters_per_unit > 0),
  scene_document jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(scene_document) = 'object'),
  UNIQUE (campaign_id,id)
);
CREATE TABLE tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  character_id uuid,
  x double precision NOT NULL DEFAULT 0,
  y double precision NOT NULL DEFAULT 0,
  z double precision NOT NULL DEFAULT 0,
  model_asset_key text,
  animation_name text,
  FOREIGN KEY (campaign_id,scene_id) REFERENCES scenes(campaign_id,id),
  FOREIGN KEY (campaign_id,character_id) REFERENCES characters(campaign_id,id)
);
CREATE TABLE character_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  effect_code text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parameters) = 'object'),
  active boolean NOT NULL DEFAULT true,
  FOREIGN KEY (campaign_id,character_id) REFERENCES characters(campaign_id,id)
);
CREATE INDEX active_character_effects ON character_effects(campaign_id,character_id) WHERE active;
CREATE TABLE character_vision_overrides (
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  blindness_radius_meters numeric CHECK (blindness_radius_meters >= 0),
  allow_allies_while_blind boolean,
  PRIMARY KEY (campaign_id,character_id),
  FOREIGN KEY (campaign_id,character_id) REFERENCES characters(campaign_id,id)
);
INSERT INTO schema_migrations(version) VALUES (1);
COMMIT;
