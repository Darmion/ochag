BEGIN;

ALTER TABLE characters
  ADD COLUMN hit_die integer CHECK (hit_die IN (6, 8, 10, 12)),
  ADD COLUMN hit_dice_spent integer NOT NULL DEFAULT 0 CHECK (hit_dice_spent BETWEEN 0 AND 30);

ALTER TABLE character_resources
  ADD COLUMN recharge text NOT NULL DEFAULT 'none' CHECK (recharge IN ('none', 'short', 'long'));

INSERT INTO schema_migrations(version) VALUES (44);

COMMIT;
